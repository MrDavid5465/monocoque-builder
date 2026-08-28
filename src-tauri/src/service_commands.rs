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
    match debug.map(str::trim).filter(|d| !d.is_empty()) {
        Some(dev) => Some(dev.to_string()),
        None => None,
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

    #[test]
    fn dev_commands_are_trimmed() {
        assert_eq!(
            resolve_with_mode("simd", Some("  /src/build/simd  "), true),
            Some("/src/build/simd".to_string())
        );
    }
}
