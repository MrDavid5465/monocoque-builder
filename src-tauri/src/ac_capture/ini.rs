//! Minimal line-preserving INI editing for AC/CSP config files.
//!
//! These files belong to the user, not to this app: Content Manager and CSP
//! both read and rewrite them, and they carry comments and ordering that
//! matter. Everything here therefore edits in place, line by line, touching
//! only the requested key and leaving every other byte — including comments,
//! blank lines and section order — exactly as found.
//!
//! A capture restores each file wholesale from a snapshot afterwards (see
//! `preflight`), so this only has to be faithful for the duration of a run;
//! but being faithful anyway means a failed restore degrades to "a couple of
//! values changed" rather than "the file was rewritten in our own style".

/// Reads a key from a section, if both exist.
pub fn get_value(text: &str, section: &str, key: &str) -> Option<String> {
    let mut in_section = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(name) = section_name(trimmed) {
            in_section = name.eq_ignore_ascii_case(section);
            continue;
        }
        if !in_section {
            continue;
        }
        if let Some((found, value)) = split_entry(trimmed) {
            if found.eq_ignore_ascii_case(key) {
                return Some(value.to_string());
            }
        }
    }
    None
}

/// Sets a key within a section, returning the updated text.
///
/// Creates the key (and, if needed, the section) when absent — which is the
/// common case for CSP override files, where a key only appears once the
/// user has changed it away from CSP's bundled default.
pub fn set_value(text: &str, section: &str, key: &str, value: &str) -> String {
    let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let mut lines: Vec<String> = text.lines().map(|line| line.to_string()).collect();

    let mut section_start = None;
    let mut section_end = lines.len();
    let mut in_section = false;
    for (index, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if let Some(name) = section_name(trimmed) {
            if in_section {
                // First header after our section closes it.
                section_end = index;
                in_section = false;
                break;
            }
            if name.eq_ignore_ascii_case(section) {
                in_section = true;
                section_start = Some(index);
            }
        }
    }
    if in_section {
        section_end = lines.len();
    }

    let Some(start) = section_start else {
        // No such section: append it, keeping a blank line before it unless
        // the file is empty or already ends with one.
        let mut appended = text.trim_end_matches(['\n', '\r']).to_string();
        if !appended.is_empty() {
            appended.push_str(newline);
            appended.push_str(newline);
        }
        appended.push_str(&format!(
            "[{section}]{newline}{key}={value}{newline}",
            section = section,
            key = key,
            value = value,
            newline = newline
        ));
        return appended;
    };

    for line in lines.iter_mut().take(section_end).skip(start + 1) {
        let trimmed = line.trim();
        if let Some((found, _)) = split_entry(trimmed) {
            if found.eq_ignore_ascii_case(key) {
                // Preserve the file's own spacing style around `=`, since
                // these files mix `KEY=value` and `KEY = value`.
                *line = if line.contains(" = ") {
                    format!("{key} = {value}")
                } else {
                    format!("{key}={value}")
                };
                return lines.join(newline) + newline;
            }
        }
    }

    // Key absent from an existing section: insert at the end of that
    // section, after its last non-blank line so trailing spacing survives.
    let mut insert_at = section_end;
    while insert_at > start + 1 && lines[insert_at - 1].trim().is_empty() {
        insert_at -= 1;
    }
    lines.insert(insert_at, format!("{key}={value}"));
    lines.join(newline) + newline
}

/// `[Section]` header name, if the line is one.
fn section_name(trimmed: &str) -> Option<&str> {
    trimmed
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
}

/// Splits `KEY=VALUE`, ignoring comments. Returns `None` for comments,
/// blank lines and anything without an `=`.
fn split_entry(trimmed: &str) -> Option<(&str, &str)> {
    if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
        return None;
    }
    let (key, value) = trimmed.split_once('=')?;
    Some((key.trim(), value.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_value_from_its_own_section() {
        let text = "[A]\nKEY=1\n\n[B]\nKEY=2\n";
        assert_eq!(get_value(text, "B", "KEY").as_deref(), Some("2"));
        assert_eq!(get_value(text, "A", "KEY").as_deref(), Some("1"));
        assert_eq!(get_value(text, "C", "KEY"), None);
    }

    #[test]
    fn replaces_only_the_targeted_line() {
        let text = "; keep me\n[CAMERA]\nMODE=TRIPLE\nOTHER=1\n";
        let updated = set_value(text, "CAMERA", "MODE", "360");
        assert!(updated.starts_with("; keep me\n"));
        assert!(updated.contains("MODE=360"));
        assert!(updated.contains("OTHER=1"));
        assert!(!updated.contains("TRIPLE"));
    }

    #[test]
    fn preserves_spaced_assignment_style() {
        let text = "[CORE]\nLAZY = FULL\n";
        assert!(set_value(text, "CORE", "LAZY", "NONE").contains("LAZY = NONE"));
    }

    #[test]
    fn adds_a_missing_key_inside_its_section() {
        let text = "[FSR]\nQUALITY=0.5\n\n[LODS]\nX=1\n";
        let updated = set_value(text, "FSR", "ACTIVE", "0");
        let fsr_block = updated.split("[LODS]").next().unwrap();
        assert!(fsr_block.contains("ACTIVE=0"));
        assert!(updated.contains("X=1"));
    }

    #[test]
    fn adds_a_missing_section() {
        let updated = set_value("[A]\nX=1\n", "CAMERA", "MODE", "360");
        assert!(updated.contains("[A]"));
        assert!(updated.contains("[CAMERA]"));
        assert!(updated.contains("MODE=360"));
    }

    #[test]
    fn matches_keys_and_sections_case_insensitively() {
        let text = "[Camera]\nmode=TRIPLE\n";
        assert!(set_value(text, "CAMERA", "MODE", "360").contains("MODE=360"));
    }

    #[test]
    fn ignores_commented_out_keys() {
        let text = "[A]\n;MODE=OLD\nMODE=REAL\n";
        assert_eq!(get_value(text, "A", "MODE").as_deref(), Some("REAL"));
        let updated = set_value(text, "A", "MODE", "NEW");
        assert!(updated.contains(";MODE=OLD"));
        assert!(updated.contains("MODE=NEW"));
    }
}
