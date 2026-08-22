pub mod app_config;
pub mod builtin_templates;
pub mod car;
pub mod clients;
pub mod dashboard_entry;
pub mod dashboard_files;
pub mod gamepad;
pub mod night_clock;
pub mod recording;
pub mod shaker_dsp;
pub mod templates;
pub mod track_geocode;
pub use car::{CarFileMutation, CarPhotoSyncQuery};
pub use dashboard_entry::DashboardMutation;
pub use gamepad::GamepadMutation;
pub use night_clock::NightClockMutation;
pub use recording::RecordingControlMutation;
pub use shaker_dsp::{ShakerDspMutation, ShakerDspQuery};
pub use templates::DashTemplateThumbnailMutation;
pub use track_geocode::TrackGeocodeQuery;

use crate::telemetry::recording as telemetry_recording;
use crate::telemetry::{build_frame, read_simdata, types::TelemetryFrame};
use crate::typiql_types::{
    DashTemplateChanged, DashboardEntryChanged, DeviceDefaultChanged, NightModeChanged,
};
use async_graphql::{Context, Object, SimpleObject, Subscription};
use futures_util::stream::{select, Stream, StreamExt};
use std::sync::Arc;
use std::time::Duration;
use tokio_stream::wrappers::IntervalStream;
use typiql::{AdapterMap, TypiQLAdapter, TypiQLBroker};

/// Every hand-written resolver in this app operates on JSON-backed types
/// (Car, Dashboard, templates, clients, shaker DSP config, Recording
/// metadata) — only the macro-generated `RecordingFrame` CRUD (see
/// `typiql_types::RecordingFrame`) uses the `"duckdb"` adapter, and it never
/// needs a hand-written resolver to reach it. So every hand-written resolver
/// that used to do `ctx.data::<Arc<dyn TypiQLAdapter>>()` against the old
/// single-adapter context now goes through this instead of repeating the
/// `"default"`-lookup boilerplate at each of the ~20 call sites.
pub fn default_adapter(ctx: &Context<'_>) -> async_graphql::Result<Arc<dyn TypiQLAdapter>> {
    let adapters = ctx.data::<AdapterMap>()?;
    adapters
        .get("default")
        .cloned()
        .ok_or_else(|| async_graphql::Error::new("no adapter registered under name \"default\""))
}

#[derive(async_graphql::SimpleObject, Clone)]
pub struct TelemetryEvent {
    pub frame: Option<TelemetryFrame>,
}

#[derive(async_graphql::Union, Clone)]
enum DashboardUpdateEvent {
    Dashboard(DashboardEntryChanged),
    Template(DashTemplateChanged),
    DeviceDefault(DeviceDefaultChanged),
    Telemetry(TelemetryEvent),
}

/// One tick of the server-authoritative simulated in-game clock (see
/// `night_clock.rs`). `sim_time_ms`/`real_time_ms` are both ms-since-epoch —
/// `real_time_ms` is always this server's own clock at the moment the tick
/// was computed, included so a future consumer could interpolate between
/// ticks if ever needed, though the current frontend just renders whatever
/// tick arrives most recently (same direct-render convention as the
/// `telemetry` subscription below).
#[derive(async_graphql::SimpleObject, Clone)]
pub struct NightClockTick {
    pub sim_time_ms: f64,
    pub real_time_ms: f64,
}

/// `nightModeUpdates` merges two logically-separate things (the record's
/// own add/update/remove events, and the ~60Hz simulated-clock tick) into
/// ONE subscription connection — deliberately not two independent
/// subscriptions. A browser holds only ~6 concurrent HTTP/1.1 connections
/// per origin, and this app's dashboard pages already keep 1-2 long-lived
/// subscriptions open (dashboardUpdates, this one); a separate always-on
/// nightClock subscription on top of that was enough to starve the pool and
/// hang unrelated mutations mid-request (discovered live: an updateNightMode
/// mutation's request was sent but its response never arrived while a
/// standalone nightClock subscription was also open on the same page). Same
/// merge pattern as `dashboard_updates` below (event-driven broker streams
/// `select()`-ed with an interval stream).
#[derive(async_graphql::Union, Clone)]
enum NightModeUpdateEvent {
    Changed(NightModeChanged),
    Clock(NightClockTick),
}

/// Computes one `NightClockTick` from the current persisted anchor. Reads
/// the adapter directly (not via `resolve_list`, which needs a
/// request-scoped `Context` this per-tick closure has already outlived) —
/// see `night_clock::read_current`/`current_sim_ms`. Falls back to a
/// harmless "sim time == real time" tick when no record exists yet or the
/// anchor isn't fully configured; the client only acts on this when its own
/// `simEnabled` is true, so an unconfigured tick is simply unused.
async fn night_clock_tick(adapter: &Arc<dyn TypiQLAdapter>) -> NightClockTick {
    let now = night_clock::now_ms();
    let record = night_clock::read_current(adapter).await;
    // Reacts to the live telemetry track changing the same way the 360°
    // photo viewer reacts to the car changing — see this function's own
    // doc comment for why it needs a remembered date to do that, since
    // telemetry has no "what date is it in-game" signal of its own.
    if let Some(record) = &record {
        night_clock::maybe_auto_recompute_sun_times(adapter, record).await;
    }
    let sim_time_ms = record
        .and_then(|record| night_clock::current_sim_ms(&record, now))
        .unwrap_or(now);
    NightClockTick {
        sim_time_ms,
        real_time_ms: now,
    }
}

#[derive(SimpleObject)]
pub struct RecordingStatus {
    pub is_recording: bool,
    pub is_playing: bool,
    pub recording_id: Option<String>,
    pub playing_id: Option<String>,
}

/// What every telemetry subscriber/query should currently see: a recorded
/// playback frame if one is active, otherwise a live read — identical to
/// the pre-recording-feature behavior when no playback is armed.
fn current_frame() -> Option<TelemetryFrame> {
    telemetry_recording::current_playback_frame().or_else(|| read_simdata().map(build_frame))
}

#[derive(Default)]
pub struct QueryRoot;

#[Object]
impl QueryRoot {
    async fn telemetry_snapshot(&self) -> Option<TelemetryFrame> {
        current_frame()
    }

    async fn recording_status(&self) -> RecordingStatus {
        RecordingStatus {
            is_recording: telemetry_recording::is_recording(),
            is_playing: telemetry_recording::is_playing(),
            recording_id: telemetry_recording::recording_id(),
            playing_id: telemetry_recording::playing_id(),
        }
    }

    /// One-shot read of the current simulated-clock tick — same rationale
    /// as `telemetry_snapshot` above (a plain query mirroring what the
    /// subscription pushes) so a freshly-mounted consumer (the day/night
    /// popup) can render the real current time immediately on open instead
    /// of showing a placeholder until the subscription's first push
    /// arrives.
    async fn night_clock_snapshot(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<NightClockTick> {
        let adapter = default_adapter(ctx)?;
        Ok(night_clock_tick(&adapter).await)
    }

    /// Every USB device currently visible to the OS — for the Shift Lights
    /// "Device ID" picker (see device_enumeration.rs's own doc comment for
    /// the devid format). Read-only sysfs enumeration on Linux, no special
    /// permissions needed just to list.
    async fn get_usb_devices(
        &self,
    ) -> async_graphql::Result<Vec<crate::device_enumeration::UsbDeviceInfo>> {
        crate::device_enumeration::list_usb_devices().map_err(async_graphql::Error::new)
    }

    /// Every serial (tty) device currently visible to the OS, resolved via
    /// `/dev/serial/by-id` — for the Device Path combobox on Shift Lights/
    /// LED Controllers/SimWind rows.
    async fn get_serial_devices(&self) -> Vec<crate::device_enumeration::SerialDeviceInfo> {
        crate::device_enumeration::list_serial_devices()
    }
}

#[derive(Default)]
pub struct SubscriptionRoot;

#[Subscription]
impl SubscriptionRoot {
    async fn tick(&self) -> impl Stream<Item = i32> {
        IntervalStream::new(tokio::time::interval(Duration::from_secs(1)))
            .enumerate()
            .map(|(i, _)| i as i32)
    }
    async fn telemetry(&self) -> impl Stream<Item = Option<TelemetryFrame>> {
        IntervalStream::new(tokio::time::interval(Duration::from_millis(33)))
            .map(|_| current_frame())
    }

    /// Replaces the macro-generated `nightModeChanged` subscription as the
    /// one connection every NightMode consumer subscribes to — record
    /// add/update/remove events plus a ~60Hz server-authoritative
    /// simulated-clock tick (see `night_clock.rs`), merged (see
    /// `NightModeUpdateEvent`'s doc comment for why this isn't two separate
    /// subscriptions). Every subscriber's clock tick is computed from the
    /// same persisted anchor + this server's own clock, fixing a previous
    /// bug where each kiosk device extrapolated independently from its own
    /// local clock and drifted apart from other devices over hours.
    async fn night_mode_updates(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<impl Stream<Item = NightModeUpdateEvent>> {
        let adapter = default_adapter(ctx)?;
        let s1 = TypiQLBroker::<NightModeChanged>::subscribe().map(NightModeUpdateEvent::Changed);
        // 16ms (~60Hz), matching `telemetry`/`dashboard_updates`'s own tick
        // rate — so the simulated clock display advances as smoothly as the
        // telemetry-driven gauges rather than visibly stepping once a
        // second. `maybe_auto_recompute_sun_times`'s own expensive path
        // (TrackLocation table scan + write) only actually runs on a track
        // CHANGE, not every tick, so this doesn't 60x the adapter load — see
        // that function's own doc comment.
        let s2 =
            IntervalStream::new(tokio::time::interval(Duration::from_millis(16))).then(move |_| {
                let adapter = adapter.clone();
                async move { NightModeUpdateEvent::Clock(night_clock_tick(&adapter).await) }
            });
        Ok(select(s1, s2))
    }

    /// `includeTelemetry` defaults to true (unchanged behavior for kiosk/
    /// live view). The dashboard designer passes false while editing — it
    /// has no use for a live telemetry frame there (its preview data comes
    /// from PlaybackPanel's manual/sweep test values instead, see
    /// DashboardDesigner/index.tsx's `baseTelemetry`), and merely receiving
    /// this ~60Hz stream (even with the frontend ignoring its payload) was
    /// enough incoming-message volume on its own to trip React's nested-
    /// update limit in the editor — confirmed live, independent of night
    /// mode or any other subscription. This can't just be left to the
    /// frontend's `skip` option because s1/s2/s3 (dashboard/template/
    /// device-default change events) still need to stay live while editing;
    /// only the telemetry sub-stream needs to be conditionally excluded
    /// from this merged subscription, not the whole thing.
    async fn dashboard_updates(
        &self,
        #[graphql(default = true)] include_telemetry: bool,
    ) -> impl Stream<Item = DashboardUpdateEvent> {
        let s1 =
            TypiQLBroker::<DashboardEntryChanged>::subscribe().map(DashboardUpdateEvent::Dashboard);
        let s2 =
            TypiQLBroker::<DashTemplateChanged>::subscribe().map(DashboardUpdateEvent::Template);
        let s3 = TypiQLBroker::<DeviceDefaultChanged>::subscribe()
            .map(DashboardUpdateEvent::DeviceDefault);
        let s4: std::pin::Pin<Box<dyn Stream<Item = DashboardUpdateEvent> + Send>> =
            if include_telemetry {
                Box::pin(
                    IntervalStream::new(tokio::time::interval(Duration::from_millis(16))).map(
                        |_| {
                            DashboardUpdateEvent::Telemetry(TelemetryEvent {
                                frame: current_frame(),
                            })
                        },
                    ),
                )
            } else {
                Box::pin(futures_util::stream::empty())
            };
        select(s4, select(s1, select(s2, s3)))
    }
}
