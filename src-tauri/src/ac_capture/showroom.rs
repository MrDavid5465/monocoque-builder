//! Generating the `monocoque_showroom` capture track from stock AC content.
//!
//! AC ships showroom buildings (`content/showroom/*`), but they're only ever
//! loaded by the car-preview screen — `acs.exe` can't race on one, because a
//! showroom has no spawn points, no physics surface and no track data. A
//! capture needs a real session, so this composes a track that has both:
//!
//! * the donor track (`drift`) supplies everything that makes it loadable —
//!   `data/`, `ai/`, `map.png`, and its model for the drivable surface;
//! * the stock showroom model is loaded alongside it through `models.ini`,
//!   both at the origin, so the building sits on the donor's tarmac.
//!
//! The donor's spawn is in its pit lane, nowhere near the building, so the
//! track also carries `monocoque_capture.ini`: where the capture should set
//! the car down (measured by driving into the building) and which of the
//! donor's meshes to hide so the showroom doesn't sit in a visible car park.
//! See `preflight::track_capture_hints` for the reading side.
//!
//! Both models are symlinked rather than copied — the donor's is ~190MB — and
//! the links are relative so they survive the Steam library moving.

use super::log;
use super::preflight::{CAPTURE_HINTS_FILE, SHOWROOM_TRACK_ID};
use std::path::{Path, PathBuf};

/// Track whose data makes the composite loadable. Stock content, so present
/// on every install.
const DONOR_TRACK: &str = "drift";

/// Stock showroom whose model provides the building.
const SHOWROOM: &str = "showroom";

/// What gets copied from the donor verbatim.
const DONOR_DIRS: [&str; 2] = ["data", "ai"];
const DONOR_FILES: [&str; 1] = ["map.png"];

/// Inside the building, measured by driving there on the composed track.
const PLACE_AT: &str = "-1.709,0.000,0.636";
/// Heading at that spot.
const PLACE_DIR: &str = "0.416,0.000,-0.909";

/// The donor's own scenery, in CSP mesh-filter syntax. Everything visible
/// that *isn't* matched — the floor specks, the exit sign — is part of the
/// showroom model itself, not drift left over.
const HIDE_FILTERS: &str = "?GRASS?|?ROAD?|?KERB?|?WALL?|?Object?|?Loft?";

/// Bump whenever anything above changes, so installs regenerate rather than
/// keeping the old composition.
const GENERATOR_VERSION: &str = "1";

fn tracks_dir(install_dir: &Path) -> PathBuf {
    install_dir.join("content").join("tracks")
}

/// Generator version recorded in an installed showroom, if one is installed.
fn installed_version(track_dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(track_dir.join(CAPTURE_HINTS_FILE)).ok()?;
    Some(super::ini::get_value(&text, "GENERATOR", "VERSION").unwrap_or_default())
}

/// Makes sure the current showroom track is installed, generating it if it's
/// missing or was made by an older generator. Returns whether it wrote
/// anything.
///
/// Built in a sibling folder and renamed into place, so a half-written track
/// is never visible under the real id — the hints file, which
/// `default_capture_track` treats as the installed-check, only appears once
/// everything else is there.
pub fn ensure_installed(install_dir: &Path) -> Result<bool, String> {
    let tracks = tracks_dir(install_dir);
    let target = tracks.join(SHOWROOM_TRACK_ID);

    match installed_version(&target) {
        Some(version) if version == GENERATOR_VERSION => return Ok(false),
        // Ours (it has hints) but stale: safe to replace.
        Some(_) => {}
        // A folder under our id with no hints is either a generation that
        // died before the rename existed, or somebody else's track. Only the
        // first is ours to delete.
        None if target.exists() && !looks_generated(&target) => {
            return Err(format!(
                "{} exists but wasn't made by monocoque-builder; not overwriting it",
                target.display()
            ));
        }
        None => {}
    }

    let staging = tracks.join(format!(".{SHOWROOM_TRACK_ID}.building"));
    if staging.exists() {
        std::fs::remove_dir_all(&staging)
            .map_err(|e| format!("couldn't clear {}: {e}", staging.display()))?;
    }
    if let Err(e) = build(install_dir, &staging) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }

    // `remove_dir_all` removes the model symlinks themselves, never the stock
    // files they point at.
    if target.exists() {
        std::fs::remove_dir_all(&target)
            .map_err(|e| format!("couldn't remove old {}: {e}", target.display()))?;
    }
    std::fs::rename(&staging, &target)
        .map_err(|e| format!("couldn't move showroom track into place: {e}"))?;

    log::line(&format!(
        "showroom: generated {} (generator v{GENERATOR_VERSION})",
        target.display()
    ));
    Ok(true)
}

/// A track folder whose UI metadata carries our tag.
fn looks_generated(track_dir: &Path) -> bool {
    std::fs::read_to_string(track_dir.join("ui/ui_track.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(strip_bom(&text)).ok())
        .and_then(|json| json.get("tags")?.as_array().cloned())
        .is_some_and(|tags| tags.iter().any(|tag| tag == "monocoque"))
}

fn strip_bom(text: &str) -> &str {
    text.strip_prefix('\u{feff}').unwrap_or(text)
}

fn build(install_dir: &Path, out: &Path) -> Result<(), String> {
    let tracks = tracks_dir(install_dir);
    let donor = tracks.join(DONOR_TRACK);
    let donor_model = format!("{DONOR_TRACK}.kn5");
    let showroom_model = format!("{SHOWROOM}.kn5");
    let showroom_source = install_dir
        .join("content/showroom")
        .join(SHOWROOM)
        .join(&showroom_model);

    for required in [donor.join(&donor_model), showroom_source.clone()] {
        if !required.is_file() {
            return Err(format!(
                "can't generate the showroom track: {} is missing",
                required.display()
            ));
        }
    }

    let io = |what: &str, e: std::io::Error| format!("showroom track: {what}: {e}");

    std::fs::create_dir_all(out.join("ui")).map_err(|e| io("create folder", e))?;
    std::fs::create_dir_all(out.join("extension")).map_err(|e| io("create folder", e))?;

    for dir in DONOR_DIRS {
        copy_dir(&donor.join(dir), &out.join(dir)).map_err(|e| io(&format!("copy {dir}/"), e))?;
    }
    for file in DONOR_FILES {
        std::fs::copy(donor.join(file), out.join(file))
            .map_err(|e| io(&format!("copy {file}"), e))?;
    }

    // Relative to the track folder once it's renamed into `content/tracks`.
    symlink(
        &Path::new("..").join(DONOR_TRACK).join(&donor_model),
        &out.join(&donor_model),
    )
    .map_err(|e| io("link donor model", e))?;
    symlink(
        &Path::new("../../showroom")
            .join(SHOWROOM)
            .join(&showroom_model),
        &out.join(&showroom_model),
    )
    .map_err(|e| io("link showroom model", e))?;

    std::fs::write(
        out.join("models.ini"),
        format!(
            "[MODEL_0]\nFILE={donor_model}\nPOSITION=0,0,0\nROTATION=0,0,0\n\n\
             [MODEL_1]\nFILE={showroom_model}\nPOSITION=0,0,0\nROTATION=0,0,0\n"
        ),
    )
    .map_err(|e| io("write models.ini", e))?;

    std::fs::write(out.join("ui/ui_track.json"), ui_track_json(&donor)?)
        .map_err(|e| io("write ui_track.json", e))?;

    // Last: its presence is what marks the track as complete.
    std::fs::write(out.join(CAPTURE_HINTS_FILE), hints_ini()).map_err(|e| io("write hints", e))?;
    Ok(())
}

/// The donor's UI metadata, renamed. Length, pit boxes and the rest are kept
/// because they're true — it's the donor's layout underneath.
fn ui_track_json(donor: &Path) -> Result<String, String> {
    let path = donor.join("ui/ui_track.json");
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("showroom track: read {}: {e}", path.display()))?;
    let mut json: serde_json::Value = serde_json::from_str(strip_bom(&text))
        .map_err(|e| format!("showroom track: parse {}: {e}", path.display()))?;
    let object = json
        .as_object_mut()
        .ok_or_else(|| format!("showroom track: {} isn't an object", path.display()))?;
    object.insert("name".into(), "Monocoque Showroom".into());
    object.insert(
        "description".into(),
        "Generated locally: a donor track's spawn and physics surface composed with a stock \
         showroom model. Used for 360 reference captures."
            .into(),
    );
    object.insert("tags".into(), serde_json::json!(["monocoque", "showroom"]));
    serde_json::to_string_pretty(&json).map_err(|e| format!("showroom track: {e}"))
}

fn hints_ini() -> String {
    format!(
        "; Read by monocoque-builder's capture (preflight::track_capture_hints).\n\
         ; The donor track supplies the spawn and the drivable surface; PLACE is\n\
         ; where the photo actually wants the car, HIDE is the donor scenery that\n\
         ; comes along with it. Generated by ac_capture::showroom — edits here are\n\
         ; overwritten when the generator version changes.\n\
         [PLACE]\nAT={PLACE_AT}\nDIR={PLACE_DIR}\n\n\
         [HIDE]\nFILTERS={HIDE_FILTERS}\n\n\
         [GENERATOR]\nVERSION={GENERATOR_VERSION}\n"
    )
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let dest = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(target, link)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ac_capture::paths::CapturePaths;
    use crate::ac_capture::preflight;

    /// A fake install with just the stock content the generator reads.
    fn fake_install() -> PathBuf {
        let root = std::env::temp_dir().join(format!("typiql-showroom-{}", uuid::Uuid::new_v4()));
        let drift = root.join("content/tracks/drift");
        std::fs::create_dir_all(drift.join("data")).unwrap();
        std::fs::create_dir_all(drift.join("ai")).unwrap();
        std::fs::create_dir_all(drift.join("ui")).unwrap();
        std::fs::write(drift.join("drift.kn5"), b"donor").unwrap();
        std::fs::write(drift.join("data/surfaces.ini"), b"[SURFACE_0]\n").unwrap();
        std::fs::write(drift.join("ai/fast_lane.ai"), b"ai").unwrap();
        std::fs::write(drift.join("map.png"), b"png").unwrap();
        std::fs::write(
            drift.join("ui/ui_track.json"),
            "\u{feff} {\n\t\"name\": \"Drift\",\n\t\"tags\" : [\"drift\"],\n\t\"pitboxes\": \"18\"\n}",
        )
        .unwrap();
        let showroom = root.join("content/showroom/showroom");
        std::fs::create_dir_all(&showroom).unwrap();
        std::fs::write(showroom.join("showroom.kn5"), b"building").unwrap();
        root
    }

    fn paths(root: &Path) -> CapturePaths {
        CapturePaths {
            install_dir: root.to_path_buf(),
            user_dir: root.join("user"),
        }
    }

    #[test]
    fn generates_a_track_the_capture_picks_up() {
        let root = fake_install();
        assert!(ensure_installed(&root).unwrap());

        let track = root.join("content/tracks/monocoque_showroom");
        // Both models resolve through their relative links.
        assert_eq!(std::fs::read(track.join("drift.kn5")).unwrap(), b"donor");
        assert_eq!(
            std::fs::read(track.join("showroom.kn5")).unwrap(),
            b"building"
        );
        assert!(std::fs::symlink_metadata(track.join("drift.kn5"))
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read(track.join("ai/fast_lane.ai")).unwrap(), b"ai");
        assert!(track.join("data/surfaces.ini").is_file());
        assert!(track.join("extension").is_dir());

        let ui: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(track.join("ui/ui_track.json")).unwrap())
                .unwrap();
        assert_eq!(ui["name"], "Monocoque Showroom");
        assert_eq!(ui["pitboxes"], "18");

        let hints = preflight::track_capture_hints(&paths(&root), SHOWROOM_TRACK_ID).unwrap();
        assert_eq!(hints.place_at, PLACE_AT);
        assert_eq!(hints.place_dir, PLACE_DIR);
        assert_eq!(hints.hide_meshes, HIDE_FILTERS);
        assert_eq!(
            preflight::default_capture_track(&paths(&root)),
            Some((SHOWROOM_TRACK_ID.to_string(), None))
        );
        assert!(!root
            .join("content/tracks/.monocoque_showroom.building")
            .exists());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn current_version_is_left_alone_and_older_ones_are_replaced() {
        let root = fake_install();
        assert!(ensure_installed(&root).unwrap());
        assert!(!ensure_installed(&root).unwrap());

        // An install from before versioning: hints, but no [GENERATOR].
        let hints = root
            .join("content/tracks/monocoque_showroom")
            .join(CAPTURE_HINTS_FILE);
        std::fs::write(&hints, "[PLACE]\nAT=0,0,0\n").unwrap();
        assert!(ensure_installed(&root).unwrap());
        assert!(std::fs::read_to_string(&hints).unwrap().contains(PLACE_AT));
        // Replacing the old track only removed links, not the stock models.
        assert!(root.join("content/tracks/drift/drift.kn5").is_file());
        assert!(root
            .join("content/showroom/showroom/showroom.kn5")
            .is_file());

        std::fs::remove_dir_all(&root).ok();
    }

    /// Generates (or confirms) the showroom in the real AC install.
    /// `cargo test -p monocoque-builder --bins real_install -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_install() {
        let paths = CapturePaths::resolve(None, None).expect("no Assetto Corsa install detected");
        let wrote = ensure_installed(&paths.install_dir).unwrap();
        println!("generated: {wrote}");
        assert!(preflight::track_capture_hints(&paths, SHOWROOM_TRACK_ID).is_some());
    }

    #[test]
    fn refuses_to_replace_a_track_it_did_not_make() {
        let root = fake_install();
        let theirs = root.join("content/tracks/monocoque_showroom");
        std::fs::create_dir_all(&theirs).unwrap();
        std::fs::write(theirs.join("theirs.kn5"), b"x").unwrap();

        assert!(ensure_installed(&root).is_err());
        assert!(theirs.join("theirs.kn5").is_file());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn missing_stock_content_is_an_error_not_a_half_track() {
        let root = fake_install();
        std::fs::remove_file(root.join("content/showroom/showroom/showroom.kn5")).unwrap();

        assert!(ensure_installed(&root).is_err());
        assert!(!root.join("content/tracks/monocoque_showroom").exists());
        assert!(!root
            .join("content/tracks/.monocoque_showroom.building")
            .exists());

        std::fs::remove_dir_all(&root).ok();
    }
}
