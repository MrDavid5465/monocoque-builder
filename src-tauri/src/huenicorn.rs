use crate::config_manager::app_config::read_app_config;
use crate::telemetry::{build_frame, read_simdata, types::SimStatus};
use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use typiql::TypiQLBroker;

/// PID of the currently-running `huenicorn` child process, if we're the one
/// that launched it. Mirrors pipewire_dsp.rs's `FILTER_CHAIN_PID` pattern —
/// see `stop_huenicorn`'s doc comment for why teardown doesn't rely on this
/// alone.
static HUENICORN_PID: Mutex<Option<u32>> = Mutex::new(None);

const HUENICORN_BASE_URL: &str = "http://127.0.0.1:8215";
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
    pub ambient_saturation_boost: f32,
}

#[derive(SimpleObject, Clone, Copy, Debug)]
pub struct HuenicornStatus {
    /// Whether a huenicorn process matching our binary path is alive
    /// (`pgrep -f`-style check — see `stop_huenicorn`'s doc comment for why
    /// this doesn't just trust the cached PID).
    pub running: bool,
    /// Whether its REST API actually answers. A crashed-but-not-yet-reaped
    /// process, or one still mid-startup, would have `running: true` but
    /// `api_reachable: false` — worth surfacing separately since nothing
    /// else in this codebase currently verifies a companion process's
    /// *liveness*, only persists an on/off flag.
    pub api_reachable: bool,
}

/// Whether a process named exactly `huenicorn` is alive. `pgrep -x` matches
/// on the process's own name, not the cached PID — same rationale as
/// `pipewire_dsp::unload_filter_chain`: the static `Mutex` resets to `None`
/// across a backend restart, but a previously-launched huenicorn keeps
/// running, so trusting only the cached PID would silently orphan it and
/// report `running: false` for a process that's very much alive. Matching by
/// name rather than by a specific install path (as this used to) means this
/// is unaffected by how huenicorn was installed — AUR, built from source
/// onto PATH, or a wrapper script — same reasoning as
/// `service_watchdogs::is_simd_running`.
fn is_running() -> bool {
    Command::new("pgrep")
        .arg("-x")
        .arg("huenicorn")
        .output()
        .map(|out| out.status.success())
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

    let command = read_app_config()
        .map(|c| c.settings.huenicorn_command)
        .unwrap_or_else(|_| "huenicorn".into());

    let log_file = std::fs::File::create(log_file_path()).map_err(|e| e.to_string())?;
    let log_file_err = log_file.try_clone().map_err(|e| e.to_string())?;

    let mut child = Command::new("sh")
        .arg("-c")
        .arg(&command)
        .stdout(log_file)
        .stderr(log_file_err)
        .spawn()
        .map_err(|e| format!("Failed to spawn huenicorn: {e}"))?;

    // Give it a moment to either come up cleanly or fail fast — mirrors
    // pipewire_dsp::load_filter_chain's own 300ms grace window and reasoning.
    std::thread::sleep(Duration::from_millis(300));

    match child.try_wait() {
        Ok(Some(status)) => {
            let log = std::fs::read_to_string(log_file_path()).unwrap_or_default();
            Err(format!("huenicorn exited immediately ({status}): {log}"))
        }
        Ok(None) => {
            let pid = child.id();
            *HUENICORN_PID.lock().map_err(|e| e.to_string())? = Some(pid);
            Ok(pid)
        }
        Err(e) => Err(format!("Failed to check huenicorn process status: {e}")),
    }
}

/// Kills the currently-running huenicorn process, if any. A no-op if none is
/// running. Kills by exact process name via `pkill -x`, not just the cached
/// PID — see `is_running`'s doc comment for why relying on the cached PID
/// alone would orphan the process across a backend restart.
pub fn stop_huenicorn() -> Result<(), String> {
    *HUENICORN_PID.lock().map_err(|e| e.to_string())? = None;

    Command::new("pkill")
        .arg("-x")
        .arg("huenicorn")
        .output()
        .map_err(|e| format!("Failed to run pkill: {e}"))?;
    Ok(())
}

pub async fn huenicorn_status() -> HuenicornStatus {
    let running = is_running();

    let api_reachable = if running {
        reqwest::Client::new()
            .get(format!("{HUENICORN_BASE_URL}/api/webUIStatus"))
            .timeout(Duration::from_millis(500))
            .send()
            .await
            .map(|res| res.status().is_success())
            .unwrap_or(false)
    } else {
        false
    };

    HuenicornStatus {
        running,
        api_reachable,
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
    devices: Vec<RawDevice>,
}

#[derive(Deserialize)]
struct RawDevice {
    name: String,
}

/// One Hue channel as configured in Huenicorn, for the "which channel drives
/// the 360° tint" picker in AmbientLights/index.tsx — `name` is the first
/// device's name (a channel is usually one lamp/strip; Huenicorn allows more
/// but this app doesn't need to show all of them for a picker label).
#[derive(SimpleObject, Clone, Debug)]
pub struct ChannelInfo {
    pub channel_id: u8,
    pub name: String,
    pub active: bool,
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
    raw.into_iter()
        .map(|c| ChannelInfo {
            name: c
                .devices
                .first()
                .map(|d| d.name.clone())
                .unwrap_or_else(|| format!("Channel {}", c.channel_id)),
            channel_id: c.channel_id,
            active: c.active,
        })
        .collect()
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
/// every ~2s for `sim_status`: transitioning into `Active` starts huenicorn
/// if `huenicorn_enabled` is set and it isn't already running; transitioning
/// out of `Active` stops it. `run_color_poller` is a fully independent
/// permanent loop that notices the process coming and going on its own — no
/// coordination needed here (see its own doc comment for why that's
/// deliberate). This fully owns start/stop when the feature is enabled —
/// the Settings UI's manual Start/Stop is for testing/override, not the
/// primary path.
pub async fn run_sim_watcher() {
    let mut was_active = false;
    loop {
        tokio::time::sleep(SIM_POLL_INTERVAL).await;

        let sim_active = read_simdata()
            .map(|d| build_frame(d).sim_status)
            .map(|status| matches!(status, SimStatus::Active))
            .unwrap_or(false);

        if sim_active && !was_active {
            let enabled = read_app_config()
                .map(|c| c.settings.huenicorn_enabled)
                .unwrap_or(false);

            if enabled && !is_running() {
                if let Err(e) = start_huenicorn() {
                    eprintln!("run_sim_watcher: failed to start huenicorn: {e}");
                }
            }
        } else if !sim_active && was_active {
            if let Err(e) = stop_huenicorn() {
                eprintln!("run_sim_watcher: failed to stop huenicorn: {e}");
            }
        }

        was_active = sim_active;
    }
}
