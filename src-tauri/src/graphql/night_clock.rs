use crate::typiql_types::{NightMode, NightModeChanged, NightModeInput, TrackLocation};
use async_graphql::{Context, Object, Result as GqlResult};
use serde_json::json;
use std::sync::{Arc, Mutex};
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

/// Last resolved track location, keyed by track id.
///
/// The lookup behind it scans every stored `TrackLocation` and deserialises
/// each one, which is fine occasionally and not fine sixty times a second —
/// this is called from the clock tick. The track changes at most once per
/// session load, so a one-entry cache removes the per-tick read entirely.
static TRACK_LOCATION_CACHE: Mutex<Option<(String, TrackLocation)>> = Mutex::new(None);

async fn cached_track_location(
    adapter: &Arc<dyn TypiQLAdapter>,
    track: &str,
) -> Option<TrackLocation> {
    if let Ok(guard) = TRACK_LOCATION_CACHE.lock() {
        if let Some((cached_track, location)) = guard.as_ref() {
            if cached_track == track {
                return Some(location.clone());
            }
        }
    }
    let location = find_track_location(adapter, track).await?;
    if let Ok(mut guard) = TRACK_LOCATION_CACHE.lock() {
        *guard = Some((track.to_string(), location.clone()));
    }
    Some(location)
}

/// Last `equinox_sun_trajectory` the game reported.
///
/// Cached because the Lua app stops sending whenever the player opens the CSP
/// debug UI or the setup menus, and whether the sun follows an equinox
/// trajectory is a property of the SESSION, not of whether a script happens
/// to be mid-frame. Re-deciding it during a gap swung elevation from +1.2 to
/// +8.1 at one instant — a visible jump, fired exactly when someone was
/// scrubbing the clock to watch the transition.
static LAST_EQUINOX_FLAG: Mutex<Option<bool>> = Mutex::new(None);

/// Whether AC is currently swinging the sun on a 20th-March trajectory
/// regardless of the session date (seasons off, or no date set).
fn equinox_trajectory_active() -> bool {
    if let Some(frame) = crate::ac_telemetry::latest() {
        if let Ok(mut guard) = LAST_EQUINOX_FLAG.lock() {
            *guard = Some(frame.equinox_sun_trajectory);
        }
        return frame.equinox_sun_trajectory;
    }
    LAST_EQUINOX_FLAG
        .lock()
        .ok()
        .and_then(|guard| *guard)
        .unwrap_or(false)
}

/// Swaps in the equinox date when AC is on that trajectory, keeping the year
/// (which only moves the equation of time by a minute or so).
///
/// Everything that positions the sun must go through this. Computing for the
/// real date while the game renders an equinox sun is not visibly wrong — it
/// yields a plausible number that simply doesn't match the sky — and it put
/// sunrise 43 minutes out at the Nordschleife.
fn apply_sun_trajectory(date: (i32, u32, u32)) -> (i32, u32, u32) {
    if !equinox_trajectory_active() {
        return date;
    }
    let (month, day) = crate::sun_position::EQUINOX_TRAJECTORY_DATE;
    (date.0, month, day)
}

/// The date the sun should be positioned for.
///
/// Built on `clock_date` rather than the telemetry frame's own timestamp: the
/// internal clock is disciplined from the game, so it IS the game's date
/// while the game is running and stays so through a telemetry gap, which the
/// frame cannot.
fn effective_sun_date(record: &NightMode) -> Option<(i32, u32, u32)> {
    let iso = clock_date(record).or_else(|| record.sim_sunrise_sunset_date.clone())?;
    let parsed = crate::sun_position::parse_iso_date(&iso)?;
    Some(apply_sun_trajectory(parsed))
}

/// Sun elevation (degrees, negative below the horizon) at the current
/// simulated instant for whatever track is live, or `None` when it can't be
/// known — no track loaded, or no location configured for it.
///
/// Pushed on every clock tick so the dawn/dusk ramp can key on elevation
/// rather than interpolating between sunrise and sunset clock times. Computed
/// here, once, rather than in each consumer: the frontend has neither the
/// track's coordinates nor the solar code, and the Huenicorn gamma pusher
/// runs with no frontend at all.
///
/// The date comes from `effective_sun_date` — see there for why it is not
/// simply the session's.
pub async fn current_sun_elevation_deg(
    adapter: &Arc<dyn TypiQLAdapter>,
    record: &NightMode,
    sim_time_ms: f64,
) -> Option<f64> {
    let track = live_track()?;
    let location = cached_track_location(adapter, &track).await?;
    let (year, month, day) = effective_sun_date(record)?;

    let minute_of_day = (sim_time_ms / 60_000.0).rem_euclid(1440.0);
    Some(crate::sun_position::sun_elevation_deg(
        year,
        month,
        day,
        location.latitude,
        location.longitude,
        minute_of_day,
    ))
}

/// How far the internal clock may drift from the game's before it's rebased.
///
/// This is a correction threshold, not a poll interval. Once the anchor is set
/// and the rate matches, the two clocks track each other and no further write
/// happens — so the steady state costs one DB write when the game starts, not
/// one per tick at 60Hz. A second is well below anything visible on a clock
/// face reading to the minute, and comfortably above the jitter between a
/// 60Hz tick and a 60Hz telemetry frame.
const CLOCK_DRIFT_TOLERANCE_MS: f64 = 1000.0;

/// Smallest change in rate worth rebasing for, as a percentage.
const SPEED_EPSILON_PERCENT: f64 = 0.5;

/// Writes the game's time, date and rate into the simulated clock's anchor.
///
/// Returns the updated record when it rebased, `None` when it left things
/// alone — which is the common case, and also what happens whenever the game
/// isn't reporting. That last part is the point: with no frames arriving this
/// does nothing at all, so the clock simply keeps running from the last anchor
/// the game gave it. Entering the setup menus (which kills the Lua app) then
/// costs nothing more than the clock free-running at the rate it was already
/// going, instead of snapping to a different time.
///
/// Goes straight through the adapter, like `maybe_auto_recompute_sun_times`
/// and for the same reason: the caller is the subscription's per-tick closure,
/// which has outlived any request-scoped `Context`.
pub async fn sync_clock_from_game(
    adapter: &Arc<dyn TypiQLAdapter>,
    record: &NightMode,
) -> Option<NightMode> {
    let frame = crate::ac_telemetry::latest()?;
    let now = now_ms();
    // Not `session_timestamp` directly: this keeps the time-of-day fallback
    // for a CSP old enough not to populate the timestamp, where the date is
    // unknown but the clock is still worth following.
    let game_ms = super::sim_ms_from_game(&frame, now);

    // AC's race time multiplier: 1 = real time. Documented as possibly 0
    // (paused) or negative (online), neither of which is a rate this clock
    // should adopt — keep whatever it was using and just correct the time.
    let raw_speed_percent = frame.time_multiplier as f64 * 100.0;
    let game_speed_percent =
        (raw_speed_percent.is_finite() && raw_speed_percent > 0.0).then_some(raw_speed_percent);
    let current_speed = record.sim_speed_percent.unwrap_or(100.0);
    let speed_changed =
        game_speed_percent.is_some_and(|p| (p - current_speed).abs() > SPEED_EPSILON_PERCENT);

    let drifted = match current_sim_ms(record, now) {
        Some(sim_ms) => (game_ms - sim_ms).abs() > CLOCK_DRIFT_TOLERANCE_MS,
        // No usable anchor yet — the first frame establishes one.
        None => true,
    };
    if !drifted && !speed_changed {
        return None;
    }

    let mut patch = json!({
        "sim_base_sim_time_ms": game_ms,
        "sim_base_real_time": now,
    });
    if let Some(speed) = game_speed_percent {
        patch["sim_speed_percent"] = json!(speed);
    }
    let updated_val = adapter
        .update(
            NightMode::collection_name().into(),
            NightMode::key_field(),
            &record.id,
            patch,
        )
        .await?;
    let updated: NightMode = serde_json::from_value(updated_val).ok()?;
    TypiQLBroker::publish(NightModeChanged {
        operation_name: "update".to_string(),
        value: updated.clone(),
    });
    Some(updated)
}

/// The in-game calendar date ("YYYY-MM-DD"), read off the internal clock.
///
/// Deliberately the clock rather than the telemetry frame directly. The clock
/// is disciplined from the game (see `sync_clock_from_game`), so this IS the
/// game's date whenever the game is running — and it stays the game's date
/// through a telemetry gap, which the frame cannot. Without that, entering
/// the setup menus would drop sunrise/sunset back to whatever date was last
/// picked by hand, and a session running past midnight would stop advancing.
fn clock_date(record: &NightMode) -> Option<String> {
    let sim_ms = current_sim_ms(record, now_ms())?;
    Some(crate::sun_position::iso_date_from_epoch_seconds(
        (sim_ms / 1000.0).floor() as i64,
    ))
}

/// Recomputes sunrise/sunset (and the dawn/dusk transition width) whenever
/// the location or the date they were computed for goes stale.
///
/// The date comes from the internal clock, which the game disciplines while
/// it's running — so a session set in June gets June's sunrise rather than
/// today's, and keeps it while the telemetry app is away. The manually-picked
/// date (`sim_sunrise_sunset_date`, set via `setSunriseSunsetFromDate`) is the
/// fallback for a clock with no anchor at all.
///
/// Reacts to the live track changing the same way the 360° photo viewer
/// reacts to the car changing. No-ops quietly (leaving whatever
/// sunrise/sunset are already set) if there's no date from either source, no
/// live track, or the live track isn't linked to a location — this runs on
/// every clock tick, so it must stay silent rather than erroring like the
/// mutation does.
///
/// Read/write here goes straight through the adapter (`TypiQLAdapter::update`
/// takes no `Context`) since this is called from the `nightClock`
/// subscription's per-tick closure, which has outlived any request-scoped
/// `Context` by the time it runs.
pub async fn maybe_auto_recompute_sun_times(adapter: &Arc<dyn TypiQLAdapter>, record: &NightMode) {
    let Some(date) = clock_date(record).or_else(|| record.sim_sunrise_sunset_date.clone()) else {
        return;
    };
    let Some(parsed) = crate::sun_position::parse_iso_date(&date) else {
        return;
    };
    // Same trajectory correction the elevation path applies. Without it the
    // stored sunrise/sunset describe a different sun than the one being
    // rendered — measured at the Nordschleife, 04:53 stored against a real
    // sunrise of about 05:34.
    let (year, month, day) = apply_sun_trajectory(parsed);
    let Some(track) = live_track() else { return };
    let Some(location) = cached_track_location(adapter, &track).await else {
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

    let sunrise = crate::sun_position::format_hhmm(sunrise_min);
    let sunset = crate::sun_position::format_hhmm(sunset_min);

    // Compare the RESULT, not the inputs. Guarding on track+date looked
    // equivalent and wasn't: the trajectory correction above can change the
    // answer while both inputs stay put, so a session that switched to an
    // equinox sun kept its stale real-date sunrise forever (04:53 stored
    // against an actual 05:34). Comparing what we computed is self-correcting
    // for any input we forget to include, and the maths is pure -- the only
    // read it needs is the track location, which is cached.
    if record.sim_last_computed_track.as_deref() == Some(track.as_str())
        && record.sim_sunrise.as_deref() == Some(sunrise.as_str())
        && record.sim_sunset.as_deref() == Some(sunset.as_str())
        && record.sim_sunrise_sunset_date.as_deref() == Some(date.as_str())
    {
        return;
    }

    let mut patch = json!({
        "sim_sunrise": sunrise,
        "sim_sunset": sunset,
        "sim_sunrise_sunset_date": date,
        "sim_last_computed_track": track,
    });
    if let Some(minutes) = crate::sun_position::compute_transition_minutes(
        year,
        month,
        day,
        location.latitude,
        location.longitude,
    ) {
        patch["sim_transition_minutes"] =
            json!(crate::sun_position::quantize_transition_minutes(minutes));
    }
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

    /// Computes real sunrise/sunset — and the civil-twilight dawn/dusk
    /// width — for the given calendar date ("YYYY-MM-DD") at whatever
    /// real-world circuit the CURRENT live telemetry track matches (via
    /// `TrackLocation.raw_track_ids`), and saves them as
    /// `simSunrise`/`simSunset`/`simTransitionMinutes`. Note that while AC is
    /// running, `maybe_auto_recompute_sun_times` will subsequently redo this
    /// for the game's own in-game date; this mutation is what drives it when
    /// nothing is live. Errors with a clear, specific reason at each
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
        let mut patch_value = json!({
            "sim_sunrise": crate::sun_position::format_hhmm(sunrise_min),
            "sim_sunset": crate::sun_position::format_hhmm(sunset_min),
            "sim_sunrise_sunset_date": date,
            "sim_last_computed_track": track,
        });
        // The dawn/dusk width is as much a property of the date and latitude
        // as the two times themselves are, so it's computed alongside them
        // rather than left at a fixed default that only suits one latitude.
        if let Some(minutes) = crate::sun_position::compute_transition_minutes(
            year,
            month,
            day,
            location.latitude,
            location.longitude,
        ) {
            patch_value["sim_transition_minutes"] =
                json!(crate::sun_position::quantize_transition_minutes(minutes));
        }
        let patch: NightModeInput = serde_json::from_value(patch_value).map_err(to_gql_err)?;
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
