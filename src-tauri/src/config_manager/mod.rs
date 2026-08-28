pub mod app_config;
pub mod parser;
pub mod types;

use types::{
    AppConfig, AppEntry, AppSettings, GqlAppConfig, GqlAppEntry, GqlAppLink, GqlAppSettings,
    GqlChannelGamma, GqlGamepadMapping,
};

use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap()
        .join("monocoque")
        .join("monocoque.config")
}
pub fn read_monocoque_config() -> Result<String, String> {
    let path = config_path();
    fs::read_to_string(path).map_err(|e| e.to_string())
}

pub fn write_monocoque_config(new_config: String) -> Result<(), String> {
    let path = config_path();
    fs::write(path, new_config).map_err(|e| e.to_string())
}
pub fn reload_monocoque() -> Result<(), String> {
    Command::new("pkill")
        .arg("-HUP")
        .arg("monocoque")
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn to_gql_config(c: AppConfig) -> GqlAppConfig {
    GqlAppConfig {
        settings: to_gql_settings(c.settings),
        applications: vec![],
    }
}
pub fn to_gql_settings(s: AppSettings) -> GqlAppSettings {
    GqlAppSettings {
        theme: s.theme,
        font_size: s.font_size,
        launch_page: s.launch_page,
        device_map: s.device_map.clone(),
        typiql_data_dir: s.typiql_data_dir.clone(),
        steer_max_deg: s.steer_max_deg,
        setup_complete: s.setup_complete,
        gamepad_mappings: s.gamepad_mappings.map(|ms| {
            ms.into_iter()
                .map(|m| GqlGamepadMapping {
                    id: m.id,
                    name: m.name,
                    mapping_type: m.mapping_type,
                    index: m.index,
                })
                .collect()
        }),
        shaker_dsp_enabled: s.shaker_dsp_enabled,
        shaker_lfe_source_device: s.shaker_lfe_source_device,
        shaker_lfe_lpf_hz: s.shaker_lfe_lpf_hz,
        huenicorn_enabled: s.huenicorn_enabled,
        ambient_tint_intensity: s.ambient_tint_intensity,
        ambient_primary_channel: s.ambient_primary_channel,
        ambient_saturation_boost: s.ambient_saturation_boost,
        ambient_channel_gamma: s.ambient_channel_gamma.map(|gs| {
            gs.into_iter()
                .map(|g| GqlChannelGamma {
                    channel_id: g.channel_id,
                    day: g.day,
                    night: g.night,
                })
                .collect()
        }),
        simd_command: s.simd_command,
        monocoque_command: s.monocoque_command,
        huenicorn_command: s.huenicorn_command,
        simd_debug_command: s.simd_debug_command,
        monocoque_debug_command: s.monocoque_debug_command,
        huenicorn_debug_command: s.huenicorn_debug_command,
        debug_build: crate::service_commands::is_debug_build(),
    }
}
pub fn to_gql_entry(a: AppEntry) -> GqlAppEntry {
    GqlAppEntry {
        name: a.name,
        path: a.path,
        front_end: a.front_end,
        default_route: a.default_route,
        links: a
            .links
            .into_iter()
            .map(|l| GqlAppLink {
                path: l.path,
                text: l.text,
            })
            .collect(),
    }
}
