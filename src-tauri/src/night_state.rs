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
/// Sun elevation (degrees) bounding each blend — full night at or below the
/// first, full day at or above the second. Must match `dayNightSim.ts`'s
/// equivalents; the two implementations light the same room, one through a
/// dashboard and one through the bulbs, so a divergence shows up as the screen
/// and the lights disagreeing mid-transition.
///
/// MEASURED in game, not chosen, and they survived a correction that
/// invalidated the first attempt: AC reports time-of-day in the track's CIVIL
/// LOCAL time while the solar maths works in UTC, so elevations derived from
/// clock observations were two hours wrong until
/// `night_clock::clock_utc_offset_minutes` was applied.
///
/// Three independent sessions at the Nurburgring agree on where the sky stops
/// changing, from both directions — 21 Sept dusk stopped at -11.09 and (an
/// earlier session) -10.73; 22 June dawn began brightening at -11.89. Mean
/// -11.24, hence full night at -11. The day end is measured the same way: 21
/// Sept the sky began changing at 18:45 local, which is +6.84, hence +7.
///
/// A physically-derived curve (log-interpolated published illuminance figures)
/// was tried in place of this and REJECTED on the rig. It agreed about where
/// night ARRIVES — full dark at nautical twilight, within a degree of all
/// three measurements, and within 5 points of this band at sunset — but ran up
/// to 20 points brighter through the middle of twilight (-3, -6, -9), which is
/// exactly the stretch that reads as "it's getting dark". It looked
/// overexposed in game.
///
/// The model describes open air; the game renders its own sky, and that sky
/// collapses toward dark faster than real twilight does once the sun is down.
/// Where they disagree, the measurements win.
pub const SUN_ELEVATION_NIGHT_DEG: f64 = -11.0;
pub const SUN_ELEVATION_DAY_DEG: f64 = 7.0;

/// Dusk's own bounds. Kept separate even though they equal dawn's: the pairs
/// were arrived at independently, so correcting either end of either band
/// shouldn't first have to re-separate them.
pub const SUN_ELEVATION_DUSK_NIGHT_DEG: f64 = -11.0;
pub const SUN_ELEVATION_DUSK_DAY_DEG: f64 = 7.0;

/// 0 = full day, 1 = full night, for a given sun elevation.
///
/// `rising` picks the band. The two are kept separate because they were
/// arrived at separately: an earlier version derived dusk by mirroring dawn,
/// which put the transition BEFORE sunset and assumed a symmetry the game does
/// not obviously have. They match today because both were measured and both
/// landed in the same place — not the same thing as deriving one from the
/// other, and mirroring still wouldn't produce them (it would put full night at
/// -7, not -11).
///
/// Smoothstep, not linear: a linear ramp moves fastest at the start, when the
/// sky is changing least, and reads as the lighting running ahead of the game.
///
/// The bias then pulls the whole curve toward night, because a COCKPIT is not
/// a sky — an interior is lit by ambient only and loses light much faster than
/// the horizon does, and these are photographs of an interior.
///
/// Fitted to one observation made in a PRACTICE session with manual time
/// control: the in-game interior stops darkening noticeably at 22:50 sim,
/// which a 10s-interval trace of the same evening puts at -7.9 degrees. The
/// exponent is chosen so the curve reaches full night there:
///
///   exponent   reaches 99% at   error vs the -7.9 anchor
///      1          -9.94              -2.04  (keeps darkening after the game
///                                            has already stopped)
///      2          -7.48              +0.42  <- chosen
///      3          -5.61              +2.29  (slams to night too early)
///
/// Both endpoints stay exactly where they are, which is what having them
/// independently confirmed requires.
///
/// An earlier value of 3 came from a first report of near-max darkness at
/// 22:00-22:30 (-2.66 to -5.78 deg), made while driving a 2-hour-cycle
/// multiplayer lobby with no time control, and was RETRACTED once the same
/// thing was checked with the clock held still. Worth recording: it is the one
/// measurement here that a moving clock produced, and it was two degrees out.
///
/// Raise to darken sooner, lower to soften; 1 restores a plain smoothstep.
pub const NIGHT_BIAS_EXPONENT: f64 = 2.0;

pub fn night_amount_from_sun_elevation(elevation_deg: f64, rising: bool) -> f64 {
    let (night_at, day_at) = if rising {
        (SUN_ELEVATION_NIGHT_DEG, SUN_ELEVATION_DAY_DEG)
    } else {
        (SUN_ELEVATION_DUSK_NIGHT_DEG, SUN_ELEVATION_DUSK_DAY_DEG)
    };
    let t = ((elevation_deg - night_at) / (day_at - night_at)).clamp(0.0, 1.0);
    1.0 - (t * t * (3.0 - 2.0 * t)).powf(NIGHT_BIAS_EXPONENT)
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
    sun_rising: bool,
) -> f64 {
    if record.sim_enabled.unwrap_or(false) {
        if let Some(elevation) = sun_elevation_deg.filter(|e| e.is_finite()) {
            return night_amount_from_sun_elevation(elevation, sun_rising);
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
        assert_eq!(night_amount(&r, Some(at(12.0, 0.0)), None, true), 1.0);
        r.is_night = false;
        assert_eq!(night_amount(&r, Some(at(12.0, 0.0)), None, true), 0.0);
    }

    /// The elevation curve, which is what actually drives the blend whenever
    /// a track location is known. Values mirror `dayNightSim.test.ts`.
    /// The elevation curve, which drives the blend whenever a track location
    /// is known. Values mirror `dayNightSim.test.ts`.
    #[test]
    fn elevation_curve_matches_its_bounds_and_eases() {
        assert_eq!(night_amount_from_sun_elevation(-11.0, true), 1.0);
        assert_eq!(night_amount_from_sun_elevation(-40.0, true), 1.0);
        assert_eq!(night_amount_from_sun_elevation(7.0, true), 0.0);
        assert_eq!(night_amount_from_sun_elevation(80.0, true), 0.0);
        // A plain smoothstep is 0.5 here; squaring pulls it to 0.75 because a
        // cockpit goes dark long before the sky does.
        let mid = night_amount_from_sun_elevation(-2.0, true);
        assert!(
            (mid - 0.75).abs() < 1e-9,
            "biased midpoint {mid} should be 0.75"
        );

        // Full night where the interior was observed to stop darkening:
        // 22:50 sim with the clock held still, i.e. -7.9 degrees.
        assert!(night_amount_from_sun_elevation(-7.9, true) > 0.99);
        // But still visibly transitioning well before then — over-biasing
        // slams to night early, which is the other way to get this wrong.
        assert!(night_amount_from_sun_elevation(-2.0, true) < 0.8);
        // Eased, not linear: a linear ramp puts the quarter-point at 0.75, and
        // smoothstep must sit above it (still darker).
        let quarter = night_amount_from_sun_elevation(-11.0 + 18.0 * 0.25, true);
        assert!(
            quarter > 0.78,
            "smoothstep should lag a linear ramp early, got {quarter}"
        );
        let mut prev = f64::MAX;
        for i in 0..=180 {
            let v = night_amount_from_sun_elevation(-11.0 + i as f64 * 0.1, true);
            assert!(v <= prev + 1e-12, "not monotonic at step {i}");
            prev = v;
        }
    }

    /// The measured bands, from both directions, plus the guard that keeps a
    /// physically-derived curve from quietly replacing them again.
    #[test]
    fn bands_match_the_measured_sky_and_stay_darker_than_open_air() {
        assert_eq!(night_amount_from_sun_elevation(7.0, false), 0.0);
        assert_eq!(night_amount_from_sun_elevation(-11.0, false), 1.0);

        // The observations themselves, with a little tolerance for rounding
        // +6.84/-10.73 onto the +7/-11 bounds.
        assert!(
            night_amount_from_sun_elevation(6.84, false) < 0.02,
            "sky was still fully lit at +6.84 deg (21 Sept)"
        );
        assert!(
            night_amount_from_sun_elevation(-10.73, false) > 0.97,
            "sky had stopped changing by -10.73 deg (21 Sept)"
        );
        assert!(
            night_amount_from_sun_elevation(-11.89, true) > 0.99,
            "sky was still fully dark at -11.89 deg (22 June dawn)"
        );

        // Sunrise/sunset itself lands mid-transition rather than at either end.
        let at_horizon = night_amount_from_sun_elevation(-0.833, false);
        assert!(
            (0.2..0.8).contains(&at_horizon),
            "the horizon should land mid-transition, got {at_horizon}"
        );

        // Darker through mid-twilight than open-air physics. A log-illuminance
        // curve gives 0.40/0.61/0.79 at these elevations and looked overexposed
        // in game; this band is up to 20 points darker, which is what matched.
        assert!(night_amount_from_sun_elevation(-3.0, false) > 0.5);
        assert!(night_amount_from_sun_elevation(-6.0, false) > 0.75);
        assert!(night_amount_from_sun_elevation(-9.0, false) > 0.93);

        // NOT a mirror of dawn: asserting that was a real bug in an earlier
        // version of this test.
        let mirrored_night = -SUN_ELEVATION_DAY_DEG;
        assert!(
            (SUN_ELEVATION_DUSK_NIGHT_DEG - mirrored_night).abs() > 1.0,
            "these are measured, not derived from each other"
        );
    }

    #[test]
    fn elevation_overrides_the_clock_ramp() {
        let r = sim_record();
        // Noon by the clock (the ramp alone would say full day), but the sun
        // is well below the band — elevation must win.
        assert_eq!(
            night_amount(&r, Some(at(12.0, 0.0)), Some(-20.0), true),
            1.0
        );
        // And with no elevation available it falls back to the clock ramp.
        assert_eq!(night_amount(&r, Some(at(12.0, 0.0)), None, true), 0.0);
        // A non-finite reading is ignored rather than poisoning the blend.
        assert_eq!(
            night_amount(&r, Some(at(12.0, 0.0)), Some(f64::NAN), true),
            0.0
        );
    }

    #[test]
    fn manual_mode_ignores_the_simulated_clock() {
        let mut r = sim_record();
        r.sim_enabled = Some(false);
        r.is_night = true;
        // Noon in sim terms, but simulation is off: the toggle wins.
        assert_eq!(night_amount(&r, Some(at(12.0, 0.0)), None, true), 1.0);
    }

    #[test]
    fn simulated_mode_without_a_clock_tick_falls_back_to_the_toggle() {
        let mut r = sim_record();
        r.is_night = true;
        assert_eq!(night_amount(&r, None, None, true), 1.0);
    }
}
