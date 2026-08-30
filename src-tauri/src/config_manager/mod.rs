pub mod app_config;
pub mod parser;
pub mod types;

use types::{
    AppConfig, AppEntry, AppSettings, GqlAppConfig, GqlAppEntry, GqlAppLink, GqlAppSettings,
    GqlGamepadMapping,
};

use std::fs;
use std::path::PathBuf;

/// Resolves the real `~/.config/monocoque` — the directory monocoque itself
/// reads its configuration from.
///
/// Inside a Flatpak this deliberately bypasses `dirs::config_dir()`. Flatpak
/// redirects `XDG_CONFIG_HOME` to the app's private
/// `~/.var/app/<app-id>/config`, so `dirs::config_dir()` there points at a
/// sandbox-local directory. Writing `monocoque.config` into it would silently
/// produce a private copy that the real monocoque never reads — which would
/// make this app's whole purpose (configuring monocoque) a no-op under Flatpak.
/// `$HOME` is *not* redirected, so `$HOME/.config/monocoque` is the host's real
/// directory; the manifest's `--filesystem=xdg-config/monocoque:create` grant
/// is what makes it visible inside the sandbox.
///
/// Outside a sandbox both paths are the same thing, so behaviour is unchanged.
pub fn monocoque_config_dir() -> PathBuf {
    if crate::host_command::in_flatpak() {
        if let Some(home) = dirs::home_dir() {
            return home.join(".config").join("monocoque");
        }
    }
    dirs::config_dir()
        .expect("no XDG config dir available")
        .join("monocoque")
}

fn config_path() -> PathBuf {
    monocoque_config_dir().join("monocoque.config")
}
pub fn read_monocoque_config() -> Result<String, String> {
    let path = config_path();
    fs::read_to_string(path).map_err(|e| e.to_string())
}

pub fn write_monocoque_config(new_config: String) -> Result<(), String> {
    let path = config_path();
    // Same missing-parent bug as write_app_config -- see the note there.
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, new_config).map_err(|e| e.to_string())
}
pub fn reload_monocoque() -> Result<(), String> {
    crate::host_command::host_command("pkill")
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
