use crate::typiql_types::{NightMode, NightModeChanged, NightModeInput, TrackLocation};
use async_graphql::{Context, Object, Result as GqlResult};
use serde_json::json;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use typiql::{resolve_add, resolve_update, TypiQLAdapter, TypiQLBroker, TypiQLType};

pub fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
        * 1000.0
}

/// Reads the current singleton `NightMode` row directly off the adapter, not
/// through `resolve_list` (which needs a request-scoped `Context`) — this is
/// also called from the `nightClock` subscription's per-tick stream closure
/// (`graphql/mod.rs`), which outlives any single request's `Context`.
pub async fn read_current(adapter: &Arc<dyn TypiQLAdapter>) -> Option<NightMode> {
    adapter
        .get_many(NightMode::collection_name().into(), vec![])
        .await
        .into_iter()
        .next()
        .and_then(|v| serde_json::from_value(v).ok())
}

/// Current simulated time (ms since epoch), extrapolated from the record's
/// persisted anchor at the given real "now". Callers always pass the
/// server's own clock as `now_ms` — never a client-supplied time — which is
/// what keeps every subscriber's simulated clock in agreement (the previous
/// design let each client extrapolate from its own local clock instead,
/// which drifted apart from other devices over hours).
pub fn current_sim_ms(record: &NightMode, now_ms: f64) -> Option<f64> {
    let base_sim_ms = record.sim_base_sim_time_ms?;
    let base_real_ms = record.sim_base_real_time?;
    let speed = record.sim_speed_percent.unwrap_or(100.0) / 100.0;
    Some(base_sim_ms + (now_ms - base_real_ms) * speed)
}

fn to_gql_err(e: impl std::fmt::Display) -> async_graphql::Error {
    async_graphql::Error::new(e.to_string())
}

/// Finds the `TrackLocation` whose `raw_track_ids` lists `track` — reads the
/// adapter directly (not `resolve_list`, which needs a request-scoped
/// `Context`) so this is usable from both the mutation below AND the
/// ctx-free background tick (`maybe_auto_recompute_sun_times`).
async fn find_track_location(
    adapter: &Arc<dyn TypiQLAdapter>,
    track: &str,
) -> Option<TrackLocation> {
    adapter
        .get_many(TrackLocation::collection_name().into(), vec![])
        .await
        .into_iter()
        .find_map(|v| {
            let loc: TrackLocation = serde_json::from_value(v).ok()?;
            let ids: Vec<String> = serde_json::from_str(&loc.raw_track_ids).ok()?;
            ids.iter().any(|id| id == track).then_some(loc)
        })
}

/// Current live telemetry track id, or `None` if the sim isn't running / no
/// track is loaded.
fn live_track() -> Option<String> {
    crate::telemetry::read_simdata()
        .map(|d| d.track_name().to_string())
        .filter(|t| !t.is_empty())
}

/// Reacts to the live track changing the same way the 360° photo viewer
/// reacts to the car changing — but sunrise/sunset need a calendar date as
/// well as a location, and telemetry has no "what date is it in-game"
/// signal to react to. So this reuses whichever date was last picked via
/// `setSunriseSunsetFromDate` (`sim_sunrise_sunset_date`) rather than asking
/// again: if the live track differs from `sim_last_computed_track` and
/// resolves to a known `TrackLocation`, recompute and persist
/// sunrise/sunset for that same remembered date. No-ops quietly (leaving
/// whatever sunrise/sunset are already set) if there's no remembered date
/// yet (nothing manually computed before), no live track, or the live track
/// isn't linked to a location — this runs on every clock tick, so it must
/// stay silent rather than erroring like the mutation does.
///
/// Read/write here goes straight through the adapter (`TypiQLAdapter::update`
/// takes no `Context`) since this is called from the `nightClock`
/// subscription's per-tick closure, which has outlived any request-scoped
/// `Context` by the time it runs.
pub async fn maybe_auto_recompute_sun_times(adapter: &Arc<dyn TypiQLAdapter>, record: &NightMode) {
    let Some(last_date) = record.sim_sunrise_sunset_date.as_deref() else {
        return;
    };
    let Some((year, month, day)) = crate::sun_position::parse_iso_date(last_date) else {
        return;
    };
    let Some(track) = live_track() else { return };
    if record.sim_last_computed_track.as_deref() == Some(track.as_str()) {
        return;
    }
    let Some(location) = find_track_location(adapter, &track).await else {
        return;
    };
    let Some((sunrise_min, sunset_min)) = crate::sun_position::compute_sunrise_sunset(
        year,
        month,
        day,
        location.latitude,
        location.longitude,
    ) else {
        return;
    };

    let patch = json!({
        "sim_sunrise": crate::sun_position::format_hhmm(sunrise_min),
        "sim_sunset": crate::sun_position::format_hhmm(sunset_min),
        "sim_last_computed_track": track,
    });
    let Some(updated_val) = adapter
        .update(
            NightMode::collection_name().into(),
            NightMode::key_field(),
            &record.id,
            patch,
        )
        .await
    else {
        return;
    };
    if let Ok(updated) = serde_json::from_value::<NightMode>(updated_val) {
        TypiQLBroker::publish(NightModeChanged {
            operation_name: "update".to_string(),
            value: updated,
        });
    }
}

/// Lazily creates the singleton `NightMode` record if none exists yet —
/// mirrors the existing convention already used by the frontend's own
/// addNightMode/updateNightMode fallback (see `useGlobalNightMode.ts`'s
/// `save()`).
async fn ensure_record(
    adapter: &Arc<dyn TypiQLAdapter>,
    ctx: &Context<'_>,
    now: f64,
) -> GqlResult<NightMode> {
    if let Some(record) = read_current(adapter).await {
        return Ok(record);
    }
    let values: NightModeInput = serde_json::from_value(json!({
        "is_night": false,
        "sim_enabled": false,
        "sim_base_sim_time_ms": now,
        "sim_base_real_time": now,
        "sim_speed_percent": 100.0,
    }))
    .map_err(to_gql_err)?;
    let created = resolve_add::<NightMode>(ctx, values).await?;
    TypiQLBroker::publish(NightModeChanged {
        operation_name: "add".to_string(),
        value: created.clone(),
    });
    Ok(created)
}

/// Rebases the simulated-clock anchor to `real_ms` (always server-now):
/// `sim_base_sim_time_ms = sim_ms`, `sim_base_real_time = real_ms`, and
/// optionally `sim_speed_percent`. Every mutation that changes what the
/// simulated clock reads, or how fast it moves, goes through this — rebasing
/// on every such change (not just time-adjusts) avoids a discontinuity where
/// a speed change would otherwise retroactively reinterpret time that
/// already elapsed under the old speed.
async fn save_anchor(
    ctx: &Context<'_>,
    id: &str,
    sim_ms: f64,
    real_ms: f64,
    speed_percent: Option<f64>,
) -> GqlResult<NightMode> {
    let mut patch = json!({
        "sim_base_sim_time_ms": sim_ms,
        "sim_base_real_time": real_ms,
    });
    if let Some(speed) = speed_percent {
        patch["sim_speed_percent"] = json!(speed);
    }
    let update: NightModeInput = serde_json::from_value(patch).map_err(to_gql_err)?;
    let updated = resolve_update::<NightMode>(ctx, id.to_string(), update)
        .await?
        .ok_or_else(|| async_graphql::Error::new("NightMode record disappeared mid-update"))?;
    TypiQLBroker::publish(NightModeChanged {
        operation_name: "update".to_string(),
        value: updated.clone(),
    });
    Ok(updated)
}

#[derive(Default)]
pub struct NightClockMutation;

#[Object]
impl NightClockMutation {
    /// Nudges the simulated in-game clock by a fixed interval (the
    /// dashboard's +/-1m/+/-5m/.../+/-12h buttons) — rebases the anchor to
    /// server-now so the shift applies immediately.
    async fn adjust_night_clock_time(
        &self,
        ctx: &Context<'_>,
        delta_minutes: f64,
    ) -> GqlResult<NightMode> {
        let adapter = crate::graphql::default_adapter(ctx)?;
        let now = now_ms();
        let record = ensure_record(&adapter, ctx, now).await?;
        let sim_ms = current_sim_ms(&record, now).unwrap_or(now);
        let new_sim_ms = sim_ms + delta_minutes * 60_000.0;
        save_anchor(ctx, &record.id, new_sim_ms, now, None).await
    }

    /// Sets the day/night cycle length in real-world hours (e.g. 2.0 = a
    /// 2-hour real cycle covers a 24-hour in-game day — 24/hours*100 as a
    /// speed percentage). Rebases the anchor to server-now in the same call.
    async fn set_night_clock_cycle_hours(
        &self,
        ctx: &Context<'_>,
        hours: f64,
    ) -> GqlResult<NightMode> {
        let adapter = crate::graphql::default_adapter(ctx)?;
        let now = now_ms();
        let record = ensure_record(&adapter, ctx, now).await?;
        let sim_ms = current_sim_ms(&record, now).unwrap_or(now);
        let speed_percent = if hours > 0.0 { 2400.0 / hours } else { 100.0 };
        save_anchor(ctx, &record.id, sim_ms, now, Some(speed_percent)).await
    }

    /// Computes real sunrise/sunset for the given calendar date ("YYYY-MM-DD")
    /// at whatever real-world circuit the CURRENT live telemetry track
    /// matches (via `TrackLocation.raw_track_ids`), and saves them as
    /// `simSunrise`/`simSunset`. Errors with a clear, specific reason at each
    /// step (no live track, unrecognized track id, track known but no
    /// location set yet) rather than silently no-op-ing, since the frontend
    /// surfaces these directly to the user as the next action to take.
    async fn set_sunrise_sunset_from_date(
        &self,
        ctx: &Context<'_>,
        date: String,
    ) -> GqlResult<NightMode> {
        let (year, month, day) = crate::sun_position::parse_iso_date(&date).ok_or_else(|| {
            async_graphql::Error::new(format!("invalid date {date:?}, expected YYYY-MM-DD"))
        })?;

        let track = live_track().ok_or_else(|| {
            async_graphql::Error::new("no live telemetry track detected — load into a track first")
        })?;

        let adapter = crate::graphql::default_adapter(ctx)?;
        let location = find_track_location(&adapter, &track).await.ok_or_else(|| {
            async_graphql::Error::new(format!(
                "track {track:?} isn't linked to any Track Location yet — add it on the Tracks page"
            ))
        })?;

        let (sunrise_min, sunset_min) = crate::sun_position::compute_sunrise_sunset(
            year,
            month,
            day,
            location.latitude,
            location.longitude,
        )
        .ok_or_else(|| {
            async_graphql::Error::new(format!(
                "no sunrise/sunset on {date} at {} (latitude {})",
                location.name, location.latitude
            ))
        })?;

        let now = now_ms();
        let record = ensure_record(&adapter, ctx, now).await?;
        // Remembers `date` and `track` so the background tick can
        // automatically redo this same computation later if the live track
        // changes — see `maybe_auto_recompute_sun_times`.
        let patch: NightModeInput = serde_json::from_value(json!({
            "sim_sunrise": crate::sun_position::format_hhmm(sunrise_min),
            "sim_sunset": crate::sun_position::format_hhmm(sunset_min),
            "sim_sunrise_sunset_date": date,
            "sim_last_computed_track": track,
        }))
        .map_err(to_gql_err)?;
        let updated = resolve_update::<NightMode>(ctx, record.id, patch)
            .await?
            .ok_or_else(|| async_graphql::Error::new("NightMode record disappeared mid-update"))?;
        TypiQLBroker::publish(NightModeChanged {
            operation_name: "update".to_string(),
            value: updated.clone(),
        });
        Ok(updated)
    }
}
