// `#[typiql_type]` generates one constructor-shaped function per struct
// (its Input type, add/update resolvers, ...) with one parameter per field —
// inherent to CRUD codegen, not something to fix by shrinking arg counts
// (some structs here, e.g. RecordingFrame, have dozens of real fields).
// `needless_question_mark` similarly fires against the macro's own generated
// `Ok(...?)` pattern, not any hand-written code in this file.
#![allow(clippy::too_many_arguments, clippy::needless_question_mark)]

use crate::graphql::app_config::{AppConfigMutation, AppConfigQuery};
use crate::graphql::builtin_templates::BuiltinTemplatesQuery;
use crate::graphql::clients::ClientsMutation;
use crate::graphql::dashboard_files::{DashboardFileSyncQuery, DashboardFileUploadMutation};
use crate::graphql::{
    CarFileMutation, CarPhotoSyncQuery, DashTemplateThumbnailMutation, DashboardMutation,
    GamepadMutation, NightClockMutation, RecordingControlMutation, ShakerDspMutation,
    ShakerDspQuery, TrackGeocodeQuery,
};
use crate::graphql::{QueryRoot, SubscriptionRoot};
use crate::telemetry::types::{CourseFlag, SimStatus};
use typiql::{typiql_schema, typiql_type};

/// A dashboard's location — enough to list it and find its folder. The only
/// part of a dashboard stored in the shared config file; its actual
/// configuration lives entirely in its own folder (see `Dashboard` below),
/// which is what makes dashboards portable (copy the folder, get the whole
/// dashboard) and makes "remove from list" incapable of destroying the one
/// copy of the config — `removeDashboardEntry` only ever drops this row.
#[typiql_type]
pub struct DashboardEntry {
    #[typiql(key)]
    pub id: String,
    pub name: String,
    pub path: String,
    /// Not stored in the main config file at all — `Dashboard` has no
    /// default location of its own (`#[typiql_type(no_location)]`), read
    /// fresh on every access from `<path>/.dashboard.json`'s `dashboard`
    /// table. Writes go through the hand-written `addDashboard`/
    /// `updateDashboard` mutations in `graphql/dashboard_entry.rs`.
    #[typiql(relation(file = "{path}/.dashboard.json", table = "dashboard"))]
    pub dashboard: Option<Dashboard>,
}

/// A dashboard's actual configuration — canvas, elements, kiosk settings,
/// thumbnails. A "dumb" type: no default storage location, reachable only
/// via `DashboardEntry.dashboard` above (reads) or the hand-written
/// `addDashboard`/`updateDashboard` mutations (writes) — see
/// `graphql/dashboard_entry.rs`. Field list unchanged from when this was a
/// `#[typiql_type]`-managed row directly in the main config file.
#[typiql_type(no_location)]
pub struct Dashboard {
    pub base_dash_type: String,
    pub canvas_width: i32,
    pub canvas_height: i32,
    pub background: Option<String>,
    pub day_night: bool,
    pub neck_fx: bool,
    /// JSON-serialized Vec<SpriteElement> / ComponentNode tree.
    pub elements: String,
    pub kiosk_x: i32,
    pub kiosk_y: i32,
    pub kiosk_opacity: f32,
    /// Filenames (within the shared thumbnails cache dir, served from
    /// `/thumbnails/*`) of captured day/night preview screenshots.
    pub thumbnail_day: Option<String>,
    pub thumbnail_night: Option<String>,
    pub group_ids: Option<String>,
}

/// One physical shaker channel — independent of both Monocoque's own effect
/// rows (`MonocoqueSoundDevice`, joined via matching `pan`) and of the real
/// audio device's own channel count: a user's interface may expose more
/// channels than they have shakers actually wired up, and separate channels
/// are often driven by entirely separate physical USB devices (e.g. several
/// cheap "nobsound"-style USB stereo amps, each its own PipeWire sink), not
/// different channels of one shared device. `devid`/`channels` are picked
/// independently per channel for exactly that reason — there's no single
/// "the" output device to default a new channel to.
#[typiql_type]
pub struct ShakerChannel {
    #[typiql(key)]
    pub id: String,
    /// Null = live/active set. A UUID = belongs to a named SoundDeviceProfile.
    pub profile_id: Option<String>,
    /// The real output channel index on this channel's own `devid` — set
    /// directly by the user (bounded 0..channels), not an internal identity.
    /// Unique only within this channel's own device, not globally: two
    /// channels on *different* devices can legitimately share a pan value
    /// (e.g. each device's own channel 0), matching real hardware numbering.
    /// `MonocoqueSoundDevice`/`LfeChannel` rows reference this channel via
    /// their own `channel_id` field, not by pan — pan is looked up fresh
    /// through that join whenever the real output index is needed, never
    /// duplicated onto those rows.
    pub pan: u8,
    /// Always this channel's real hardware device — never overwritten by DSP
    /// mode. Unlike the prior per-row design (which persisted a DSP-sink
    /// override into storage, backed up via pre_dsp_devid and restored on
    /// disable), the DSP-mode devid substitution is computed fresh at export
    /// time only (buildConfigText), the same "never touches storage" pattern
    /// already used for pan/channels/dsp_slot substitution — and it has to
    /// be, now that devid lives per-channel while the DSP override is
    /// inherently per-*effect* (each effect gets its own isolated capture
    /// sink; see pipewire_dsp::effect_sink_name). No backup/restore needed
    /// at all: this field simply never changes due to DSP state.
    pub devid: String,
    pub channels: u8,
    /// One of FrontLeft/FrontRight/RearLeft/RearRight/Front/Rear/Left/Right/
    /// All (see shakerUtils.ts's cornersToConfig/configToCorners) — this
    /// channel's physical position, applied uniformly to every tyre-capable
    /// effect on it (suspension/tyreslip/tyrelock/abs) when exporting.
    /// None until the user sets one.
    pub position: Option<String>,
}

#[typiql_type]
pub struct MonocoqueSoundDevice {
    #[typiql(key)]
    pub id: String,
    pub device: String,
    pub effect: String,
    /// This row's channel — a direct reference to ShakerChannel.id. The
    /// row's real physical pan (for the exported `pan =` line), devid, and
    /// channels are all looked up fresh through this join, never duplicated
    /// onto this row — so they can't go stale if the channel's own pan is
    /// edited later. Replaced a flat `pan` field that joined directly against
    /// ShakerChannel.pan; that stopped being safe once pan became
    /// user-editable and no longer globally unique (see ShakerChannel.pan's
    /// doc comment).
    pub channel_id: String,
    /// Always this effect's real/intended volume — never overwritten by DSP
    /// mode (same "computed at export time only, never touches storage"
    /// reasoning as ShakerChannel.devid's doc comment: while DSP is active,
    /// the exported config's volume line is 100 regardless of this stored
    /// value, computed fresh in buildConfigText, since real attenuation
    /// happens via the DSP fader instead).
    pub volume: u8,
    pub modulation: String,
    pub frequency: Option<f32>,
    pub frequency_max: Option<f32>,
    pub amplitude: Option<f32>,
    pub amplitude_max: Option<f32>,
    /// Null = live/active set. A UUID = belongs to a named SoundDeviceProfile.
    pub profile_id: Option<String>,
    /// This row's permanent, never-overwritten identity as one of the DSP
    /// filter-chain's isolated capture channels — distinct from `pan`, which
    /// stays the row's real physical output-channel target at all times
    /// (used by CarLayout/ShakerMatrix's corner grouping and tyre
    /// assignment, completely unaffected by DSP state). Assigned once at
    /// row-creation time by the frontend (max existing dspSlot + 1), never
    /// touched again — enableShakerDsp substitutes this for `pan` only in
    /// the *generated* Monocoque config text (buildConfigText), never in
    /// storage, so every effect gets its own isolated Monocoque stream while
    /// the app's own notion of "which corner" never changes underneath it.
    pub dsp_slot: Option<u8>,
}

/// A named shaker configuration profile.
/// Records belonging to this profile are MonocoqueSoundDevice entries with a matching profile_id.
#[typiql_type]
pub struct SoundDeviceProfile {
    #[typiql(key)]
    pub id: String,
    pub name: String,
    pub car: Option<String>,
    pub game: Option<String>,
    /// The first profile ever created is automatically the default (enforced
    /// client-side at creation time); new profiles seed their initial
    /// ShakerDspChannel values from whichever profile currently holds this
    /// flag. At most one profile should have this true at a time — enforced
    /// by setDefaultSoundDeviceProfile, not by storage itself.
    pub is_default: bool,
    /// Links this profile to a real Car record (Car.id), wired from the
    /// Car's own configuration page (CarDetail.tsx) — the same entity
    /// dashboards use for 360°/pan, not a free-text name like `car` above.
    /// Softly enforced client-side that at most one profile points at a
    /// given car at a time; None until the user links one.
    pub car_id: Option<String>,
}

/// One row per (profile, DSP slot) — the PipeWire-side DSP settings for
/// that slot, decoupled from Monocoque's own per-effect fields on
/// MonocoqueSoundDevice. `slot` matches MonocoqueSoundDevice.dsp_slot (a
/// row's permanent isolated-capture-channel identity), NOT its physical
/// output pan — deliberately a different field name from the
/// MonocoqueSoundDevice.pan it's adjacent to in concept, since the two now
/// mean different things (see MonocoqueSoundDevice.dsp_slot's doc comment).
/// Consumed only by enableShakerDsp when building the filter-chain graph
/// (graphql/shaker_dsp.rs) — Monocoque itself never reads these. Same
/// live(null)/profile(id) scoping convention as MonocoqueSoundDevice, so it
/// clones/loads through the same profile save/load flow.
#[typiql_type]
pub struct ShakerDspChannel {
    #[typiql(key)]
    pub id: String,
    pub profile_id: Option<String>,
    pub slot: u8,
    /// None = LPF bypassed for this channel.
    pub lpf_hz: Option<f32>,
    /// 0-100, PipeWire-side gain applied after the LPF. Default 100 (unity).
    pub fader: u8,
    /// When true, this channel is silenced in the live filter-chain (Mult
    /// forced to 0) without touching the stored `fader` value — mirrors the
    /// LPF bypass pattern (see `lpf_hz`'s None) but as an explicit flag
    /// rather than an Option, since `fader` has no natural "off" sentinel
    /// (0% is itself a valid tuned value). Lets a user isolate one effect at
    /// a time for real-hardware verification without losing their mix.
    pub muted: bool,
}

/// One physical corner's slice of the LFE "effect" — a whole extra signal
/// path, not a Monocoque effect at all: it taps AppSettings.shaker_lfe_
/// source_device's monitor, downmixes to mono, runs it through one shared
/// bq_lowpass (AppSettings.shaker_lfe_lpf_hz — global, since there's only
/// one downmixed signal, unlike the per-corner lpf_hz on ShakerDspChannel),
/// then fans the same filtered mono signal out to every enabled corner at
/// its own fader/mute. Never touches MonocoqueSoundDevice or the exported
/// Monocoque config — purely a PipeWire-side addition, live-applied the
/// same way as ShakerDspChannel (see graphql/shaker_dsp.rs). DSP mode must
/// be enabled for this to have any live effect; rows can still be edited
/// while it's off, same as ShakerDspChannel.
#[typiql_type]
pub struct LfeChannel {
    #[typiql(key)]
    pub id: String,
    pub profile_id: Option<String>,
    /// This corner's channel — a direct reference to ShakerChannel.id, same
    /// join shape as MonocoqueSoundDevice.channel_id (see its doc comment).
    /// LfeChannel rows are never written to the exported config, so this is
    /// purely an internal join key, not a Monocoque-facing value.
    pub channel_id: String,
    /// 0-100, applied after the shared downmix+LPF stage.
    pub fader: u8,
    pub muted: bool,
}

/// Arduino serial LED controller (Serial / Simleds).
#[typiql_type]
pub struct MonocoqueLedsDevice {
    #[typiql(key)]
    pub id: String,
    pub devpath: String,
    pub baud: u32,
    pub num_leds: u8,
    pub start_led: u8,
    pub end_led: u8,
    pub config: String,
    pub profile_id: Option<String>,
}

/// USB tachometer / shift-light indicator (e.g. Revburner), or a wheelbase's
/// built-in serial shift-light strip (e.g. Moza R5/R12/R3/R8, KS Pro Wheel —
/// monocoque dispatches these as `device = "Serial"; type = "Wheel"`,
/// identified by `subtype` + `devpath`/`baud`, not USB VID/PID). `deviceKind`
/// picks which of the two shapes this row represents: "usb" uses
/// devid/subtype/granularity/config (subtype e.g. "Revburner"); "serial"
/// uses subtype/devpath/baud (subtype e.g. "MozaR5"/"MozaNew"/
/// "MozaKSProWheel") and leaves devid/granularity/config unused. Both kinds
/// share one type rather than splitting into two, since a user picks between
/// them per-row via a device-kind selector, not per-schema.
#[typiql_type]
pub struct MonocoqueShiftLight {
    #[typiql(key)]
    pub id: String,
    pub device_kind: String,
    pub devid: String,
    pub subtype: String,
    pub granularity: u8,
    pub config: String,
    pub devpath: Option<String>,
    pub baud: Option<u32>,
    pub profile_id: Option<String>,
}

/// Arduino serial SimWind fan controller (Serial / SimWind).
#[typiql_type]
pub struct MonocoqueSimWindDevice {
    #[typiql(key)]
    pub id: String,
    pub devpath: String,
    pub baud: u32,
    pub fan_power: f32,
    pub config: String,
    pub profile_id: Option<String>,
}

/// A reusable dashboard component template saved globally across dashboards.
/// `component` is a JSON-serialized ComponentNode tree.
#[typiql_type]
pub struct DashTemplate {
    #[typiql(key)]
    pub id: String,
    pub name: String,
    /// Auto-detected gauge kind: "needle", "bar", "digital", "combination", or "none"
    pub gauge_type: String,
    /// JSON-serialized ComponentNode
    pub component: String,
    /// Filename (within the thumbnails cache dir, served from `/thumbnails/*`)
    /// of a captured preview of this template's component tree — set via
    /// upload_dash_template_thumbnail, same convention as Car/Dashboard
    /// thumbnails. Not a live-rendered preview — storing that per template
    /// card was explicitly rejected as non-performant.
    pub thumbnail: Option<String>,
    /// JSON-serialized array of `{filename, data}` (data = base64 data URL),
    /// captured from the source dashboard's own sprite files at save time so
    /// the template renders correctly when applied to a dashboard that doesn't
    /// already have those files. `None` for templates saved before this field
    /// existed or with no sprite refs — applying them falls back to the
    /// global /dash-sprites/ store, same as before.
    pub sprites: Option<String>,
}

/// Tracks connected app instances for per-device dashboard configuration.
/// `id` is a UUID generated and persisted in the client's localStorage.
/// `last_seen` is a Unix timestamp string updated on each heartbeat.
#[typiql_type]
pub struct ConnectedClient {
    #[typiql(key)]
    pub id: String,
    pub name: Option<String>,
    pub last_seen: String,
}

/// A named group of dashboards with car-specific routing.
/// `car_dash_map` is JSON: `Record<carName, dashboardName>`.
#[typiql_type]
pub struct DashGroup {
    #[typiql(key)]
    pub id: String,
    pub name: String,
    pub default_dash: Option<String>,
    pub car_dash_map: String,
}

/// Tracks car names seen in telemetry. `id` is the car name itself; `name` mirrors it.
#[typiql_type]
pub struct KnownCar {
    #[typiql(key)]
    pub id: String,
    pub name: Option<String>,
}

/// A stored file. Keyed by its real, stable filesystem `path` — `id` is a
/// content hash, recomputed by sync_car_photos whenever the real file's
/// bytes change, so `url` (built from the current id) naturally cache-busts
/// on edit without any relationship pointing at this record ever needing to
/// be touched (relations key off `path`, never `id`). Deliberately general —
/// not car-specific — so it can later back other stored-file needs (dashboard
/// sprites, thumbnails, other 360s), which already have stable real paths.
/// `mtime` (file modification time, unix seconds) lets sync_dashboard_files
/// skip re-reading+re-hashing a file's full content when its mtime hasn't
/// changed since the last sync — full-content hashing every file on every
/// dashboard open was measured taking 5+ seconds for a folder with a few
/// multi-MB 360 photos. `Option` because existing records predate this field.
#[typiql_type]
pub struct File {
    #[typiql(key)]
    pub path: String,
    pub id: String,
    pub filename: String,
    pub url: String,
    pub mtime: Option<i64>,
}

/// A physical car, optionally linked to one or more raw car identifiers as
/// reported by telemetry (`car_ids`). Can exist before any photo is uploaded
/// (created via plain `addCar` with just name + car_ids) — day_photo stays
/// optional until a day photo is uploaded via `uploadCarPhoto`.
#[typiql_type]
pub struct Car {
    #[typiql(key)]
    pub id: String,
    pub name: String,
    /// JSON-serialized Vec<String> of raw car_ids (KnownCar.id values) this
    /// Car represents — same convention as Dashboard.elements/group_ids,
    /// since the macro doesn't support native Vec<String> fields. Softly
    /// enforced client-side that a given raw car_id belongs to at most one Car.
    pub car_ids: String,
    /// The day 360° photo, resolved via the File relation below — matched
    /// against day_photo_path, which is set once at first upload and never
    /// updated again (only the File row it points at changes over time).
    #[typiql(relation(local = "day_photo_path", op = "eq", foreign = "path"))]
    pub day_photo: Option<File>,
    pub day_photo_path: Option<String>,
    /// Optional night variant of the same shot (same camera position,
    /// different lighting) — same relation shape as day_photo. Falls back to
    /// day_photo when unset.
    #[typiql(relation(local = "night_photo_path", op = "eq", foreign = "path"))]
    pub night_photo: Option<File>,
    pub night_photo_path: Option<String>,
    /// Filename (within the thumbnails cache dir, served from `/thumbnails/*`)
    /// of a small captured screenshot of the car's freelook 360° viewer, used
    /// for the car card grid instead of rendering a live WebGL viewer per
    /// card. Captured automatically the first time the freelook viewer loads
    /// this photo, and re-capturable on demand. Not the raw image data —
    /// storing that inline would bloat the JSON store. Out of scope for the
    /// File-relation migration — stays a plain filename for now.
    pub thumbnail: Option<String>,
}

/// Global day/night state, shared live across every dashboard and kiosk display
/// via the auto-generated `nightModeChanged` subscription. Effectively a
/// singleton — the app operates on whichever single record exists, creating
/// one on first use.
///
/// Two independent sources can drive `is_night`: a manual toggle (the
/// existing kiosk Day/Night button) and a simulated in-game clock (since
/// telemetry never reports the sim's own date/time). Both are stored on this
/// same record rather than as separate types. `sim_enabled` is an explicit
/// mode switch (not a recency-based heuristic) — a UI control alongside the
/// day/night toggle lets the user pick manual vs simulated directly; whichever
/// is selected is authoritative until switched again.
#[typiql_type]
pub struct NightMode {
    #[typiql(key)]
    pub id: String,
    pub is_night: bool,
    /// Option, not bool: every other sim_* field is also optional, and
    /// keeping this one consistent means addNightMode/updateNightMode calls
    /// that only touch the manual toggle (the common case) don't have to
    /// also supply a value for every simulation field. Absent/null == false.
    pub sim_enabled: Option<bool>,
    /// ms since epoch: the in-game simulated time being matched, as of
    /// `sim_base_real_time`. Server-internal bookkeeping only — clients never
    /// read or write this field directly; they get the live simulated clock
    /// via the `nightClock` subscription (see `graphql/mod.rs`) and adjust it
    /// via the `adjustNightClockTime`/`setNightClockCycleHours` mutations
    /// (`graphql/night_clock.rs`), which rebase this anchor server-side.
    /// (Was an ISO-8601 string in an earlier client-only-extrapolation
    /// design; plain ms avoids needing a date-parsing crate now that only
    /// the backend ever reads/writes it.)
    pub sim_base_sim_time_ms: Option<f64>,
    /// ms since epoch, the SERVER's own clock: real time when
    /// `sim_base_sim_time_ms` was captured. Always `SystemTime::now()` on the
    /// backend, never a client-supplied time — this is what keeps the
    /// simulated clock in agreement across every kiosk device (previously
    /// each device extrapolated independently using its own local clock,
    /// which drifted apart from other devices over hours).
    pub sim_base_real_time: Option<f64>,
    /// Simulated clock speed as a percentage of real-time (100 = real time,
    /// 1200 = a 2-hour real cycle covers a 24-hour in-game day).
    pub sim_speed_percent: Option<f64>,
    /// "HH:MM" time-of-day (24h) within the simulated day.
    pub sim_sunrise: Option<String>,
    pub sim_sunset: Option<String>,
    /// How many simulated minutes the dawn/dusk crossfade takes, centered on
    /// sunrise/sunset (e.g. 40 = the transition runs from 20 simulated
    /// minutes before to 20 after each boundary). Unlike the manual toggle's
    /// fixed ~2s CSS crossfade, this drives a continuously-computed blend
    /// value so a compressed in-game day still reads as a gradual dawn/dusk.
    pub sim_transition_minutes: Option<f64>,
    /// "YYYY-MM-DD", set whenever `setSunriseSunsetFromDate` runs (manually
    /// or automatically) — remembered so that when the live telemetry track
    /// later changes, the background tick (see `night_clock.rs`'s
    /// `maybe_auto_recompute_sun_times`) can recompute sunrise/sunset for
    /// the NEW track using the SAME date the user last picked, without
    /// asking again. Server-internal bookkeeping, same spirit as
    /// `sim_base_sim_time_ms`.
    pub sim_sunrise_sunset_date: Option<String>,
    /// Raw telemetry track id that `sim_sunrise`/`sim_sunset` were last
    /// computed for — lets the background tick detect "the live track
    /// changed" (compare against the CURRENT live track) without
    /// recomputing on every single tick when nothing's changed.
    pub sim_last_computed_track: Option<String>,
}

/// Global "preview car" — when set and the sim isn't actively running, kiosk
/// displays act as if this raw car_id were the live-telemetry car for
/// 360°-photo/pan purposes. `car_id` here is always a RAW car identifier (as
/// reported by telemetry / KnownCar.id) — NOT a Car record's own `id` — so it
/// blends seamlessly with live telemetry's own raw car_id in
/// DashboardDesigner. Singleton, like NightMode.
#[typiql_type]
pub struct PreviewCar {
    #[typiql(key)]
    pub id: String,
    pub car_id: String,
}

/// A real-world circuit location, used to compute real sunrise/sunset times
/// for the day/night simulation (see night_clock.rs's
/// `set_sunrise_sunset_from_date`) from whichever track telemetry currently
/// reports. `raw_track_ids` is a JSON array of strings rather than a single
/// id, matched by exact membership — the same physical circuit is commonly
/// reported under several different raw ids (different sim/game, different
/// DLC/mod release of the same track, different layout variants), so one
/// location can list every id that should resolve to it rather than forcing
/// a separate row (and separately-entered lat/lon) per variant.
#[typiql_type]
pub struct TrackLocation {
    #[typiql(key)]
    pub id: String,
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
    pub raw_track_ids: String,
}

/// Per-car pan override for a specific 360° dashboard. `car_id` here is a Car
/// record's own `id` (NOT a raw telemetry car_id) — pan alignment is a
/// property of the physical car itself, kept consistent across every
/// game/raw car_id that car might appear under. Field name kept as `car_id`
/// unchanged even though what it points to has changed, to minimize churn.
/// At most one record per (car_id, dash_name); falls back to the dashboard's
/// own base pan when no override exists.
#[typiql_type]
pub struct CarDashPan {
    #[typiql(key)]
    pub id: String,
    pub car_id: String,
    pub dash_name: String,
    pub yaw: f64,
    pub pitch: f64,
    pub fov: f64,
    pub roll: f64,
}

/// Maps a device (by human-readable name) or `device_name = "default"` to a
/// dashboard or group. Stored in the JSON adapter; the subscription lets kiosk
/// screens reroute automatically when the operator changes the mapping.
#[typiql_type]
pub struct DeviceDefault {
    #[typiql(key)]
    pub id: String,
    pub device_name: String,
    pub dash: Option<String>,
    pub group: Option<String>,
}

/// Named profile for LED controller configurations.
#[typiql_type]
pub struct LedsDeviceProfile {
    #[typiql(key)]
    pub id: String,
    pub name: String,
    pub car: Option<String>,
    pub game: Option<String>,
    /// Links this profile to a real Car record (Car.id), wired from the
    /// Car's own configuration page — same convention as
    /// SoundDeviceProfile.carId's doc comment. None until linked.
    pub car_id: Option<String>,
}

/// Named profile for shift light configurations.
#[typiql_type]
pub struct ShiftLightProfile {
    #[typiql(key)]
    pub id: String,
    pub name: String,
    pub car: Option<String>,
    pub game: Option<String>,
    /// Links this profile to a real Car record (Car.id), wired from the
    /// Car's own configuration page — same convention as
    /// SoundDeviceProfile.carId's doc comment. None until linked.
    pub car_id: Option<String>,
}

/// Named profile for SimWind fan controller configurations.
#[typiql_type]
pub struct SimWindDeviceProfile {
    #[typiql(key)]
    pub id: String,
    pub name: String,
    pub car: Option<String>,
    pub game: Option<String>,
    /// Links this profile to a real Car record (Car.id), wired from the
    /// Car's own configuration page — same convention as
    /// SoundDeviceProfile.carId's doc comment. None until linked.
    pub car_id: Option<String>,
}

/// A recorded telemetry session's metadata — small and infrequently
/// written, so it stays on the "default" (JSON) adapter. The frame data
/// itself is a real DuckDB-backed type (`RecordingFrame` below), related
/// here as a has-many field matched on `recording_id` — a recording can be
/// many thousands of frames, which would force a whole-file rewrite on
/// every write (and an all-or-nothing read) under JsonAdapter; DuckDB's
/// columnar storage and native range queries are exactly the shape this
/// data needs, and typiql's ordinary relation-field machinery makes the
/// cross-adapter join (JSON parent, DuckDB children) transparent — see
/// [[project_typiql_rs]] / the DuckDB adapter plan for the full rationale.
#[typiql_type]
pub struct Recording {
    #[typiql(key)]
    pub id: String,
    pub name: String,
    /// Unix seconds, as a string — same convention as ConnectedClient.last_seen.
    pub created_at: String,
    pub duration_ms: i64,
    pub frame_count: i32,
    pub sample_rate_hz: f32,
    /// Convenience for the recordings list — the car name seen during the
    /// session, captured once at stop time from the first frame that had one.
    pub car: Option<String>,
    #[typiql(relation(local = "id", op = "eq", foreign = "recording_id"))]
    pub frames: Vec<RecordingFrame>,
}

/// One recorded telemetry frame. DuckDB-backed (`adapter = "duckdb"`) —
/// columnar/range-query storage fits a recording's shape far better than
/// one JSON blob per session (see `Recording`'s doc comment). A real typiql
/// type like any other: gets free `getRecordingFrames`/`addRecordingFrame`/
/// etc. CRUD via the standard macro-generated resolvers, so
/// `graphql/recording.rs` only needs `add_many`/list-filter calls, not a
/// hand-written frame-storage resolver.
///
/// Every `TelemetryFrame` field is flattened directly onto this struct;
/// `TyreData`'s 4-tyre `Vec` (`[FL, FR, RL, RR]`, per `TelemetryFrame`'s own
/// doc comment) is flattened into 32 `<corner>_<field>` columns — the same
/// flattening `chartUtils.ts` used to do client-side on every chart load,
/// now done once at write time instead.
#[typiql_type(adapter = "duckdb")]
pub struct RecordingFrame {
    #[typiql(key)]
    pub id: String,
    pub recording_id: String,
    pub frame_index: i32,

    // Status
    pub sim_status: SimStatus,
    pub simon: bool,
    pub car: String,
    pub track: String,
    pub driver: String,
    pub tyre_compound: String,

    // Motion
    pub g_lat: f32,
    pub g_lon: f32,
    pub g_vert: f32,
    pub heading: f64,
    pub pitch: f64,
    pub roll: f64,

    // Drivetrain
    pub speed: f64,
    pub rpm: u32,
    pub max_rpm: u32,
    pub idle_rpm: u32,
    pub gear: i32,
    pub max_gears: u32,
    pub throttle: f64,
    pub brake: f64,
    pub clutch: f64,
    pub steering: f64,
    pub handbrake: f64,
    pub abs: f64,
    pub brake_bias: f64,

    // Fuel & engine
    pub fuel: f64,
    pub fuel_capacity: f64,
    pub turbo_boost: f64,
    pub turbo_pct: f64,

    // Tyres — flattened [FL, FR, RL, RR]
    pub fl_temp: f64,
    pub fl_pressure: f64,
    pub fl_slip_ratio: f64,
    pub fl_slip_angle: f64,
    pub fl_wear: f64,
    pub fl_brake_temp: f64,
    pub fl_rps: f64,
    pub fl_diameter: f64,

    pub fr_temp: f64,
    pub fr_pressure: f64,
    pub fr_slip_ratio: f64,
    pub fr_slip_angle: f64,
    pub fr_wear: f64,
    pub fr_brake_temp: f64,
    pub fr_rps: f64,
    pub fr_diameter: f64,

    pub rl_temp: f64,
    pub rl_pressure: f64,
    pub rl_slip_ratio: f64,
    pub rl_slip_angle: f64,
    pub rl_wear: f64,
    pub rl_brake_temp: f64,
    pub rl_rps: f64,
    pub rl_diameter: f64,

    pub rr_temp: f64,
    pub rr_pressure: f64,
    pub rr_slip_ratio: f64,
    pub rr_slip_angle: f64,
    pub rr_wear: f64,
    pub rr_brake_temp: f64,
    pub rr_rps: f64,
    pub rr_diameter: f64,

    // Environment
    pub air_temp: f64,
    pub track_temp: f64,
    pub air_density: f64,

    // Session
    pub lap: u32,
    pub position: u32,
    pub num_laps: u32,
    pub num_cars: u32,
    pub course_flag: CourseFlag,
    pub lap_is_valid: bool,
    pub in_pit: bool,
    pub current_lap_seconds: u32,
    pub last_lap_seconds: u32,
    pub sector1_time: f64,
    pub sector2_time: f64,
}

typiql_schema!(
    MonocoqueSoundDevice, ShakerChannel, SoundDeviceProfile, ShakerDspChannel, LfeChannel,
    MonocoqueLedsDevice, LedsDeviceProfile,
    MonocoqueShiftLight, ShiftLightProfile,
    MonocoqueSimWindDevice, SimWindDeviceProfile,
    DashTemplate, ConnectedClient, DashGroup, KnownCar, DeviceDefault,
    Car, File, NightMode, CarDashPan, PreviewCar, DashboardEntry, Recording, RecordingFrame, TrackLocation;
    AppConfigQuery, DashboardFileSyncQuery, BuiltinTemplatesQuery, CarPhotoSyncQuery, ShakerDspQuery, TrackGeocodeQuery, QueryRoot;
    AppConfigMutation, DashboardFileUploadMutation, ClientsMutation, CarFileMutation, DashTemplateThumbnailMutation, DashboardMutation, GamepadMutation, NightClockMutation, ShakerDspMutation, RecordingControlMutation;
    SubscriptionRoot
);
