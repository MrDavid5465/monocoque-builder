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
    /// Whether Huenicorn should auto-launch when the sim reports `Active`
    /// (see huenicorn.rs's `run_sim_watcher`). Global, like
    /// `shaker_dsp_enabled` — the ambient-lighting rig isn't per-car/profile.
    pub huenicorn_enabled: bool,
    /// How strongly the 360° viewer's ambient tint blends in, 0.0-1.0. See
    /// Photo360Viewer.tsx's `ambientTint` uniform.
    pub ambient_tint_intensity: f32,
    /// Which Huenicorn channel ID drives the 360° tint (v1 picks one — see
    /// AmbientColorChanged's own doc comment). None = first active channel.
    pub ambient_primary_channel: Option<u8>,
    /// How much to exaggerate the 360° tint color's own saturation (see
    /// Photo360Viewer.tsx's `boostedR`/`boostedG`/`boostedB`) — 1.0 = as
    /// captured (default), higher pushes a pale/washed-out reading toward a
    /// genuinely vivid color (a pale red becomes a vibrant red) rather than
    /// just a brighter version of the same pale color.
    pub ambient_saturation_boost: f32,
    /// Command used to launch `simd` when `service_watchdogs::run_simd_watchdog`
    /// finds it not running. Defaults to the bare `simd` (PATH-resolved) —
    /// override this if your install only exposes it under a different name
    /// (e.g. a distrobox wrapper script).
    pub simd_command: String,
    /// Command used to launch monocoque when `run_monocoque_watchdog` finds
    /// it not running while the sim is `Active`. Defaults to `monocoque play`.
    pub monocoque_command: String,
    /// Command used to launch Huenicorn (see `huenicorn::start_huenicorn`).
    /// Defaults to the bare `huenicorn` (PATH-resolved).
    pub huenicorn_command: String,
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
    pub huenicorn_enabled: MaybeUndefined<bool>,
    pub ambient_tint_intensity: MaybeUndefined<f32>,
    pub ambient_primary_channel: MaybeUndefined<u8>,
    pub ambient_saturation_boost: MaybeUndefined<f32>,
    pub simd_command: MaybeUndefined<String>,
    pub monocoque_command: MaybeUndefined<String>,
    pub huenicorn_command: MaybeUndefined<String>,
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
    #[serde(default)]
    pub huenicorn_enabled: bool,
    #[serde(default)]
    pub ambient_tint_intensity: f32,
    #[serde(default)]
    pub ambient_primary_channel: Option<u8>,
    #[serde(default = "default_ambient_saturation_boost")]
    pub ambient_saturation_boost: f32,
    #[serde(default = "default_simd_command")]
    pub simd_command: String,
    #[serde(default = "default_monocoque_command")]
    pub monocoque_command: String,
    #[serde(default = "default_huenicorn_command")]
    pub huenicorn_command: String,
}

fn default_ambient_saturation_boost() -> f32 {
    1.0
}

fn default_simd_command() -> String {
    "simd".into()
}

fn default_monocoque_command() -> String {
    "monocoque play".into()
}

fn default_huenicorn_command() -> String {
    "huenicorn".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub settings: AppSettings,
}
