//! Server-side day/night ramp — the Rust counterpart of the frontend's
//! `src/components/Telemetry/dayNightSim.ts`.
//!
//! That module stays the source of truth for anything *rendered* (every
//! dashboard already imports it, and it's covered by
//! `src/__tests__/dayNightSim.test.ts`); this port exists because the
//! Huenicorn gamma push (`huenicorn::run_gamma_pusher`) has to work with no
//! dashboard open at all — the bulbs are lit by a background loop, not by a
//! React tree, so it can't ask the frontend what time it is in-sim. The two
//! implementations must agree, so the ramp math below is a deliberate
//! line-for-line translation rather than a re-derivation, and the tests at
//! the bottom mirror the TS suite's cases. If one side's ramp changes, change
//! both.
//!
//! Deliberately UTC-only, same as the TS version: only the numeric HH:MM
//! offsets matter, never a real-world timezone.

use crate::typiql_types::NightMode;

const DAY_MIN: f64 = 1440.0;

fn wrap_minutes(x: f64) -> f64 {
    ((x % DAY_MIN) + DAY_MIN) % DAY_MIN
}

/// "HH:MM" (24h) -> minutes since midnight, or `None` if unparseable.
pub fn parse_time_of_day(hhmm: &str) -> Option<f64> {
    let (h, m) = hhmm.trim().split_once(':')?;
    let h: u32 = h.parse().ok()?;
    let m: u32 = m.parse().ok()?;
    if h > 23 || m > 59 {
        return None;
    }
    Some((h * 60 + m) as f64)
}

/// Minutes-since-UTC-midnight of a ms-since-epoch instant. Seconds are
/// truncated before the division to match the TS version's
/// `getUTCSeconds() / 60` (which likewise ignores the sub-second part).
fn minute_of_day(sim_time_ms: f64) -> f64 {
    (sim_time_ms / 1000.0).floor().rem_euclid(86_400.0) / 60.0
}

/// 0 = full day, 1 = full night, continuous through the dawn/dusk ramp.
/// `None` when sunrise/sunset aren't configured yet.
pub fn simulated_night_amount(sim_time_ms: f64, record: &NightMode) -> Option<f64> {
    let sunrise_min = parse_time_of_day(record.sim_sunrise.as_deref()?)?;
    let sunset_min = parse_time_of_day(record.sim_sunset.as_deref()?)?;
    // The ramp starts AT the sunrise/sunset clock time and runs forward for
    // the full configured duration — it isn't centred on it. In-game, the
    // sky is still fully dark right at the calculated "sunrise" time;
    // daylight only arrives progressively over the following
    // `sim_transition_minutes`, and the same holds in reverse for sunset. A
    // centred ramp made both transitions appear to start too early (still
    // dark well past the sunrise time).
    let t = record.sim_transition_minutes.unwrap_or(40.0).max(0.0);

    let min_of_day = minute_of_day(sim_time_ms);
    let since_sunrise = wrap_minutes(min_of_day - sunrise_min);
    let since_sunset = wrap_minutes(min_of_day - sunset_min);
    let in_dawn_ramp = t > 0.0 && since_sunrise <= t;
    let in_dusk_ramp = t > 0.0 && since_sunset <= t;

    let night_amount = if in_dawn_ramp {
        1.0 - since_sunrise / t
    } else if in_dusk_ramp {
        since_sunset / t
    } else {
        let day_length = wrap_minutes(sunset_min - sunrise_min);
        if since_sunrise < day_length {
            0.0
        } else {
            1.0
        }
    };

    Some(night_amount.clamp(0.0, 1.0))
}

/// The effective 0..1 night blend, honouring `sim_enabled` as an explicit
/// mode switch exactly like `computeEffectiveNightState`: the simulated
/// clock wins when it's on AND usable, otherwise the manual toggle's hard
/// 0/1. `sim_time_ms` comes from `night_clock::current_sim_ms`.
pub fn night_amount(record: &NightMode, sim_time_ms: Option<f64>) -> f64 {
    if record.sim_enabled.unwrap_or(false) {
        if let Some(amount) = sim_time_ms.and_then(|ms| simulated_night_amount(ms, record)) {
            return amount;
        }
    }
    if record.is_night {
        1.0
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a record with the simulated clock enabled and a 06:00/18:00
    /// day, 40-minute transitions — the same fixture shape the TS suite uses.
    fn sim_record() -> NightMode {
        NightMode {
            id: "1".into(),
            is_night: false,
            sim_enabled: Some(true),
            sim_base_sim_time_ms: None,
            sim_base_real_time: None,
            sim_speed_percent: None,
            sim_sunrise: Some("06:00".into()),
            sim_sunset: Some("18:00".into()),
            sim_transition_minutes: Some(40.0),
            sim_sunrise_sunset_date: None,
            sim_last_computed_track: None,
        }
    }

    /// ms-since-epoch for a UTC time-of-day on an arbitrary day — only the
    /// time-of-day matters to the ramp.
    fn at(hour: f64, minute: f64) -> f64 {
        (hour * 3600.0 + minute * 60.0) * 1000.0
    }

    #[test]
    fn parses_and_rejects_times() {
        assert_eq!(parse_time_of_day("06:30"), Some(390.0));
        assert_eq!(parse_time_of_day(" 6:30 "), Some(390.0));
        assert_eq!(parse_time_of_day("24:00"), None);
        assert_eq!(parse_time_of_day("06:60"), None);
        assert_eq!(parse_time_of_day("nope"), None);
    }

    #[test]
    fn full_day_and_full_night_outside_the_ramps() {
        let r = sim_record();
        assert_eq!(simulated_night_amount(at(12.0, 0.0), &r), Some(0.0));
        assert_eq!(simulated_night_amount(at(0.0, 0.0), &r), Some(1.0));
    }

    #[test]
    fn ramps_through_dawn_and_dusk() {
        let r = sim_record();
        // The ramp starts (full night/day, not half-blended) exactly at the
        // configured sunrise/sunset clock time.
        assert_eq!(simulated_night_amount(at(6.0, 0.0), &r), Some(1.0));
        assert_eq!(simulated_night_amount(at(18.0, 0.0), &r), Some(0.0));
        // Midpoint of the following 40-minute transition is half-blended.
        assert_eq!(simulated_night_amount(at(6.0, 20.0), &r), Some(0.5));
        assert_eq!(simulated_night_amount(at(18.0, 20.0), &r), Some(0.5));
        // Dawn runs night -> day, dusk runs day -> night, over that window.
        assert_eq!(simulated_night_amount(at(6.0, 10.0), &r), Some(0.75));
        assert_eq!(simulated_night_amount(at(6.0, 30.0), &r), Some(0.25));
        assert_eq!(simulated_night_amount(at(18.0, 10.0), &r), Some(0.25));
        assert_eq!(simulated_night_amount(at(18.0, 30.0), &r), Some(0.75));
        // The ramp completes exactly at sunrise/sunset + transition minutes.
        assert_eq!(simulated_night_amount(at(6.0, 40.0), &r), Some(0.0));
        assert_eq!(simulated_night_amount(at(18.0, 40.0), &r), Some(1.0));
    }

    #[test]
    fn ramp_wraps_around_midnight() {
        let mut r = sim_record();
        r.sim_sunrise = Some("23:50".into());
        // Dawn ramp runs 23:50 -> 00:30 the next day; the minutes-since
        // calculation has to wrap through midnight to land inside it.
        assert_eq!(simulated_night_amount(at(23.0, 50.0), &r), Some(1.0));
        assert_eq!(simulated_night_amount(at(0.0, 10.0), &r), Some(0.5));
        assert_eq!(simulated_night_amount(at(0.0, 30.0), &r), Some(0.0));
        // Well before the ramp starts, still deep night from the previous
        // sunset.
        assert_eq!(simulated_night_amount(at(23.0, 0.0), &r), Some(1.0));
    }

    #[test]
    fn unconfigured_sun_times_fall_back_to_the_manual_toggle() {
        let mut r = sim_record();
        r.sim_sunrise = None;
        assert_eq!(simulated_night_amount(at(12.0, 0.0), &r), None);

        r.is_night = true;
        assert_eq!(night_amount(&r, Some(at(12.0, 0.0))), 1.0);
        r.is_night = false;
        assert_eq!(night_amount(&r, Some(at(12.0, 0.0))), 0.0);
    }

    #[test]
    fn manual_mode_ignores_the_simulated_clock() {
        let mut r = sim_record();
        r.sim_enabled = Some(false);
        r.is_night = true;
        // Noon in sim terms, but simulation is off: the toggle wins.
        assert_eq!(night_amount(&r, Some(at(12.0, 0.0))), 1.0);
    }

    #[test]
    fn simulated_mode_without_a_clock_tick_falls_back_to_the_toggle() {
        let mut r = sim_record();
        r.is_night = true;
        assert_eq!(night_amount(&r, None), 1.0);
    }
}
