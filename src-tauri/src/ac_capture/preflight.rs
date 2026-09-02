//! Swapping AC's config over for a capture, and putting it back afterwards.
//!
//! A capture has to change settings that belong to the user: which session
//! launches, what the display mode is, and whether upscaling is on. None of
//! that can be done live — CSP marks the upscaling keys
//! `not available with IS_LIVE__` and tells you to restart the game — so the
//! files are edited on disk before launch.
//!
//! That makes putting them back the most safety-critical part of this
//! feature. Every file is snapshotted verbatim into a restore journal
//! *before* the first edit, and the journal is written to disk before AC is
//! ever started. If a run dies half way — crash, power cut, someone killing
//! the process — the journal survives, and `restore_pending` puts everything
//! back on the next start. Without that, a failed capture would leave a
//! triple-screen rig stuck in 360° mode with upscaling off and no obvious
//! way back.

use super::ini;
use super::paths::CapturePaths;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The value `[CAMERA] MODE` takes for CSP's 360° rendering mode.
///
/// CSP registers its custom display modes internally rather than declaring
/// them in any config file, so this can't be derived from the install. Read
/// instead out of a saved Content Manager video preset ("360 mode.cmpreset"
/// under `AppData/Local/AcTools Content Manager/Presets/Video Settings`),
/// whose `VideoData` differs from the triple-screen preset by exactly this
/// key plus the resolution. Still overridable, since a CSP update could
/// rename it.
pub const DEFAULT_DISPLAY_MODE_360: &str = "__EXT_360";

/// AC's session type for Practice.
const SESSION_TYPE_PRACTICE: &str = "1";

/// Everything a capture needs to reconfigure, with defaults that suit a
/// cockpit reference shot.
#[derive(Debug, Clone)]
pub struct CaptureConfig {
    /// AC car folder id, e.g. `ks_porsche_962c_shorttail`.
    pub car_id: String,
    /// AC track folder id.
    pub track_id: String,
    /// Track layout, for tracks that have several (`CONFIG_TRACK`).
    pub track_layout: Option<String>,
    /// `[CAMERA] MODE` value that selects 360° rendering.
    pub display_mode: String,
    /// Capture resolution. Must be 2:1 — that's the aspect an
    /// equirectangular image is defined at, and CSP renders the 360° view to
    /// fill whatever framebuffer it's given.
    ///
    /// Larger than the physical display is fine, and wanted: these get
    /// zoomed into. The catch is that it only holds *windowed*. In
    /// fullscreen the Wayland compositor hands the game the display's own
    /// geometry, which on a 7680×2160 desktop squashed the sphere into
    /// 3.56:1 — complete (measured: top and bottom rows near-uniform, so
    /// real poles) but the wrong shape, and unfixable afterwards without
    /// scaling 2160 rows up to 3840 and inventing the difference.
    ///
    /// Windowed, the requested size is honoured as-is, so this can be as
    /// large as the GPU will stand.
    pub width: u32,
    pub height: u32,
    /// Per-cube-face resolution for 360° mode. The scene is rendered six
    /// times at this size, so it trades quality against capture time
    /// steeply.
    pub frame_resolution: u32,
    /// Whether to force upscaling off. 360° mode doesn't render correctly
    /// with it enabled on current CSP builds.
    pub disable_upscaling: bool,
    /// Whether to turn down world/scenery detail. 360° mode renders the
    /// scene six times over, so anything that isn't the car is worth
    /// giving up — but only up to the point where it starts changing how
    /// the car itself looks (see `apply_quality_edits`).
    pub reduce_world_quality: bool,
    /// How far to jump the clock for the night frame, in seconds. 12h by
    /// default, matching the "+12h" button in CSP's debug app.
    pub night_offset_seconds: u32,
    /// Seconds to let the car come to rest after being teleported.
    ///
    /// `physics.teleportCarTo` drops the car in rather than setting it
    /// down — observed landing hard enough to roll onto its side — so it
    /// needs time to land and stop bouncing before anything is photographed.
    pub place_settle_seconds: f32,
    /// Seconds to let the scene settle before the day frame.
    pub day_settle_seconds: f32,
    /// Seconds to settle before the night frame. Longer than the day one:
    /// auto-exposure has to adapt to the light collapsing, and shooting
    /// early yields a frame caught mid-adaptation.
    pub night_settle_seconds: f32,
    /// Guard inside the game, after which the Lua app gives up and reports
    /// rather than leaving AC running with the user's config swapped out.
    pub in_game_timeout_seconds: u32,
    /// Supersampling factor for the screenshot itself, 1–4.
    ///
    /// Stacks on top of the window size: CSP's Nice Screenshots renders the
    /// shot at this multiple of the framebuffer, so an 8192×4096 window at
    /// ×2 produces a genuine 16384×8192 image. Real rendered detail, unlike
    /// scaling a finished image up.
    ///
    /// **×2 is the practical ceiling from an 8192-wide window.** D3D11 caps
    /// texture dimensions at 16384, which ×2 hits exactly; ×3 would need
    /// 24576 and cannot be allocated. The same ceiling applies whichever way
    /// it's reached — a 4096-wide window at ×4 lands in the same place — so
    /// 16384×8192 is the most this pipeline can produce at all.
    ///
    /// Costs rise sharply either way: CSP warns "videocards are no good at
    /// handling huge textures", and each step multiplies the accumulation
    /// sample count (×2 means four times as many shots), which is why
    /// `accumulation_iterations` comes down as this goes up.
    pub screenshot_multiplier: u32,
    /// Accumulation-AA samples per screenshot.
    ///
    /// CSP's stock 24 is tuned for ×1. At higher multipliers the sample
    /// count is already multiplied by the extra pixels, so this comes down
    /// to keep a capture from taking minutes per frame.
    pub accumulation_iterations: u32,
    /// Where the *session* spawns the car, written to `race.ini`.
    ///
    /// Set to the same place the photo is taken, so the car is put there by
    /// the game rather than moved afterwards. `physics.teleportCarTo` drops
    /// the car in from above — observed landing hard enough to roll onto its
    /// side, and once onto grass beside the track — whereas the session's
    /// own spawn places it correctly on the racing line, upright and still.
    ///
    /// This is only viable because the session can now be started without a
    /// pits menu: `ac.tryToStart` is called from the `IN_GAME` UI callback,
    /// which runs before the session is live. While the start logic lived in
    /// `update()` (which doesn't tick until afterwards) a pit spawn was the
    /// only way to get a menu for it to press, and the run otherwise waited
    /// forever for a human to press the wheel button bound to
    /// `__CM_START_STOP_SESSION`.
    pub session_spawn_set: String,
    /// Where the car should be when photographed, as an `ac.SpawnSet` value.
    ///
    /// `HOTLAP_START`: pit lane is normally floodlit, which washes out the
    /// night frame that exists specifically to show a lit dashboard, and a
    /// track position is the same for every car regardless of pit
    /// allocation.
    ///
    /// When this matches `session_spawn_set` — the normal case — the game
    /// has already put the car there and nothing needs moving. They only
    /// differ if a session can't spawn where the photo wants to be taken, in
    /// which case the capture teleports and accepts the rough landing.
    pub spawn_set: String,
    /// Whether the Lua app quits Assetto Corsa once it's finished.
    ///
    /// Always true for a real capture — the run is unattended and the config
    /// stays swapped out until the game exits. Turned off when staging a
    /// capture by hand, so the session stays open and the result can be
    /// looked at in place.
    pub shutdown_when_done: bool,
}

impl CaptureConfig {
    pub fn new(car_id: impl Into<String>, track_id: impl Into<String>) -> Self {
        Self {
            car_id: car_id.into(),
            track_id: track_id.into(),
            track_layout: None,
            display_mode: DEFAULT_DISPLAY_MODE_360.to_string(),
            // Matches the saved "360 mode" preset, and confirmed rendering
            // correctly at this size once fullscreen is off.
            width: 8192,
            height: 4096,
            frame_resolution: 2048,
            disable_upscaling: true,
            reduce_world_quality: true,
            night_offset_seconds: 12 * 60 * 60,
            place_settle_seconds: 3.0,
            day_settle_seconds: 1.5,
            night_settle_seconds: 4.0,
            // Generous because a supersampled capture is genuinely slow:
            // every accumulation sample is a full 16384×8192 render, and
            // there are two frames to take. CSP expects this too — it offers
            // to save partial images every 30s for long shots. The guard is
            // only there to stop a wedged run leaving the game up with the
            // user's config swapped out, so it costs nothing to be patient.
            in_game_timeout_seconds: 900,
            // 1, established the hard way: ×2 on top of this window crashed
            // the game. CSP renders the 360° target as R16G16B16A16_FLOAT —
            // 8 bytes a pixel, so 268 MB at 8192×4096 — and ×2 asks for
            // 16384×8192, over a gigabyte for one buffer, on top of the six
            // cube faces 360° mode already needs. The log got as far as
            // "Making a shot: 8 samples" and died there, having previously
            // failed to create even the ×1 target at one point.
            //
            // For more resolution, raise `width`/`height` instead. Window
            // size costs memory linearly, where the multiplier costs it
            // fourfold and adds an accumulation buffer besides — and a
            // natively-rendered 8192×4096 beats the same size supersampled
            // up from 4096×2048 anyway.
            screenshot_multiplier: 1,
            // Below CSP's stock 24 because every sample is a full 33
            // megapixel render, and `DO_NOT_BLOCK=0` means accumulation now
            // definitely runs rather than being skipped. 8 was reached
            // without trouble in testing.
            accumulation_iterations: 8,
            session_spawn_set: "HOTLAP_START".to_string(),
            spawn_set: "HOTLAP_START".to_string(),
            shutdown_when_done: true,
        }
    }
}

/// One file as it was before the capture touched it.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct JournalEntry {
    path: PathBuf,
    /// Whether the file existed at all. A CSP override file that didn't
    /// exist has to be *deleted* on restore, not written back empty —
    /// leaving a stub behind would override CSP's defaults with nothing.
    existed: bool,
    contents: Option<String>,
}

/// The set of files a capture has swapped out, persisted so a crashed run
/// can still be undone later.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RestoreJournal {
    entries: Vec<JournalEntry>,
}

/// Where the journal lives.
///
/// Deliberately under the config directory rather than the cache: losing it
/// means being unable to restore the user's own settings, which is not a
/// disposable-derived-data risk worth taking.
pub fn journal_path() -> PathBuf {
    dirs::config_dir()
        .map(|dir| dir.join("dashboard-designer"))
        .unwrap_or_else(|| PathBuf::from("data/typiql"))
        .join("ac-capture-restore.json")
}

impl RestoreJournal {
    /// Records a file's current contents, once. Repeated calls for the same
    /// path keep the first snapshot, so the journal always describes the
    /// state from *before* this capture rather than an intermediate one.
    fn snapshot(&mut self, path: &Path) -> Result<(), String> {
        if self.entries.iter().any(|entry| entry.path == path) {
            return Ok(());
        }
        let (existed, contents) = match std::fs::read_to_string(path) {
            Ok(text) => (true, Some(text)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => (false, None),
            // Notably includes "not valid UTF-8": these are Windows-authored
            // files and could in principle be Windows-1252. Failing here is
            // the safe direction — it happens before anything is modified —
            // but the raw io error alone wouldn't explain that.
            Err(err) => {
                return Err(format!(
                    "Couldn't read {} ({err}). A capture won't change any settings it \
                     can't first back up.",
                    path.display()
                ))
            }
        };
        self.entries.push(JournalEntry {
            path: path.to_path_buf(),
            existed,
            contents,
        });
        Ok(())
    }

    /// Persists the journal. Called before the first edit — a journal that
    /// only reached disk after the edits would be useless for exactly the
    /// crash it exists to survive.
    fn persist(&self) -> Result<(), String> {
        let path = journal_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("Couldn't create {}: {err}", parent.display()))?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|err| format!("Couldn't serialise the restore journal: {err}"))?;
        std::fs::write(&path, json)
            .map_err(|err| format!("Couldn't write {}: {err}", path.display()))
    }

    /// Puts every recorded file back and clears the journal.
    ///
    /// Restores as much as it can even if one file fails, so a single
    /// unwritable path can't strand the rest of the user's settings.
    fn restore(&self) -> Result<(), String> {
        let mut failures = Vec::new();
        for entry in &self.entries {
            let outcome = if entry.existed {
                std::fs::write(&entry.path, entry.contents.as_deref().unwrap_or_default())
                    .map_err(|err| format!("{}: {err}", entry.path.display()))
            } else {
                match std::fs::remove_file(&entry.path) {
                    Ok(()) => Ok(()),
                    Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
                    Err(err) => Err(format!("{}: {err}", entry.path.display())),
                }
            };
            if let Err(message) = outcome {
                failures.push(message);
            }
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "Couldn't restore some Assetto Corsa settings: {}",
                failures.join("; ")
            ))
        }
    }
}

/// Restores a journal left behind by an earlier run, if there is one.
///
/// Called on startup. Returns whether anything was restored, so the caller
/// can say so rather than silently repairing the user's config.
pub fn restore_pending() -> Result<bool, String> {
    let path = journal_path();
    let Ok(json) = std::fs::read_to_string(&path) else {
        return Ok(false);
    };
    let journal: RestoreJournal = serde_json::from_str(&json).map_err(|err| {
        format!(
            "Couldn't read the restore journal at {}: {err}",
            path.display()
        )
    })?;
    journal.restore()?;
    let _ = std::fs::remove_file(&path);
    Ok(!journal.entries.is_empty())
}

/// Snapshots and rewrites AC's config for a capture.
///
/// The journal is returned so the caller can restore it once the run ends;
/// it's already on disk by the time this returns.
pub fn apply(paths: &CapturePaths, config: &CaptureConfig) -> Result<RestoreJournal, String> {
    let race_ini = paths.race_ini();
    let video_ini = paths.video_ini();
    let graphics_ini = paths.ext_cfg("graphics_adjustments.ini");
    let modes_ini = paths.ext_cfg("custom_rendering_modes.ini");
    let screenshots_ini = paths.ext_cfg("nice_screenshots.ini");

    let mut journal = RestoreJournal::default();
    journal.snapshot(&race_ini)?;
    journal.snapshot(&video_ini)?;
    if config.disable_upscaling {
        journal.snapshot(&graphics_ini)?;
    }
    journal.snapshot(&modes_ini)?;
    journal.snapshot(&screenshots_ini)?;
    // On disk before anything is modified — see this module's doc comment.
    journal.persist()?;

    write_race_ini(&race_ini, config)?;
    write_video_ini(&video_ini, config)?;
    write_modes_ini(&modes_ini, config)?;
    write_screenshot_quality(&screenshots_ini, config)?;
    if config.disable_upscaling {
        write_upscaling_off(&graphics_ini)?;
    }

    Ok(journal)
}

/// Restores config after a run and drops the journal.
pub fn finish(journal: &RestoreJournal) -> Result<(), String> {
    journal.restore()?;
    let _ = std::fs::remove_file(journal_path());
    Ok(())
}

/// The track `race.ini` currently points at, as `(track, layout)`.
///
/// Used as the default place to shoot a car. It's a better default than any
/// hardcoded track name: whatever is in there was genuinely launched on this
/// install at some point, so it's guaranteed to exist and to have a valid
/// layout — a hardcoded favourite might simply not be installed.
pub fn current_track(paths: &CapturePaths) -> Option<(String, Option<String>)> {
    let text = std::fs::read_to_string(paths.race_ini()).ok()?;
    let track = ini::get_value(&text, "RACE", "TRACK").filter(|value| !value.is_empty())?;
    let layout = ini::get_value(&text, "RACE", "CONFIG_TRACK").filter(|value| !value.is_empty());
    Some((track, layout))
}

fn read_or_empty(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(format!("Couldn't read {}: {err}", path.display())),
    }
}

fn write(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Couldn't create {}: {err}", parent.display()))?;
    }
    std::fs::write(path, text).map_err(|err| format!("Couldn't write {}: {err}", path.display()))
}

/// Points `race.ini` at a solo practice session in the requested car.
fn write_race_ini(path: &Path, config: &CaptureConfig) -> Result<(), String> {
    let mut text = read_or_empty(path)?;

    for (section, key, value) in [
        ("RACE", "TRACK", config.track_id.as_str()),
        (
            "RACE",
            "CONFIG_TRACK",
            config.track_layout.as_deref().unwrap_or(""),
        ),
        ("RACE", "MODEL", config.car_id.as_str()),
        ("RACE", "CARS", "1"),
        ("RACE", "AI_LEVEL", "100"),
        ("RACE", "DRIFT_MODE", "0"),
        ("RACE", "RACE_LAPS", "0"),
        ("RACE", "PENALTIES", "0"),
        // `-` means "the car named in [RACE]", which is how AC's own
        // launcher writes a single-car session.
        ("CAR_0", "MODEL", "-"),
        ("CAR_0", "BALLAST", "0"),
        ("CAR_0", "RESTRICTOR", "0"),
        // A practice session of no fixed length: nothing here ever needs
        // it to end on its own, the Lua app quits the game when it's done.
        ("SESSION_0", "NAME", "Practice"),
        ("SESSION_0", "TYPE", SESSION_TYPE_PRACTICE),
        ("SESSION_0", "DURATION_MINUTES", "0"),
        // Set explicitly rather than inherited: whatever Content Manager
        // last wrote here decides whether there's a pits menu for
        // `ac.tryToStart` to press, and without one the session waits for a
        // human. The car gets moved to its real position afterwards.
        ("SESSION_0", "SPAWN_SET", config.session_spawn_set.as_str()),
        // Everything below turns off a mode that would otherwise hijack
        // the launch. REMOTE especially: it can still be pointing at the
        // last multiplayer server joined, in which case AC would connect
        // to it instead of starting the local session this capture needs.
        ("REMOTE", "ACTIVE", "0"),
        ("REPLAY", "ACTIVE", "0"),
        ("BENCHMARK", "ACTIVE", "0"),
        ("RESTART", "ACTIVE", "0"),
        ("GHOST_CAR", "ENABLED", "0"),
        ("GHOST_CAR", "PLAYING", "0"),
        ("GHOST_CAR", "RECORDING", "0"),
        ("__PREVIEW_GENERATION", "ACTIVE", "0"),
    ] {
        text = ini::set_value(&text, section, key, value);
    }

    write(path, &text)
}

/// Switches the display over to 360° mode at a 2:1 capture resolution.
fn write_video_ini(path: &Path, config: &CaptureConfig) -> Result<(), String> {
    let mut text = read_or_empty(path)?;

    text = ini::set_value(&text, "CAMERA", "MODE", &config.display_mode);
    text = ini::set_value(&text, "VIDEO", "WIDTH", &config.width.to_string());
    text = ini::set_value(&text, "VIDEO", "HEIGHT", &config.height.to_string());
    // Windowed. Fullscreen would be handed the display's own geometry,
    // which is exactly what has to be avoided here — the capture needs a
    // 2:1 framebuffer, and no real monitor layout is 2:1. Windowed at a
    // size that fits is honoured as requested.
    text = ini::set_value(&text, "VIDEO", "FULLSCREEN", "0");

    // CSP states plainly that its custom rendering modes "require
    // post-processing and FXAA in AC video settings enabled to work" — so
    // these are switched ON for a capture even though this function is
    // otherwise busy turning things down. Getting this wrong doesn't
    // degrade the shot, it stops 360° mode working at all.
    text = ini::set_value(&text, "POST_PROCESS", "ENABLED", "1");
    text = ini::set_value(&text, "POST_PROCESS", "FXAA", "1");

    if config.reduce_world_quality {
        text = apply_quality_edits(text);
    }

    write(path, &text)
}

/// Turns down what the car doesn't depend on.
///
/// The line drawn here matters: the subject of the photo is the cockpit, and
/// several "scenery" settings feed straight back onto it. Cubemap
/// reflections show up in the paint, the glass and the instrument covers,
/// and post-processing governs exposure — so those are deliberately left
/// alone. What's turned down is genuinely external: world/scenery detail,
/// smoke and mirror rendering cost, which 360° mode otherwise pays for six
/// times over.
fn apply_quality_edits(mut text: String) -> String {
    for (section, key, value) in [
        ("ASSETTOCORSA", "WORLD_DETAIL", "0"),
        ("EFFECTS", "SMOKE", "0"),
        ("EFFECTS", "RENDER_SMOKE_IN_MIRROR", "0"),
        ("EFFECTS", "MOTION_BLUR", "0"),
        // Mirrors stay enabled — they're part of the cockpit and show in
        // the sphere — but not at high quality, which is a per-frame
        // render cost multiplied by every cube face.
        ("MIRROR", "HQ", "0"),
        ("VIDEO", "SHADOW_MAP_SIZE", "1024"),
    ] {
        text = ini::set_value(&text, section, key, value);
    }
    text
}

/// Sets the per-face resolution 360° mode renders at.
fn write_modes_ini(path: &Path, config: &CaptureConfig) -> Result<(), String> {
    let text = read_or_empty(path)?;
    let updated = ini::set_value(
        &text,
        "MODE_360",
        "FRAME_RESOLUTION",
        &config.frame_resolution.to_string(),
    );
    write(path, &updated)
}

/// Turns CSP's screenshot pipeline up for a capture.
///
/// These photos get zoomed into — they're reference material for tracing a
/// dashboard, not thumbnails — so sharpness matters more than capture speed.
/// Three things are adjusted, all restored afterwards:
///
/// * `RESOLUTION_MULTIPLIER` supersamples the shot above the window size.
///   This is the only way to exceed the framebuffer with genuinely rendered
///   detail; the alternative, a larger window, is capped by the desktop.
/// * `RANGE_MULT` is reduced. It sets how far the camera jitters within a
///   pixel between accumulation samples, and CSP notes that decreasing it
///   makes the image sharper — jitter that's good for anti-aliasing a moving
///   scene just softens a still.
/// * `MIP_LOD_BIAS` is pushed more negative for sharper textures.
///
/// `DO_NOT_BLOCK` is switched off as well: left on, CSP skips exactly these
/// expensive options when it considers the car to be driving, which would
/// silently produce an ordinary-resolution shot instead.
fn write_screenshot_quality(path: &Path, config: &CaptureConfig) -> Result<(), String> {
    let mut text = read_or_empty(path)?;

    text = ini::set_value(&text, "BASIC", "ENABLED", "1");
    text = ini::set_value(&text, "BASIC", "DO_NOT_BLOCK", "0");

    text = ini::set_value(&text, "ACCUMULATION_AA", "ENABLED", "1");
    text = ini::set_value(
        &text,
        "ACCUMULATION_AA",
        "RESOLUTION_MULTIPLIER",
        &config.screenshot_multiplier.clamp(1, 4).to_string(),
    );
    text = ini::set_value(
        &text,
        "ACCUMULATION_AA",
        "ITERATIONS",
        &config.accumulation_iterations.clamp(4, 80).to_string(),
    );
    text = ini::set_value(&text, "ACCUMULATION_AA", "RANGE_MULT", "0.5");
    text = ini::set_value(&text, "ACCUMULATION_AA", "MIP_LOD_BIAS", "-3");

    write(path, &text)
}

/// Forces upscaling off, since 360° mode doesn't render correctly with it on.
///
/// `[FSR] ACTIVE` is the switch, confirmed against both the live
/// `graphics_adjustments.ini` and Content Manager's own CSP preset, which
/// writes `[GRAPHICS_ADJUSTMENTS:FSR] ACTIVE`. The other keys in that section
/// (`OLD_IMPLEMENTATION`, `QUALITY_*`, `OPTISCALER_*`) select and tune which
/// upscaler runs, and don't need touching when the whole thing is off.
fn write_upscaling_off(path: &Path) -> Result<(), String> {
    let text = read_or_empty(path)?;
    let updated = ini::set_value(&text, "FSR", "ACTIVE", "0");
    write(path, &updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> CaptureConfig {
        CaptureConfig::new("ks_toyota_ae86", "ks_brands_hatch")
    }

    #[test]
    fn race_ini_disables_the_remote_session() {
        let dir = std::env::temp_dir().join(format!("typiql-race-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("race.ini");
        // A leftover multiplayer session, which is what AC would otherwise
        // rejoin instead of starting the capture's practice session.
        std::fs::write(&path, "[REMOTE]\nACTIVE=1\nSERVER_IP=1.2.3.4\n").unwrap();

        write_race_ini(&path, &config()).unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(
            ini::get_value(&text, "REMOTE", "ACTIVE").as_deref(),
            Some("0")
        );
        assert_eq!(
            ini::get_value(&text, "RACE", "MODEL").as_deref(),
            Some("ks_toyota_ae86")
        );
        assert_eq!(
            ini::get_value(&text, "SESSION_0", "TYPE").as_deref(),
            Some(SESSION_TYPE_PRACTICE)
        );
        // Untouched keys survive.
        assert_eq!(
            ini::get_value(&text, "REMOTE", "SERVER_IP").as_deref(),
            Some("1.2.3.4")
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn video_ini_keeps_post_processing_on_while_reducing_scenery() {
        let dir = std::env::temp_dir().join(format!("typiql-video-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("video.ini");
        std::fs::write(
            &path,
            "[CAMERA]\nMODE=TRIPLE\n\n[POST_PROCESS]\nENABLED=0\nFXAA=0\n\n[ASSETTOCORSA]\nWORLD_DETAIL=5\n",
        )
        .unwrap();

        write_video_ini(&path, &config()).unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(
            ini::get_value(&text, "CAMERA", "MODE").as_deref(),
            Some(DEFAULT_DISPLAY_MODE_360)
        );
        // 360 mode depends on both of these being on.
        assert_eq!(
            ini::get_value(&text, "POST_PROCESS", "ENABLED").as_deref(),
            Some("1")
        );
        assert_eq!(
            ini::get_value(&text, "POST_PROCESS", "FXAA").as_deref(),
            Some("1")
        );
        assert_eq!(
            ini::get_value(&text, "ASSETTOCORSA", "WORLD_DETAIL").as_deref(),
            Some("0")
        );
        // 2:1, not the user's own aspect ratio.
        assert_eq!(
            ini::get_value(&text, "VIDEO", "WIDTH").as_deref(),
            Some("8192")
        );
        assert_eq!(
            ini::get_value(&text, "VIDEO", "HEIGHT").as_deref(),
            Some("4096")
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn restores_edited_files_and_removes_ones_that_did_not_exist() {
        let dir = std::env::temp_dir().join(format!("typiql-journal-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let existing = dir.join("existing.ini");
        let absent = dir.join("absent.ini");
        std::fs::write(&existing, "[A]\nX=1\n").unwrap();

        let mut journal = RestoreJournal::default();
        journal.snapshot(&existing).unwrap();
        journal.snapshot(&absent).unwrap();

        std::fs::write(&existing, "[A]\nX=999\n").unwrap();
        std::fs::write(&absent, "[B]\nY=2\n").unwrap();

        journal.restore().unwrap();

        assert_eq!(std::fs::read_to_string(&existing).unwrap(), "[A]\nX=1\n");
        // A CSP override that didn't exist must go away again, not linger
        // as a stub shadowing CSP's own defaults.
        assert!(!absent.exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn snapshot_keeps_the_earliest_state_of_a_file() {
        let dir = std::env::temp_dir().join(format!("typiql-snap-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("f.ini");
        std::fs::write(&path, "original").unwrap();

        let mut journal = RestoreJournal::default();
        journal.snapshot(&path).unwrap();
        std::fs::write(&path, "modified").unwrap();
        journal.snapshot(&path).unwrap();
        journal.restore().unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "original");
        std::fs::remove_dir_all(&dir).ok();
    }
}
