//! Loads machine-local development settings from a `.env.local` file, so the
//! `TYPIQL_*_DEV_COMMAND` variables don't have to be retyped on every
//! `npm run tauri dev`.
//!
//! This is the missing half of `service_commands`: that module explains why
//! those values are environment variables rather than app config (where a
//! source build lives is a property of one developer's machine, not of the
//! application, and a config file would carry the setting to machines with no
//! such checkout). All of that still holds — this only removes the retyping,
//! by reading the same variables from a file that is equally machine-local.
//!
//! Three properties keep this from undermining the split it supports:
//!
//! - **Debug builds only.** A release build never reads the file, so it can
//!   still never be pointed at a source tree. Same guard, same reason, as
//!   `service_commands::resolve`.
//! - **The environment wins.** A variable already set in the shell is left
//!   alone, so a one-off override on the command line still takes precedence
//!   over the file.
//! - **Prefixed keys only.** The file can set `TYPIQL_*` and `RUST_*` and
//!   nothing else. A dotfile that silently edits `PATH` or `LD_PRELOAD` for
//!   the process is a bigger hazard than the convenience is worth. Skipped
//!   keys are logged rather than ignored quietly.
//!
//! `.env.local` is already covered by the repo's `*.local` ignore rule, so it
//! cannot be committed by accident. `.env.local.example` (placeholders only,
//! no one's personal paths) is the committed copy.

use std::path::PathBuf;

/// The file name searched for, from the working directory upward.
const FILE_NAME: &str = ".env.local";

/// Key prefixes the file is allowed to set.
const ALLOWED_PREFIXES: [&str; 2] = ["TYPIQL_", "RUST_"];

/// Reads `.env.local` into the process environment.
///
/// Call once, at the very top of `main`, before any thread is spawned:
/// `set_var` mutates process-global state that concurrent `getenv` calls
/// cannot safely observe, and every consumer here (the service watchdogs, the
/// capture module) reads it later from tasks this must precede.
///
/// Returns the file it loaded, if any. No-ops in release builds, and when no
/// file is found — running without one is the normal case for anyone who
/// passes the variables some other way.
pub fn load() -> Option<PathBuf> {
    if !crate::service_commands::is_debug_build() {
        return None;
    }

    let path = find_upwards(FILE_NAME)?;
    let contents = match std::fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(e) => {
            eprintln!("dev_env: could not read {}: {e}", path.display());
            return None;
        }
    };

    let mut applied = 0;
    for (key, value) in parse(&contents) {
        if !ALLOWED_PREFIXES.iter().any(|p| key.starts_with(p)) {
            eprintln!(
                "dev_env: ignoring `{key}` from {} - only {} keys are read from this file",
                path.display(),
                ALLOWED_PREFIXES.join("/")
            );
            continue;
        }
        // Already set in the shell: leave it. An explicit override on the
        // command line has to beat the file, or debugging one service against
        // a different build means editing the file every time.
        if std::env::var_os(&key).is_some() {
            continue;
        }
        std::env::set_var(&key, &value);
        applied += 1;
    }

    println!(
        "dev_env: loaded {applied} variable(s) from {}",
        path.display()
    );
    Some(path)
}

/// Walks up from the working directory looking for `name`.
///
/// Searching upward rather than reading a fixed path is what makes one file
/// serve every way the binary gets started: `tauri dev` runs it with the
/// working directory set to `src-tauri`, a bare `cargo run` the same, and an
/// IDE may use the repo root. All three find a single `.env.local` beside
/// `package.json`.
fn find_upwards(name: &str) -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok()?;
    cwd.ancestors()
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

/// Parses `KEY=VALUE` lines.
///
/// Hand-rolled rather than pulling in `dotenvy`, matching this codebase's
/// existing convention for small, well-understood formats (`sun_position`'s
/// date handling, the Steam VDF reader in `ac_capture::paths`, the INI
/// round-trip in `ac_capture::ini`). The format supported is deliberately the
/// boring subset: comments, blank lines, an optional `export` prefix,
/// surrounding quotes, and no variable interpolation — a value is exactly the
/// literal text, which is what a path with spaces in it needs.
fn parse(contents: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for raw in contents.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line).trim_start();
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        out.push((key.to_string(), unquote(value.trim()).to_string()));
    }
    out
}

/// Strips one layer of matching surrounding quotes.
///
/// Only when they match and there are at least two characters, so a lone `"`
/// stays a lone `"` rather than becoming an empty string.
fn unquote(value: &str) -> &str {
    let bytes = value.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' || first == b'\'') && first == last {
            return &value[1..value.len() - 1];
        }
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_boring_subset() {
        let parsed = parse(
            r#"
# a comment
TYPIQL_SIMD_DEV_COMMAND=/src/build/simd

  export TYPIQL_MONOCOQUE_DEV_COMMAND="/src/build/monocoque play"
TYPIQL_HUENICORN_DEV_COMMAND='/src/build/huenicorn'
"#,
        );
        assert_eq!(
            parsed,
            vec![
                ("TYPIQL_SIMD_DEV_COMMAND".into(), "/src/build/simd".into()),
                (
                    "TYPIQL_MONOCOQUE_DEV_COMMAND".into(),
                    "/src/build/monocoque play".into()
                ),
                (
                    "TYPIQL_HUENICORN_DEV_COMMAND".into(),
                    "/src/build/huenicorn".into()
                ),
            ]
        );
    }

    /// A command with arguments is the normal case here ("monocoque play"),
    /// and an `=` inside a value must not split the line a second time.
    #[test]
    fn keeps_spaces_and_later_equals_signs_in_the_value() {
        let parsed = parse("TYPIQL_MONOCOQUE_DEV_COMMAND=monocoque play --flag=1");
        assert_eq!(
            parsed,
            vec![(
                "TYPIQL_MONOCOQUE_DEV_COMMAND".into(),
                "monocoque play --flag=1".into()
            )]
        );
    }

    #[test]
    fn skips_lines_that_are_not_assignments() {
        assert!(parse("no equals sign here").is_empty());
        assert!(parse("=novalue").is_empty());
        assert!(parse("   ").is_empty());
        assert!(parse("#TYPIQL_SIMD_DEV_COMMAND=x").is_empty());
    }

    #[test]
    fn unquotes_only_matching_pairs() {
        assert_eq!(unquote("\"quoted\""), "quoted");
        assert_eq!(unquote("'quoted'"), "quoted");
        assert_eq!(unquote("bare"), "bare");
        // Mismatched or lone quotes are left exactly as written.
        assert_eq!(unquote("\"mismatched'"), "\"mismatched'");
        assert_eq!(unquote("\""), "\"");
        assert_eq!(unquote(""), "");
    }

    /// An empty value is legitimate — `service_commands::resolve` already
    /// treats an empty dev command as unset, so this must reach it as one
    /// rather than being dropped during parsing.
    #[test]
    fn keeps_empty_values() {
        assert_eq!(
            parse("TYPIQL_SIMD_DEV_COMMAND="),
            vec![("TYPIQL_SIMD_DEV_COMMAND".into(), "".into())]
        );
    }

    #[test]
    fn only_prefixed_keys_are_allowed() {
        for key in ["TYPIQL_SIMD_DEV_COMMAND", "RUST_LOG", "RUST_BACKTRACE"] {
            assert!(ALLOWED_PREFIXES.iter().any(|p| key.starts_with(p)), "{key}");
        }
        for key in ["PATH", "LD_PRELOAD", "HOME", "TYPIQ_TYPO"] {
            assert!(
                !ALLOWED_PREFIXES.iter().any(|p| key.starts_with(p)),
                "{key} should not be settable from .env.local"
            );
        }
    }
}
