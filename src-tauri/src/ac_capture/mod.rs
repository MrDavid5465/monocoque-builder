//! Unattended capture of a car's day/night 360° cockpit reference photos.
//!
//! Replaces doing it by hand: launch Assetto Corsa, get in the car, hide the
//! HUD, screenshot, jump to night, turn the lights on, screenshot again,
//! quit, then upload both images. The work is split three ways:
//!
//! * `preflight` swaps AC's config over (practice session, 360° display
//!   mode, upscaling off) and — importantly — puts it back afterwards.
//! * `lua_app` is a CSP Lua app that runs inside the game and drives the
//!   actual sequence, because everything it needs (entering the car, hiding
//!   apps, screenshots, the time jump, headlights, quitting) exists as a
//!   CSP Lua API and nothing external can do those things reliably.
//! * `launch` installs that app, starts the game via Steam, and waits for
//!   it to report back.
//!
//! Both frames come from one session so they stay pixel-aligned for
//! `Photo360CrossfadeViewer`, which blends between them.

pub mod content;
pub mod ini;
pub mod launch;
pub mod paths;
pub mod preflight;

pub use preflight::CaptureConfig;

use paths::CapturePaths;
use std::sync::Mutex;
use std::time::Duration;

/// Folder (and, per CSP's convention, entry-script) name of the Lua app.
pub const LUA_APP_NAME: &str = "typiql_360_capture";

/// Steam app id for Assetto Corsa.
pub const AC_STEAM_APP_ID: &str = paths::AC_STEAM_APP_ID;

/// How long to wait overall, covering the game's own startup as well as the
/// capture. Comfortably longer than the in-game guard, since a cold start
/// with a big mod folder can take minutes before the script even runs, and
/// the capture itself is supersampled and slow.
const OVERALL_TIMEOUT: Duration = Duration::from_secs(1800);

/// Progress of the capture currently running, plus how the last one ended.
///
/// `Car`/`File` records live in the typiql store, but this is transient
/// process state with no meaningful persisted form — the same reasoning as
/// `RecordingStatus` in `graphql/mod.rs`.
///
/// The outcome of the previous run is kept here too because a capture runs
/// detached from the request that started it: by the time it fails there's
/// no request left to return an error to, so the failure has to be readable
/// afterwards or it would vanish silently.
#[derive(Debug, Clone, Default)]
pub struct CaptureProgress {
    pub running: bool,
    pub car_id: Option<String>,
    pub stage: String,
    /// Why the last capture failed, if it did. Cleared when a new one starts.
    pub last_error: Option<String>,
    /// Car whose capture last completed successfully — the frontend's cue to
    /// refetch and show the new photos.
    pub last_completed_car_id: Option<String>,
}

static PROGRESS: Mutex<CaptureProgress> = Mutex::new(CaptureProgress {
    running: false,
    car_id: None,
    stage: String::new(),
    last_error: None,
    last_completed_car_id: None,
});

pub fn progress() -> CaptureProgress {
    PROGRESS
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default()
}

/// Whether a capture is already under way. Guards against a second run
/// being started while one is mid-flight, which would fight over both AC
/// and the config files.
pub fn is_running() -> bool {
    PROGRESS.lock().map(|guard| guard.running).unwrap_or(false)
}

/// Marks a capture as started, clearing the previous run's outcome.
pub fn begin(car_id: &str) {
    if let Ok(mut guard) = PROGRESS.lock() {
        guard.running = true;
        guard.car_id = Some(car_id.to_string());
        guard.stage = "Starting".to_string();
        guard.last_error = None;
        guard.last_completed_car_id = None;
    }
}

fn set_stage(car_id: &str, stage: &str) {
    if let Ok(mut guard) = PROGRESS.lock() {
        guard.running = true;
        guard.car_id = Some(car_id.to_string());
        guard.stage = stage.to_string();
    }
}

/// Records how a capture ended.
pub fn finish_progress(car_id: &str, outcome: Result<(), String>) {
    if let Ok(mut guard) = PROGRESS.lock() {
        guard.running = false;
        guard.car_id = None;
        match outcome {
            Ok(()) => {
                guard.stage = "Done".to_string();
                guard.last_completed_car_id = Some(car_id.to_string());
            }
            Err(message) => {
                guard.stage = "Failed".to_string();
                guard.last_error = Some(message);
            }
        }
    }
}

/// The two images a capture produced.
pub struct CaptureImages {
    pub day: Vec<u8>,
    pub night: Vec<u8>,
}

/// Restores config left swapped out by a previous run that never finished.
///
/// Call once on startup. A capture that died mid-run would otherwise leave
/// the user in 360° mode with upscaling disabled, which on a triple-screen
/// rig is both baffling and hard to undo by hand.
pub fn restore_pending_config() -> Result<bool, String> {
    preflight::restore_pending()
}

/// Runs one capture end to end.
///
/// AC's config is restored on every exit path — success, failure inside the
/// game, or a timeout — because the alternative is leaving someone's sim
/// rig misconfigured after a failure they didn't cause.
pub async fn run(
    config: &CaptureConfig,
    install_override: Option<&str>,
    user_override: Option<&str>,
) -> Result<CaptureImages, String> {
    let paths = CapturePaths::resolve(install_override, user_override)?;

    if launch::is_ac_running() {
        return Err(
            "Assetto Corsa is already running. Close it first — a capture has to start \
             the game itself with its own session settings."
                .to_string(),
        );
    }

    set_stage(&config.car_id, "Preparing Assetto Corsa");

    launch::install_lua_app(&paths)?;
    let journal = preflight::apply(&paths, config)?;

    // Everything from here on has to hand back to `finish` regardless of
    // outcome, so the body runs to a Result first and cleanup happens after.
    let outcome = run_session(&paths, config).await;

    set_stage(&config.car_id, "Restoring Assetto Corsa settings");
    launch::clear_job(&paths);
    let restored = preflight::finish(&journal);

    let images = outcome?;
    // A restore failure is reported even when the capture itself worked —
    // the user needs to know their settings are still swapped out.
    restored?;
    Ok(images)
}

async fn run_session(
    paths: &CapturePaths,
    config: &CaptureConfig,
) -> Result<CaptureImages, String> {
    let job_id = uuid::Uuid::new_v4().to_string();
    launch::write_job(paths, config, &job_id)?;

    set_stage(&config.car_id, "Launching Assetto Corsa");
    launch::launch(paths, AC_STEAM_APP_ID)?;

    set_stage(&config.car_id, "Capturing in game");
    let outcome = launch::wait_for_result(paths, &job_id, OVERALL_TIMEOUT).await?;
    if !outcome.ok {
        return Err(format!(
            "Capture failed in Assetto Corsa: {}",
            outcome.message
        ));
    }

    set_stage(&config.car_id, "Waiting for Assetto Corsa to close");
    launch::wait_for_exit().await;

    let out = paths.lua_out_dir();
    Ok(CaptureImages {
        day: read_image(&out.join("day.png"), "day")?,
        night: read_image(&out.join("night.png"), "night")?,
    })
}

fn read_image(path: &std::path::Path, label: &str) -> Result<Vec<u8>, String> {
    let bytes = std::fs::read(path).map_err(|err| {
        format!(
            "Couldn't read the {label} capture at {}: {err}",
            path.display()
        )
    })?;
    if bytes.is_empty() {
        return Err(format!("The {label} capture came out empty."));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs the whole automated pipeline against the real game.
    ///
    /// Covers everything the staged manual test doesn't: preflight rewriting
    /// AC's config (and restoring it), launching through Steam, waiting on
    /// the result, and shutting down. The only part left out is filing the
    /// images onto a Car record, which needs the app's data store.
    ///
    /// Assetto Corsa must be closed first. Set `MONOCOQUE_BUILDER_CAPTURE_CAR` to pick
    /// a car; the track comes from whatever `race.ini` currently points at.
    ///
    /// `#[ignore]`, and genuinely invasive — it edits real settings, though
    /// every file is journalled first and restored on the way out:
    /// `cargo test -p typiql full_capture_run -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn full_capture_run() {
        let car = std::env::var("MONOCOQUE_BUILDER_CAPTURE_CAR")
            .unwrap_or_else(|_| "ks_corvette_c7r".to_string());

        let paths = CapturePaths::resolve(None, None).expect("no Assetto Corsa install detected");
        let mut config = CaptureConfig::new(car.clone(), String::new());
        let (track, layout) =
            preflight::current_track(&paths).expect("no track in race.ini — launch AC once");
        config.track_id = track.clone();
        config.track_layout = layout;

        println!("car   : {car}");
        println!("track : {track}");
        println!("output: {}x{}", config.width, config.height);
        println!("Launching Assetto Corsa. It will close itself when done.\n");

        // Progress is process-global, so a watcher thread can narrate the run
        // rather than leaving several minutes of silence.
        let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let watcher_done = done.clone();
        let watcher = std::thread::spawn(move || {
            let mut last = String::new();
            while !watcher_done.load(std::sync::atomic::Ordering::Relaxed) {
                let stage = progress().stage;
                if stage != last && !stage.is_empty() {
                    println!("  → {stage}");
                    last = stage;
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        });

        let outcome = tokio::runtime::Runtime::new()
            .expect("couldn't start a runtime")
            .block_on(run(&config, None, None));

        done.store(true, std::sync::atomic::Ordering::Relaxed);
        watcher.join().ok();

        match outcome {
            Ok(images) => {
                println!(
                    "\nOK — day {:.1} MB, night {:.1} MB",
                    images.day.len() as f64 / 1e6,
                    images.night.len() as f64 / 1e6
                );
                assert!(!images.day.is_empty() && !images.night.is_empty());
            }
            Err(err) => panic!("capture failed: {err}"),
        }
    }

    /// Puts AC's settings back if a run died before it could.
    ///
    /// The app does this on startup, but during testing there may be no app
    /// start between attempts — so this is the manual equivalent.
    /// `cargo test -p typiql restore_ac_config -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn restore_ac_config() {
        match restore_pending_config() {
            Ok(true) => println!("Restored settings from an interrupted capture."),
            Ok(false) => println!("Nothing to restore — no journal present."),
            Err(err) => panic!("restore failed: {err}"),
        }
    }
}
