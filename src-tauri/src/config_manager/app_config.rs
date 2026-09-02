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
                simd_debug_command: None,
                monocoque_debug_command: None,
                huenicorn_debug_command: None,
            },
        }
    }
}

pub fn applications() -> Vec<AppEntry> {
    vec![
        AppEntry {
            name: "Dashboards".into(),
            path: "dashboards".into(),
            front_end: "Dashboards".into(),
            // The app is the dashboards list, so it opens straight onto it and
            // no longer carries a sub-nav link that repeats its own name.
            default_route: "dashboards".into(),
            links: vec![
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
        },
        AppEntry {
            name: "Shakers".into(),
            path: "shakers".into(),
            front_end: "Shakers".into(),
            default_route: "".into(),
            links: vec![AppLink {
                path: "profiles".into(),
                text: "Profiles".into(),
            }],
        },
        AppEntry {
            name: "LED Controllers".into(),
            path: "leds".into(),
            front_end: "LedsDevices".into(),
            default_route: "".into(),
            links: vec![AppLink {
                path: "profiles".into(),
                text: "Profiles".into(),
            }],
        },
        AppEntry {
            name: "Shift Lights".into(),
            path: "shift-lights".into(),
            front_end: "ShiftLights".into(),
            default_route: "".into(),
            links: vec![AppLink {
                path: "profiles".into(),
                text: "Profiles".into(),
            }],
        },
        AppEntry {
            name: "SimWind".into(),
            path: "sim-wind".into(),
            front_end: "SimWindDevices".into(),
            default_route: "".into(),
            links: vec![AppLink {
                path: "profiles".into(),
                text: "Profiles".into(),
            }],
        },
        // No "Profiles" link — there's no list of records to manage here,
        // Huenicorn's own web UI owns the channel/screen-region list (see
        // AmbientLights/index.tsx's own doc comment).
        AppEntry {
            name: "Ambient Lights".into(),
            path: "ambient-lights".into(),
            front_end: "AmbientLights".into(),
            default_route: "".into(),
            links: vec![],
        },
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
