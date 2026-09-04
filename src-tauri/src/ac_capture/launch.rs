//! Installing the capture app into AC, starting the game, and waiting for
//! the result.

use super::paths::{self, CapturePaths};
use super::{CaptureConfig, LUA_APP_NAME};
use std::path::Path;
use std::time::Duration;

/// The Lua app is embedded rather than shipped as a bundle resource.
///
/// TyPiQL ships as deb, rpm, AppImage and Flatpak, and each of those
/// resolves resource paths differently (the Flatpak one from inside a
/// sandbox). Embedding the two files sidesteps that entirely — there's no
/// runtime path to get wrong, and the app that gets installed always matches
/// the binary that installed it.
const MANIFEST: &str = include_str!("lua_app/manifest.ini");
const SCRIPT: &str = include_str!("lua_app/typiql_360_capture.lua");
/// Needed for the app to appear in AC's drawer at all — see manifest.ini.
const ICON: &[u8] = include_bytes!("lua_app/icon.png");

/// AC's process name, as `pgrep -x` sees it under Proton.
const AC_PROCESS: &str = "acs.exe";

/// What Steam launches, and therefore what Content Manager renames itself to
/// on a CM install (see `start_ac`). Tracked separately from `AC_PROCESS`
/// because CM sitting idle in its UI is invisible to every other signal:
/// `acs.exe` is absent and no telemetry is being published, so a capture
/// happily starts a SECOND process inside a Proton prefix CM already holds.
const AC_LAUNCHER_PROCESS: &str = "AssettoCorsa.exe";

/// How long to wait for AC to exit on its own after the script asks it to.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(30);

/// What the Lua app reported back.
#[derive(Debug, Clone)]
pub struct CaptureOutcome {
    pub ok: bool,
    pub message: String,
}

/// Writes the capture app into AC's `apps/lua` folder.
///
/// Rewritten on every run rather than only when missing, so a stale copy
/// from an older TyPiQL can't quietly keep running against a newer job
/// format.
pub fn install_lua_app(paths: &CapturePaths) -> Result<(), String> {
    let dir = paths.lua_app_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("Couldn't create {}: {err}", dir.display()))?;

    write(&dir.join("manifest.ini"), MANIFEST)?;
    // CSP requires the entry script to be named after its folder.
    write(&dir.join(format!("{LUA_APP_NAME}.lua")), SCRIPT)?;
    let icon = dir.join("icon.png");
    std::fs::write(&icon, ICON)
        .map_err(|err| format!("Couldn't write {}: {err}", icon.display()))?;

    let out = paths.lua_out_dir();
    std::fs::create_dir_all(&out)
        .map_err(|err| format!("Couldn't create {}: {err}", out.display()))?;
    // Clear anything from a previous run so a stale image or result can
    // never be mistaken for this one's.
    for name in ["day.png", "night.png", "result.ini"] {
        let _ = std::fs::remove_file(out.join(name));
    }
    Ok(())
}

/// Queues a job for the Lua app.
///
/// Written last, immediately before launch: the app treats the presence of
/// this file as "TyPiQL asked for a capture", and consumes it on startup so
/// an ordinary play session later never re-triggers one.
pub fn write_job(paths: &CapturePaths, config: &CaptureConfig, job_id: &str) -> Result<(), String> {
    let job = format!(
        "[JOB]\n\
         ID={job_id}\n\
         CAR_ID={car}\n\
         NIGHT_OFFSET_SECONDS={night_offset}\n\
         DAY_SETTLE_SECONDS={day_settle}\n\
         NIGHT_SETTLE_SECONDS={night_settle}\n\
         TIMEOUT_SECONDS={timeout}\n\
         SPAWN_SET={spawn_set}\n\
         TELEPORT={teleport}\n\
         PLACE_SETTLE_SECONDS={place_settle}\n\
         SHUTDOWN_WHEN_DONE={shutdown}\n",
        job_id = job_id,
        car = config.car_id,
        night_offset = config.night_offset_seconds,
        day_settle = config.day_settle_seconds,
        night_settle = config.night_settle_seconds,
        timeout = config.in_game_timeout_seconds,
        spawn_set = config.spawn_set,
        // Only move the car if the session couldn't spawn it where the photo
        // is taken. Teleporting drops it in from above, so it's a fallback,
        // not the normal path.
        teleport = i32::from(config.spawn_set != config.session_spawn_set),
        place_settle = config.place_settle_seconds,
        shutdown = if config.shutdown_when_done { 1 } else { 0 },
    );
    write(&paths.lua_app_dir().join("job.ini"), &job)
}

/// Removes a queued job that never got consumed.
///
/// Matters when a launch fails before AC ever read it: leaving the file
/// behind would arm a capture on the user's next ordinary session.
pub fn clear_job(paths: &CapturePaths) {
    let _ = std::fs::remove_file(paths.lua_app_dir().join("job.ini"));
}

/// Whether a sim is currently running.
///
/// Reads the same `/dev/shm/SIMAPI.DAT` this app already takes telemetry
/// from, rather than looking for the process. That's deliberate, and follows
/// what monocoque does: `simapi_get_sim()` checks SIMAPI.DAT before it ever
/// scans `/proc`, so it works against a *host* simd from inside a sandbox.
///
/// Scanning for the process instead would break under Flatpak, which gives
/// each sandbox its own PID namespace with no way to share the host's —
/// measured on this project's sibling monocoque packaging at 5 visible pids
/// inside versus 497 outside, and unchanged by `--allow=devel` or
/// `--filesystem=host`. Getting host process visibility needs
/// `flatpak-spawn --host` and the broad `--talk-name=org.freedesktop.Flatpak`
/// permission that goes with it; reading shared memory needs neither.
///
/// `pgrep` is still consulted as a second opinion, since it costs nothing and
/// is accurate on a native build even when simd isn't running to publish
/// telemetry. Either signal saying "running" counts: a false positive only
/// produces a "close the game first" message, while a false negative would
/// start a second copy on top of a live session.
pub fn is_ac_running() -> bool {
    let sim_is_live = crate::telemetry::read_simdata()
        .map(crate::telemetry::build_frame)
        .is_some_and(|frame| {
            frame.simon || frame.sim_status != crate::telemetry::types::SimStatus::Off
        });

    sim_is_live || crate::process_liveness::is_running(AC_PROCESS)
}

/// Whether the launcher — Content Manager, on an install where it has taken
/// over `AssettoCorsa.exe` — is running.
///
/// Separate from `is_ac_running` because it needs its own message: the game
/// is not running in any sense the user would recognise, so "close the game
/// first" is unhelpful and looks wrong.
///
/// Worth guarding at all because a capture launched alongside a resident CM
/// fails in a way that points nowhere near the cause: the second process into
/// the prefix cannot create a D3D11 device, and AC dies 1.7 seconds in having
/// logged only `DX11 Device creation FAILED`. Starting the same capture again
/// with CM closed succeeds at the identical resolution, which is what rules
/// out the settings themselves.
pub fn is_launcher_running() -> bool {
    crate::process_liveness::is_running(AC_LAUNCHER_PROCESS)
}

/// Starts Assetto Corsa.
///
/// Runs `acs.exe` directly inside the game's own Proton prefix, rather than
/// asking Steam to launch the app. Going through Steam runs whatever sits at
/// `AssettoCorsa.exe`, and on any install with Content Manager that *is*
/// Content Manager — it renames the real launcher to
/// `AssettoCorsa_original.exe` and takes its place. CM then opens its UI and
/// waits for someone to press Drive, which never happens in an unattended
/// capture. Confirmed here: the first automated attempt did nothing but open
/// CM.
///
/// `acs.exe` is the game itself and reads the `race.ini` preflight has
/// already written, so it starts straight into the session it's told to.
///
/// Falls back to the Steam URI when Proton can't be located. That path still
/// stalls on a CM install, but it's better than refusing to start at all,
/// and it's the only option if the prefix layout isn't recognisable.
pub fn launch(paths: &CapturePaths, app_id: &str) -> Result<(), String> {
    match (paths.proton_binary(), paths.compat_data_dir()) {
        (Some(proton), Some(compat)) => launch_via_proton(paths, &proton, &compat),
        _ => launch_via_steam(app_id),
    }
}

/// How to get out to the host, when this process can't run the game itself.
///
/// A game launched from inside a sandbox inherits *that* environment's
/// graphics stack, which generally isn't the host's. Seen concretely during
/// development: launched from a distrobox container with no NVIDIA Vulkan
/// driver (3 ICDs inside against 24 on the host), Assetto Corsa got as far
/// as reading its config and then died with "DX11 Device creation FAILED".
/// The Flatpak build has the same shape of problem, which is why monocoque's
/// simd already routes its host-side work through `flatpak-spawn --host`.
///
/// Returns the command prefix to put in front of the real one, or `None`
/// when this process can launch the game directly.
fn host_exec_prefix() -> Option<Vec<String>> {
    // Explicit override first, so a development container can point at
    // whatever escape hatch it has (`distrobox-host-exec`, say).
    if let Ok(value) = std::env::var("MONOCOQUE_BUILDER_CAPTURE_HOST_EXEC") {
        let parts: Vec<String> = value.split_whitespace().map(str::to_string).collect();
        if !parts.is_empty() {
            return Some(parts);
        }
    }
    // Reuses the app's own sandbox detection rather than re-checking
    // `/.flatpak-info` here — `host_command` already caches that, and every
    // other host-bound call in this codebase goes through it.
    if crate::host_command::in_flatpak() {
        return Some(vec!["flatpak-spawn".to_string(), "--host".to_string()]);
    }
    None
}

fn launch_via_proton(
    paths: &CapturePaths,
    proton: &Path,
    compat_data: &Path,
) -> Result<(), String> {
    // `runinprefix` when something already holds the prefix — in practice
    // Content Manager sitting in its UI.
    //
    // The verbs differ in exactly the way that matters here. `run` does full
    // session setup and `waitforexitandrun` literally blocks on
    // `wineserver -w`, i.e. waits for the existing prefix to CLOSE, which is
    // the opposite of what is wanted. `runinprefix` execs wine directly, and
    // wine attaches to the wineserver already running for that WINEPREFIX, so
    // the capture joins the live session instead of standing up a second one.
    //
    // A second session was the actual failure: it could not create a D3D11
    // device and AC died 1.7 seconds in. Refusing to start was the first fix
    // and it worked, but telling someone to close their launcher to take a
    // screenshot is a poor trade when the prefix can simply be shared.
    //
    // Not the default, because `runinprefix` also skips the prefix-update
    // step (`init_session(update_prefix_files=False)`) and the drive mappings
    // that `run` performs. Those are exactly the things an already-running
    // prefix has done for us, so this is only safe in that case — on a cold
    // start the full `run` is still required.
    let verb = if is_launcher_running() || is_ac_running() {
        "runinprefix"
    } else {
        "run"
    };
    let steam_client = paths.steam_client_dir().ok_or_else(|| {
        "Found Proton but not Steam's own directory, which it needs to run.".to_string()
    })?;

    // Both `STEAM_COMPAT_*` variables are mandatory for `proton run`: the
    // first says which prefix to use (so the game sees its existing
    // settings, content and CSP install), the second is where Proton finds
    // its runtime. `PROTON_ENABLE_WAYLAND` matches how the game is normally
    // launched here, and matters for quality — an XWayland window gets
    // scaled by the display's fractional scaling, which resamples the
    // screenshot and visibly softens it.
    let mut env: Vec<(String, String)> = vec![
        (
            "STEAM_COMPAT_DATA_PATH".to_string(),
            compat_data.to_string_lossy().into_owned(),
        ),
        (
            "STEAM_COMPAT_CLIENT_INSTALL_PATH".to_string(),
            steam_client.to_string_lossy().into_owned(),
        ),
        ("PROTON_ENABLE_WAYLAND".to_string(), "1".to_string()),
    ];

    // Whatever the user set in Steam's launch options, since starting the
    // game directly skips them. `SIMD_BRIDGE_EXE` is the one that matters:
    // simd's automatic bridging reads it from the *game's* environment, so
    // without it a capture-launched session produces no telemetry at all.
    // Anything else configured there (`PROTON_ENABLE_WAYLAND`, HDR flags)
    // comes along too, which is the point — a captured session should behave
    // like a played one.
    //
    // Appended after the defaults above so a user's own value wins on a
    // clash rather than being silently overridden.
    if let Some(options) = paths::steam_launch_options(super::AC_STEAM_APP_ID) {
        env.extend(paths::env_assignments(&options));
    }

    let mut command = match host_exec_prefix() {
        Some(prefix) => {
            let mut command = std::process::Command::new(&prefix[0]);
            command.args(&prefix[1..]);
            // Environment is passed via `env` rather than the usual
            // `Command::env`, because that would set it on *this* side of
            // the sandbox boundary and never reach the host process.
            command.arg("env");
            for (key, value) in &env {
                command.arg(format!("{key}={value}"));
            }
            command.arg(proton);
            command
        }
        None => {
            let mut command = std::process::Command::new(proton);
            for (key, value) in &env {
                command.env(key, value);
            }
            command
        }
    };

    command
        .arg(verb)
        .arg(paths.acs_exe())
        // AC resolves content relative to its working directory.
        .current_dir(&paths.install_dir)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("Couldn't start Assetto Corsa via Proton ({err})."))
}

/// Asks Steam to launch the game by URI.
///
/// Uses `steam://` rather than the `steam` binary because this app ships as
/// a Flatpak: inside the sandbox there's no `steam` on `PATH`, and reaching
/// the host one needs `flatpak-spawn --host` with the broad
/// `--talk-name=org.freedesktop.Flatpak` permission. A URI goes through the
/// OpenURI portal instead, and works whether Steam is native or a Flatpak.
fn launch_via_steam(app_id: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(format!("steam://rungameid/{app_id}"))
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|err| {
            format!("Couldn't ask Steam to launch Assetto Corsa ({err}). Is Steam installed?")
        })
}

/// Waits for the Lua app to report a result.
///
/// Polls for the result file rather than watching the images, so an explicit
/// failure from inside the game surfaces as its own message instead of
/// looking like a timeout.
pub async fn wait_for_result(
    paths: &CapturePaths,
    job_id: &str,
    timeout: Duration,
) -> Result<CaptureOutcome, String> {
    let result_path = paths.lua_out_dir().join("result.ini");
    let deadline = std::time::Instant::now() + timeout;
    // Only meaningful once AC has actually appeared: it is not running yet at
    // the moment this starts polling, and treating that as "it died" would
    // fail every capture instantly.
    let mut seen_running = false;

    while std::time::Instant::now() < deadline {
        if let Ok(text) = std::fs::read_to_string(&result_path) {
            // A result from an earlier run can still be on disk if clearing
            // it failed; only this job's own result counts.
            if super::ini::get_value(&text, "RESULT", "ID").as_deref() == Some(job_id) {
                let ok = super::ini::get_value(&text, "RESULT", "STATUS").as_deref() == Some("ok");
                let message = super::ini::get_value(&text, "RESULT", "MESSAGE")
                    .unwrap_or_else(|| "No message".to_string());
                return Ok(CaptureOutcome { ok, message });
            }
        }

        // AC dying without writing a result used to be indistinguishable from
        // it still working: this waited out the whole timeout, and only then
        // did the caller restore the user's settings. A real crash took 1.7
        // seconds and left the rig in 360 mode with the restore journal on
        // disk for the rest of the timeout.
        //
        // The game records why it went, so say that instead of "timed out".
        if is_ac_running() {
            seen_running = true;
        } else if seen_running {
            return Err(match last_startup_error(paths) {
                Some(reason) => format!("Assetto Corsa quit before capturing: {reason}"),
                None => "Assetto Corsa quit before capturing, with no error logged.".to_string(),
            });
        }

        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    Err(format!(
        "Assetto Corsa didn't report a finished capture within {}s.",
        timeout.as_secs()
    ))
}

/// The last error Assetto Corsa logged, if its log is readable.
///
/// Exists because AC is specific about startup failures and we were throwing
/// that away. A real one: creating the D3D11 device failed at the capture's
/// 8192x4096 window and the log said so in as many words, while this app
/// reported only that nothing had happened for the length of the timeout.
///
/// Best-effort by design — a missing or unreadable log is not itself worth
/// reporting, since the caller already has a perfectly good "it quit" message.
fn last_startup_error(paths: &CapturePaths) -> Option<String> {
    let log = paths.user_dir.join("logs").join("log.txt");
    let text = std::fs::read_to_string(log).ok()?;
    text.lines()
        .rev()
        .find(|line| line.starts_with("ERROR:"))
        .map(|line| line.trim_start_matches("ERROR:").trim().to_string())
}

/// Waits for AC to close itself after a capture.
///
/// The Lua app calls `ac.shutdownAssettoCorsa()`, so this is only a grace
/// period; it returns whether the game actually went away, letting the
/// caller mention a still-running game rather than assume a clean exit.
pub async fn wait_for_exit() -> bool {
    let deadline = std::time::Instant::now() + SHUTDOWN_GRACE;
    while std::time::Instant::now() < deadline {
        if !is_ac_running() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    !is_ac_running()
}

fn write(path: &Path, text: &str) -> Result<(), String> {
    std::fs::write(path, text).map_err(|err| format!("Couldn't write {}: {err}", path.display()))
}

#[cfg(test)]
mod tests {
    /// The startup-error extraction, which turns AC's own log line into the
    /// message the user sees instead of a bare timeout.
    #[test]
    fn reads_the_last_logged_error() {
        let dir = std::env::temp_dir().join(format!("cap-log-test-{}", std::process::id()));
        let logs = dir.join("logs");
        std::fs::create_dir_all(&logs).unwrap();
        std::fs::write(
            logs.join("log.txt"),
            "CURRENT LOCALE en\n\
             ERROR: TEMPORARY DX11 Device D3D11CreateDevice failed\n\
             ERROR: DX11 Device creation FAILED\n\
             CRASH in:\n",
        )
        .unwrap();
        let paths = CapturePaths {
            install_dir: dir.clone(),
            user_dir: dir.clone(),
        };
        // The LAST error, not the first — the final one is the specific cause.
        assert_eq!(
            super::last_startup_error(&paths).as_deref(),
            Some("DX11 Device creation FAILED")
        );

        // No log at all is not an error in itself: the caller already has a
        // usable "it quit" message without one.
        let empty = dir.join("empty");
        std::fs::create_dir_all(&empty).unwrap();
        let paths = CapturePaths {
            install_dir: empty.clone(),
            user_dir: empty,
        };
        assert_eq!(super::last_startup_error(&paths), None);

        std::fs::remove_dir_all(&dir).ok();
    }

    use super::*;
    use crate::ac_capture::CaptureConfig;

    /// Installs the Lua app and arms one job, then stops.
    ///
    /// This exists to test the risky half — the in-game sequence — on its own,
    /// without Steam launching, `race.ini` rewriting or any of the Rust
    /// orchestration in the way. Run it, start Assetto Corsa yourself into any
    /// practice session, and watch the app's own window report each state.
    ///
    /// Shutdown is deliberately disabled here, so the session stays open
    /// afterwards and both frames can be inspected in place rather than the
    /// game vanishing the moment it finishes.
    ///
    /// `#[ignore]` because it writes into a real Assetto Corsa install:
    /// `cargo test -p typiql stage_capture_for_manual_run -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn stage_capture_for_manual_run() {
        let paths = CapturePaths::resolve(None, None).expect("no Assetto Corsa install detected");

        let mut config = CaptureConfig::new("manual-test", String::new());
        config.shutdown_when_done = false;

        install_lua_app(&paths).expect("couldn't install the Lua app");
        write_job(&paths, &config, "manual").expect("couldn't write the job");

        println!("Installed to: {}", paths.lua_app_dir().display());
        println!("Output will land in: {}", paths.lua_out_dir().display());
        println!();
        println!("Now launch Assetto Corsa into any practice session.");
        println!("The app hides the UI, shoots day.png, jumps 12h, turns the");
        println!("headlights on, shoots night.png, and then stops WITHOUT quitting.");
    }
}
