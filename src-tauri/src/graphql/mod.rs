pub mod app_config;
pub mod builtin_templates;
pub mod car;
pub mod clients;
pub mod dashboard_entry;
pub mod dashboard_files;
pub mod gamepad;
pub mod recording;
pub mod shaker_dsp;
pub mod templates;
pub use car::{CarFileMutation, CarPhotoSyncQuery};
pub use dashboard_entry::DashboardMutation;
pub use gamepad::GamepadMutation;
pub use recording::RecordingControlMutation;
pub use shaker_dsp::{ShakerDspMutation, ShakerDspQuery};
pub use templates::DashTemplateThumbnailMutation;

use crate::telemetry::recording as telemetry_recording;
use crate::telemetry::{build_frame, read_simdata, types::TelemetryFrame};
use crate::typiql_types::{DashTemplateChanged, DashboardEntryChanged, DeviceDefaultChanged};
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

    async fn dashboard_updates(&self) -> impl Stream<Item = DashboardUpdateEvent> {
        let s1 =
            TypiQLBroker::<DashboardEntryChanged>::subscribe().map(DashboardUpdateEvent::Dashboard);
        let s2 =
            TypiQLBroker::<DashTemplateChanged>::subscribe().map(DashboardUpdateEvent::Template);
        let s3 = TypiQLBroker::<DeviceDefaultChanged>::subscribe()
            .map(DashboardUpdateEvent::DeviceDefault);
        let s4 = IntervalStream::new(tokio::time::interval(Duration::from_millis(16))).map(|_| {
            DashboardUpdateEvent::Telemetry(TelemetryEvent {
                frame: current_frame(),
            })
        });
        select(s4, select(s1, select(s2, s3)))
    }
}
