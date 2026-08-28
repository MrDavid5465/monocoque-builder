use crate::config_manager::app_config::read_app_config;
use crate::process_liveness;
use crate::service_commands;
use crate::telemetry::{build_frame, read_simdata, types::SimStatus};
use async_graphql::SimpleObject;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Home for watchdogs over external services this app depends on but
/// doesn't own the lifecycle of end-to-end — simd (writes the telemetry
/// this app reads) and monocoque (drives shaker/shift-light/etc. devices,
/// doesn't touch telemetry itself) are the first two.
const WATCHDOG_POLL_INTERVAL: Duration = Duration::from_secs(5);

/// Spawns `command_line` through a shell rather than as a single program —
/// `Command::new` only takes one executable with no argument splitting, but
/// the user-configurable `simd_command`/`monocoque_command` settings (see
/// `AppSettings`) need to support multi-word overrides like a distrobox
/// wrapper invocation (`distrobox enter --root simracing-dev -- simd -n`),
/// not just a bare binary name.
///
/// Two things here are load-bearing and neither is obvious:
///
/// **The child gets a FIFO on stdin, opened read-write.** monocoque's game
/// loop calls `uv_poll_init` on fd 0 unconditionally — it watches stdin for
/// the interactive "press q to quit" key, and there is no headless flag to
/// turn that off (`play` accepts only -v/-d/-a/-c/-l/-f). `epoll` rejects
/// `/dev/null`, so `uv_poll_init` fails, `monocoque_mainloop` returns 1, and
/// the process dies ~10ms after launch with "Game loop exited with error
/// code: 1" — confirmed by reproducing it both ways: `monocoque play
/// < /dev/null` dies instantly, the identical command on a pollable stdin
/// initializes its haptics and sound devices normally. Inheriting this
/// backend's own stdin is therefore a coin flip on how the backend itself was
/// started (a terminal works, anything detached does not), which is not a
/// property a rig watchdog should have.
///
/// A plain pipe would fix the poll but introduce a worse bug: when this app
/// exits, the write end closes, stdin reports readable-at-EOF forever, and
/// monocoque's callback (which `scanf`s a char and ignores the EOF) spins at
/// 100% CPU on the orphan. Opening a FIFO `0<>` makes the child hold both
/// ends itself, so it is always pollable, never reports EOF, and depends on
/// nothing this process does after the spawn.
///
/// **The child is reaped.** Dropping a `Child` doesn't wait, so an exited
/// service used to linger as `<defunct>` — which `pgrep` matches, which made
/// the liveness checks below report a corpse as running and stopped the
/// watchdog from ever restarting it. See `process_liveness`.
fn spawn_command_line(service: &str, command_line: &str) -> std::io::Result<()> {
    let fifo = std::env::temp_dir().join(format!("typiql-{service}-stdin"));
    // Recreated per spawn: a stale FIFO from a previous run is harmless, but
    // a stale *regular* file at that path (or a leftover of the wrong type)
    // would silently put us back on an unpollable stdin.
    std::fs::remove_file(&fifo).ok();
    let fifo_arg = fifo.display().to_string();
    let made_fifo = Command::new("mkfifo")
        .arg(&fifo_arg)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    // Falls back to the bare command if the FIFO couldn't be created — a
    // service that doesn't care about stdin (simd) still starts fine, and
    // one that does is no worse off than before this existed.
    let line = if made_fifo {
        format!("exec 0<>'{fifo_arg}'; {command_line}")
    } else {
        eprintln!("spawn_command_line: could not create {fifo_arg}, starting {service} without a pollable stdin");
        command_line.to_string()
    };

    let mut child = Command::new("sh")
        .arg("-c")
        .arg(&line)
        .stdin(Stdio::inherit())
        .spawn()?;

    std::thread::spawn(move || {
        if let Ok(status) = child.wait() {
            eprintln!("spawn_command_line: child exited ({status})");
        }
    });

    Ok(())
}

#[derive(SimpleObject, Clone, Copy, Debug)]
pub struct SimdStatus {
    pub running: bool,
}

/// Whether a live process named exactly `simd` is alive — see
/// `process_liveness` for why this matches on name (not a cached PID, not a
/// full command line, so the `-a` the user normally starts simd with is
/// irrelevant) and why zombies have to be filtered out explicitly.
fn is_simd_running() -> bool {
    process_liveness::is_running("simd")
}

pub fn simd_status() -> SimdStatus {
    SimdStatus {
        running: is_simd_running(),
    }
}

/// Runs forever; spawn once at startup (see main.rs, alongside
/// `gamepad::run_watchdog`/`huenicorn::run_sim_watcher`/`run_color_poller`).
///
/// Spawns `AppSettings::simd_command` (default: bare `simd`, PATH-resolved)
/// rather than going through a systemd unit. This used to shell out to
/// `systemctl --user start simd` to lean on systemd's own restart/backoff,
/// but that made the watchdog's ability to recover simd hostage to whatever
/// `ExecStart` a *separately maintained* unit file happened to contain (e.g.
/// a specific distrobox container name) — confirmed live that this drifts
/// out of sync with reality and silently stops working (833 failed restarts
/// logged before it was caught, because the unit pointed at a path that only
/// resolved inside one specific container). Making the launch command itself
/// a setting (Services tab, Settings dialog) rather than hardcoding either
/// `simd` or a systemd unit means it works whether `simd` was installed via
/// AUR, built from source onto PATH, or only exists as a distrobox wrapper
/// script under a different name — no code change needed for any of those,
/// just the setting.
/// simd's own pidfile path — hardcoded in its source too (`PID_FILE` in
/// simd.c), not configurable on either side.
const SIMD_PID_FILE: &str = "/tmp/simd.pid";

/// After this many consecutive failed restarts, say once that the sim's
/// bridge may need a game restart — see `run_simd_watchdog`. Deliberately a
/// one-shot per streak: this loop runs every 5s, and a hint repeated 12
/// times a minute is noise, not help.
const SIMD_STUCK_ATTEMPTS: u32 = 3;

/// Removes simd's pidfile if it's there while no simd is running.
///
/// simd creates it with `O_CREAT | O_EXCL` and refuses to start if the open
/// fails — "simd daemon already running, please remove /tmp/simd.pid if this
/// is not the case." — but nothing removes it when simd dies abnormally, and
/// it dies abnormally often enough to matter (confirmed live: three SIGABRTs
/// inside four minutes, each leaving an empty pidfile behind). The result was
/// a watchdog that looked healthy while achieving nothing: it dutifully
/// spawned simd every 5s, and simd refused every time, for as long as the
/// user left it. One found here was five days old.
///
/// Only ever called from the branch that has already established no live
/// simd exists, and it re-checks immediately before unlinking: the file is
/// simd's mutual exclusion, so deleting one out from under a *running* simd
/// would let a second instance start alongside it. Note that simd never
/// writes a PID into this file (every one observed is 0 bytes), so its
/// contents can't be used to judge staleness — the absence of a live process
/// is the only signal available.
fn clear_stale_simd_pidfile() -> bool {
    clear_stale_pidfile_at(std::path::Path::new(SIMD_PID_FILE), &is_simd_running)
}

/// The decision behind `clear_stale_simd_pidfile`, with the path and the
/// liveness check injected so the "never unlink a running daemon's lock"
/// rule is actually testable rather than asserted in a comment.
fn clear_stale_pidfile_at(path: &std::path::Path, still_running: &dyn Fn() -> bool) -> bool {
    if !path.exists() || still_running() {
        return false;
    }

    match std::fs::remove_file(path) {
        Ok(()) => {
            eprintln!(
                "run_simd_watchdog: removed stale {} (no simd process is running)",
                path.display()
            );
            true
        }
        Err(e) => {
            eprintln!(
                "run_simd_watchdog: could not remove stale {}: {e}",
                path.display()
            );
            false
        }
    }
}

/// The bridge executable simd would launch for the currently-running sim, if
/// any — read straight out of the game process's own environment, the same
/// way simd finds it (`getEnvValueForPid(pid, "SIMD_BRIDGE_EXE")` in simd.c).
///
/// Deliberately discovered rather than configured or hardcoded: the path is
/// per-sim (acbridge.exe for Assetto Corsa, others elsewhere) and is already
/// declared once, in the game's launch options. Reading it back from there
/// means this can't drift out of sync with what simd itself would use — the
/// same failure that made the simd/monocoque launch commands settings rather
/// than constants.
fn simd_bridge_exe() -> Option<String> {
    let entries = std::fs::read_dir("/proc").ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(pid) = name.to_str().and_then(|n| n.parse::<u32>().ok()) else {
            continue;
        };
        // Unreadable environs (other users, or a process that exited between
        // the readdir and here) are simply skipped.
        let Ok(environ) = std::fs::read(format!("/proc/{pid}/environ")) else {
            continue;
        };
        for var in environ.split(|b| *b == 0) {
            if let Some(value) = String::from_utf8_lossy(var).strip_prefix("SIMD_BRIDGE_EXE=") {
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

/// Kills a bridge process left behind by a crashed simd.
///
/// simd forks the bridge itself and is the only thing that ever stops it —
/// `bridgeclosecallback` SIGTERMs `bridge_pid` once the game pid disappears.
/// When simd dies instead, that callback never runs, so the bridge is
/// orphaned onto init while still holding the game's shared memory. Restarting
/// simd then forks a *second* bridge alongside the first, both writing the
/// same shm.
///
/// Matches on command line, never on environment: the bridge exe path appears
/// in the bridge's own argv, while the *game* only carries it as an env var —
/// so this can't mistake the game for its bridge and kill the session.
///
/// Returns whether anything was signalled. Note that clearing the bridge does
/// not always restore telemetry on its own; the game itself may need
/// restarting before a fresh bridge can attach (see `run_simd_watchdog`).
fn kill_orphaned_simd_bridge() -> bool {
    let Some(exe) = simd_bridge_exe() else {
        return false;
    };
    // Basename, since simd may invoke it through a wrapper (SIMD_WRAP_EXE)
    // that rewrites the leading path.
    let Some(needle) = bridge_needle(&exe) else {
        return false;
    };

    let Ok(entries) = std::fs::read_dir("/proc") else {
        return false;
    };

    let mut killed = false;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(pid) = name.to_str().and_then(|n| n.parse::<u32>().ok()) else {
            continue;
        };
        let Ok(cmdline) = std::fs::read(format!("/proc/{pid}/cmdline")) else {
            continue;
        };
        if !String::from_utf8_lossy(&cmdline).contains(&needle) {
            continue;
        }

        eprintln!("run_simd_watchdog: killing orphaned bridge pid {pid} ({needle})");
        if let Err(e) = Command::new("kill").arg(pid.to_string()).output() {
            eprintln!("run_simd_watchdog: failed to kill bridge pid {pid}: {e}");
        } else {
            killed = true;
        }
    }
    killed
}

pub async fn run_simd_watchdog() {
    // Consecutive restarts that didn't result in a running simd — drives the
    // one-shot hint below, and resets the moment simd is up.
    let mut failed_attempts: u32 = 0;
    let mut warned_stuck = false;
    let mut warned_missing_dev_command = false;

    loop {
        tokio::time::sleep(WATCHDOG_POLL_INTERVAL).await;

        if is_simd_running() {
            failed_attempts = 0;
            warned_stuck = false;
            warned_missing_dev_command = false;
            continue;
        }

        // Both of these are no-ops in the normal case (first start of the
        // day, or a clean shutdown) and only do anything after simd died
        // without cleaning up after itself.
        clear_stale_simd_pidfile();
        kill_orphaned_simd_bridge();

        let config = read_app_config().ok();
        let production = config
            .as_ref()
            .map(|c| c.settings.simd_command.clone())
            .unwrap_or_else(|| "simd".into());
        let debug = config
            .as_ref()
            .and_then(|c| c.settings.simd_debug_command.clone());

        let Some(command) = service_commands::resolve(&production, debug.as_deref()) else {
            // Logged once per streak: this loop runs every 5s and the
            // situation only changes when someone edits the setting.
            if !warned_missing_dev_command {
                warned_missing_dev_command = true;
                eprintln!(
                    "run_simd_watchdog: this is a debug build and no simd dev command is set \
                     (Settings > Services). Refusing to start the installed simd - set the dev \
                     command to your source build, or run a release build to use `{production}`."
                );
            }
            continue;
        };

        eprintln!("run_simd_watchdog: simd not running, starting it via `{command}`");
        if let Err(e) = spawn_command_line("simd", &command) {
            eprintln!("run_simd_watchdog: failed to spawn simd: {e}");
        }

        failed_attempts += 1;
        if failed_attempts >= SIMD_STUCK_ATTEMPTS && !warned_stuck {
            warned_stuck = true;
            eprintln!(
                "run_simd_watchdog: simd has not stayed up across {failed_attempts} restarts. \
                 If a sim is running, its bridge may need the game restarted before simd can \
                 attach to it again - that part is not something this watchdog can do for you."
            );
        }
    }
}

#[derive(SimpleObject, Clone, Copy, Debug)]
pub struct MonocoqueStatus {
    pub running: bool,
}

/// Whether a live process named exactly `monocoque` is alive — see
/// `process_liveness`. This one is why that module's zombie filter exists:
/// monocoque's corpse read as "running" for hours while nothing drove the
/// rig.
fn is_monocoque_running() -> bool {
    process_liveness::is_running("monocoque")
}

pub fn monocoque_status() -> MonocoqueStatus {
    MonocoqueStatus {
        running: is_monocoque_running(),
    }
}

/// Boxflat (the Moza wheel-base config GUI) opens the same serial device
/// monocoque drives (the `devpath` in monocoque.config) — running both at
/// once means one of them loses the port. Installed as a Flatpak
/// (`io.github.lawstorant.boxflat`, confirmed live via `flatpak list`), so
/// this goes through `flatpak kill`/`flatpak ps` rather than `pgrep`/`pkill`
/// on a process name — Flatpak's bubblewrap sandboxing makes the actual
/// child process unreliable to target directly, but the app ID is stable.
/// Returns whether it actually stopped something, so the caller only pays
/// the settle delay when needed.
fn stop_boxflat_if_running() -> bool {
    const BOXFLAT_APP_ID: &str = "io.github.lawstorant.boxflat";

    let running = Command::new("flatpak")
        .arg("ps")
        .output()
        .map(|out| {
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .any(|line| line.contains(BOXFLAT_APP_ID))
        })
        .unwrap_or(false);

    if !running {
        return false;
    }

    eprintln!("run_monocoque_watchdog: Boxflat is running, stopping it to free the serial port");
    if let Err(e) = Command::new("flatpak")
        .args(["kill", BOXFLAT_APP_ID])
        .output()
    {
        eprintln!("run_monocoque_watchdog: failed to stop Boxflat: {e}");
    }
    true
}

/// Runs forever; spawn once at startup (see main.rs, alongside
/// `run_simd_watchdog`). Spawns `AppSettings::monocoque_command` (default:
/// `monocoque play`) rather than a hardcoded binary name — see
/// `run_simd_watchdog`'s doc comment for why the launch command is a setting,
/// not code. This only cares whether monocoque *should* be running right now: whenever
/// `sim_status` is `Active` and no `monocoque` process is found, start one.
/// A level check, not an edge check, deliberately — it uniformly covers
/// both "sim just went Active, monocoque was never started this session"
/// and "monocoque crashed mid-session while still driving" with the same
/// one condition, no separate crash-recovery path needed. Never stops
/// monocoque on its own (unlike huenicorn.rs's run_sim_watcher) — monocoque
/// only needs to be running to drive physical devices, there's no cost to
/// leaving it up between sessions, and auto-stopping it was explicitly out
/// of scope here.
pub async fn run_monocoque_watchdog() {
    let mut warned_missing_dev_command = false;
    let mut consecutive_failed_starts: u32 = 0;
    let mut last_start_attempt: Option<Instant> = None;

    loop {
        tokio::time::sleep(WATCHDOG_POLL_INTERVAL).await;

        let sim_active = read_simdata()
            .map(|d| build_frame(d).sim_status)
            .map(|status| matches!(status, SimStatus::Active))
            .unwrap_or(false);

        let running = is_monocoque_running();
        if running {
            // A start that stuck. Clear the penalty so a genuine crash later
            // in the session gets a prompt restart instead of inheriting the
            // backoff from some unrelated earlier failure.
            consecutive_failed_starts = 0;
            last_start_attempt = None;
        }

        if !sim_active || running {
            warned_missing_dev_command = false;
            continue;
        }

        // A monocoque that dies during startup lands right back here every
        // poll, and the level check above cannot tell "not started yet" from
        // "started and immediately crashed". Seen for real: a device config
        // pointing at a Lua script that was never copied out of monocoque's
        // conf/ dir made it segfault during device init, and this watchdog
        // turned that single crash into a core dump every 5 seconds for
        // minutes. Backing off keeps a bad config cheap.
        let wait = monocoque_start_backoff(consecutive_failed_starts);
        if last_start_attempt.map_or(false, |at| at.elapsed() < wait) {
            continue;
        }

        let config = read_app_config().ok();
        let production = config
            .as_ref()
            .map(|c| c.settings.monocoque_command.clone())
            .unwrap_or_else(|| "monocoque play".into());
        let debug = config
            .as_ref()
            .and_then(|c| c.settings.monocoque_debug_command.clone());

        let Some(command) = service_commands::resolve(&production, debug.as_deref()) else {
            if !warned_missing_dev_command {
                warned_missing_dev_command = true;
                eprintln!(
                    "run_monocoque_watchdog: this is a debug build and no monocoque dev command \
                     is set (Settings > Services). Refusing to start the installed monocoque."
                );
            }
            continue;
        };

        eprintln!(
            "run_monocoque_watchdog: sim active but monocoque not running, starting it via `{command}`"
        );
        last_start_attempt = Some(Instant::now());
        consecutive_failed_starts = consecutive_failed_starts.saturating_add(1);
        if consecutive_failed_starts > 1 {
            eprintln!(
                "run_monocoque_watchdog: monocoque has failed to stay up {consecutive_failed_starts} \
                 times; next retry in at least {}s",
                monocoque_start_backoff(consecutive_failed_starts).as_secs()
            );
        }
        if stop_boxflat_if_running() {
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        if let Err(e) = spawn_command_line("monocoque", &command) {
            eprintln!("run_monocoque_watchdog: failed to spawn monocoque: {e}");
        }
    }
}

/// Ceiling on the wait between monocoque start attempts, reached after six
/// consecutive failures. A permanently broken config then costs one attempt
/// every few minutes rather than one every `WATCHDOG_POLL_INTERVAL`.
const MONOCOQUE_START_BACKOFF_MAX: Duration = Duration::from_secs(320);

/// How long to wait before the next start attempt, given how many attempts
/// in a row have failed to leave monocoque running. Doubles from one poll
/// interval up to `MONOCOQUE_START_BACKOFF_MAX`; zero on a clean slate, so
/// the common "sim just went active" case still starts on the next poll.
fn monocoque_start_backoff(consecutive_failures: u32) -> Duration {
    if consecutive_failures == 0 {
        return Duration::ZERO;
    }
    let doubling = WATCHDOG_POLL_INTERVAL.as_secs() << consecutive_failures.min(6);
    Duration::from_secs(doubling).min(MONOCOQUE_START_BACKOFF_MAX)
}

/// The bridge exe's basename, used to match candidate processes' command
/// lines. Handles both separators: `SIMD_BRIDGE_EXE` is consumed by wine, so
/// it is just as likely to be a Windows-style path as a Unix one.
fn bridge_needle(exe: &str) -> Option<String> {
    let base = exe.trim().rsplit(['/', '\\']).next().unwrap_or("").trim();
    (!base.is_empty()).then(|| base.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn does_not_delay_the_first_monocoque_start_attempt() {
        // The common case is "sim just went active"; that must still start
        // monocoque on the very next poll, not one backoff later.
        assert_eq!(monocoque_start_backoff(0), Duration::ZERO);
    }

    #[test]
    fn backs_off_further_after_each_failed_monocoque_start() {
        // A crash-on-start loop must get cheaper each time round, not stay
        // pinned at WATCHDOG_POLL_INTERVAL.
        assert_eq!(monocoque_start_backoff(1), Duration::from_secs(10));
        assert_eq!(monocoque_start_backoff(2), Duration::from_secs(20));
        assert_eq!(monocoque_start_backoff(3), Duration::from_secs(40));
    }

    #[test]
    fn caps_the_monocoque_start_backoff() {
        // Without a cap the shift overflows and a permanently broken config
        // would eventually stop being retried at all.
        assert_eq!(monocoque_start_backoff(6), MONOCOQUE_START_BACKOFF_MAX);
        assert_eq!(monocoque_start_backoff(50), MONOCOQUE_START_BACKOFF_MAX);
        assert_eq!(monocoque_start_backoff(u32::MAX), MONOCOQUE_START_BACKOFF_MAX);
    }

    fn scratch_pidfile(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("typiql-watchdog-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn removes_a_pidfile_left_behind_by_a_dead_daemon() {
        let path = scratch_pidfile("stale.pid");
        std::fs::write(&path, "").unwrap(); // simd leaves these empty
        assert!(clear_stale_pidfile_at(&path, &|| false));
        assert!(!path.exists());
    }

    /// The one that matters: this file is simd's mutual exclusion, so
    /// removing it while simd is alive would let a second instance start
    /// alongside the first.
    #[test]
    fn never_removes_a_pidfile_while_the_daemon_is_running() {
        let path = scratch_pidfile("live.pid");
        std::fs::write(&path, "").unwrap();
        assert!(!clear_stale_pidfile_at(&path, &|| true));
        assert!(path.exists(), "a running daemon's lock must survive");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn no_pidfile_is_nothing_to_clean_up() {
        let path = scratch_pidfile("absent.pid");
        std::fs::remove_file(&path).ok();
        assert!(!clear_stale_pidfile_at(&path, &|| false));
    }

    #[test]
    fn bridge_needle_takes_the_basename_of_either_path_style() {
        assert_eq!(
            bridge_needle("/home/david/git/simshmbridge/assets/acbridge.exe"),
            Some("acbridge.exe".to_string())
        );
        assert_eq!(
            bridge_needle("Z:\\home\\david\\assets\\acbridge.exe"),
            Some("acbridge.exe".to_string())
        );
        assert_eq!(
            bridge_needle("acbridge.exe"),
            Some("acbridge.exe".to_string())
        );
        assert_eq!(bridge_needle(""), None);
        assert_eq!(bridge_needle("   "), None);
        assert_eq!(bridge_needle("/trailing/slash/"), None);
    }
}
