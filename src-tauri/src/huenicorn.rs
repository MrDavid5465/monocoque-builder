use crate::config_manager::app_config::read_app_config;
use crate::graphql::night_clock;
use crate::night_state;
use crate::process_liveness;
use crate::telemetry::{build_frame, read_simdata, types::SimStatus};
use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use typiql::{TypiQLAdapter, TypiQLBroker};

/// PID of the currently-running `huenicorn` child process, if we're the one
/// that launched it. Mirrors pipewire_dsp.rs's `FILTER_CHAIN_PID` pattern —
/// see `stop_huenicorn`'s doc comment for why teardown doesn't rely on this
/// alone.
static HUENICORN_PID: Mutex<Option<u32>> = Mutex::new(None);

const HUENICORN_BASE_URL: &str = "http://127.0.0.1:8215";
/// Process name to match, and the default launch command (see
/// `AppSettings::huenicorn_command` for overriding the latter).
const HUENICORN_PROCESS_NAME: &str = "huenicorn";
const SIM_POLL_INTERVAL: Duration = Duration::from_secs(2);
/// Matches Huenicorn's own configured Hue-streaming rate (confirmed live
/// via `GET /api/displayInfo`'s `selectedRefreshRate`: 30, not the ~12.5Hz
/// this was originally set to) — polling any slower than the source itself
/// updates just adds latency/aliasing on top of `current_channel_colors()`
/// for no benefit, since there's nothing new to see between Huenicorn's own
/// ticks. `selectedRefreshRate` is user-configurable in Huenicorn's own web
/// UI; this constant should track whatever that's actually set to rather
/// than assume 30 forever, if it turns out to differ from this value.
const COLOR_POLL_INTERVAL: Duration = Duration::from_millis(33);
/// Per-channel color epsilon below which a poll tick is treated as unchanged
/// and not republished — avoids flooding the merged `dashboardUpdates`
/// subscription with no-op pushes at ~30Hz (same spirit as
/// `useTelemetryPlayback`'s `shallowEqualRecord` guard on the frontend, but
/// server-side here since this is a new publish source, not reactive state).
const COLOR_CHANGE_EPSILON: f32 = 0.004;
/// How many consecutive `SIM_POLL_INTERVAL` ticks the REST API may fail to
/// answer, *after having answered at least once for this instance*, before
/// `run_sim_watcher` treats the process as hung and kills it. Gated on
/// having-been-reachable rather than on an absolute grace period on purpose:
/// huenicorn's own startup blocks on the xdg-desktop-portal screen picker,
/// which is user-paced and can easily outlast any fixed timeout, so a plain
/// "unreachable for N seconds" check would shoot a perfectly healthy
/// instance that's just waiting on the prompt.
const API_MISS_LIMIT: u8 = 5;
/// Minimum gap between two *automatic* start attempts. Huenicorn pops an
/// xdg-desktop-portal picker on every launch, so an instance that dies
/// immediately and repeatedly (e.g. the screen is asleep and there's nothing
/// to capture) must not turn into a prompt storm — one attempt per this
/// interval at worst.
const AUTO_START_BACKOFF: Duration = Duration::from_secs(30);
/// How often `run_gamma_pusher` re-evaluates the day/night blend. Two
/// seconds is far coarser than `COLOR_POLL_INTERVAL` on purpose: gamma
/// tracks the in-sim *time of day*, which even at a heavily compressed cycle
/// moves over minutes, not frames. Each tick that actually changes something
/// costs one small PUT per channel.
const GAMMA_PUSH_INTERVAL: Duration = Duration::from_secs(2);
/// Gamma delta below which a tick is treated as unchanged and not pushed —
/// an order of magnitude finer than the UI slider's own 0.05 step, so every
/// deliberate setting change still gets through while a slowly-creeping
/// dawn ramp doesn't PUT four times a second. Same spirit as
/// `COLOR_CHANGE_EPSILON`, applied to a much slower signal.
const GAMMA_CHANGE_EPSILON: f32 = 0.005;

/// Set when the user explicitly hits Stop on the Ambient Lights page, cleared
/// when they hit Start or when the sim next transitions into `Active` (see
/// `run_sim_watcher`). Only exists because that watcher restarts huenicorn on
/// a *level* check rather than an edge — without this, a manual Stop during a
/// live session would be undone within ~2s. The auto start/stop path never
/// touches this flag; only `graphql/huenicorn.rs`'s mutations do.
static MANUAL_STOP: AtomicBool = AtomicBool::new(false);

fn log_file_path() -> std::path::PathBuf {
    std::env::temp_dir().join("typiql-huenicorn.log")
}

/// One Hue channel's currently-streamed color, as reported by Huenicorn's
/// `GET /api/currentColors`. `#[serde(rename_all = "camelCase")]` doubles as
/// both the wire format for that REST call and this type's own GraphQL
/// field naming (async-graphql's `SimpleObject` already camelCases Rust
/// field names for the schema, so this is really only pinning the serde
/// side to match Huenicorn's `channelId` key).
#[derive(SimpleObject, Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelColor {
    pub channel_id: u8,
    pub r: f32,
    pub g: f32,
    pub b: f32,
}

/// Broadcast over the merged `dashboardUpdates` subscription (see
/// `graphql/mod.rs`'s `DashboardUpdateEvent::AmbientColor`). Carries every
/// channel's color, not a single pre-blended value — per-channel data is
/// kept separate end-to-end so a future version can drive directional
/// effects; v1 consumers (Photo360Viewer.tsx) just pick one channel.
#[derive(SimpleObject, Clone, Debug)]
pub struct AmbientColorChanged {
    pub colors: Vec<ChannelColor>,
}

/// Broadcast whenever `updateSettings` touches the Huenicorn-relevant
/// fields — `AppSettings`/`update_settings` isn't a typiql-managed CRUD
/// type (it's a hand-written singleton config resolver), so unlike
/// NightModeChanged/CarDashPanChanged there's no stock mutation to
/// auto-publish this; `update_settings` (graphql/app_config.rs) publishes
/// it explicitly after every save, same manual-publish requirement
/// documented on `RecordingStatus`'s own doc comment (graphql/mod.rs). Lets
/// an already-open kiosk dashboard pick up a settings change made from a
/// different window/device (e.g. the Ambient Lights page on another
/// tablet) without needing a reload — the same live-config problem
/// NightModeChanged already solves for night-mode settings.
#[derive(SimpleObject, Clone, Copy, Debug)]
pub struct HuenicornSettingsChanged {
    pub huenicorn_enabled: bool,
    pub ambient_tint_intensity: f32,
    pub ambient_primary_channel: Option<u8>,
    pub ambient_saturation_boost_day: f32,
    pub ambient_saturation_boost_night: f32,
}

#[derive(SimpleObject, Clone, Copy, Debug)]
pub struct HuenicornStatus {
    /// Whether a live process named `huenicorn` exists — see `live_pids`'
    /// doc comment for why "live" specifically excludes zombies, and
    /// `stop_huenicorn`'s for why none of this trusts the cached PID.
    pub running: bool,
    /// Whether its REST API actually answers. A process still mid-startup
    /// (huenicorn's own launch blocks on the xdg-desktop-portal screen
    /// picker), or one that's wedged rather than exited, has `running: true`
    /// but `api_reachable: false` — worth surfacing separately since nothing
    /// else in this codebase currently verifies a companion process's
    /// *liveness*, only persists an on/off flag. `run_sim_watcher` acts on
    /// the second case; this pair is what the Ambient Lights page renders.
    pub api_reachable: bool,
    /// Whether `AppSettings::huenicorn_command` (after `service_commands::
    /// resolve`) actually resolves to something launchable — see
    /// `command_installed`. Lets the Ambient Lights page gate its whole
    /// settings UI behind "is this even installed" instead of just cycling
    /// Start/Stop against a binary that will never come up. Trivially `true`
    /// whenever `running` is (an already-running process is by definition
    /// installed), so this never pays for the probe below in the common case.
    pub installed: bool,
}

/// Whether a live (non-zombie) `huenicorn` process exists — see
/// `process_liveness`, which owns this check and the hard-won reasoning
/// behind it, and is shared with the simd/monocoque watchdogs.
fn is_running() -> bool {
    process_liveness::is_running(HUENICORN_PROCESS_NAME)
}

/// PIDs of live `huenicorn` processes — `run_gamma_pusher` uses the set as
/// an instance identity, to notice a restart that began and ended between
/// two of its ticks.
fn live_pids() -> Vec<u32> {
    process_liveness::live_pids(HUENICORN_PROCESS_NAME)
}

/// Records whether the user's last manual action on the Ambient Lights page
/// was Stop (`true`) or Start (`false`) — see `MANUAL_STOP`.
pub fn set_manually_stopped(stopped: bool) {
    MANUAL_STOP.store(stopped, Ordering::Relaxed);
}

/// The command that would actually run huenicorn right now, after
/// `service_commands::resolve` — `None` when this is a debug build with no
/// dev command configured (see that module's own doc comment on why that's a
/// refusal, not a fallback). Shared by `start_huenicorn` (which errors out on
/// `None`) and `huenicorn_status` (which reports it as not installed).
fn resolved_command() -> Option<String> {
    let config = read_app_config().ok();
    let production = config
        .as_ref()
        .map(|c| c.settings.huenicorn_command.clone())
        .unwrap_or_else(|| "huenicorn".into());
    crate::service_commands::resolve(
        &production,
        crate::service_commands::HUENICORN_DEV_COMMAND_ENV,
    )
}

/// Whether `command`'s first whitespace-separated token resolves to
/// something launchable, checked via the shell's own `command -v` rather than
/// a `which`-crate lookup — the configured command can carry arguments (a
/// wrapper script), so only the first token is meaningful to look up, and
/// `command -v` (unlike `which`) also recognizes shell functions/builtins a
/// wrapper might rely on. The token is passed as `sh -c`'s positional `$0`,
/// never interpolated into the script text, so this is safe even though the
/// command string comes from a user-editable setting. Deliberately does NOT
/// fully spawn huenicorn just to answer "is this installed" — a real launch
/// pops the XDG screen-picker portal, which would be a bizarre side effect of
/// what's meant to be a passive status check.
fn command_installed(command: &str) -> bool {
    let Some(first) = command.split_whitespace().next() else {
        return false;
    };
    crate::host_command::host_command("sh")
        .arg("-c")
        .arg("command -v -- \"$0\" >/dev/null 2>&1")
        .arg(first)
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Spawns `AppSettings::huenicorn_command` (default: bare `huenicorn`,
/// PATH-resolved — see `is_running`'s doc comment) through a shell, so a
/// multi-word override (e.g. a wrapper script with args) works the same as a
/// bare binary name — `Command::new` alone only takes one program, no
/// argument splitting. Redirects stdout/stderr to a log file. Returns the
/// child's PID (also cached in `HUENICORN_PID`). A no-op (returns the
/// existing PID) if already running — matches this codebase's idempotent
/// teardown/start convention (e.g. gamepad.rs's device lifecycle).
pub fn start_huenicorn() -> Result<u32, String> {
    if let Some(pid) = *HUENICORN_PID.lock().map_err(|e| e.to_string())? {
        if is_running() {
            return Ok(pid);
        }
    }

    // Unlike the watchdogs' polling loops, this runs on an explicit start
    // (sim went Active, or the Ambient Lights page's Start button), so the
    // debug-build refusal is returned as an error the caller surfaces rather
    // than only logged.
    let command = resolved_command().ok_or_else(|| {
        format!(
            "This is a debug build and {} is not set. Refusing to start the installed \
             Huenicorn — point that variable at your source build, or run a release build \
             to use the configured command.",
            crate::service_commands::HUENICORN_DEV_COMMAND_ENV
        )
    })?;

    // Same host-resolution the watchdogs do: this spawn runs on the host under
    // Flatpak, so a command that only exists in a Flatpak has to be named as
    // one. A no-op today, since huenicorn is installed to ~/.local/bin, which
    // is on the host's PATH.
    let command = crate::service_commands::resolve_for_host(&command);

    let log_file = std::fs::File::create(log_file_path()).map_err(|e| e.to_string())?;
    let log_file_err = log_file.try_clone().map_err(|e| e.to_string())?;

    let mut child = crate::host_command::host_command("sh")
        .arg("-c")
        .arg(&command)
        .stdout(log_file)
        .stderr(log_file_err)
        .spawn()
        .map_err(|e| format!("Failed to spawn huenicorn: {e}"))?;

    // Give it a moment to either come up cleanly or fail fast — mirrors
    // pipewire_dsp::load_filter_chain's own 300ms grace window and reasoning.
    std::thread::sleep(Duration::from_millis(300));

    let started = child.try_wait();

    match started {
        Ok(Some(status)) => {
            let log = std::fs::read_to_string(log_file_path()).unwrap_or_default();
            Err(format!("huenicorn exited immediately ({status}): {log}"))
        }
        Ok(None) => {
            let pid = child.id();
            *HUENICORN_PID.lock().map_err(|e| e.to_string())? = Some(pid);

            // Reap it whenever it exits. `Child`'s `Drop` deliberately does
            // *not* wait, so simply letting the handle fall out of scope here
            // leaves a permanent `<defunct>` entry that `pgrep` still matches
            // — see `live_pids`' doc comment for what that broke. One
            // detached thread blocked in `wait()` per launch is the cheapest
            // fix that also works for the crash path (there is no other point
            // where this app would notice the exit; nothing else here polls
            // the child handle).
            std::thread::spawn(move || {
                if let Ok(status) = child.wait() {
                    eprintln!("huenicorn exited ({status})");
                }
            });

            Ok(pid)
        }
        Err(e) => Err(format!("Failed to check huenicorn process status: {e}")),
    }
}

/// Kills the currently-running huenicorn process, if any. A no-op if none is
/// running. Kills by exact process name via `pkill -x`, not just the cached
/// PID — see `live_pids`' doc comment for why relying on the cached PID
/// alone would orphan the process across a backend restart.
///
/// Escalates to `SIGKILL` if the process is still live ~1s after the initial
/// `SIGTERM`. The hung instances this needs to clear (screen went to sleep
/// mid-capture, or Hue sync was killed from the phone app, both of which can
/// leave huenicorn wedged rather than exited) are exactly the ones that don't
/// necessarily act on a polite signal, and a wedged process that survives the
/// stop would block the next start just as effectively as the zombie did.
/// Blocks the caller for up to ~1s in that pathological case only — same
/// tradeoff as `start_huenicorn`'s own 300ms grace sleep, which is likewise
/// called straight from an async resolver.
pub fn stop_huenicorn() -> Result<(), String> {
    *HUENICORN_PID.lock().map_err(|e| e.to_string())? = None;

    crate::host_command::host_command("pkill")
        .arg("-x")
        .arg("huenicorn")
        .output()
        .map_err(|e| format!("Failed to run pkill: {e}"))?;

    for _ in 0..10 {
        std::thread::sleep(Duration::from_millis(100));
        if !is_running() {
            return Ok(());
        }
    }

    eprintln!("stop_huenicorn: huenicorn survived SIGTERM, escalating to SIGKILL");
    crate::host_command::host_command("pkill")
        .args(["-9", "-x", "huenicorn"])
        .output()
        .map_err(|e| format!("Failed to run pkill -9: {e}"))?;
    Ok(())
}

fn huenicorn_config_path() -> Result<std::path::PathBuf, String> {
    dirs::config_dir()
        .map(|p| p.join("huenicorn").join("config.json"))
        .ok_or_else(|| "Could not resolve config directory".to_string())
}

/// Forces huenicorn's next launch to re-show the XDG portal's screen-picker
/// dialog, instead of silently reusing whatever region was selected the
/// first time. Huenicorn persists the portal's `restore_token` into its own
/// `config.json` (see `XdgDesktopPortal.cpp`'s `persist_mode` handling
/// upstream) specifically so *most* restarts don't re-prompt — normally
/// desirable, but it also means there's no user-facing way to deliberately
/// pick a different screen/region once a token exists, short of editing that
/// file by hand. This does the same edit, plus the required restart, as one
/// action: stop (blocks until the process is actually gone — huenicorn may
/// itself rewrite its config on shutdown, so editing before it's confirmed
/// dead risks the old token just getting written back), strip
/// `restoreToken` from the JSON, start again.
pub fn reset_screen_selection() -> Result<(), String> {
    stop_huenicorn()?;

    let path = huenicorn_config_path()?;
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut config: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if let Some(obj) = config.as_object_mut() {
        obj.remove("restoreToken");
    }
    let text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())?;

    set_manually_stopped(false);
    start_huenicorn()?;
    Ok(())
}

/// Whether huenicorn's REST API answers right now. Split out of
/// `huenicorn_status` so `run_sim_watcher`'s hang detection can ask this
/// directly without paying for a second `pgrep` it already ran.
async fn api_reachable() -> bool {
    reqwest::Client::new()
        .get(format!("{HUENICORN_BASE_URL}/api/webUIStatus"))
        .timeout(Duration::from_millis(500))
        .send()
        .await
        .map(|res| res.status().is_success())
        .unwrap_or(false)
}

pub async fn huenicorn_status() -> HuenicornStatus {
    let running = is_running();
    let installed = running
        || resolved_command()
            .map(|cmd| command_installed(&cmd))
            .unwrap_or(false);

    HuenicornStatus {
        running,
        api_reachable: running && api_reachable().await,
        installed,
    }
}

/// One-shot GET of `/api/currentColors`. Returns an empty vec (rather than
/// an error) when unreachable — callers poll this in a loop and a transient
/// miss shouldn't be treated any differently than "nothing changed yet".
pub async fn current_channel_colors() -> Vec<ChannelColor> {
    let Ok(res) = reqwest::Client::new()
        .get(format!("{HUENICORN_BASE_URL}/api/currentColors"))
        .timeout(Duration::from_millis(500))
        .send()
        .await
    else {
        return Vec::new();
    };

    if !res.status().is_success() {
        return Vec::new();
    }

    res.json::<Vec<ChannelColor>>().await.unwrap_or_default()
}

/// Wire shape of one corner-pair in Huenicorn's JSON, e.g. `{"x":0.0,"y":0.5}`
/// nested under `uvA`/`uvB` — see `RawUVs`.
#[derive(Deserialize, Clone, Copy)]
struct RawUVPoint {
    x: f32,
    y: f32,
}

/// Wire shape of a channel's screen region: `{"uvA":{x,y}, "uvB":{x,y}}`,
/// normalized (0..1) screen coordinates — shared by `GET /api/channels`
/// (nested under each channel) and the direct response of `PUT
/// /api/setChannelUV/:id`. `#[serde(rename_all = "camelCase")]` maps
/// `uv_a`/`uv_b` to Huenicorn's `uvA`/`uvB` keys.
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct RawUVs {
    uv_a: RawUVPoint,
    uv_b: RawUVPoint,
}

/// A channel's screen region, flattened for GraphQL — see `RawUVs` for the
/// wire shape this is converted from. `uv_a`/`uv_b` track Huenicorn's own
/// corner terminology (not "min"/"max") so this stays easy to cross-check
/// against Huenicorn's own source/API docs.
#[derive(SimpleObject, Clone, Copy, Debug)]
pub struct ChannelUVs {
    pub uv_a_x: f32,
    pub uv_a_y: f32,
    pub uv_b_x: f32,
    pub uv_b_y: f32,
}

impl From<RawUVs> for ChannelUVs {
    fn from(raw: RawUVs) -> Self {
        ChannelUVs {
            uv_a_x: raw.uv_a.x,
            uv_a_y: raw.uv_a.y,
            uv_b_x: raw.uv_b.x,
            uv_b_y: raw.uv_b.y,
        }
    }
}

/// Raw shape of Huenicorn's `GET /api/channels` (see WebUIBackend.cpp's own
/// `/api/channels` route) — only the fields this app actually uses. Kept
/// private/distinct from `ChannelInfo` (the GraphQL-facing type) since this
/// mirrors Huenicorn's wire format exactly, including a `devices` array this
/// app collapses down to a single display name.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawChannel {
    channel_id: u8,
    active: bool,
    gamma_factor: f32,
    devices: Vec<RawDevice>,
    uvs: RawUVs,
}

#[derive(Deserialize)]
struct RawDevice {
    name: String,
}

/// One Hue channel as configured in Huenicorn, for the "which channel drives
/// the 360° tint" picker in AmbientLights/index.tsx and for
/// ChannelMapper.tsx's screen-region editor — `name` is the first device's
/// name (a channel is usually one lamp/strip; Huenicorn allows more but this
/// app doesn't need to show all of them for a picker label).
#[derive(SimpleObject, Clone, Debug)]
pub struct ChannelInfo {
    pub channel_id: u8,
    pub name: String,
    pub active: bool,
    /// Whatever gamma this channel is running right now — Huenicorn's own
    /// profile value, or the last thing `run_gamma_pusher` set. The Ambient
    /// Lights page seeds its day/night sliders from this so opening the page
    /// and saving without touching anything can't move the lights.
    pub gamma_factor: f32,
    /// This channel's current screen-capture region — see `ChannelUVs`.
    pub uv_a_x: f32,
    pub uv_a_y: f32,
    pub uv_b_x: f32,
    pub uv_b_y: f32,
}

/// Shared by `list_channels`, `set_channel_active`, and
/// `set_entertainment_configuration` — all three either fetch or receive
/// back the same `RawChannel` shape from Huenicorn.
fn raw_channel_to_info(c: RawChannel) -> ChannelInfo {
    ChannelInfo {
        name: c
            .devices
            .first()
            .map(|d| d.name.clone())
            .unwrap_or_else(|| format!("Channel {}", c.channel_id)),
        channel_id: c.channel_id,
        active: c.active,
        gamma_factor: c.gamma_factor,
        uv_a_x: c.uvs.uv_a.x,
        uv_a_y: c.uvs.uv_a.y,
        uv_b_x: c.uvs.uv_b.x,
        uv_b_y: c.uvs.uv_b.y,
    }
}

/// One-shot GET of `/api/channels`. Returns an empty vec (not an error) when
/// unreachable — same rationale as `current_channel_colors`: the settings
/// page polls this, and Huenicorn simply not running yet is a normal state,
/// not a failure to surface.
pub async fn list_channels() -> Vec<ChannelInfo> {
    let Ok(res) = reqwest::Client::new()
        .get(format!("{HUENICORN_BASE_URL}/api/channels"))
        .timeout(Duration::from_millis(500))
        .send()
        .await
    else {
        return Vec::new();
    };

    if !res.status().is_success() {
        return Vec::new();
    }

    let raw = res.json::<Vec<RawChannel>>().await.unwrap_or_default();
    raw.into_iter().map(raw_channel_to_info).collect()
}

/// Pushes one corner of a channel's screen region to Huenicorn (`PUT
/// /api/setChannelUV/:channelId`, body `{"x", "y", "type"}` where `type` is
/// 0=TopLeft/1=TopRight/2=BottomLeft/3=BottomRight — see `Imaging::UVCorner`
/// in Huenicorn's own source). Returns the *clamped* resulting rectangle:
/// dragging one corner past its opposite pushes the opposite corner too (see
/// `Channel::setUV` in Huenicorn's `Channel.cpp`), so this response — not
/// the caller's own guess mid-drag — is the region's new source of truth.
/// Unlike `set_channel_gamma`, this endpoint's response has no `succeeded`
/// field; any 200 with valid JSON is success. An invalid channel id isn't
/// guarded against server-side (Huenicorn indexes its channel map with
/// `.at()`, which throws), but ChannelMapper.tsx only ever sends ids it just
/// read from `list_channels`, so that path isn't expected to be hit.
pub async fn set_channel_uv(
    channel_id: u8,
    corner: u8,
    x: f32,
    y: f32,
) -> Result<ChannelUVs, String> {
    let res = reqwest::Client::new()
        .put(format!(
            "{HUENICORN_BASE_URL}/api/setChannelUV/{channel_id}"
        ))
        .json(&json!({ "x": x, "y": y, "type": corner }))
        .timeout(Duration::from_millis(500))
        .send()
        .await
        .map_err(|e| format!("setChannelUV PUT failed: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("setChannelUV PUT returned {}", res.status()));
    }

    res.json::<RawUVs>()
        .await
        .map(ChannelUVs::from)
        .map_err(|e| format!("setChannelUV PUT returned no JSON: {e}"))
}

/// Activates/deactivates a channel (`POST /api/setChannelActivity/:channelId`,
/// body `{"active": bool}`), returning Huenicorn's full post-change channel
/// list so ChannelMapper.tsx's active/inactive rows can refresh from one
/// response instead of a separate refetch.
pub async fn set_channel_active(channel_id: u8, active: bool) -> Result<Vec<ChannelInfo>, String> {
    #[derive(Deserialize)]
    struct Response {
        succeeded: bool,
        #[serde(default)]
        channels: Vec<RawChannel>,
    }

    let res = reqwest::Client::new()
        .post(format!(
            "{HUENICORN_BASE_URL}/api/setChannelActivity/{channel_id}"
        ))
        .json(&json!({ "active": active }))
        .timeout(Duration::from_millis(500))
        .send()
        .await
        .map_err(|e| format!("setChannelActivity POST failed: {e}"))?;

    let body: Response = res
        .json()
        .await
        .map_err(|e| format!("setChannelActivity POST returned no JSON: {e}"))?;

    if !body.succeeded {
        return Err(format!(
            "huenicorn rejected activity change for channel {channel_id}"
        ));
    }

    Ok(body.channels.into_iter().map(raw_channel_to_info).collect())
}

/// Persists Huenicorn's current in-memory config (channel regions, gamma,
/// active set, ...) to its own `profile.json` (`POST /api/saveProfile`).
/// Everything else in this module only pushes live, in-memory changes —
/// this is the one call that survives a Huenicorn restart.
///
/// Deliberately does not parse the response body: Huenicorn's own handler
/// constructs it as `Json{"succeeded", true}` — nlohmann's brace-init with
/// exactly two bare elements (not `{{"k", v}}`) serializes to the *array*
/// `["succeeded", true]`, not an object, unlike every other endpoint in this
/// file. Treating a 2xx status as success avoids depending on that quirk.
pub async fn save_profile() -> Result<(), String> {
    let res = reqwest::Client::new()
        .post(format!("{HUENICORN_BASE_URL}/api/saveProfile"))
        .timeout(Duration::from_millis(1000))
        .send()
        .await
        .map_err(|e| format!("saveProfile POST failed: {e}"))?;

    if res.status().is_success() {
        Ok(())
    } else {
        Err(format!("saveProfile POST returned {}", res.status()))
    }
}

#[derive(SimpleObject, Clone, Debug)]
pub struct SubsampleCandidate {
    pub x: i32,
    pub y: i32,
}

/// `GET /api/displayInfo`'s full shape — display resolution, the subsample
/// widths Huenicorn is willing to run at, and the refresh-rate/transition-
/// smoothing settings AdvancedHuenicornSettings.tsx edits.
#[derive(SimpleObject, Clone, Debug)]
pub struct HuenicornDisplayInfo {
    pub x: i32,
    pub y: i32,
    pub subsample_width: i32,
    pub subsample_resolution_candidates: Vec<SubsampleCandidate>,
    pub selected_refresh_rate: i32,
    pub max_refresh_rate: i32,
    pub selected_transition_smoothing: f32,
}

#[derive(Deserialize)]
struct RawPoint {
    x: i32,
    y: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawDisplayInfo {
    x: i32,
    y: i32,
    subsample_width: i32,
    subsample_resolution_candidates: Vec<RawPoint>,
    selected_refresh_rate: i32,
    max_refresh_rate: i32,
    selected_transition_smoothing: f32,
}

/// One-shot GET of `/api/displayInfo`. `None` (not an error) when
/// unreachable, matching `list_channels`' polling-friendly shape —
/// AdvancedHuenicornSettings.tsx renders its own "Huenicorn isn't running"
/// state rather than surfacing this as a failure.
pub async fn display_info() -> Option<HuenicornDisplayInfo> {
    let res = reqwest::Client::new()
        .get(format!("{HUENICORN_BASE_URL}/api/displayInfo"))
        .timeout(Duration::from_millis(500))
        .send()
        .await
        .ok()?;

    if !res.status().is_success() {
        return None;
    }

    let raw: RawDisplayInfo = res.json().await.ok()?;
    Some(HuenicornDisplayInfo {
        x: raw.x,
        y: raw.y,
        subsample_width: raw.subsample_width,
        subsample_resolution_candidates: raw
            .subsample_resolution_candidates
            .into_iter()
            .map(|p| SubsampleCandidate { x: p.x, y: p.y })
            .collect(),
        selected_refresh_rate: raw.selected_refresh_rate,
        max_refresh_rate: raw.max_refresh_rate,
        selected_transition_smoothing: raw.selected_transition_smoothing,
    })
}

#[derive(SimpleObject, Clone, Debug)]
pub struct HuenicornInterpolationOption {
    pub name: String,
    pub value: i32,
}

#[derive(SimpleObject, Clone, Debug)]
pub struct HuenicornInterpolationInfo {
    pub current: i32,
    pub available: Vec<HuenicornInterpolationOption>,
}

/// One-shot GET of `/api/interpolationInfo`. Parsed via `serde_json::Value`
/// rather than a typed struct because `available` is an array of
/// single-key `{name: value}` objects (Huenicorn's own wire quirk) — that
/// shape is flattened into `HuenicornInterpolationOption` here so nothing
/// downstream has to know about it. `None` when unreachable, same
/// polling-friendly convention as `display_info`.
pub async fn interpolation_info() -> Option<HuenicornInterpolationInfo> {
    let res = reqwest::Client::new()
        .get(format!("{HUENICORN_BASE_URL}/api/interpolationInfo"))
        .timeout(Duration::from_millis(500))
        .send()
        .await
        .ok()?;

    if !res.status().is_success() {
        return None;
    }

    let body: serde_json::Value = res.json().await.ok()?;
    let current = body.get("current")?.as_i64()? as i32;
    let available = body
        .get("available")?
        .as_array()?
        .iter()
        .filter_map(|entry| {
            let (name, value) = entry.as_object()?.iter().next()?;
            Some(HuenicornInterpolationOption {
                name: name.clone(),
                value: value.as_i64()? as i32,
            })
        })
        .collect();

    Some(HuenicornInterpolationInfo { current, available })
}

#[derive(SimpleObject, Clone, Debug)]
pub struct HuenicornEntertainmentConfig {
    pub id: String,
    pub name: String,
}

#[derive(SimpleObject, Clone, Debug)]
pub struct HuenicornEntertainmentConfigs {
    pub configs: Vec<HuenicornEntertainmentConfig>,
    pub current_id: String,
}

#[derive(Deserialize)]
struct RawEntertainmentConfig {
    name: String,
    #[serde(rename = "entertainmentConfigurationId")]
    entertainment_configuration_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawEntertainmentConfigsResponse {
    entertainment_configurations: Vec<RawEntertainmentConfig>,
    current_entertainment_configuration_id: String,
}

/// One-shot GET of `/api/entertainmentConfigurations`. `None` when
/// unreachable, same convention as `display_info`/`interpolation_info` —
/// AdvancedHuenicornSettings.tsx only renders this picker at all when more
/// than one configuration exists, mirroring Huenicorn's own web UI gate.
pub async fn entertainment_configs() -> Option<HuenicornEntertainmentConfigs> {
    let res = reqwest::Client::new()
        .get(format!(
            "{HUENICORN_BASE_URL}/api/entertainmentConfigurations"
        ))
        .timeout(Duration::from_millis(500))
        .send()
        .await
        .ok()?;

    if !res.status().is_success() {
        return None;
    }

    let raw: RawEntertainmentConfigsResponse = res.json().await.ok()?;
    Some(HuenicornEntertainmentConfigs {
        configs: raw
            .entertainment_configurations
            .into_iter()
            .map(|c| HuenicornEntertainmentConfig {
                id: c.entertainment_configuration_id,
                name: c.name,
            })
            .collect(),
        current_id: raw.current_entertainment_configuration_id,
    })
}

/// `PUT /api/setSubsampleWidth`, bare JSON integer body. Returns the fresh
/// `HuenicornDisplayInfo` via a follow-up `display_info()` call rather than
/// hand-assembling one from this endpoint's own partial `{x,y,
/// subsampleWidth}` response, so refresh-rate/candidate fields can't go
/// stale in the caller's hands.
pub async fn set_subsample_width(width: i32) -> Result<HuenicornDisplayInfo, String> {
    let res = reqwest::Client::new()
        .put(format!("{HUENICORN_BASE_URL}/api/setSubsampleWidth"))
        .json(&width)
        .timeout(Duration::from_millis(500))
        .send()
        .await
        .map_err(|e| format!("setSubsampleWidth PUT failed: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("setSubsampleWidth PUT returned {}", res.status()));
    }

    display_info()
        .await
        .ok_or_else(|| "subsample width set, but displayInfo re-fetch failed".to_string())
}

/// `PUT /api/setRefreshRate`, bare JSON integer body (Hz). Huenicorn clamps
/// to the display's own max refresh rate server-side, so the returned value
/// can differ from what was requested.
pub async fn set_refresh_rate(hz: i32) -> Result<i32, String> {
    let res = reqwest::Client::new()
        .put(format!("{HUENICORN_BASE_URL}/api/setRefreshRate"))
        .json(&hz)
        .timeout(Duration::from_millis(500))
        .send()
        .await
        .map_err(|e| format!("setRefreshRate PUT failed: {e}"))?;

    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("setRefreshRate PUT returned no JSON: {e}"))?;

    body.get("refreshRate")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32)
        .ok_or_else(|| format!("setRefreshRate PUT returned unexpected body: {body}"))
}

/// `PUT /api/setInterpolation`, bare JSON integer body (enum value from
/// `HuenicornInterpolationOption`).
pub async fn set_interpolation(value: i32) -> Result<(), String> {
    let res = reqwest::Client::new()
        .put(format!("{HUENICORN_BASE_URL}/api/setInterpolation"))
        .json(&value)
        .timeout(Duration::from_millis(500))
        .send()
        .await
        .map_err(|e| format!("setInterpolation PUT failed: {e}"))?;

    if res.status().is_success() {
        Ok(())
    } else {
        Err(format!("setInterpolation PUT returned {}", res.status()))
    }
}

/// `PUT /api/setTransitionSmoothing`, bare JSON float body (0-95, a
/// percentage — Huenicorn itself divides by 100 server-side).
pub async fn set_transition_smoothing(value: f32) -> Result<f32, String> {
    let res = reqwest::Client::new()
        .put(format!("{HUENICORN_BASE_URL}/api/setTransitionSmoothing"))
        .json(&value)
        .timeout(Duration::from_millis(500))
        .send()
        .await
        .map_err(|e| format!("setTransitionSmoothing PUT failed: {e}"))?;

    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("setTransitionSmoothing PUT returned no JSON: {e}"))?;

    body.get("transitionSmoothing")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
        .ok_or_else(|| format!("setTransitionSmoothing PUT returned unexpected body: {body}"))
}

/// `PUT /api/setEntertainmentConfiguration`, bare JSON string body (a
/// config id from `entertainment_configs`). Switching configurations
/// changes Huenicorn's whole channel set, so this returns the fresh list —
/// same shape/rationale as `set_channel_active`.
pub async fn set_entertainment_configuration(id: String) -> Result<Vec<ChannelInfo>, String> {
    #[derive(Deserialize)]
    struct Response {
        succeeded: bool,
        #[serde(default)]
        channels: Vec<RawChannel>,
    }

    let res = reqwest::Client::new()
        .put(format!(
            "{HUENICORN_BASE_URL}/api/setEntertainmentConfiguration"
        ))
        .json(&id)
        .timeout(Duration::from_millis(1000))
        .send()
        .await
        .map_err(|e| format!("setEntertainmentConfiguration PUT failed: {e}"))?;

    let body: Response = res
        .json()
        .await
        .map_err(|e| format!("setEntertainmentConfiguration PUT returned no JSON: {e}"))?;

    if !body.succeeded {
        return Err(format!(
            "huenicorn rejected entertainment configuration {id}"
        ));
    }

    Ok(body.channels.into_iter().map(raw_channel_to_info).collect())
}

fn colors_changed(prev: &[ChannelColor], next: &[ChannelColor]) -> bool {
    if prev.len() != next.len() {
        return true;
    }
    prev.iter().zip(next.iter()).any(|(a, b)| {
        a.channel_id != b.channel_id
            || (a.r - b.r).abs() > COLOR_CHANGE_EPSILON
            || (a.g - b.g).abs() > COLOR_CHANGE_EPSILON
            || (a.b - b.b).abs() > COLOR_CHANGE_EPSILON
    })
}

/// Runs forever; spawn once at startup (see main.rs, alongside
/// `gamepad::run_watchdog`/`run_sim_watcher`) — deliberately NOT tied to any
/// particular start path. An earlier version spawned this reactively from
/// `run_sim_watcher`'s automatic start and the manual `startHuenicorn`
/// mutation, guarded by a "one poller at a time" flag; that flag reset on
/// every backend rebuild (a static, like everything else, doesn't survive a
/// process restart), and if huenicorn was already running from *before* the
/// restart, nothing re-triggered it — confirmed live twice: once right
/// after the manual-start path was added, and again after a routine
/// cargo-watch rebuild mid-session, both times silently leaving
/// `AmbientColorChanged` dead while huenicorn itself kept streaming fine to
/// the bulbs. A single permanent loop that checks `is_running()` on its own
/// every tick can't be "forgotten" by any call site, by construction.
///
/// Polls `current_channel_colors()` at the same rate Huenicorn itself
/// streams to the bridge (see `COLOR_POLL_INTERVAL`'s own doc comment) while
/// huenicorn is up, and publishes an `AmbientColorChanged` only when the
/// colors moved enough to matter (see `COLOR_CHANGE_EPSILON`). Falls back to
/// the much slower `SIM_POLL_INTERVAL` cadence while huenicorn isn't
/// running — no point spawning `pgrep` at ~30Hz forever when there's
/// nothing to poll — and clears `last` on that transition so the first
/// colors read after a fresh start always publishes, even if they happen to
/// match whatever was last seen before the previous stop.
pub async fn run_color_poller() {
    let mut last: Vec<ChannelColor> = Vec::new();
    loop {
        if !is_running() {
            tokio::time::sleep(SIM_POLL_INTERVAL).await;
            last.clear();
            continue;
        }

        let colors = current_channel_colors().await;
        if !colors.is_empty() && colors_changed(&last, &colors) {
            last = colors.clone();
            TypiQLBroker::publish(AmbientColorChanged { colors });
        }

        tokio::time::sleep(COLOR_POLL_INTERVAL).await;
    }
}

/// Runs forever; spawn once at startup (see main.rs, alongside
/// `gamepad::run_watchdog`/`run_color_poller`). Polls `read_simdata()`
/// every ~2s for `sim_status` and owns huenicorn's whole lifecycle: while
/// the sim is `Active` and `huenicorn_enabled` is set, huenicorn should be
/// running and answering; leaving `Active` stops it. `run_color_poller` is a
/// fully independent permanent loop that notices the process coming and
/// going on its own — no coordination needed here (see its own doc comment
/// for why that's deliberate). The Ambient Lights page's manual Start/Stop
/// is for testing/override, not the primary path, but a manual Stop is
/// honoured for the rest of the session (see `MANUAL_STOP`).
///
/// The start check is a *level* check, not an edge check — deliberately, and
/// for the same reason `service_watchdogs::run_monocoque_watchdog` is: one
/// condition then covers both "the sim just went Active and huenicorn was
/// never started this session" and "huenicorn died mid-session", with no
/// separate crash-recovery path. The edge-triggered version could only ever
/// recover on the next inactive→Active transition, which in practice meant
/// a huenicorn lost mid-session (screen sleep, or Hue sync killed from the
/// phone app — both observed) stayed dead for the rest of the session.
///
/// It also force-stops a huenicorn that is alive but has stopped answering
/// its REST API for `API_MISS_LIMIT` consecutive ticks having previously
/// answered, which the level check then restarts on the following tick.
/// "Alive but wedged" is a real state for this process, not just a
/// theoretical one, and it is worse than a clean exit: the process name
/// still matches, so nothing else here would ever consider replacing it.
pub async fn run_sim_watcher() {
    let mut was_active = false;
    let mut api_was_reachable = false;
    let mut api_misses: u8 = 0;
    let mut last_auto_start: Option<Instant> = None;

    loop {
        tokio::time::sleep(SIM_POLL_INTERVAL).await;

        let sim_active = read_simdata()
            .map(|d| build_frame(d).sim_status)
            .map(|status| matches!(status, SimStatus::Active))
            .unwrap_or(false);

        // Hang detection, before the start check below so a wedged instance
        // is cleared and replaced without waiting an extra tick.
        if is_running() {
            if api_reachable().await {
                api_was_reachable = true;
                api_misses = 0;
            } else if api_was_reachable {
                api_misses += 1;
                if api_misses >= API_MISS_LIMIT {
                    eprintln!(
                        "run_sim_watcher: huenicorn is alive but its API stopped answering, killing it"
                    );
                    if let Err(e) = stop_huenicorn() {
                        eprintln!("run_sim_watcher: failed to kill hung huenicorn: {e}");
                    }
                    api_was_reachable = false;
                    api_misses = 0;
                }
            }
        } else {
            api_was_reachable = false;
            api_misses = 0;
        }

        if sim_active {
            // A fresh session clears both the manual override and the
            // backoff: whatever the user did last session, and however many
            // times huenicorn failed to come up during it, this is a new
            // chance to start cleanly.
            if !was_active {
                set_manually_stopped(false);
                last_auto_start = None;
            }

            let enabled = read_app_config()
                .map(|c| c.settings.huenicorn_enabled)
                .unwrap_or(false);
            let backing_off = last_auto_start
                .map(|at| at.elapsed() < AUTO_START_BACKOFF)
                .unwrap_or(false);

            if enabled && !MANUAL_STOP.load(Ordering::Relaxed) && !backing_off && !is_running() {
                last_auto_start = Some(Instant::now());
                if let Err(e) = start_huenicorn() {
                    eprintln!("run_sim_watcher: failed to start huenicorn: {e}");
                }
            }
        } else if was_active {
            if let Err(e) = stop_huenicorn() {
                eprintln!("run_sim_watcher: failed to stop huenicorn: {e}");
            }
        }

        was_active = sim_active;
    }
}

/// Pushes one channel's gamma factor to Huenicorn (`PUT
/// /api/setChannelGammaFactor/:channelId`, body `{"gammaFactor": f}`).
///
/// Huenicorn answers 200 with `{"succeeded": false, "error": ...}` for an
/// unknown channel id rather than an HTTP error status, so the body is what
/// decides success here, not `status().is_success()` — a channel the user
/// configured that no longer exists in Huenicorn's profile (renumbered,
/// removed) would otherwise look like a silent success forever.
///
/// This only moves Huenicorn's in-memory runtime value; it does not write
/// its profile.json (`setChannelGammaFactor` in CoreService.cpp mutates the
/// channel and returns). That's the desired shape — this app re-pushes on
/// every fresh instance (see `run_gamma_pusher`), and the user's own
/// Huenicorn profile stays whatever they set in Huenicorn's own UI.
pub async fn set_channel_gamma(channel_id: u8, gamma_factor: f32) -> Result<(), String> {
    let res = reqwest::Client::new()
        .put(format!(
            "{HUENICORN_BASE_URL}/api/setChannelGammaFactor/{channel_id}"
        ))
        .json(&json!({ "gammaFactor": gamma_factor }))
        .timeout(Duration::from_millis(500))
        .send()
        .await
        .map_err(|e| format!("gamma PUT failed: {e}"))?;

    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("gamma PUT returned no JSON: {e}"))?;

    if body.get("succeeded").and_then(|v| v.as_bool()) == Some(true) {
        Ok(())
    } else {
        Err(format!(
            "huenicorn rejected gamma for channel {channel_id}: {body}"
        ))
    }
}

/// Runs forever; spawn once per backend start (see `api::build_router`,
/// which owns the adapter handle this needs — same fire-and-forget shape as
/// `shaker_dsp::resume_shaker_dsp_if_enabled`).
///
/// Keeps every configured channel's Huenicorn gamma factor tracking the
/// global day/night state: each channel has a `day` and a `night` value
/// (`AppSettings::ambient_channel_gamma`) and this interpolates between them
/// by the current night amount. In manual day/night mode that amount is a
/// hard 0 or 1, so the lights step at the toggle; with the simulated in-game
/// clock running it's the continuous dawn/dusk ramp, so the bulbs dim into
/// evening at the same rate the dashboards do — see `night_state`, which is
/// the server-side port of the frontend's ramp, and exists precisely so this
/// loop doesn't need an open dashboard to know the in-sim time of day.
///
/// Inert until configured: no `ambient_channel_gamma` (the default) means
/// this never touches Huenicorn at all, leaving whatever gamma the user set
/// in Huenicorn's own web UI.
///
/// Re-pushes from scratch whenever the huenicorn process changes identity —
/// a fresh instance loads gamma from its own profile.json, knows nothing
/// about this app's day/night state, and would otherwise sit at its
/// profile's daytime value all night. Tracking the live PID set rather than
/// a "was it running last tick" flag catches a restart that begins and ends
/// between two ticks, which a stop/start from the Ambient Lights page can
/// easily do.
pub async fn run_gamma_pusher(adapter: Arc<dyn TypiQLAdapter>) {
    let mut pushed: HashMap<u8, f32> = HashMap::new();
    let mut last_pids: Vec<u32> = Vec::new();

    loop {
        tokio::time::sleep(GAMMA_PUSH_INTERVAL).await;

        let pids = live_pids();
        if pids != last_pids {
            pushed.clear();
            last_pids = pids;
        }
        if last_pids.is_empty() {
            continue;
        }

        let Ok(config) = read_app_config() else {
            continue;
        };
        let Some(gammas) = config.settings.ambient_channel_gamma else {
            continue;
        };
        if gammas.is_empty() {
            continue;
        }

        // Nothing to push into until Huenicorn's REST API is actually up —
        // its startup blocks on the xdg-desktop-portal picker, so "process
        // exists" arrives well before "accepts settings". Skipping the tick
        // (rather than PUTting into the void) also keeps `pushed` honest:
        // only values Huenicorn confirmed are recorded as sent.
        if !api_reachable().await {
            continue;
        }

        let night = match night_clock::read_current(&adapter).await {
            Some(record) => {
                let sim_ms = night_clock::current_sim_ms(&record, night_clock::now_ms());
                // Same elevation the dashboards blend on, so the bulbs and
                // the screen can't disagree partway through a dawn.
                let sun = match sim_ms {
                    Some(ms) => night_clock::current_sun_elevation_deg(&adapter, &record, ms).await,
                    None => None,
                };
                night_state::night_amount(
                    &record,
                    sim_ms,
                    sun.map(|(elevation, _)| elevation),
                    sun.map(|(_, rising)| rising).unwrap_or(true),
                ) as f32
            }
            // No NightMode record yet (nothing has toggled day/night on this
            // install): treat it as full day rather than skipping, so the
            // day values still apply.
            None => 0.0,
        };

        for gamma in gammas {
            let target = gamma.day + (gamma.night - gamma.day) * night;
            let unchanged = pushed
                .get(&gamma.channel_id)
                .map(|prev| (prev - target).abs() <= GAMMA_CHANGE_EPSILON)
                .unwrap_or(false);
            if unchanged {
                continue;
            }

            match set_channel_gamma(gamma.channel_id, target).await {
                // Only recorded on success, so a transient failure is simply
                // retried on the next tick.
                Ok(()) => {
                    pushed.insert(gamma.channel_id, target);
                }
                Err(e) => eprintln!("run_gamma_pusher: {e}"),
            }
        }
    }
}
