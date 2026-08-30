//! Running host commands from inside (and outside) a Flatpak sandbox.
//!
//! This app drives the host: it shells out to `pactl`, `pw-dump`, `pw-cli`,
//! `pipewire`, `pkill` and `pkexec` to inspect and reconfigure audio routing,
//! and to install a udev rule for gamepad access. None of those binaries exist
//! inside a Flatpak runtime, and even if they did they would act on the
//! sandbox's own namespaces rather than the host's — `pkill` would find no
//! host processes to signal, and `pactl` would talk to nothing.
//!
//! Flatpak's escape hatch for this is `flatpak-spawn --host`, which asks the
//! session helper to run the command outside the sandbox. It requires
//! `--talk-name=org.freedesktop.Flatpak` in the manifest's finish-args; without
//! it the spawn is refused.
//!
//! Outside a sandbox this is a plain passthrough, so the same code path serves
//! the .deb/.rpm/AppImage builds unchanged.

use std::process::Command;

/// True when running inside a Flatpak sandbox.
///
/// `/.flatpak-info` is created by flatpak in every sandbox and is the
/// documented way to detect one from inside. Checked once and cached, since
/// this is called from polling loops.
pub fn in_flatpak() -> bool {
    use std::sync::OnceLock;
    static IN_FLATPAK: OnceLock<bool> = OnceLock::new();
    *IN_FLATPAK.get_or_init(|| std::path::Path::new("/.flatpak-info").exists())
}

/// Builds a `Command` that runs `program` on the host.
///
/// Use this instead of `Command::new` for anything that must affect the host:
/// audio daemons, host processes, privileged helpers. Arguments are added by
/// the caller exactly as with `Command::new`, because `flatpak-spawn` passes
/// everything after the program name straight through.
///
/// Deliberately *not* used for commands that should stay inside the sandbox
/// (there are none today, but a bundled helper binary would be one).
pub fn host_command(program: &str) -> Command {
    if in_flatpak() {
        let mut cmd = Command::new("flatpak-spawn");
        cmd.arg("--host").arg(program);
        cmd
    } else {
        Command::new(program)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Outside a sandbox the wrapper must be a pure passthrough -- otherwise
    /// the native .deb/.rpm/AppImage builds would gain a dependency on
    /// flatpak-spawn, which won't be installed.
    #[test]
    fn passthrough_when_not_sandboxed() {
        if in_flatpak() {
            return; // meaningless assertion inside a sandbox
        }
        let cmd = host_command("pactl");
        assert_eq!(cmd.get_program(), "pactl");
        assert_eq!(cmd.get_args().count(), 0);
    }

    /// The wrapper must not mangle arguments -- `flatpak-spawn --host` takes
    /// the program and its args positionally, so a caller adding `.arg(...)`
    /// has to end up with the same argv either way.
    #[test]
    fn args_are_passed_through_unchanged() {
        let mut cmd = host_command("pw-dump");
        cmd.arg("--no-colors");
        let args: Vec<_> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(args.last().unwrap(), "--no-colors");
        if in_flatpak() {
            assert_eq!(cmd.get_program(), "flatpak-spawn");
            assert_eq!(args, vec!["--host", "pw-dump", "--no-colors"]);
        }
    }
}
