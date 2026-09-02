//! Which command actually launches a companion service — the source build
//! while developing, the installed one in a shipped build.
//!
//! The mode is the **build type**, not a stored setting: `cfg!(debug_assertions)`
//! is true for `npm run tauri dev` and false for a `tauri build` release
//! binary. That was a deliberate choice over a runtime toggle — a toggle is
//! one more piece of state that can be left in the wrong position, and the
//! failure it would cause is the nastiest kind: a shipped build quietly
//! launching binaries out of a source tree that isn't on the target machine,
//! or a dev session testing the installed copy while you edit the source and
//! wonder why nothing changes.
//!
//! In a debug build, a service with no dev command is treated as a
//! **misconfiguration, not a fallback**: `resolve` returns `None` and the
//! caller declines to start it. Silently launching the installed binary is
//! precisely what the dev/production split exists to prevent — that is how an
//! afternoon gets spent debugging a stale `/usr/local/bin` copy while the
//! source build sits unused.
//!
//! The dev command comes from an **environment variable**, not app config.
//! Where a source build lives is a property of one developer's machine, not
//! of the application: putting it in config meant the setting existed in the
//! UI of every shipped build, where it does nothing, and travelled with a
//! config file to machines that have no such checkout. An env var is scoped
//! to the shell that launched the dev build, which is exactly the lifetime
//! the value has.

/// Environment variables holding the dev command for each service. Only read
/// in debug builds.
pub const SIMD_DEV_COMMAND_ENV: &str = "TYPIQL_SIMD_DEV_COMMAND";
pub const MONOCOQUE_DEV_COMMAND_ENV: &str = "TYPIQL_MONOCOQUE_DEV_COMMAND";
pub const HUENICORN_DEV_COMMAND_ENV: &str = "TYPIQL_HUENICORN_DEV_COMMAND";

/// True when this is a debug (`cargo build` / `tauri dev`) binary.
pub fn is_debug_build() -> bool {
    cfg!(debug_assertions)
}

/// The command to launch a service, or `None` when this is a debug build and
/// its dev environment variable isn't set (see the module docs — that case is
/// a refusal, not a fallback).
///
/// `production` is the configured command used by shipped builds; `dev_env`
/// names the variable consulted instead while developing. Callers own the
/// logging, since the watchdogs re-resolve on every tick and would otherwise
/// repeat the same complaint every few seconds.
pub fn resolve(production: &str, dev_env: &str) -> Option<String> {
    let debug = std::env::var(dev_env).ok();
    resolve_with_mode(production, debug.as_deref(), is_debug_build())
}

/// The decision itself, with the mode passed in — a single build can only
/// ever exercise one side of `cfg!(debug_assertions)`, so the tests need this
/// seam to cover both.
fn resolve_with_mode(production: &str, debug: Option<&str>, debug_build: bool) -> Option<String> {
    if !debug_build {
        return Some(production.to_string());
    }

    // Whitespace-only counts as unset: these come from a text field, and a
    // stray space shouldn't become a command that fails in a confusing way.
    debug
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(|dev| dev.to_string())
}

/// Rewrites a command line into something the *host* can actually run.
///
/// Under Flatpak every service is started through `flatpak-spawn --host`, so
/// the configured command has to name a program that exists out there — and on
/// an immutable host it frequently doesn't. Measured on this rig: with the
/// monocoque Flatpak installed and running, `sh -lc 'command -v monocoque'` on
/// the host comes back empty, because monocoque lives in a Flatpak (and a
/// distrobox), not in the host's PATH. The watchdog would then respawn a
/// command that can never start, forever, while `pgrep` kept reporting the
/// service down.
///
/// So when the program isn't on the host's PATH but some installed Flatpak
/// *provides* a binary by that name, the line becomes
/// `flatpak run --command=<program> <app-id> <args…>`.
///
/// Asking which app provides the binary, rather than matching the app id's
/// last segment, is what makes `simd` work: it ships inside monocoque's
/// Flatpak, so its id ends in `.monocoque` and a suffix match found nothing —
/// the log said "no installed Flatpak app id ends in `.simd`" while `simd` sat
/// in that app's own bin directory. The lookup reads
/// `flatpak info --show-location` for each installed app and tests
/// `files/bin/<program>`, which needs no table of ids here and keeps working
/// when a binary moves between bundles.
///
/// Anything already resolvable on the host is returned untouched, as is every
/// command when not sandboxed.
pub fn resolve_for_host(command_line: &str) -> String {
    if !crate::host_command::in_flatpak() {
        return command_line.to_string();
    }
    rewrite_for_flatpak(command_line, host_has_program, flatpak_app_providing)
}

/// The rewrite itself, with both host lookups injected — they shell out to the
/// host, which no unit test can do.
fn rewrite_for_flatpak(
    command_line: &str,
    host_has: impl Fn(&str) -> bool,
    app_providing: impl Fn(&str) -> Option<String>,
) -> String {
    let trimmed = command_line.trim();
    let (program, args) = match trimmed.split_once(char::is_whitespace) {
        Some((p, rest)) => (p, rest.trim()),
        None => (trimmed, ""),
    };

    // Already a Flatpak invocation, or nothing to work with.
    if program.is_empty() || program == "flatpak" || host_has(program) {
        return command_line.to_string();
    }

    let Some(app_id) = app_providing(program) else {
        // Nothing to fall back to. Left alone on purpose: the caller's existing
        // "child exited" logging reports the real failure, which is more useful
        // than a rewrite that would fail differently.
        eprintln!(
            "resolve_for_host: `{program}` is not on the host's PATH and no installed \
Flatpak provides it — starting it as configured, which will probably fail"
        );
        return command_line.to_string();
    };

    let rewritten = if args.is_empty() {
        format!("flatpak run --command={program} {app_id}")
    } else {
        format!("flatpak run --command={program} {app_id} {args}")
    };
    eprintln!("resolve_for_host: `{program}` is not on the host's PATH; using `{rewritten}`");
    rewritten
}

/// Whether the host can resolve `program`.
///
/// `sh -lc`, not `sh -c`: `flatpak-spawn` hands the host the *sandbox's*
/// environment, so a plain `sh -c` searches `/app/bin:/usr/bin` and would miss
/// everything in the user's real PATH — `~/.local/bin/huenicorn`, for
/// instance, which is exactly the case this must not get wrong. A login shell
/// reads the host's profile and gets the host's PATH.
fn host_has_program(program: &str) -> bool {
    crate::host_command::host_command("sh")
        .arg("-lc")
        .arg(format!("command -v {program}"))
        .output()
        .map(|out| out.status.success() && !out.stdout.is_empty())
        .unwrap_or(false)
}

/// The id of an installed Flatpak whose own `bin` directory holds `program`.
///
/// One host command rather than one per app: `flatpak info --show-location`
/// has to run for every installed app, and driving that loop from here would
/// be a separate `flatpak-spawn` round trip each time.
fn flatpak_app_providing(program: &str) -> Option<String> {
    let script = format!(
        "for id in $(flatpak list --app --columns=application); do \
             loc=$(flatpak info --show-location \"$id\" 2>/dev/null) || continue; \
             if [ -x \"$loc/files/bin/{program}\" ]; then echo \"$id\"; break; fi; \
         done"
    );

    let out = crate::host_command::host_command("sh")
        .arg("-lc")
        .arg(script)
        .output()
        .ok()?;

    let id = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if id.is_empty() {
        None
    } else {
        Some(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_builds_always_use_the_configured_command() {
        assert_eq!(
            resolve_with_mode("simd", None, false),
            Some("simd".to_string())
        );
        // Even with a dev command configured — a shipped build must never
        // reach into a source tree.
        assert_eq!(
            resolve_with_mode("simd", Some("/src/build/simd"), false),
            Some("simd".to_string())
        );
    }

    #[test]
    fn debug_builds_use_the_dev_command() {
        assert_eq!(
            resolve_with_mode("simd", Some("/src/build/simd"), true),
            Some("/src/build/simd".to_string())
        );
    }

    #[test]
    fn debug_builds_refuse_when_no_dev_command_is_configured() {
        assert_eq!(resolve_with_mode("simd", None, true), None);
        assert_eq!(resolve_with_mode("simd", Some(""), true), None);
        assert_eq!(resolve_with_mode("simd", Some("   "), true), None);
    }

    /// A command the host can run is never touched — the Flatpak path is a
    /// fallback, not a preference.
    #[test]
    fn leaves_commands_the_host_can_run_alone() {
        assert_eq!(
            rewrite_for_flatpak("huenicorn --port 8080", |_| true, |_| None),
            "huenicorn --port 8080"
        );
    }

    #[test]
    fn rewrites_to_the_providing_flatpak_keeping_arguments() {
        let provider = |_: &str| Some("io.github.spacefreak18.monocoque".to_string());
        assert_eq!(
            rewrite_for_flatpak("monocoque play", |_| false, provider),
            "flatpak run --command=monocoque io.github.spacefreak18.monocoque play"
        );
        assert_eq!(
            rewrite_for_flatpak("monocoque", |_| false, provider),
            "flatpak run --command=monocoque io.github.spacefreak18.monocoque"
        );
    }

    /// simd ships inside monocoque's Flatpak, so nothing about the app id
    /// mentions it -- the whole reason this asks which app provides a binary
    /// rather than reading the id.
    #[test]
    fn finds_a_binary_bundled_under_an_unrelated_app_id() {
        let provider = |program: &str| {
            (program == "simd").then(|| "io.github.spacefreak18.monocoque".to_string())
        };
        assert_eq!(
            rewrite_for_flatpak("simd", |_| false, provider),
            "flatpak run --command=simd io.github.spacefreak18.monocoque"
        );
    }

    /// Nothing provides it: the command stays as configured, so the spawn
    /// failure the caller already logs is the one the user sees.
    #[test]
    fn leaves_the_command_alone_when_nothing_provides_it() {
        assert_eq!(rewrite_for_flatpak("simd", |_| false, |_| None), "simd");
    }

    /// An explicit `flatpak run …` in settings is already host-runnable even
    /// though `flatpak` may not look like a service binary.
    #[test]
    fn leaves_an_explicit_flatpak_invocation_alone() {
        let line = "flatpak run --command=monocoque io.github.spacefreak18.monocoque play";
        assert_eq!(rewrite_for_flatpak(line, |_| false, |_| None), line);
    }

    #[test]
    fn dev_commands_are_trimmed() {
        assert_eq!(
            resolve_with_mode("simd", Some("  /src/build/simd  "), true),
            Some("/src/build/simd".to_string())
        );
    }
}
