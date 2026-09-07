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

/// Longest name `pgrep -x` can ever match.
///
/// Without `-f`, `pgrep` matches `/proc/<pid>/comm`, which the kernel caps at
/// `TASK_COMM_LEN - 1` = 15 characters. A longer pattern cannot match
/// anything, and pgrep says so — on stderr, while exiting exactly as if the
/// process simply weren't running:
///
/// ```text
/// pgrep: pattern that searches for process name longer than 15 characters
///        will result in zero matches
/// ```
///
/// Nothing reads that stderr, so `is_running("AssettoCorsa.exe")` — 16
/// characters — was a permanent `false`. It silently disabled the Content
/// Manager detection that decides whether to join an existing Proton prefix,
/// which is invisible from the outside: the capture just takes the cold-start
/// path and fails the way it always did.
const MAX_COMM_LEN: usize = 15;

/// The pattern to hand `pgrep -x` for a given process name.
///
/// Truncating is what makes a long name matchable at all. It costs a little
/// specificity — another process whose name shares the first 15 characters
/// would match too — which is worth it against never matching, and harmless
/// for the names this app looks for.
fn comm_pattern(process_name: &str) -> String {
    process_name.chars().take(MAX_COMM_LEN).collect()
}

/// PIDs of live (non-zombie) processes named exactly `process_name`, or `None`
/// if the check itself couldn't run.
///
/// The distinction matters wherever "not running" triggers something
/// destructive: a `pgrep` that failed to spawn is not evidence that anything
/// died. Callers that only need the conservative answer can use `live_pids`.
pub fn live_pids_checked(process_name: &str) -> Option<Vec<u32>> {
    let out = crate::host_command::host_command("pgrep")
        .arg("-x")
        .arg(comm_pattern(process_name))
        .output()
        .ok()?;

    Some(
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|line| line.trim().parse::<u32>().ok())
            .filter(|pid| is_live(*pid))
            .collect(),
    )
}

/// PIDs of live (non-zombie) processes named exactly `process_name`.
///
/// A failed check reads as "nothing running", which is the right default for
/// the watchdogs — the worst case is starting a service that's already there,
/// against never starting one that isn't.
pub fn live_pids(process_name: &str) -> Vec<u32> {
    live_pids_checked(process_name).unwrap_or_default()
}

/// Whether any live process named exactly `process_name` exists.
pub fn is_running(process_name: &str) -> bool {
    !live_pids(process_name).is_empty()
}

/// Whether any live process named exactly `process_name` exists, or `None` if
/// the check couldn't be made. See `live_pids_checked`.
pub fn is_running_checked(process_name: &str) -> Option<bool> {
    live_pids_checked(process_name).map(|pids| !pids.is_empty())
}

/// `pid comm` for every live process whose *command line* mentions `needle`.
///
/// Diagnostic only, and deliberately matching on the command line rather than
/// the name: it exists to answer "the name I'm looking for isn't there, so
/// what IS running?" — a question `pgrep -x` cannot answer by construction,
/// since it only ever confirms or denies the name you already guessed.
pub fn comms_matching_cmdline(needle: &str) -> Vec<String> {
    let Ok(out) = crate::host_command::host_command("pgrep")
        .arg("-f")
        .arg(needle)
        .output()
    else {
        return Vec::new();
    };

    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .filter(|pid| is_live(*pid))
        .map(|pid| format!("{pid} {}", comm_of(pid).unwrap_or_else(|| "?".into())))
        .collect()
}

/// A pid's `comm`, i.e. exactly what `pgrep -x` matches against.
fn comm_of(pid: u32) -> Option<String> {
    let path = format!("/proc/{pid}/comm");
    let text = if crate::host_command::in_flatpak() {
        let out = crate::host_command::host_command("cat")
            .arg(&path)
            .output()
            .ok()?;
        String::from_utf8_lossy(&out.stdout).into_owned()
    } else {
        std::fs::read_to_string(&path).ok()?
    };
    Some(text.trim().to_string())
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

    /// The regression that disabled Content Manager detection outright.
    #[test]
    fn a_name_too_long_for_comm_is_truncated_not_passed_through() {
        // 16 characters: one over what /proc/<pid>/comm can hold, which is
        // where pgrep gives up and matches nothing.
        assert_eq!(comm_pattern("AssettoCorsa.exe"), "AssettoCorsa.ex");
        // Anything that fits is handed over untouched, so `-x` stays exact.
        assert_eq!(comm_pattern("acs.exe"), "acs.exe");
        assert_eq!(comm_pattern("huenicorn"), "huenicorn");
        // Exactly at the limit is still a fit.
        let fifteen = "a".repeat(MAX_COMM_LEN);
        assert_eq!(comm_pattern(&fifteen), fifteen);
    }

    /// The kernel really does truncate and `pgrep` really cannot see past it,
    /// proven against a live process rather than taken from a man page.
    ///
    /// Note that a too-long pattern does NOT fail loudly: pgrep prints its
    /// warning to stderr and still exits 1, which is indistinguishable from an
    /// honest "no such process" to anything reading the exit status. That is
    /// precisely why the original bug went unnoticed.
    #[test]
    fn pgrep_only_matches_a_long_name_once_truncated() {
        use std::os::unix::fs::PermissionsExt;

        // 21 characters, so /proc/<pid>/comm keeps only "MonocoqueProbeS".
        let long_name = "MonocoqueProbeSleeper";
        let dir = std::env::temp_dir().join(format!("mb-comm-probe-{}", std::process::id()));
        if std::fs::create_dir_all(&dir).is_err() {
            return;
        }
        let probe = dir.join(long_name);
        // A copy of a real binary, because exec'ing a script would leave comm
        // reading as the interpreter and prove nothing.
        if std::fs::copy("/bin/sleep", &probe).is_err() {
            let _ = std::fs::remove_dir_all(&dir);
            return;
        }
        let _ = std::fs::set_permissions(&probe, std::fs::Permissions::from_mode(0o755));

        let Ok(mut child) = Command::new(&probe).arg("5").spawn() else {
            let _ = std::fs::remove_dir_all(&dir);
            return;
        };
        // Long enough to be visible in /proc, short enough not to drag.
        std::thread::sleep(std::time::Duration::from_millis(200));

        let full = Command::new("pgrep").arg("-x").arg(long_name).output();
        let truncated = Command::new("pgrep")
            .arg("-x")
            .arg(comm_pattern(long_name))
            .output();

        // Cleaned up before asserting, so a failure can't leak the process.
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_dir_all(&dir);

        let (Ok(full), Ok(truncated)) = (full, truncated) else {
            return;
        };
        assert!(
            String::from_utf8_lossy(&full.stdout).trim().is_empty(),
            "the untruncated name found something — the bug this guards \
             against would not reproduce"
        );
        assert!(
            !String::from_utf8_lossy(&truncated.stdout).trim().is_empty(),
            "the truncated name should find the running probe"
        );
    }

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
