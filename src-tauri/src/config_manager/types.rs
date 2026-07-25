use async_graphql::{InputObject, MaybeUndefined, SimpleObject};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(SimpleObject, Clone)]
pub struct GqlAppLink {
    pub path: String,
    pub text: String,
}

#[derive(SimpleObject, Clone)]
pub struct GqlAppEntry {
    pub name: String,
    pub path: String,
    pub front_end: String,
    pub default_route: String,
    pub links: Vec<GqlAppLink>,
}

/// A named virtual-gamepad mapping (e.g. "Headlights" → button 0).
#[derive(Debug, Clone, Serialize, Deserialize, SimpleObject)]
pub struct GqlGamepadMapping {
    pub id: String,
    pub name: String,
    /// "button" or "axis"
    pub mapping_type: String,
    /// Button index 0–31, or axis index 0–5 (X/Y/Z/RX/RY/RZ)
    pub index: i32,
}

#[derive(InputObject, Clone)]
pub struct GamepadMappingInput {
    pub id: String,
    pub name: String,
    pub mapping_type: String,
    pub index: i32,
}

/// Storage form (Serde only).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GamepadMapping {
    pub id: String,
    pub name: String,
    pub mapping_type: String,
    pub index: i32,
}

#[derive(SimpleObject, Clone)]
#[graphql(name = "AppSettings")]
pub struct GqlAppSettings {
    pub theme: String,
    pub font_size: f32,
    pub launch_page: String,
    pub device_map: Option<HashMap<String, String>>,
    pub typiql_data_dir: Option<String>,
    /// Total physical steering wheel rotation in degrees (full lock-to-lock). A 900° wheel
    /// should have this set to 900. The sim returns ±1.0 — this value is halved and applied
    /// as the per-side degrees.
    pub steer_max_deg: Option<f64>,
    pub setup_complete: bool,
    pub gamepad_mappings: Option<Vec<GqlGamepadMapping>>,
    /// Whether shaker rows are currently pointed at the DSP virtual sink
    /// (see graphql/shaker_dsp.rs's enable/disableShakerDsp). Global, not
    /// per-profile — the physical shaker rig's wiring doesn't change per car/game.
    pub shaker_dsp_enabled: bool,
    /// The real PipeWire sink whose monitor the LFE effect taps (downmixed
    /// to mono, LPF'd, fanned out to every enabled LfeChannel corner) — see
    /// LfeChannel's doc comment. Set via the LFE source-device picker in
    /// ShakerMatrix; distinct from each ShakerChannel's own `devid` (where the
    /// shaker signal *plays back to*), which is where LFE listens *from*.
    pub shaker_lfe_source_device: Option<String>,
    /// Cutoff frequency for the LFE effect's one shared low-pass filter.
    /// None = bypassed. Global (not per-corner) since there's only one
    /// downmixed signal before it fans out to each corner's own fader.
    pub shaker_lfe_lpf_hz: Option<f32>,
}

#[derive(SimpleObject, Clone)]
pub struct GqlAppConfig {
    pub settings: GqlAppSettings,
    pub applications: Vec<GqlAppEntry>,
}

/// Every field is `MaybeUndefined<T>` (not `Option<T>`, not a plain
/// required value) — omitted means "leave untouched", explicit `null` means
/// "clear", a value means "set". This applies uniformly even to fields
/// backed by a non-`Option` `AppSettings` field (`theme`/`font_size`/
/// `launch_page`/`setup_complete`/`shaker_dsp_enabled`) — `update_settings`
/// (graphql/app_config.rs) treats an explicit `null` for those the same as
/// omitted (a pragmatic no-op; there's no way to statically stop a client
/// sending null for a field that doesn't semantically support clearing, and
/// this app doesn't do field-level schema validation elsewhere either).
/// Async-graphql's `InputObject` derive parses `MaybeUndefined` fields
/// directly from the GraphQL wire argument (no serde involved for this
/// hand-written struct, unlike the macro-generated `{Type}Input` structs
/// which round-trip through `serde_json` as part of a generic patch-merge —
/// `update_settings` merges each field explicitly instead).
#[derive(InputObject)]
pub struct AppSettingsInput {
    pub theme: MaybeUndefined<String>,
    pub font_size: MaybeUndefined<f32>,
    pub launch_page: MaybeUndefined<String>,
    pub device_map: MaybeUndefined<HashMap<String, String>>,
    pub typiql_data_dir: MaybeUndefined<String>,
    pub steer_max_deg: MaybeUndefined<f64>,
    pub setup_complete: MaybeUndefined<bool>,
    pub gamepad_mappings: MaybeUndefined<Vec<GamepadMappingInput>>,
    pub shaker_dsp_enabled: MaybeUndefined<bool>,
    pub shaker_lfe_source_device: MaybeUndefined<String>,
    pub shaker_lfe_lpf_hz: MaybeUndefined<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppLink {
    pub path: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppEntry {
    pub name: String,
    pub path: String,
    pub front_end: String,
    pub default_route: String,
    pub links: Vec<AppLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub theme: String,
    pub font_size: f32,
    pub launch_page: String,
    pub device_map: Option<HashMap<String, String>>,
    #[serde(default)]
    pub typiql_data_dir: Option<String>,
    #[serde(default)]
    pub steer_max_deg: Option<f64>,
    #[serde(default)]
    pub setup_complete: bool,
    #[serde(default)]
    pub gamepad_mappings: Option<Vec<GamepadMapping>>,
    #[serde(default)]
    pub shaker_dsp_enabled: bool,
    #[serde(default)]
    pub shaker_lfe_source_device: Option<String>,
    #[serde(default)]
    pub shaker_lfe_lpf_hz: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub settings: AppSettings,
}
