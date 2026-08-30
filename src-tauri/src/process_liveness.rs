//! Is a process with this name actually alive?
//!
//! Every companion process this app supervises (simd, monocoque, huenicorn)
//! is found by name with `pgrep -x` rather than by a cached PID — the static
//! that would hold that PID resets on every backend restart while the process
//! itself keeps running, so trusting it would orphan the process and report
//! it dead. Matching on the name instead is also indifferent to how the
//! binary was installed (AUR, built onto PATH, a wrapper script) and to which
//! sibling container it was started in, since this distrobox shares the host
//! PID namespace.
//!
//! A Flatpak build does **not** share it: the sandbox gets its own PID
//! namespace, so both the `pgrep` and the `/proc` read below have to happen on
//! the host or they disagree with each other. See `is_live`.
//!
//! The catch, and the reason this module exists instead of a bare `pgrep`
//! exit-status check: **`pgrep` matches zombies**. A `<defunct>` process has
//! already exited — its parent simply hasn't reaped it — but it still has a
//! `/proc/<pid>/comm`, so `pgrep -x` happily returns it and any "is it
//! running?" check built on that alone answers `true` forever. Both places
//! that got this wrong were confirmed live, and both silently disabled the
//! feature they guarded:
//!
//! - huenicorn exited one evening and its corpse was still answering `pgrep`
//!   two days later, so the sim watcher never restarted it and launching the
//!   sim produced no screen-capture portal prompt.
//! - monocoque's game loop exited ~10ms after launch, and its corpse made
//!   `run_monocoque_watchdog` believe it was driving the rig for hours.
//!
//! Spawners must ALSO reap (see `service_watchdogs::spawn_command_line`) so
//! new zombies stop appearing; this filter handles the ones already there,
//! including any inherited from before a rebuild.


/// PIDs of live (non-zombie) processes named exactly `process_name`.
pub fn live_pids(process_name: &str) -> Vec<u32> {
    let Ok(out) = crate::host_command::host_command("pgrep").arg("-x").arg(process_name).output() else {
        return Vec::new();
    };

    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .filter(|pid| is_live(*pid))
        .collect()
}

/// Whether any live process named exactly `process_name` exists.
pub fn is_running(process_name: &str) -> bool {
    !live_pids(process_name).is_empty()
}

/// Whether `pid` exists and is in any state other than zombie. A `/proc` read
/// that fails means the process is already gone between the `pgrep` and this
/// check, which counts as not-live for the same reason a zombie does.
fn is_live(pid: u32) -> bool {
    // Read /proc on the host when sandboxed. Flatpak gives the sandbox its own
    // PID namespace -- measured: 4 entries in the sandbox's /proc against 668
    // on the host -- so the pids pgrep returns (it runs on the host, via
    // host_command) don't exist in the sandbox's /proc at all. Reading locally
    // would make every pid look dead, live_pids() would always come back
    // empty, and the watchdogs would restart services forever while believing
    // nothing was running: silent misbehaviour rather than a visible error.
    let stat = if crate::host_command::in_flatpak() {
        let Ok(out) = crate::host_command::host_command("cat")
            .arg(format!("/proc/{pid}/stat"))
            .output()
        else {
            return false;
        };
        if !out.status.success() {
            return false;
        }
        String::from_utf8_lossy(&out.stdout).into_owned()
    } else {
        let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
            return false;
        };
        stat
    };

    // `pid (comm) state ...` — `comm` is unquoted and may itself contain
    // spaces or a `)`, so the state field is the first token after the
    // *last* `)`, not the third whitespace-separated field.
    stat.rsplit_once(')')
        .and_then(|(_, rest)| rest.split_whitespace().next())
        .map(|state| state != "Z")
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    // Only the zombie test spawns a real child; everything else goes
    // through host_command.
    use std::process::Command;

    #[test]
    fn this_process_is_live() {
        let me = std::process::id();
        assert!(is_live(me));
    }

    #[test]
    fn a_pid_that_does_not_exist_is_not_live() {
        // Above any plausible pid_max, so /proc/<pid>/stat can't be read.
        assert!(!is_live(u32::MAX));
    }

    /// The regression itself: a child that has exited but not been waited on
    /// is a zombie, `pgrep` still matches it, and `is_live` must not.
    #[test]
    fn an_unreaped_exited_child_is_not_live() {
        let child = Command::new("true").spawn().expect("spawn true");
        let pid = child.id();
        // Deliberately not waiting: dropping `Child` does not reap.
        std::mem::forget(child);

        // Give it a moment to exit and become defunct.
        for _ in 0..50 {
            std::thread::sleep(std::time::Duration::from_millis(20));
            if !is_live(pid) {
                break;
            }
        }
        assert!(
            !is_live(pid),
            "an unreaped exited child must read as not live"
        );
    }
}
