use crate::config_manager::app_config::read_app_config;
use crate::telemetry::{build_frame, read_simdata, types::SimStatus};
use async_graphql::SimpleObject;
use std::process::{Child, Command};
use std::time::Duration;

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
fn spawn_command_line(command_line: &str) -> std::io::Result<Child> {
    Command::new("sh").arg("-c").arg(command_line).spawn()
}

#[derive(SimpleObject, Clone, Copy, Debug)]
pub struct SimdStatus {
    pub running: bool,
}

/// Whether a process named exactly `simd` is alive. `pgrep -x` matches on
/// the process's own name (not full command line), so this is unaffected
/// by which flags it was started with (confirmed live: the user's actual
/// simd instance is normally started manually with `-a`, which this
/// watchdog's own bare `simd` spawn deliberately doesn't pass — see
/// `run_simd_watchdog`'s own doc comment). Also unaffected by which
/// container it was started in:
/// confirmed live that this Arch distrobox container is rootful with
/// additional grants, which shares the host PID namespace, so a process
/// started in a sibling container is still visible here.
fn is_simd_running() -> bool {
    Command::new("pgrep")
        .arg("-x")
        .arg("simd")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
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
pub async fn run_simd_watchdog() {
    loop {
        tokio::time::sleep(WATCHDOG_POLL_INTERVAL).await;

        if is_simd_running() {
            continue;
        }

        let command = read_app_config()
            .map(|c| c.settings.simd_command)
            .unwrap_or_else(|_| "simd".into());

        eprintln!("run_simd_watchdog: simd not running, starting it via `{command}`");
        if let Err(e) = spawn_command_line(&command) {
            eprintln!("run_simd_watchdog: failed to spawn simd: {e}");
        }
    }
}

#[derive(SimpleObject, Clone, Copy, Debug)]
pub struct MonocoqueStatus {
    pub running: bool,
}

/// Whether a process named exactly `monocoque` is alive — see
/// `is_simd_running`'s doc comment for why `pgrep -x` (not full command
/// line) and why this survives it having been started in a sibling
/// container.
fn is_monocoque_running() -> bool {
    Command::new("pgrep")
        .arg("-x")
        .arg("monocoque")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
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
    loop {
        tokio::time::sleep(WATCHDOG_POLL_INTERVAL).await;

        let sim_active = read_simdata()
            .map(|d| build_frame(d).sim_status)
            .map(|status| matches!(status, SimStatus::Active))
            .unwrap_or(false);

        if !sim_active || is_monocoque_running() {
            continue;
        }

        let command = read_app_config()
            .map(|c| c.settings.monocoque_command)
            .unwrap_or_else(|_| "monocoque play".into());

        eprintln!(
            "run_monocoque_watchdog: sim active but monocoque not running, starting it via `{command}`"
        );
        if stop_boxflat_if_running() {
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        if let Err(e) = spawn_command_line(&command) {
            eprintln!("run_monocoque_watchdog: failed to spawn monocoque: {e}");
        }
    }
}
