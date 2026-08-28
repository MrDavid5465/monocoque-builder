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
                ambient_saturation_boost: 1.0,
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
            name: "Telemetry Admin".into(),
            path: "telemetryadmin".into(),
            front_end: "TelemetryAdmin".into(),
            default_route: "".into(),
            links: vec![
                AppLink {
                    path: "dashboards".into(),
                    text: "Dashboards".into(),
                },
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
    dirs::config_dir()
        .unwrap()
        .join("monocoque")
        .join("typiql.json")
}

pub fn read_app_config() -> Result<AppConfig, String> {
    let path = config_path();
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
    fs::write(path, text).map_err(|e| e.to_string())
}
