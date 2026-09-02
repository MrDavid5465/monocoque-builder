//! GraphQL surface for the AC-only extended telemetry stream.
//!
//! The Lua app pushes frames to a plain WebSocket (`ac_telemetry::ingest`);
//! this is the other side, where the frontend reads them. Kept separate
//! because the producer is a Lua script that can't reasonably speak GraphQL,
//! while consumers already speak nothing else.

use crate::ac_telemetry::{self, AcTelemetryFrame};
use async_graphql::{Context, Object, Result as GqlResult, SimpleObject};
use futures_util::stream::{Stream, StreamExt};
use std::time::Duration;
use tokio_stream::wrappers::IntervalStream;

/// One frame, as the frontend sees it.
///
/// A separate type from the wire struct so the GraphQL schema isn't pinned to
/// whatever the Lua app happens to send — fields can be renamed or dropped on
/// one side without breaking the other.
#[derive(SimpleObject, Clone, Default)]
pub struct AcTelemetry {
    /// Seconds from midnight in game. The real clock, as opposed to the
    /// server-side simulation in `night_clock.rs`.
    pub time_total_seconds: f64,
    pub day_of_year: i32,
    /// Seconds since the epoch in the *track's* local timezone, not UTC.
    /// Carries the in-game date as well as the time.
    pub timestamp: i64,
    pub time_multiplier: f32,

    pub sun_angle_deg: f32,
    /// Sun elevation; negative below the horizon.
    pub sun_pitch_deg: f32,
    /// 0→1, WeatherFX's own "time for headlights" judgement. Intended as the
    /// day→night cross-fade input, since it accounts for weather rather than
    /// just the hour.
    pub light_suggestion: f32,
    pub ambient_lighting_multiplier: f32,
    /// 0 = under cover, 1 = open sky.
    pub ambient_occlusion: f32,

    /// Head offset the game applied this frame, car-local metres, relative to
    /// the driver's rest eye position. Dashboards should follow this rather
    /// than deriving sway from g-forces: CSP's NeckFX is a washout filter, so
    /// a proportional mapping drifts out of phase with it mid-corner.
    pub neck_offset_x: f32,
    pub neck_offset_y: f32,
    pub neck_offset_z: f32,

    pub sky_occlusion: f32,
    pub rain_intensity: f32,
    pub wind_speed_kmh: f32,
    pub wind_direction_deg: f32,

    pub pos_x: f32,
    pub pos_y: f32,
    pub pos_z: f32,
    /// 0–360, 0 = north.
    pub compass: f32,
    /// Lap progress, 0→1.
    pub spline_position: f32,

    pub headlights_active: bool,
    pub high_beams: bool,
    pub brake_lights_active: bool,

    /// False for remote cars and replays, where the car-level fields above
    /// aren't meaningful.
    pub physics_available: bool,
}

impl From<AcTelemetryFrame> for AcTelemetry {
    fn from(frame: AcTelemetryFrame) -> Self {
        Self {
            time_total_seconds: frame.time_total_seconds,
            day_of_year: frame.day_of_year,
            timestamp: frame.timestamp,
            time_multiplier: frame.time_multiplier,
            sun_angle_deg: frame.sun_angle_deg,
            sun_pitch_deg: frame.sun_pitch_deg,
            light_suggestion: frame.light_suggestion,
            ambient_lighting_multiplier: frame.ambient_lighting_multiplier,
            ambient_occlusion: frame.ambient_occlusion,
            neck_offset_x: frame.neck_offset_x,
            neck_offset_y: frame.neck_offset_y,
            neck_offset_z: frame.neck_offset_z,
            sky_occlusion: frame.sky_occlusion,
            rain_intensity: frame.rain_intensity,
            wind_speed_kmh: frame.wind_speed_kmh,
            wind_direction_deg: frame.wind_direction_deg,
            pos_x: frame.pos_x,
            pos_y: frame.pos_y,
            pos_z: frame.pos_z,
            compass: frame.compass,
            spline_position: frame.spline_position,
            headlights_active: frame.headlights_active,
            high_beams: frame.high_beams,
            brake_lights_active: frame.brake_lights_active,
            physics_available: frame.physics_available,
        }
    }
}

/// Whether the extended stream is usable, and why not when it isn't.
///
/// Three separate conditions, reported separately because each has a
/// different fix: install the game, install the app, start driving.
#[derive(SimpleObject, Default)]
pub struct AcTelemetrySupport {
    /// An Assetto Corsa install was found.
    pub game_installed: bool,
    /// The TyPiQL telemetry Lua app is present in that install.
    pub app_installed: bool,
    /// Frames are arriving right now.
    pub connected: bool,
    pub reason: Option<String>,
}

#[derive(Default)]
pub struct AcTelemetryQuery;

#[Object]
impl AcTelemetryQuery {
    /// Whether a dashboard can rely on the extended AC telemetry.
    ///
    /// Meant to be queried before subscribing, so a dashboard can fall back
    /// to plain telemetry rather than sitting on a stream that will never
    /// produce anything.
    async fn ac_telemetry_support(&self) -> AcTelemetrySupport {
        let paths = match crate::ac_capture::paths::CapturePaths::resolve(None, None) {
            Ok(paths) => paths,
            Err(reason) => {
                return AcTelemetrySupport {
                    reason: Some(reason),
                    ..Default::default()
                }
            }
        };

        let app_installed = ac_telemetry::install::is_installed(&paths);
        let connected = ac_telemetry::is_connected();
        AcTelemetrySupport {
            game_installed: true,
            app_installed,
            connected,
            reason: if !app_installed {
                Some("The TyPiQL telemetry app isn't installed in Assetto Corsa yet.".into())
            } else if !connected {
                Some("Installed, but no frames are arriving — is the game running?".into())
            } else {
                None
            },
        }
    }

    /// The most recent frame, if one arrived recently.
    async fn ac_telemetry_snapshot(&self) -> Option<AcTelemetry> {
        ac_telemetry::latest().map(AcTelemetry::from)
    }
}

#[derive(Default)]
pub struct AcTelemetryMutation;

#[Object]
impl AcTelemetryMutation {
    /// Installs (or refreshes) the telemetry Lua app inside Assetto Corsa.
    ///
    /// Explicit rather than automatic: this writes a script into the user's
    /// game that runs on every launch and opens a network connection. That
    /// should be something they turn on, not something that appears because
    /// they opened a settings page.
    async fn install_ac_telemetry_app(&self, _ctx: &Context<'_>) -> GqlResult<bool> {
        let paths = crate::ac_capture::paths::CapturePaths::resolve(None, None)
            .map_err(async_graphql::Error::new)?;
        ac_telemetry::install::install(&paths).map_err(async_graphql::Error::new)?;
        Ok(true)
    }

    async fn uninstall_ac_telemetry_app(&self, _ctx: &Context<'_>) -> GqlResult<bool> {
        let paths = crate::ac_capture::paths::CapturePaths::resolve(None, None)
            .map_err(async_graphql::Error::new)?;
        ac_telemetry::install::uninstall(&paths).map_err(async_graphql::Error::new)?;
        Ok(true)
    }
}

/// Builds the stream behind the `acTelemetry` subscription.
///
/// Lives here next to the type it yields, but is driven from
/// `SubscriptionRoot` in `graphql/mod.rs` — the schema macro takes a single
/// subscription root, so every subscription has to hang off that one type.
///
/// Polled from the stored latest frame on an interval rather than pushed per
/// arrival, matching how `telemetry` and `dashboardUpdates` already work:
/// consumers render at screen rate, so delivering every inbound frame would
/// only queue work they'd discard. Yields `None` while nothing is arriving,
/// so a subscriber can tell "not running" from "running but stationary"
/// without a second query.
pub fn stream(rate_hz: u32) -> impl Stream<Item = Option<AcTelemetry>> {
    let period = Duration::from_millis((1000 / rate_hz.clamp(1, 60)) as u64);
    IntervalStream::new(tokio::time::interval(period))
        .map(|_| ac_telemetry::latest().map(AcTelemetry::from))
}
