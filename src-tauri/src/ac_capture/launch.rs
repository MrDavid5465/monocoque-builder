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

/// AC's process name for the first few seconds after launch.
const AC_PROCESS: &str = "acs.exe";

/// What AC is called for the rest of its life.
///
/// The game calls `prctl(PR_SET_NAME)` on its main thread once it's up, and
/// for a thread-group leader that IS `/proc/<pid>/comm` — so the process
/// stops answering to `acs.exe` about 2.7 seconds in and, to anything looking
/// for that name, simply vanishes while running perfectly.
///
/// This wasted three sessions. Every symptom pointed at a crash: "quit before
/// capturing" fired like clockwork a few seconds after launch while the game
/// was demonstrably alive and logging. What finally settled it was dumping the
/// `comm` of everything matching `assettocorsa` at the moment of the first
/// miss, which printed `AC: main thread` sitting there the whole time.
///
/// Exactly fifteen characters, so it fits `comm` without truncation — but see
/// `process_liveness::MAX_COMM_LEN`, since that is luck rather than design.
/// Both names are checked, because the early seconds really are `acs.exe` and
/// a capture is launched into exactly that window.
const AC_PROCESS_RUNNING: &str = "AC: main thread";

/// What Steam launches, and therefore what Content Manager renames itself to
/// on a CM install (see `start_ac`). Tracked separately from `AC_PROCESS`
/// because CM sitting idle in its UI is invisible to every other signal:
/// `acs.exe` is absent and no telemetry is being published, so a capture
/// happily starts a SECOND process inside a Proton prefix CM already holds.
///
/// Sixteen characters, one over what `/proc/<pid>/comm` holds — which made
/// this constant match nothing at all until `process_liveness` learned to
/// truncate. See `MAX_COMM_LEN` there; the bug is invisible from here because
/// a permanent "no launcher running" looks exactly like the ordinary case.
const AC_LAUNCHER_PROCESS: &str = "AssettoCorsa.exe";

/// How long to wait for AC to exit on its own after the script asks it to.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(30);

/// How often `wait_for_result` looks for a result and checks the game is alive.
const POLL_INTERVAL: Duration = Duration::from_millis(500);

/// Consecutive checks that must agree the game is gone before believing it,
/// once the capture is actually under way.
///
/// Three seconds at `POLL_INTERVAL` — a real crash is still reported promptly
/// rather than waiting out the half-hour timeout, which was the point of
/// checking at all.
const DEATH_CONFIRMATIONS: u32 = 6;

/// The same, while the game is still starting up. Sixty seconds.
///
/// Startup is where every false positive so far has happened, and where one
/// costs the most. Two things make it the wrong place to be decisive:
///
/// * The process-liveness signal is demonstrably unreliable there. Measured on
///   7 Sept: `acs.exe` was found 0.6s after launch, then went missing for the
///   next twelve seconds while CSP logged continuously — the game was plainly
///   alive and the name simply stopped matching.
/// * Declaring death is destructive. The caller immediately clears `job.ini`
///   and restores AC's config, and the game does not read either of those
///   until well into its own startup — the Lua app loaded about eleven seconds
///   after launch in that same run, five seconds AFTER the job had been
///   deleted out from under it. So an early false positive doesn't just report
///   a failure, it causes one.
///
/// AC's own startup is minutes with a large mod folder, so this is still well
/// inside the overall timeout and only delays the report of a genuine
/// early crash.
const DEATH_CONFIRMATIONS_WHILE_STARTING: u32 = 120;

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
         DAY_HOUR={day_hour}\n\
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
        day_hour = config.day_hour,
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

    // Both of AC's names, or this would answer "no" for a game that has been
    // running longer than about three seconds — which is most of them, and
    // would let a capture start on top of a live session.
    sim_is_live || ac_process_is_running().unwrap_or(false)
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

/// Whether AC's own process is alive — deliberately narrower than
/// `is_ac_running`.
///
/// `is_ac_running` ORs the process check with SIMAPI.DAT and is built to fail
/// safe in ONE direction: a false positive there only produces "close the game
/// first", while a false negative would start a second copy on top of a live
/// session. Polling for the game to *die* inverts that polarity — a false
/// negative aborts a capture that is working — so the shared-memory half is
/// left out. SIMAPI.DAT is written by simd rather than by the game, and
/// neither its contents nor its timing are this app's to reason about.
///
/// `None` means the check couldn't be made, which is not the same answer as
/// "the game is gone".
fn ac_process_is_running() -> Option<bool> {
    let early = crate::process_liveness::is_running_checked(AC_PROCESS);
    let running = crate::process_liveness::is_running_checked(AC_PROCESS_RUNNING);
    // `None` only when BOTH checks failed to run — one name being absent is an
    // answer, two failed lookups are not.
    match (early, running) {
        (None, None) => None,
        (early, running) => Some(early.unwrap_or(false) || running.unwrap_or(false)),
    }
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
    super::log::line(&format!(
        "launching via proton `{verb}` (launcher={}, game={})",
        is_launcher_running(),
        is_ac_running()
    ));
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
    // Consecutive checks that agreed the game was gone.
    let mut misses: u32 = 0;
    // The Lua app deletes `job.ini` the moment it claims the job, which makes
    // the file's disappearance a precise "the game has read our instructions"
    // marker — and the point after which being decisive about death is safe.
    let job_path = paths.lua_app_dir().join("job.ini");
    let mut job_claimed = false;

    while std::time::Instant::now() < deadline {
        if !job_claimed && !job_path.exists() {
            job_claimed = true;
            // Start the stricter count from scratch. Carrying the startup
            // tally across the threshold change killed a capture that had just
            // succeeded: 16 misses accumulated harmlessly against a limit of
            // 120, then the job was claimed, the limit dropped to 6, and the
            // already-banked 16 tripped it 45 milliseconds later. The counts
            // answer different questions and must not be shared.
            misses = 0;
            super::log::line("job claimed by the game; capture is under way");
        }
        let allowed_misses = if job_claimed {
            DEATH_CONFIRMATIONS
        } else {
            DEATH_CONFIRMATIONS_WHILE_STARTING
        };

        if let Ok(text) = std::fs::read_to_string(&result_path) {
            // A result from an earlier run can still be on disk if clearing
            // it failed; only this job's own result counts.
            if super::ini::get_value(&text, "RESULT", "ID").as_deref() == Some(job_id) {
                let ok = super::ini::get_value(&text, "RESULT", "STATUS").as_deref() == Some("ok");
                let message = super::ini::get_value(&text, "RESULT", "MESSAGE")
                    .unwrap_or_else(|| "No message".to_string());
                // The whole result, not just the verdict: the Lua app reports
                // how the car actually got started and what its lights did,
                // and a capture that "worked" with the wrong answer to either
                // is the kind of thing only visible in hindsight.
                super::log::line(&format!(
                    "result from game: ok={ok} — {}",
                    text.lines()
                        .map(str::trim)
                        .filter(|line| !line.is_empty() && *line != "[RESULT]")
                        .collect::<Vec<_>>()
                        .join(" | ")
                ));
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
        //
        // Confirmed over several checks rather than one, because the first
        // version of this fired on a single reading and killed a capture that
        // was working: it declared the game dead 3.4 seconds after the Lua app
        // was installed, while AC went on running for another ten seconds and
        // exited cleanly. Worse than a spurious error message, the caller
        // restores AC's config the moment this returns — so the restore landed
        // in the middle of the game's own startup, and AC read back the
        // ORIGINAL race.ini and loaded the user's previous car instead of the
        // one being captured. Startup is exactly when these signals are least
        // stable, so a single miss cannot be allowed to mean anything.
        match ac_process_is_running() {
            Some(true) => {
                if !seen_running {
                    super::log::line(&format!("`{AC_PROCESS}` is up; watching for it to finish"));
                }
                seen_running = true;
                misses = 0;
            }
            Some(false) if seen_running => {
                misses += 1;
                // Every miss while running would be 120 lines of nothing; the
                // first and then every fifth is enough to see the shape.
                if misses == 1 || misses.is_multiple_of(5) {
                    super::log::line(&format!(
                        "`{AC_PROCESS}` not found ({misses}/{allowed_misses}, \
                         job_claimed={job_claimed}); still waiting"
                    ));
                }
                // Once per run, on the first miss, record what the game is
                // actually called — so a run that RECOVERS still answers the
                // question, rather than only the ones that fail.
                if misses == 1 {
                    let others = crate::process_liveness::comms_matching_cmdline("assettocorsa");
                    super::log::line(&format!("  live `assettocorsa` processes: {others:?}"));
                }
                if misses >= allowed_misses {
                    super::log::line(&format!(
                        "`{AC_PROCESS}` gone for {misses} consecutive checks, giving up"
                    ));
                    // What IS running, since the name we were looking for
                    // isn't. This is the open question from 7 Sept: the game
                    // was alive and `acs.exe` had stopped matching, and only
                    // the real comm can say why.
                    let others = crate::process_liveness::comms_matching_cmdline("assettocorsa");
                    super::log::line(&if others.is_empty() {
                        "nothing matching `assettocorsa` is running either".to_string()
                    } else {
                        format!("but these are running: {}", others.join(", "))
                    });
                    return Err(match last_startup_error(paths) {
                        Some(reason) => format!("Assetto Corsa quit before capturing: {reason}"),
                        None => {
                            "Assetto Corsa quit before capturing, with no error logged.".to_string()
                        }
                    });
                }
            }
            // Either it hasn't appeared yet, or the check itself couldn't run.
            // Neither is evidence that anything died, so neither resets nor
            // advances the count.
            _ => {}
        }

        tokio::time::sleep(POLL_INTERVAL).await;
    }

    super::log::line(&format!(
        "timed out after {}s (game seen running: {seen_running})",
        timeout.as_secs()
    ));
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
        .find(|line| line.starts_with("ERROR:") && !is_benign_ac_error(line))
        .map(|line| line.trim_start_matches("ERROR:").trim().to_string())
}

/// Errors AC logs during a perfectly healthy session.
///
/// Without this the "why did it quit" message is worse than none at all: a run
/// was reported as `quit before capturing: NO STAT FOR ks_nordschleife`, which
/// names a real log line, sounds authoritative, and has nothing to do with
/// anything — it appears in sessions that finish normally. Every pattern here
/// was observed in a session the user confirmed working.
fn is_benign_ac_error(line: &str) -> bool {
    const BENIGN: [&str; 5] = [
        // Missing leaderboard stats for a car or track.
        "NO STAT FOR",
        // Force feedback probing every effect the wheel might support.
        "InputDevice::initFF",
        "DAMPER CREATION FAILED",
        // Python apps that aren't installed; AC lists them regardless.
        "Python [ERROR] File",
        "TrackIR DLL Location key not present",
    ];
    BENIGN.iter().any(|pattern| line.contains(pattern))
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

    /// Noise AC logs in a healthy session must not be offered as a cause.
    ///
    /// The regression: a capture was reported as "quit before capturing: NO
    /// STAT FOR ks_nordschleife". That line is real, it is the last `ERROR:`
    /// in the log, and it is completely irrelevant — it appears in sessions
    /// that finish normally. A confident wrong answer sent the investigation
    /// after the track files instead of the process name.
    #[test]
    fn ignores_errors_a_healthy_session_also_logs() {
        let dir = std::env::temp_dir().join(format!("cap-benign-test-{}", std::process::id()));
        let logs = dir.join("logs");
        std::fs::create_dir_all(&logs).unwrap();
        std::fs::write(
            logs.join("log.txt"),
            "ERROR: DX11 Device creation FAILED\n\
             ERROR: InputDevice::initFF(), lpDirectInputDevice->SetProperty failed\n\
             ERROR: DAMPER CREATION FAILED\n\
             ERROR: Python [ERROR] File apps/python/SimHub/SimHub.py not found\n\
             ERROR: TrackIR DLL Location key not present\n\
             ERROR: NO STAT FOR ks_nordschleife\n",
        )
        .unwrap();
        let paths = CapturePaths {
            install_dir: dir.clone(),
            user_dir: dir.clone(),
        };
        // Reaches past five lines of noise to the one that actually matters.
        assert_eq!(
            super::last_startup_error(&paths).as_deref(),
            Some("DX11 Device creation FAILED")
        );

        // Noise alone yields nothing rather than something misleading.
        std::fs::write(
            logs.join("log.txt"),
            "ERROR: NO STAT FOR ks_nordschleife\n\
             ERROR: DAMPER CREATION FAILED\n",
        )
        .unwrap();
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
