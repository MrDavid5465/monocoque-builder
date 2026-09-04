pub mod ac_telemetry;
pub mod app_config;
pub mod builtin_templates;
pub mod capture;
pub mod car;
pub mod clients;
pub mod dashboard_entry;
pub mod dashboard_files;
pub mod gamepad;
pub mod huenicorn;
pub mod night_clock;
pub mod recording;
pub mod shaker_dsp;
pub mod templates;
pub mod track_geocode;
pub use ac_telemetry::{AcTelemetryMutation, AcTelemetryQuery};
pub use capture::{CarCaptureMutation, CarCaptureQuery};
pub use car::{CarFileMutation, CarPhotoSyncQuery};
pub use dashboard_entry::DashboardMutation;
pub use gamepad::GamepadMutation;
pub use huenicorn::HuenicornMutation;
pub use night_clock::NightClockMutation;
pub use recording::RecordingControlMutation;
pub use shaker_dsp::{ShakerDspMutation, ShakerDspQuery};
pub use templates::DashTemplateThumbnailMutation;
pub use track_geocode::TrackGeocodeQuery;

use crate::huenicorn::{
    current_channel_colors, display_info, entertainment_configs, huenicorn_status,
    interpolation_info, list_channels, AmbientColorChanged, ChannelColor, ChannelInfo,
    HuenicornDisplayInfo, HuenicornEntertainmentConfigs, HuenicornInterpolationInfo,
    HuenicornSettingsChanged, HuenicornStatus,
};
// Aliased: this module already has its own `gamepad` submodule (the
// GraphQL resolvers), distinct from the device layer being called here.
use crate::gamepad as gamepad_device;
use crate::service_watchdogs::{self, MonocoqueStatus, SimdStatus};
use crate::telemetry::recording as telemetry_recording;
use crate::telemetry::{build_frame, read_simdata, types::TelemetryFrame};
use crate::typiql_types::{
    CarChanged, CarDashPanChanged, DashTemplateChanged, DashboardEntryChanged,
    DeviceDefaultChanged, LfeChannelChanged, MonocoqueSoundDeviceChanged, NightModeChanged,
    PreviewCarChanged, ShakerChannelChanged, ShakerDspChannelChanged,
};
use async_graphql::{Context, Object, SimpleObject, Subscription};
use futures_util::stream::{select, select_all, Stream, StreamExt};
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
    // NightMode/NightClock/PreviewCar/CarDashPan folded in below so a
    // window showing a dashboard needs only ONE persistent subscription
    // instead of four (this one plus standalone night_mode_updates/
    // previewCarChanged/carDashPanChanged) — see dashboard_updates' own doc
    // comment for why that count matters. The standalone subscriptions
    // still exist unchanged for consumers that aren't DashboardDesigner
    // (Cars/DashPanEditor's lone useGlobalNightMode() call, Cars/CarDetail's
    // lone useGlobalPreviewCar() call) — this is an additional way to reach
    // the same events, not a replacement.
    NightMode(NightModeChanged),
    NightClock(NightClockTick),
    PreviewCar(PreviewCarChanged),
    CarDashPan(CarDashPanChanged),
    // Which car a dashboard shows can change without any dashboard edit at
    // all — starring a favourite is the case that exposed this. Event-driven
    // like its neighbours here, so it needs no include flag.
    Car(CarChanged),
    // Replaces Controls.tsx's old 1s recordingStatus poll (fired from every
    // mounted window, since Controls is on the always-present nav bar) — see
    // publish_recording_status' own doc comment for where this gets
    // published from.
    Recording(RecordingStatus),
    // Per-channel Huenicorn colors, published from huenicorn.rs's color
    // poller loop (not a mutation-triggered event like the others above —
    // see AmbientColorChanged's own doc comment).
    AmbientColor(AmbientColorChanged),
    // Assetto Corsa's extended telemetry, for the same reason as the rest:
    // the NeckFX sway consumer would otherwise hold a second always-open
    // subscription alongside this one. Opt-in (see `include_ac_telemetry`)
    // because it's the only member here that carries no meaning for a
    // dashboard not driving motion from it, and at 60Hz it roughly doubles
    // this stream's message rate.
    AcTelemetry(ac_telemetry::AcTelemetry),
    // Huenicorn-relevant settings (enabled/intensity/primary channel),
    // published from update_settings — see HuenicornSettingsChanged's own
    // doc comment.
    HuenicornSettings(HuenicornSettingsChanged),
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
    /// Whether Assetto Corsa is currently disciplining this clock (see
    /// `night_clock::sync_clock_from_game`). Informational only — the clock
    /// is read the same way either way, which is the whole point of
    /// disciplining rather than switching sources. A UI that offers to
    /// configure the simulation can use it to say the game is driving it.
    pub from_game: bool,
    /// Sun elevation in degrees at `sim_time_ms`, negative below the horizon,
    /// or `None` when it can't be known (no track loaded, or no location
    /// configured for it).
    ///
    /// The honest input for a dawn/dusk blend: elevation is what actually
    /// sets sky brightness, so a ramp keyed on it needs no assumption about
    /// where in the transition sunrise falls — which is the assumption that
    /// kept being wrong. Computed server-side (see
    /// `night_clock::current_sun_elevation_deg`) because the frontend has
    /// neither the track's coordinates nor the solar code, and because the
    /// Huenicorn gamma pusher has to work with no frontend at all.
    pub sun_elevation_deg: Option<f64>,
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

/// See `shaker_updates`' own doc comment for why this merge exists.
#[derive(async_graphql::Union, Clone)]
enum ShakerUpdateEvent {
    Device(MonocoqueSoundDeviceChanged),
    Channel(ShakerChannelChanged),
    Dsp(ShakerDspChannelChanged),
    Lfe(LfeChannelChanged),
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
    // Assetto Corsa DISCIPLINES this clock rather than replacing it: while the
    // game is reporting, its time, date and rate are written into the anchor,
    // and the clock is then read from that anchor exactly as it always was.
    //
    // The alternative — returning the game's clock directly and falling back
    // to the simulation when it stops — has a hole in it that shows up
    // constantly in practice: the Lua app dies whenever the player enters the
    // setup menus, so the clock would snap from the real in-game time back to
    // a simulation that had been free-running elsewhere for hours. Cross-fading
    // between two clocks that disagree is not something a dashboard can hide.
    // Disciplining leaves exactly one clock, which keeps running from the last
    // values the game gave it and so bridges those gaps unnoticed.
    let record = match &record {
        Some(record) => night_clock::sync_clock_from_game(adapter, record)
            .await
            .or_else(|| Some(record.clone())),
        None => None,
    };
    if let Some(record) = &record {
        night_clock::maybe_auto_recompute_sun_times(adapter, record).await;
    }

    let synced = crate::ac_telemetry::latest().is_some();
    let sim_time_ms = record
        .and_then(|record| night_clock::current_sim_ms(&record, now))
        .unwrap_or(now);
    let sun_elevation_deg = night_clock::current_sun_elevation_deg(adapter, sim_time_ms).await;
    NightClockTick {
        sim_time_ms,
        real_time_ms: now,
        from_game: synced,
        sun_elevation_deg,
    }
}

/// The game's own instant — date included — as ms since epoch.
///
/// Prefers `timestamp`, which CSP documents as seconds since the epoch *in
/// the track's own timezone rather than UTC0*. That quirk is what makes it
/// directly usable: consumers read the value back with `getUTCHours()` (see
/// `computeSimulatedNightState`), so a track-local epoch yields the game's
/// local time-of-day, and its date along with it. A session set in June 2024
/// then reports June 2024 rather than today's date wearing the game's clock.
///
/// Falls back to placing the time-of-day on today's UTC midnight if the
/// timestamp is missing or implausible — an older CSP, or a frame that
/// arrived before the field was populated. Time-of-day is the part that
/// drives day/night, so it's worth keeping even without a trustworthy date.
///
/// Deliberately not derived from `dayOfYear`: measured against a real
/// session, that field reported 168 for 2024-06-17, which is day 169 — it
/// appears to be 0-based, and the timestamp needs no such guesswork.
pub(super) fn sim_ms_from_game(frame: &crate::ac_telemetry::AcTelemetryFrame, now_ms: f64) -> f64 {
    const MS_PER_DAY: f64 = 86_400_000.0;

    if let Some(timestamp) = frame.session_timestamp() {
        return timestamp as f64 * 1000.0;
    }

    let utc_midnight = (now_ms / MS_PER_DAY).floor() * MS_PER_DAY;
    utc_midnight + frame.time_total_seconds * 1000.0
}

#[derive(SimpleObject, Clone)]
pub struct RecordingStatus {
    pub is_recording: bool,
    pub is_playing: bool,
    pub recording_id: Option<String>,
    pub playing_id: Option<String>,
}

impl RecordingStatus {
    fn current() -> Self {
        RecordingStatus {
            is_recording: telemetry_recording::is_recording(),
            is_playing: telemetry_recording::is_playing(),
            recording_id: telemetry_recording::recording_id(),
            playing_id: telemetry_recording::playing_id(),
        }
    }
}

/// `RecordingStatus` isn't a typiql CRUD type (recording/playback state
/// lives in `telemetry::recording`'s in-process statics, not an adapter
/// table), so unlike NightModeChanged/CarDashPanChanged there's no stock
/// mutation to auto-publish it — `RecordingControlMutation`'s hand-written
/// resolvers (`recording.rs`) call this explicitly after each state change,
/// same manual-publish requirement documented on `night_clock.rs`'s own
/// mutations.
pub fn publish_recording_status() {
    TypiQLBroker::publish(RecordingStatus::current());
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
        RecordingStatus::current()
    }

    async fn huenicorn_status(&self) -> HuenicornStatus {
        huenicorn_status().await
    }

    async fn simd_status(&self) -> SimdStatus {
        service_watchdogs::simd_status()
    }

    async fn monocoque_status(&self) -> MonocoqueStatus {
        service_watchdogs::monocoque_status()
    }

    /// Whether this backend can create the virtual gamepad — see
    /// `gamepad::gamepad_udev_status`. A query rather than a Tauri command
    /// so the browser build gets the same answer as the desktop one; the
    /// backend is the process that would actually open `/dev/uinput`, so it
    /// is also the only one that can answer honestly.
    async fn gamepad_udev_status(&self) -> bool {
        gamepad_device::gamepad_udev_status()
    }

    /// Channel list for the "which channel drives the 360° tint" picker in
    /// AmbientLights/index.tsx.
    async fn huenicorn_channels(&self) -> Vec<ChannelInfo> {
        list_channels().await
    }

    /// Display resolution, subsample candidates, and refresh-rate/
    /// transition-smoothing info for AdvancedHuenicornSettings.tsx and for
    /// ChannelMapper.tsx's aspect-ratio-locked mapping canvas.
    async fn huenicorn_display_info(&self) -> Option<HuenicornDisplayInfo> {
        display_info().await
    }

    /// Available color-interpolation modes, for AdvancedHuenicornSettings.tsx.
    async fn huenicorn_interpolation_info(&self) -> Option<HuenicornInterpolationInfo> {
        interpolation_info().await
    }

    /// Hue entertainment configurations (bridge-side light groupings), for
    /// AdvancedHuenicornSettings.tsx's picker — only rendered client-side
    /// when there's more than one, mirroring Huenicorn's own web UI.
    async fn huenicorn_entertainment_configs(&self) -> Option<HuenicornEntertainmentConfigs> {
        entertainment_configs().await
    }

    /// One-shot current colors, for the live swatch next to that picker —
    /// distinct from the ~30Hz `AmbientColor` subscription event, which only
    /// a kiosk 360 dashboard subscribes to (see `dashboard_updates`'s own
    /// `include_ambient_color` gating).
    async fn huenicorn_current_colors(&self) -> Vec<ChannelColor> {
        current_channel_colors().await
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
    /// Extended, Assetto-Corsa-only telemetry from the in-game Lua app.
    ///
    /// Deliberately separate from `telemetry` above rather than folded into
    /// it: that one is cross-sim and comes from the shared-memory bridge,
    /// while this exists only when AC is running with the TyPiQL app
    /// installed. Merging them would mean a dashboard couldn't tell which
    /// fields it could actually count on. Query `acTelemetrySupport` first to
    /// decide whether to subscribe at all.
    async fn ac_telemetry(
        &self,
        // 60, matching both the Lua app's send rate and screen rate — the
        // NeckFX sway consumers read this inside a requestAnimationFrame loop,
        // where anything slower steps visibly.
        #[graphql(default = 60)] rate_hz: u32,
    ) -> impl Stream<Item = Option<ac_telemetry::AcTelemetry>> {
        ac_telemetry::stream(rate_hz)
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

    /// Replaces the 4 separate `useSubscription`s ShakerMatrix.tsx used to
    /// hold open (monocoqueSoundDeviceChanged, shakerChannelChanged,
    /// shakerDspChannelChanged, lfeChannelChanged) — those, plus the always-on
    /// `dashboardUpdates` subscription mounted globally, put the page one
    /// HTTP/1.1 connection away from Chromium's ~6-per-origin ceiling.
    /// Confirmed live as the cause of "Enable DSP" (and really any mutation
    /// on that page) hanging with no error: the backend answered
    /// `enableShakerDsp` in under 100ms via a bare `curl` issued *while* the
    /// browser's own request for the same mutation was still stuck — the
    /// server was never blocked, only the browser's own connection queue
    /// was. Same class of bug already fixed once for Dashboard Designer
    /// (`liveUpdatesHub.tsx`, commit `ebe3c44`) by merging several
    /// independent subscriptions into one; this does the same merge for
    /// Shakers. The individual auto-generated subscriptions
    /// (`shakerChannelChanged`/etc.) still exist, untouched — this just adds
    /// one more way to reach the same broker-published events.
    async fn shaker_updates(&self) -> impl Stream<Item = ShakerUpdateEvent> {
        let s1 = TypiQLBroker::<MonocoqueSoundDeviceChanged>::subscribe()
            .map(ShakerUpdateEvent::Device)
            .boxed();
        let s2 = TypiQLBroker::<ShakerChannelChanged>::subscribe()
            .map(ShakerUpdateEvent::Channel)
            .boxed();
        let s3 = TypiQLBroker::<ShakerDspChannelChanged>::subscribe()
            .map(ShakerUpdateEvent::Dsp)
            .boxed();
        let s4 = TypiQLBroker::<LfeChannelChanged>::subscribe()
            .map(ShakerUpdateEvent::Lfe)
            .boxed();
        select_all([s1, s2, s3, s4])
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
    ///
    /// `includeNightClock` is a SEPARATE flag, not reused from
    /// includeTelemetry — a caller can legitimately want one without the
    /// other (e.g. Cars/DashPanEditor, via the frontend hub in
    /// liveUpdatesHub.tsx, wants the ~60Hz night-clock tick — it drives that
    /// page's own day/night preview toggle — but never wants telemetry
    /// frames at all, it's not a live dashboard). Defaults to true, matching
    /// night_mode_updates' own unconditional behavior — DashboardDesigner is
    /// the one caller that explicitly ties it to kioskMode, same as
    /// includeTelemetry.
    async fn dashboard_updates(
        &self,
        ctx: &Context<'_>,
        #[graphql(default = true)] include_telemetry: bool,
        #[graphql(default = true)] include_night_clock: bool,
        #[graphql(default = true)] include_ambient_color: bool,
        // Defaults OFF, unlike the others: only a dashboard actually driving
        // NeckFX sway has any use for it, and at 60Hz it would otherwise
        // roughly double this stream's message rate for every window.
        #[graphql(default = false)] include_ac_telemetry: bool,
    ) -> async_graphql::Result<impl Stream<Item = DashboardUpdateEvent>> {
        let adapter = default_adapter(ctx)?;

        let s1 = TypiQLBroker::<DashboardEntryChanged>::subscribe()
            .map(DashboardUpdateEvent::Dashboard)
            .boxed();
        let s2 = TypiQLBroker::<DashTemplateChanged>::subscribe()
            .map(DashboardUpdateEvent::Template)
            .boxed();
        let s3 = TypiQLBroker::<DeviceDefaultChanged>::subscribe()
            .map(DashboardUpdateEvent::DeviceDefault)
            .boxed();
        let s4: std::pin::Pin<Box<dyn Stream<Item = DashboardUpdateEvent> + Send>> =
            if include_telemetry {
                IntervalStream::new(tokio::time::interval(Duration::from_millis(16)))
                    .map(|_| {
                        DashboardUpdateEvent::Telemetry(TelemetryEvent {
                            frame: current_frame(),
                        })
                    })
                    .boxed()
            } else {
                futures_util::stream::empty().boxed()
            };
        // Same NightModeChanged/NightClockTick merge night_mode_updates does
        // on its own — duplicated here (not derived from that subscription)
        // since a GraphQL subscription field can't subscribe to another
        // subscription field internally, only to the underlying
        // TypiQLBroker streams both pull from.
        let s5 = TypiQLBroker::<NightModeChanged>::subscribe()
            .map(DashboardUpdateEvent::NightMode)
            .boxed();
        let s6: std::pin::Pin<Box<dyn Stream<Item = DashboardUpdateEvent> + Send>> =
            if include_night_clock {
                let adapter = adapter.clone();
                IntervalStream::new(tokio::time::interval(Duration::from_millis(16)))
                    .then(move |_| {
                        let adapter = adapter.clone();
                        async move { DashboardUpdateEvent::NightClock(night_clock_tick(&adapter).await) }
                    })
                    .boxed()
            } else {
                futures_util::stream::empty().boxed()
            };
        let s7 = TypiQLBroker::<PreviewCarChanged>::subscribe()
            .map(DashboardUpdateEvent::PreviewCar)
            .boxed();
        let s8 = TypiQLBroker::<CarDashPanChanged>::subscribe()
            .map(DashboardUpdateEvent::CarDashPan)
            .boxed();
        let s13 = TypiQLBroker::<CarChanged>::subscribe()
            .map(DashboardUpdateEvent::Car)
            .boxed();
        let s9 = TypiQLBroker::<RecordingStatus>::subscribe()
            .map(DashboardUpdateEvent::Recording)
            .boxed();
        let s10: std::pin::Pin<Box<dyn Stream<Item = DashboardUpdateEvent> + Send>> =
            if include_ambient_color {
                TypiQLBroker::<AmbientColorChanged>::subscribe()
                    .map(DashboardUpdateEvent::AmbientColor)
                    .boxed()
            } else {
                futures_util::stream::empty().boxed()
            };
        let s11 = TypiQLBroker::<HuenicornSettingsChanged>::subscribe()
            .map(DashboardUpdateEvent::HuenicornSettings)
            .boxed();
        // `flat_map` over the Option rather than mapping it into the union:
        // `ac_telemetry::stream` yields None whenever the game isn't
        // reporting, and a union arm has no way to express "no frame". The
        // consumer treats silence as inactive anyway (its own staleness
        // handling), so dropping the Nones keeps this stream quiet while AC
        // isn't running instead of sending 60 empty events a second.
        let s12: std::pin::Pin<Box<dyn Stream<Item = DashboardUpdateEvent> + Send>> =
            if include_ac_telemetry {
                ac_telemetry::stream(60)
                    .filter_map(|frame| async move { frame.map(DashboardUpdateEvent::AcTelemetry) })
                    .boxed()
            } else {
                futures_util::stream::empty().boxed()
            };

        Ok(futures_util::stream::select_all([
            s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13,
        ]))
    }
}
