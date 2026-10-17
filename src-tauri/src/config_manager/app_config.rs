use crate::config_manager::types::{AppConfig, AppEntry, AppLink, AppSettings};
use dirs;
use std::fs;
use std::path::PathBuf;

impl Default for AppConfig {
    fn default() -> Self {
        let default_data_dir =
            dirs::config_dir().map(|p| p.join("dashboard-designer").to_string_lossy().to_string());
        AppConfig {
            settings: AppSettings {
                theme: "dark-purple".into(),
                font_size: 1.0,
                launch_page: "telemetryadmin/default".into(),
                device_map: None,
                typiql_data_dir: default_data_dir,
                steer_max_deg: None,
                setup_complete: false,
                gamepad_mappings: None,
                shaker_dsp_enabled: false,
                shaker_lfe_source_device: None,
                shaker_lfe_lpf_hz: None,
                huenicorn_enabled: false,
                ambient_tint_intensity: 0.3,
                ambient_primary_channel: None,
                ambient_saturation_boost_day: 1.0,
                ambient_saturation_boost_night: 1.0,
                ambient_channel_gamma: None,
                simd_command: "simd".into(),
                monocoque_command: "monocoque play".into(),
                huenicorn_command: "huenicorn".into(),
                // Nothing unknown in a config this build just created.
                extra: Default::default(),
            },
        }
    }
}

/// The app's Profiles page. The app's own page (its root) needs no link: the
/// sidebar item is that page, and on a phone the sidebar shell leads an app's
/// link pills with a pill for its root (labelled with the app's name).
fn profiles() -> Vec<AppLink> {
    vec![AppLink {
        path: "profiles".into(),
        text: "Profiles".into(),
    }]
}

// Sidebar groups. The sidebar lists groups in the order their first app
// appears below, so this list is ordered by group: RIG, LIGHTING, DASHBOARDS.
// An app with `group: None` falls under the shell's default group ("SYSTEM",
// set in App.tsx). Icons are Fluent UI MDL2 names (the shell registers the
// whole MDL2 font, so any name in @fluentui/font-icons-mdl2 works).
const RIG: &str = "RIG";
const LIGHTING: &str = "LIGHTING";
const DASHBOARDS: &str = "DASHBOARDS";

fn entry(
    name: &str,
    path: &str,
    front_end: &str,
    group: &str,
    icon: &str,
    links: Vec<AppLink>,
) -> AppEntry {
    AppEntry {
        name: name.into(),
        path: path.into(),
        front_end: front_end.into(),
        // Empty for every app. The Dashboards list is that app's INDEX route
        // rather than a child of it, so there is nothing to redirect to --
        // `/dashboards` renders the list directly. It used to be
        // "dashboards", which bounced `/dashboards` to `/dashboards/dashboards`
        // and put the app's own name in the URL twice.
        default_route: "".into(),
        links,
        group: Some(group.into()),
        icon: Some(icon.into()),
    }
}

pub fn applications() -> Vec<AppEntry> {
    vec![
        // ── RIG: hardware the driver feels ──────────────────────────────
        entry("Shakers", "shakers", "Shakers", RIG, "Speakers", profiles()),
        entry(
            "SimWind",
            "sim-wind",
            "SimWindDevices",
            RIG,
            "WindDirection",
            profiles(),
        ),
        // ── LIGHTING ────────────────────────────────────────────────────
        entry(
            "LED Controllers",
            "leds",
            "LedsDevices",
            LIGHTING,
            "Lightbulb",
            profiles(),
        ),
        entry(
            "Shift Lights",
            "shift-lights",
            "ShiftLights",
            LIGHTING,
            "SpeedHigh",
            profiles(),
        ),
        // No "Profiles" link — there's no list of records to manage here,
        // Huenicorn's own web UI owns the channel/screen-region list (see
        // AmbientLights/index.tsx's own doc comment).
        entry(
            "Ambient Lights",
            "ambient-lights",
            "AmbientLights",
            LIGHTING,
            "Sunny",
            vec![],
        ),
        // ── DASHBOARDS ──────────────────────────────────────────────────
        entry(
            "Dashboards",
            "dashboards",
            "Dashboards",
            DASHBOARDS,
            "ViewDashboard",
            // The dashboards list itself is the app's root (see profiles()).
            vec![
                AppLink {
                    path: "cars".into(),
                    text: "Cars".into(),
                },
                AppLink {
                    path: "groups".into(),
                    text: "Groups".into(),
                },
                AppLink {
                    path: "templates".into(),
                    text: "Templates".into(),
                },
                AppLink {
                    path: "recordings".into(),
                    text: "Recordings".into(),
                },
                AppLink {
                    path: "tracks".into(),
                    text: "Tracks".into(),
                },
            ],
        ),
    ]
}

fn config_path() -> PathBuf {
    // Shares monocoque's config directory, so it resolves the same real path
    // under Flatpak rather than the sandbox-private one -- see
    // super::monocoque_config_dir(). Keeping both files together also means a
    // Flatpak install and a native install see the same settings.
    super::monocoque_config_dir().join("monocoque-builder.json")
}

/// The settings file was named for the app back when the app was called
/// typiql. Nothing else moved in the rename -- the data directory, the DuckDB
/// recordings and the photo cache all live under ~/.config/dashboard-designer
/// and are untouched -- but leaving this one file behind would silently reset
/// the theme, the launch page and every monocoque/simd/huenicorn command line
/// back to defaults on first launch after upgrading.
///
/// Moves rather than copies, so there is exactly one file of record. An older
/// build run afterwards would seed itself fresh defaults rather than quietly
/// diverge from a stale copy.
fn migrate_legacy_config(path: &PathBuf) {
    if path.exists() {
        return;
    }
    let legacy = super::monocoque_config_dir().join("typiql.json");
    if !legacy.is_file() {
        return;
    }
    if let Err(e) = fs::rename(&legacy, path) {
        eprintln!(
            "could not move {} to {}: {e} -- starting from defaults",
            legacy.display(),
            path.display()
        );
    }
}

pub fn read_app_config() -> Result<AppConfig, String> {
    let path = config_path();
    migrate_legacy_config(&path);
    if !path.exists() {
        // First run — write defaults and return them
        let default = AppConfig::default();
        write_app_config(&default)?;
        return Ok(default);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

pub fn write_app_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path();
    let text = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    // Create the parent directory first. read_app_config() calls this on first
    // run to seed defaults, and fs::write fails with ENOENT when the directory
    // doesn't exist yet. This never surfaced on a developer machine because
    // ~/.config/monocoque already exists anywhere monocoque itself has run --
    // but in a genuinely clean environment (a fresh install without monocoque,
    // or a Flatpak's private config dir) the first run failed, the `my` query
    // returned "No such file or directory (os error 2)", and the UI sat on its
    // splash screen forever.
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_app_has_a_group_and_an_icon() {
        for app in applications() {
            assert!(
                app.group.as_deref().is_some_and(|g| !g.is_empty()),
                "{} has no group",
                app.name
            );
            assert!(
                app.icon.as_deref().is_some_and(|i| !i.is_empty()),
                "{} has no icon",
                app.name
            );
        }
    }

    #[test]
    fn groups_are_contiguous_in_rig_lighting_dashboards_order() {
        let mut order: Vec<String> = Vec::new();
        for app in applications() {
            let g = app.group.unwrap();
            if order.last() != Some(&g) {
                assert!(
                    !order.contains(&g),
                    "group {g} is split; the sidebar would list it at its first app only"
                );
                order.push(g);
            }
        }
        assert_eq!(order, vec![RIG, LIGHTING, DASHBOARDS]);
    }

    #[test]
    fn gql_entry_carries_group_and_icon() {
        let gql: Vec<_> = applications()
            .into_iter()
            .map(super::super::to_gql_entry)
            .collect();
        let dash = gql.iter().find(|a| a.path == "dashboards").unwrap();
        assert_eq!(dash.group.as_deref(), Some(DASHBOARDS));
        assert_eq!(dash.icon.as_deref(), Some("ViewDashboard"));
        assert_eq!(dash.links.len(), 5);
        assert!(
            dash.links.iter().all(|l| !l.path.is_empty()),
            "the app's root needs no link: the shell gives it a pill of its own"
        );
    }
}
