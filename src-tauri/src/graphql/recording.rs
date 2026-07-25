use crate::telemetry::recording as rec;
use crate::telemetry::types::{TelemetryFrame, TyreData};
use crate::typiql_types::{Recording, RecordingFrame, RecordingFrameInput, RecordingInput};
use async_graphql::{Context, MaybeUndefined, Object, Result as GqlResult};
use std::time::{SystemTime, UNIX_EPOCH};
use typiql::{
    resolve_add, resolve_add_many, resolve_list, resolve_remove, resolve_update, FieldFilter,
    FilterOp, Location,
};

fn now_unix_secs() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

/// Flattens one captured frame into a storable `RecordingFrame` row — the
/// inverse of `unflatten_frame` below. `tyres` is always `[FL, FR, RL, RR]`
/// per `TelemetryFrame`'s own doc comment.
fn flatten_frame(recording_id: &str, frame_index: i32, f: TelemetryFrame) -> RecordingFrame {
    let [fl, fr, rl, rr] = [
        f.tyres.first().cloned().unwrap_or(zero_tyre()),
        f.tyres.get(1).cloned().unwrap_or(zero_tyre()),
        f.tyres.get(2).cloned().unwrap_or(zero_tyre()),
        f.tyres.get(3).cloned().unwrap_or(zero_tyre()),
    ];
    RecordingFrame {
        id: uuid::Uuid::new_v4().to_string(),
        recording_id: recording_id.to_string(),
        frame_index,
        sim_status: f.sim_status,
        simon: f.simon,
        car: f.car,
        track: f.track,
        driver: f.driver,
        tyre_compound: f.tyre_compound,
        g_lat: f.g_lat,
        g_lon: f.g_lon,
        g_vert: f.g_vert,
        heading: f.heading,
        pitch: f.pitch,
        roll: f.roll,
        speed: f.speed,
        rpm: f.rpm,
        max_rpm: f.max_rpm,
        idle_rpm: f.idle_rpm,
        gear: f.gear,
        max_gears: f.max_gears,
        throttle: f.throttle,
        brake: f.brake,
        clutch: f.clutch,
        steering: f.steering,
        handbrake: f.handbrake,
        abs: f.abs,
        brake_bias: f.brake_bias,
        fuel: f.fuel,
        fuel_capacity: f.fuel_capacity,
        turbo_boost: f.turbo_boost,
        turbo_pct: f.turbo_pct,
        fl_temp: fl.temp,
        fl_pressure: fl.pressure,
        fl_slip_ratio: fl.slip_ratio,
        fl_slip_angle: fl.slip_angle,
        fl_wear: fl.wear,
        fl_brake_temp: fl.brake_temp,
        fl_rps: fl.rps,
        fl_diameter: fl.diameter,
        fr_temp: fr.temp,
        fr_pressure: fr.pressure,
        fr_slip_ratio: fr.slip_ratio,
        fr_slip_angle: fr.slip_angle,
        fr_wear: fr.wear,
        fr_brake_temp: fr.brake_temp,
        fr_rps: fr.rps,
        fr_diameter: fr.diameter,
        rl_temp: rl.temp,
        rl_pressure: rl.pressure,
        rl_slip_ratio: rl.slip_ratio,
        rl_slip_angle: rl.slip_angle,
        rl_wear: rl.wear,
        rl_brake_temp: rl.brake_temp,
        rl_rps: rl.rps,
        rl_diameter: rl.diameter,
        rr_temp: rr.temp,
        rr_pressure: rr.pressure,
        rr_slip_ratio: rr.slip_ratio,
        rr_slip_angle: rr.slip_angle,
        rr_wear: rr.wear,
        rr_brake_temp: rr.brake_temp,
        rr_rps: rr.rps,
        rr_diameter: rr.diameter,
        air_temp: f.air_temp,
        track_temp: f.track_temp,
        air_density: f.air_density,
        lap: f.lap,
        position: f.position,
        num_laps: f.num_laps,
        num_cars: f.num_cars,
        course_flag: f.course_flag,
        lap_is_valid: f.lap_is_valid,
        in_pit: f.in_pit,
        current_lap_seconds: f.current_lap_seconds,
        last_lap_seconds: f.last_lap_seconds,
        sector1_time: f.sector1_time,
        sector2_time: f.sector2_time,
    }
}

fn zero_tyre() -> TyreData {
    TyreData {
        temp: 0.0,
        pressure: 0.0,
        slip_ratio: 0.0,
        slip_angle: 0.0,
        wear: 0.0,
        brake_temp: 0.0,
        rps: 0.0,
        diameter: 0.0,
    }
}

/// Reassembles a stored `RecordingFrame` row back into the `TelemetryFrame`
/// shape playback (`telemetry/recording.rs`) and the rest of the live
/// telemetry path already understand — the inverse of `flatten_frame`.
fn unflatten_frame(r: RecordingFrame) -> TelemetryFrame {
    TelemetryFrame {
        sim_status: r.sim_status,
        simon: r.simon,
        car: r.car,
        track: r.track,
        driver: r.driver,
        tyre_compound: r.tyre_compound,
        g_lat: r.g_lat,
        g_lon: r.g_lon,
        g_vert: r.g_vert,
        heading: r.heading,
        pitch: r.pitch,
        roll: r.roll,
        speed: r.speed,
        rpm: r.rpm,
        max_rpm: r.max_rpm,
        idle_rpm: r.idle_rpm,
        gear: r.gear,
        max_gears: r.max_gears,
        throttle: r.throttle,
        brake: r.brake,
        clutch: r.clutch,
        steering: r.steering,
        handbrake: r.handbrake,
        abs: r.abs,
        brake_bias: r.brake_bias,
        fuel: r.fuel,
        fuel_capacity: r.fuel_capacity,
        turbo_boost: r.turbo_boost,
        turbo_pct: r.turbo_pct,
        tyres: vec![
            TyreData {
                temp: r.fl_temp,
                pressure: r.fl_pressure,
                slip_ratio: r.fl_slip_ratio,
                slip_angle: r.fl_slip_angle,
                wear: r.fl_wear,
                brake_temp: r.fl_brake_temp,
                rps: r.fl_rps,
                diameter: r.fl_diameter,
            },
            TyreData {
                temp: r.fr_temp,
                pressure: r.fr_pressure,
                slip_ratio: r.fr_slip_ratio,
                slip_angle: r.fr_slip_angle,
                wear: r.fr_wear,
                brake_temp: r.fr_brake_temp,
                rps: r.fr_rps,
                diameter: r.fr_diameter,
            },
            TyreData {
                temp: r.rl_temp,
                pressure: r.rl_pressure,
                slip_ratio: r.rl_slip_ratio,
                slip_angle: r.rl_slip_angle,
                wear: r.rl_wear,
                brake_temp: r.rl_brake_temp,
                rps: r.rl_rps,
                diameter: r.rl_diameter,
            },
            TyreData {
                temp: r.rr_temp,
                pressure: r.rr_pressure,
                slip_ratio: r.rr_slip_ratio,
                slip_angle: r.rr_slip_angle,
                wear: r.rr_wear,
                brake_temp: r.rr_brake_temp,
                rps: r.rr_rps,
                diameter: r.rr_diameter,
            },
        ],
        air_temp: r.air_temp,
        track_temp: r.track_temp,
        air_density: r.air_density,
        lap: r.lap,
        position: r.position,
        num_laps: r.num_laps,
        num_cars: r.num_cars,
        course_flag: r.course_flag,
        lap_is_valid: r.lap_is_valid,
        in_pit: r.in_pit,
        current_lap_seconds: r.current_lap_seconds,
        last_lap_seconds: r.last_lap_seconds,
        sector1_time: r.sector1_time,
        sector2_time: r.sector2_time,
    }
}

#[derive(Default)]
pub struct RecordingControlMutation;

#[Object]
impl RecordingControlMutation {
    /// Creates the metadata row and arms the background poller — the row
    /// exists (with frameCount 0) for the whole duration of the recording,
    /// same "create up front" shape as add_dashboard.
    async fn start_recording(
        &self,
        ctx: &Context<'_>,
        name: String,
        sample_rate_hz: f32,
    ) -> GqlResult<Recording> {
        if rec::is_recording() {
            return Err(async_graphql::Error::new(
                "A recording is already in progress",
            ));
        }

        let entry = RecordingInput {
            name: MaybeUndefined::Value(name),
            created_at: MaybeUndefined::Value(now_unix_secs()),
            duration_ms: MaybeUndefined::Value(0),
            frame_count: MaybeUndefined::Value(0),
            sample_rate_hz: MaybeUndefined::Value(sample_rate_hz),
            car: MaybeUndefined::Undefined,
        };
        let created = resolve_add::<Recording>(ctx, entry).await?;
        rec::start(created.id.clone(), sample_rate_hz);
        Ok(created)
    }

    /// Stops the active recording (if any), bulk-inserts its frames as
    /// `RecordingFrame` rows (DuckDB), and updates the metadata row's
    /// duration/frameCount/car.
    async fn stop_recording(&self, ctx: &Context<'_>) -> GqlResult<Option<Recording>> {
        let adapter = crate::graphql::default_adapter(ctx)?;
        let Some((id, frames)) = rec::stop() else {
            return Ok(None);
        };

        let Some(row_val) = adapter
            .get_one(Location::Named("recordings".into()), "id", &id)
            .await
        else {
            return Ok(None);
        };
        let row: Recording = serde_json::from_value(row_val)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;

        let duration_ms = ((frames.len() as f64 / row.sample_rate_hz as f64) * 1000.0) as i64;
        let car = frames
            .iter()
            .find(|f| !f.car.is_empty())
            .map(|f| f.car.clone());
        let frame_count = frames.len() as i32;

        let recording_frames: Vec<RecordingFrame> = frames
            .into_iter()
            .enumerate()
            .map(|(i, f)| flatten_frame(&id, i as i32, f))
            .collect();
        if !recording_frames.is_empty() {
            resolve_add_many::<RecordingFrame>(ctx, recording_frames).await?;
        }

        // Keys here must match Recording's own Rust (snake_case) field names,
        // not the camelCase GraphQL schema names — the JSON adapter stores
        // and merges raw serde output, and async-graphql's camelCasing only
        // applies at the GraphQL API boundary, not to storage.
        let patch = serde_json::json!({
            "duration_ms": duration_ms,
            "frame_count": frame_count,
            "car": car,
        });
        let updated = adapter
            .update(Location::Named("recordings".into()), "id", &id, patch)
            .await;
        Ok(updated.and_then(|v| serde_json::from_value(v).ok()))
    }

    /// Loads a recording's frames (ordered by frameIndex) and arms
    /// playback — every telemetry subscriber (existing pollers in
    /// graphql/mod.rs) picks this up transparently on their next tick, no
    /// per-client wiring needed.
    async fn play_recording(&self, ctx: &Context<'_>, id: String) -> GqlResult<bool> {
        let adapter = crate::graphql::default_adapter(ctx)?;

        let Some(row_val) = adapter
            .get_one(Location::Named("recordings".into()), "id", &id)
            .await
        else {
            return Ok(false);
        };
        let row: Recording = serde_json::from_value(row_val)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;

        let mut recording_frames = resolve_list::<RecordingFrame>(
            ctx,
            vec![FieldFilter {
                field: "recording_id".to_string(),
                op: FilterOp::Eq,
                value: serde_json::Value::String(id),
            }],
        )
        .await?;
        recording_frames.sort_by_key(|f| f.frame_index);

        if recording_frames.is_empty() {
            return Ok(false);
        }
        let frames: Vec<TelemetryFrame> =
            recording_frames.into_iter().map(unflatten_frame).collect();
        rec::play(row.id.clone(), frames, row.sample_rate_hz);
        Ok(true)
    }

    async fn stop_playback(&self) -> bool {
        rec::stop_playback();
        true
    }

    /// Creates a `Recording` + its `RecordingFrame` rows from a previously
    /// exported CSV, parsed client-side into `framesJson` (a JSON array of
    /// per-frame field objects — see `chartUtils.ts`'s `parseImportedCsv`).
    /// Export is inherently partial (only whatever fields were checked in
    /// the legend at export time, plus `sampleRateHz`/`car` encoded as
    /// metadata header lines rather than per-row columns — see
    /// `toCsv`/`parseImportedCsv`), so this is a best-effort round-trip, not
    /// a lossless one: any `RecordingFrame` field absent from a given
    /// object — including `simStatus`/`courseFlag`, which the chart export
    /// re-encodes as plot-friendly numeric codes the frontend deliberately
    /// does *not* forward here rather than risk deserializing garbage into
    /// those enums — just defaults (`#[serde(default)]`, see typiql-macros'
    /// struct_fields codegen), the same as any other partial insert.
    async fn import_recording(
        &self,
        ctx: &Context<'_>,
        name: String,
        sample_rate_hz: f32,
        car: Option<String>,
        frames_json: String,
    ) -> GqlResult<Recording> {
        let raw_frames: Vec<serde_json::Value> = serde_json::from_str(&frames_json)
            .map_err(|e| async_graphql::Error::new(format!("invalid frames JSON: {e}")))?;
        if raw_frames.is_empty() {
            return Err(async_graphql::Error::new("no frames to import"));
        }

        // `RecordingFrame::id` is its key field, so — unlike every other
        // (non-key) field — it has no `#[serde(default)]` and deserializing
        // a row without one fails outright; a CSV export never carries the
        // original row id at all, so inject a throwaway placeholder here
        // before deserializing (overwritten with a real UUID right after,
        // same as every other insert path). `frames_json`'s keys are
        // expected in Rust's own snake_case (matching RecordingFrame's
        // field names, no `#[serde(rename)]` on this type) — see
        // chartUtils.ts's `parseImportedCsv`, which converts the CSV's
        // camelCase GraphQL-boundary column names back to snake_case for
        // exactly this reason (same rule as any other hand-built JSON patch
        // in this app: storage/import payloads use Rust field names, only
        // the GraphQL API boundary itself is camelCase).
        let mut recording_frames: Vec<RecordingFrame> = raw_frames
            .into_iter()
            .filter_map(|mut v| {
                if let serde_json::Value::Object(map) = &mut v {
                    map.entry("id")
                        .or_insert_with(|| serde_json::Value::String(String::new()));
                }
                serde_json::from_value(v).ok()
            })
            .collect();
        if recording_frames.is_empty() {
            return Err(async_graphql::Error::new(
                "no valid frames found in the imported data",
            ));
        }

        let entry = RecordingInput {
            name: MaybeUndefined::Value(name),
            created_at: MaybeUndefined::Value(now_unix_secs()),
            duration_ms: MaybeUndefined::Value(
                ((recording_frames.len() as f64 / sample_rate_hz as f64) * 1000.0) as i64,
            ),
            frame_count: MaybeUndefined::Value(recording_frames.len() as i32),
            sample_rate_hz: MaybeUndefined::Value(sample_rate_hz),
            car: car
                .map(MaybeUndefined::Value)
                .unwrap_or(MaybeUndefined::Undefined),
        };
        let created = resolve_add::<Recording>(ctx, entry).await?;

        for (i, frame) in recording_frames.iter_mut().enumerate() {
            frame.id = uuid::Uuid::new_v4().to_string();
            frame.recording_id = created.id.clone();
            frame.frame_index = i as i32;
        }
        resolve_add_many::<RecordingFrame>(ctx, recording_frames).await?;

        Ok(created)
    }

    /// Permanently trims a recording down to just the `[lo, hi]` frame-index
    /// window — every frame outside it is deleted, and the kept frames are
    /// reindexed to start at 0 (so the cropped recording behaves exactly
    /// like a freshly-recorded one of that length: window sliders, CSV
    /// export frame numbering, and duration all derive from `frame_index`
    /// starting at 0). Destructive and irreversible, which is why the
    /// frontend gates this behind a confirmation dialog rather than calling
    /// it directly off a slider change.
    async fn crop_recording(
        &self,
        ctx: &Context<'_>,
        id: String,
        lo: i32,
        hi: i32,
    ) -> GqlResult<Option<Recording>> {
        let adapter = crate::graphql::default_adapter(ctx)?;

        let mut recording_frames = resolve_list::<RecordingFrame>(
            ctx,
            vec![FieldFilter {
                field: "recording_id".to_string(),
                op: FilterOp::Eq,
                value: serde_json::Value::String(id.clone()),
            }],
        )
        .await?;
        recording_frames.sort_by_key(|f| f.frame_index);

        for frame in recording_frames
            .iter()
            .filter(|f| f.frame_index < lo || f.frame_index > hi)
        {
            resolve_remove::<RecordingFrame>(ctx, frame.id.clone()).await?;
        }

        let kept: Vec<&RecordingFrame> = recording_frames
            .iter()
            .filter(|f| f.frame_index >= lo && f.frame_index <= hi)
            .collect();
        for (new_index, frame) in kept.iter().enumerate() {
            if frame.frame_index != new_index as i32 {
                let patch: RecordingFrameInput =
                    serde_json::from_value(serde_json::json!({ "frame_index": new_index as i32 }))
                        .map_err(|e| async_graphql::Error::new(e.to_string()))?;
                resolve_update::<RecordingFrame>(ctx, frame.id.clone(), patch).await?;
            }
        }

        let Some(row_val) = adapter
            .get_one(Location::Named("recordings".into()), "id", &id)
            .await
        else {
            return Ok(None);
        };
        let row: Recording = serde_json::from_value(row_val)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        let frame_count = kept.len() as i32;
        let duration_ms = ((frame_count as f64 / row.sample_rate_hz as f64) * 1000.0) as i64;

        let patch = serde_json::json!({ "duration_ms": duration_ms, "frame_count": frame_count });
        let updated = adapter
            .update(Location::Named("recordings".into()), "id", &id, patch)
            .await;
        Ok(updated.and_then(|v| serde_json::from_value(v).ok()))
    }
}
