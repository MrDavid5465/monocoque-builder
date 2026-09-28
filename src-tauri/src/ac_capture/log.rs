//! The account a capture writes of itself, to a file.
//!
//! A capture runs unattended and detached from the request that started it,
//! and the part that goes wrong happens in another process — the game — which
//! this app only ever observes through a couple of noisy signals. When one
//! misfires, the evidence left behind is a handful of file mtimes and AC's own
//! log; reconstructing a failure from those is slow and easy to get wrong.
//!
//! Written to a file rather than to stderr because stderr is exactly where it
//! isn't readable: under `tauri dev` the pipe belongs to the dev-server
//! process, and a packaged build discards it altogether. The one time the
//! output matters, nobody can get at it.
//!
//! Timestamps are local wall-clock to match the format AC and CSP use in their
//! own logs (`2026.09.06/22:35:25`), since lining the two up is the whole
//! point — a capture failure is nearly always a question about ordering
//! between this app and the game.

use std::io::Write;
use std::path::{Path, PathBuf};

/// Trim the log once it passes this. A capture writes on the order of tens of
/// lines, so this still holds hundreds of them.
const MAX_BYTES: u64 = 256 * 1024;

/// Where the log lives.
///
/// Alongside the restore journal, under the config directory rather than a
/// cache — same reasoning as `preflight::journal_path`, and it means the two
/// halves of a post-mortem sit next to each other.
pub fn path() -> PathBuf {
    dirs::config_dir()
        .map(|dir| dir.join("dashboard-designer"))
        .unwrap_or_else(|| PathBuf::from("data/typiql"))
        .join("ac-capture.log")
}

/// Appends one timestamped line. Best-effort: a capture must not fail because
/// its diary couldn't be written.
pub fn line(message: &str) {
    let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    append_to(&path(), &format!("{stamp}  {message}\n"));
}

/// Opens a new section for one capture, trimming first if the file has grown
/// past `MAX_BYTES`.
///
/// Trimming drops the whole file rather than keeping a tail: a partial line at
/// the head of a log that's read by eye is worse than a note saying what
/// happened, and the runs that matter are the recent ones.
pub fn begin(car_id: &str) {
    let path = path();
    if std::fs::metadata(&path).is_ok_and(|meta| meta.len() > MAX_BYTES)
        && std::fs::remove_file(&path).is_ok()
    {
        append_to(
            &path,
            &format!("(previous entries dropped: log passed {MAX_BYTES} bytes)\n"),
        );
    }
    append_to(&path, "\n");
    line(&format!("=== capture starting: {car_id} ==="));
}

/// The single point that touches the filesystem, so the rest stays testable
/// without writing into the real config directory.
fn append_to(path: &Path, text: &str) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = file.write_all(text.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("mb-capture-log-{}-{name}", std::process::id()))
    }

    #[test]
    fn appends_rather_than_replacing() {
        let path = temp_path("append");
        let _ = std::fs::remove_file(&path);

        append_to(&path, "first\n");
        append_to(&path, "second\n");

        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(text, "first\nsecond\n");
        let _ = std::fs::remove_file(&path);
    }

    /// A missing parent directory is created rather than silently losing the
    /// line — on a fresh install nothing has written to the config directory
    /// yet when the first capture runs.
    #[test]
    fn creates_the_directory_it_needs() {
        let dir = temp_path("mkdir-dir");
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("nested").join("ac-capture.log");

        append_to(&path, "hello\n");

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Writing must never panic, whatever the filesystem says — the capture
    /// itself is the thing that matters.
    #[test]
    fn an_unwritable_path_is_ignored() {
        // A path whose parent is a FILE, so both the mkdir and the open fail.
        let blocker = temp_path("blocker");
        std::fs::write(&blocker, "not a directory").unwrap();
        append_to(&blocker.join("log.txt"), "should vanish quietly\n");
        let _ = std::fs::remove_file(&blocker);
    }
}
