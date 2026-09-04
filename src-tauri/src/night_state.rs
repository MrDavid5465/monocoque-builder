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
/// Sun elevation (degrees) bounding the dawn/dusk blend — full night at or
/// below the first, full day at or above the second. Must match
/// `dayNightSim.ts`'s `SUN_ELEVATION_NIGHT_DEG`/`SUN_ELEVATION_DAY_DEG`; the
/// two implementations light the same room, one through a dashboard and one
/// through the bulbs, so a divergence here shows up as the screen and the
/// lights disagreeing mid-dawn.
///
/// Chosen against observed sky rather than a textbook threshold: stepping the
/// in-game clock a minute at a time, the sky was not yet perceptibly lighter
/// at -3.9 deg but clearly was by -1.6 deg. Civil twilight's -6 started the
/// ramp roughly half an hour before anything visibly changed.
pub const SUN_ELEVATION_NIGHT_DEG: f64 = -2.0;
pub const SUN_ELEVATION_DAY_DEG: f64 = 15.0;

/// 0 = full day, 1 = full night, for a given sun elevation. Smoothstep, not
/// linear: a linear ramp moves fastest at the start, when the sky is changing
/// least, and reads as the lighting running ahead of the game.
pub fn night_amount_from_sun_elevation(elevation_deg: f64) -> f64 {
    let span = SUN_ELEVATION_DAY_DEG - SUN_ELEVATION_NIGHT_DEG;
    let t = ((elevation_deg - SUN_ELEVATION_NIGHT_DEG) / span).clamp(0.0, 1.0);
    1.0 - t * t * (3.0 - 2.0 * t)
}

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
/// `sun_elevation_deg`, when known, wins over the clock ramp — see
/// `dayNightSim.ts` for why: elevation cannot disagree with the sky, whereas
/// the clock ramp has to assume where sunrise falls within the transition,
/// and every version of that assumption has been wrong.
pub fn night_amount(
    record: &NightMode,
    sim_time_ms: Option<f64>,
    sun_elevation_deg: Option<f64>,
) -> f64 {
    if record.sim_enabled.unwrap_or(false) {
        if let Some(elevation) = sun_elevation_deg.filter(|e| e.is_finite()) {
            return night_amount_from_sun_elevation(elevation);
        }
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
        assert_eq!(night_amount(&r, Some(at(12.0, 0.0)), None), 1.0);
        r.is_night = false;
        assert_eq!(night_amount(&r, Some(at(12.0, 0.0)), None), 0.0);
    }

    /// The elevation curve, which is what actually drives the blend whenever
    /// a track location is known. Values mirror `dayNightSim.test.ts`.
    #[test]
    fn elevation_curve_matches_its_bounds_and_eases() {
        // Bounds are hard 1/0, and clamp beyond them rather than overshooting.
        assert_eq!(night_amount_from_sun_elevation(-2.0), 1.0);
        assert_eq!(night_amount_from_sun_elevation(-40.0), 1.0);
        assert_eq!(night_amount_from_sun_elevation(15.0), 0.0);
        assert_eq!(night_amount_from_sun_elevation(80.0), 0.0);
        // Midpoint of the band is exactly half, as smoothstep is symmetric.
        let mid = night_amount_from_sun_elevation(6.5);
        assert!((mid - 0.5).abs() < 1e-9, "midpoint {mid} should be 0.5");
        // Sunrise itself (-0.833 deg) is still essentially night: the whole
        // point of the band being weighted after sunrise rather than centred
        // on it.
        let at_sunrise = night_amount_from_sun_elevation(-0.833);
        assert!(
            at_sunrise > 0.97,
            "at sunrise the blend should still read as night, got {at_sunrise}"
        );
        // Eased, not linear: a linear ramp would put the quarter-point at
        // exactly 0.75, and smoothstep must sit above it (still darker).
        let quarter = night_amount_from_sun_elevation(-2.0 + 17.0 * 0.25);
        assert!(
            quarter > 0.78,
            "smoothstep should lag a linear ramp early, got {quarter}"
        );
        // Monotonic across the whole band — no wobble a blend would show.
        let mut prev = f64::MAX;
        for i in 0..=170 {
            let v = night_amount_from_sun_elevation(-2.0 + i as f64 * 0.1);
            assert!(v <= prev + 1e-12, "not monotonic at step {i}");
            prev = v;
        }
    }

    /// Elevation wins over the clock ramp when both are available.
    #[test]
    fn elevation_overrides_the_clock_ramp() {
        let r = sim_record();
        // Noon by the clock (the ramp alone would say full day), but the sun
        // is below the horizon — elevation must win.
        assert_eq!(night_amount(&r, Some(at(12.0, 0.0)), Some(-10.0)), 1.0);
        // And with no elevation available it falls back to the clock ramp.
        assert_eq!(night_amount(&r, Some(at(12.0, 0.0)), None), 0.0);
        // A non-finite reading is ignored rather than poisoning the blend.
        assert_eq!(night_amount(&r, Some(at(12.0, 0.0)), Some(f64::NAN)), 0.0);
    }

    #[test]
    fn manual_mode_ignores_the_simulated_clock() {
        let mut r = sim_record();
        r.sim_enabled = Some(false);
        r.is_night = true;
        // Noon in sim terms, but simulation is off: the toggle wins.
        assert_eq!(night_amount(&r, Some(at(12.0, 0.0)), None), 1.0);
    }

    #[test]
    fn simulated_mode_without_a_clock_tick_falls_back_to_the_toggle() {
        let mut r = sim_record();
        r.is_night = true;
        assert_eq!(night_amount(&r, None, None), 1.0);
    }
}
