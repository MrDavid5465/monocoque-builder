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
//! In a debug build, a service with no configured dev command is treated as a
//! **misconfiguration, not a fallback**: `resolve` returns `None` and the
//! caller declines to start it. Silently launching the installed binary is
//! precisely what the dev/production split exists to prevent — that is how an
//! afternoon gets spent debugging a stale `/usr/local/bin` copy while the
//! source build sits unused.

/// True when this is a debug (`cargo build` / `tauri dev`) binary.
pub fn is_debug_build() -> bool {
    cfg!(debug_assertions)
}

/// The command to launch `service`, or `None` when this is a debug build and
/// no dev command is configured for it (see the module docs — that case is a
/// refusal, not a fallback). Callers own the logging, since the watchdogs
/// re-resolve on every tick and would otherwise repeat the same complaint
/// every few seconds.
pub fn resolve(production: &str, debug: Option<&str>) -> Option<String> {
    resolve_with_mode(production, debug, is_debug_build())
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
/// So when the program isn't on the host's PATH and an installed Flatpak app
/// id ends in `.<program>`, the line becomes
/// `flatpak run --command=<program> <app-id> <args…>`. Suffix-matching the app
/// id is deliberate over a hardcoded table: it picks up
/// `io.github.spacefreak18.monocoque` for `monocoque` without this app needing
/// to know that id, and it only ever runs when the host has nothing by that
/// name anyway.
///
/// Anything already resolvable on the host is returned untouched, as is every
/// command when not sandboxed.
pub fn resolve_for_host(command_line: &str) -> String {
    if !crate::host_command::in_flatpak() {
        return command_line.to_string();
    }
    rewrite_for_flatpak(command_line, host_has_program, installed_flatpak_apps)
}

/// The rewrite itself, with both host lookups injected — they shell out to the
/// host, which no unit test can do.
fn rewrite_for_flatpak(
    command_line: &str,
    host_has: impl Fn(&str) -> bool,
    installed_apps: impl Fn() -> Vec<String>,
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

    let suffix = format!(".{program}");
    let Some(app_id) = installed_apps().into_iter().find(|id| id.ends_with(&suffix)) else {
        // Nothing to fall back to (simd, for one, has no Flatpak at all).
        // Left alone on purpose: the caller's existing "child exited" logging
        // reports the real failure, which is more useful than a rewrite that
        // would fail differently.
        eprintln!(
            "resolve_for_host: `{program}` is not on the host's PATH and no installed Flatpak              app id ends in `{suffix}` — starting it as configured, which will probably fail"
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

/// Application ids of the Flatpak apps installed on the host.
fn installed_flatpak_apps() -> Vec<String> {
    crate::host_command::host_command("flatpak")
        .args(["list", "--app", "--columns=application"])
        .output()
        .map(|out| {
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
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
            rewrite_for_flatpak("huenicorn --port 8080", |_| true, Vec::new),
            "huenicorn --port 8080"
        );
    }

    #[test]
    fn rewrites_to_the_matching_flatpak_keeping_arguments() {
        let apps = || {
            vec![
                "com.telemetryadmin.app".to_string(),
                "io.github.spacefreak18.monocoque".to_string(),
            ]
        };
        assert_eq!(
            rewrite_for_flatpak("monocoque play", |_| false, apps),
            "flatpak run --command=monocoque io.github.spacefreak18.monocoque play"
        );
        assert_eq!(
            rewrite_for_flatpak("monocoque", |_| false, apps),
            "flatpak run --command=monocoque io.github.spacefreak18.monocoque"
        );
    }

    /// simd has no Flatpak anywhere; the command stays as configured so the
    /// spawn failure the caller already logs is the one the user sees.
    #[test]
    fn leaves_the_command_alone_when_no_flatpak_matches() {
        let apps = || vec!["io.github.spacefreak18.monocoque".to_string()];
        assert_eq!(rewrite_for_flatpak("simd", |_| false, apps), "simd");
    }

    /// A partial name must not match: `.app` ending in the app id is not a
    /// program called `app` unless it really is one.
    #[test]
    fn matches_the_whole_final_segment_only() {
        let apps = || vec!["io.github.spacefreak18.monocoque".to_string()];
        assert_eq!(rewrite_for_flatpak("coque play", |_| false, apps), "coque play");
    }

    /// An explicit `flatpak run …` in settings is already host-runnable even
    /// though `flatpak` may not look like a service binary.
    #[test]
    fn leaves_an_explicit_flatpak_invocation_alone() {
        let line = "flatpak run --command=monocoque io.github.spacefreak18.monocoque play";
        assert_eq!(rewrite_for_flatpak(line, |_| false, Vec::new), line);
    }

    #[test]
    fn dev_commands_are_trimmed() {
        assert_eq!(
            resolve_with_mode("simd", Some("  /src/build/simd  "), true),
            Some("/src/build/simd".to_string())
        );
    }
}
