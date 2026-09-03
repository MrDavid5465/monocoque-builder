//! Extended telemetry streamed out of Assetto Corsa by a CSP Lua app.
//!
//! The existing telemetry path (Monocoque/simd → `/dev/shm/SIMAPI.DAT` →
//! `telemetry::read_simdata`) is cross-sim and deliberately lowest-common-
//! denominator. It carries no in-game clock, no world position, and nothing
//! about how the game is actually rendering the cockpit.
//!
//! A Lua app running inside AC can see all of that directly, so this is a
//! second, AC-only source that runs alongside the existing one rather than
//! replacing it. Everything here is additive: with the app absent, or the
//! game not running, consumers simply see no frames.
//!
//! Three things motivated it, all confirmed against this install's CSP SDK:
//!
//! * **Time of day.** `sim.timeTotalSeconds` is the real in-game clock, which
//!   the app currently has to simulate server-side (`graphql/night_clock.rs`)
//!   because no telemetry carries it.
//! * **NeckFX alignment.** Dashboards re-derive head movement from raw
//!   g-forces, but CSP's actual implementation
//!   (`extension/lua/cockpit-camera/default/cockpit.lua`) is a *washout*
//!   filter — it decays toward centre during sustained load and overshoots on
//!   release — so a proportional mapping ends up out of phase with what the
//!   player sees. Reading the camera offset the game actually applied removes
//!   the guesswork entirely.
//! * **Cockpit lighting.** `car.ambientOcclusion` says whether the car is
//!   under cover, which a day/night dashboard can tint against.

pub mod ingest;
pub mod install;

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// Folder (and entry-script) name of the Lua app, per CSP's convention.
pub const LUA_APP_NAME: &str = "typiql_telemetry";

/// One frame of AC-only telemetry.
///
/// Field names match the CSP API they come from, so the Lua side and this
/// stay obviously in step. Everything is optional at the wire level (serde
/// defaults) so an older app version talking to a newer backend degrades to
/// missing fields rather than a rejected frame.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AcTelemetryFrame {
    // ---- Time of day -------------------------------------------------
    /// Seconds from midnight, unrounded. Replaces the simulated clock.
    pub time_total_seconds: f64,
    /// 1–366, needed for solar declination.
    pub day_of_year: i32,
    /// Unix seconds in *track-local* time, not UTC.
    pub timestamp: i64,
    /// Race time acceleration. Can be 0, or negative online.
    pub time_multiplier: f32,

    // ---- Sun and ambient light --------------------------------------
    /// Sun azimuth, degrees.
    pub sun_angle_deg: f32,
    /// Sun elevation, degrees. Negative below the horizon.
    pub sun_pitch_deg: f32,
    /// 0→1, WeatherFX's own "time for headlights" judgement — a ready-made
    /// scalar for cross-fading a day dashboard into a night one, and better
    /// than thresholding the clock because it accounts for weather.
    pub light_suggestion: f32,
    pub ambient_lighting_multiplier: f32,
    /// 0 = fully shadowed (tunnel, under cover), 1 = open sky.
    pub ambient_occlusion: f32,

    // ---- Cockpit camera (NeckFX) ------------------------------------
    /// Head offset the game actually applied this frame, in car-local
    /// metres, relative to the driver's rest eye position. This is the
    /// value dashboards should follow instead of re-deriving sway from
    /// g-forces — see this module's doc comment.
    pub neck_offset_x: f32,
    pub neck_offset_y: f32,
    pub neck_offset_z: f32,

    /// Head ROTATION relative to the car, degrees.
    ///
    /// Usually the channel that carries the signal. NeckFX's three effects
    /// (TRACK_FOLLOWING, SLIDING_LOOK, STEERING) all change where the head
    /// LOOKS rather than where it sits, so on a typical
    /// look-into-the-corner configuration the offsets above stay near zero
    /// while these move. Measured that way on this rig, which is why both
    /// channels are carried rather than position alone.
    pub neck_yaw_deg: f32,
    pub neck_pitch_deg: f32,
    pub neck_roll_deg: f32,

    // ---- Weather -----------------------------------------------------
    /// Cloud cover proxy, 0→1.
    pub sky_occlusion: f32,
    pub rain_intensity: f32,
    pub wind_speed_kmh: f32,
    /// Real-world compass degrees, track heading already applied.
    pub wind_direction_deg: f32,

    // ---- Position ----------------------------------------------------
    /// World position, metres. Absent from the shared-memory telemetry
    /// entirely, and the thing a live track map needs.
    pub pos_x: f32,
    pub pos_y: f32,
    pub pos_z: f32,
    /// Heading, 0–360 with 0 = north.
    pub compass: f32,
    /// Lap progress, 0→1.
    pub spline_position: f32,

    // ---- Car lights --------------------------------------------------
    pub headlights_active: bool,
    pub high_beams: bool,
    pub brake_lights_active: bool,

    /// False for remote cars online and in replays, where much of the above
    /// is unavailable. Consumers should treat a frame with this unset as
    /// carrying only the scene-level fields.
    pub physics_available: bool,
}

impl AcTelemetryFrame {
    /// `timestamp`, but only when it actually carries a session date rather
    /// than a placeholder — an older CSP, or a frame that arrived before the
    /// field was populated, reports something near zero. Anything before 2000
    /// isn't a date a session could plausibly be set in.
    ///
    /// Shared by every consumer that wants the in-game date (the night clock
    /// override in `graphql/mod.rs`, and sunrise/sunset in
    /// `graphql/night_clock.rs`) so the plausibility rule stays in one place.
    pub fn session_timestamp(&self) -> Option<i64> {
        const EARLIEST_PLAUSIBLE: i64 = 946_684_800;
        (self.timestamp > EARLIEST_PLAUSIBLE).then_some(self.timestamp)
    }
}

/// The most recent frame, plus when it arrived.
///
/// Held in process rather than persisted — it's a live signal with no
/// meaningful stored form, the same reasoning as `CaptureProgress` and
/// `RecordingStatus`.
static LATEST: Mutex<Option<(AcTelemetryFrame, std::time::Instant)>> = Mutex::new(None);

/// How long after the last frame the stream counts as gone. Generous
/// relative to a 30–60Hz send rate, so a stutter or a loading screen doesn't
/// read as a disconnect.
const STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(3);

pub fn store(frame: AcTelemetryFrame) {
    if let Ok(mut guard) = LATEST.lock() {
        *guard = Some((frame, std::time::Instant::now()));
    }
}

/// The latest frame, or `None` if nothing has arrived recently.
pub fn latest() -> Option<AcTelemetryFrame> {
    let guard = LATEST.lock().ok()?;
    let (frame, at) = guard.as_ref()?;
    (at.elapsed() < STALE_AFTER).then(|| frame.clone())
}

/// Whether frames are currently arriving.
pub fn is_connected() -> bool {
    latest().is_some()
}
