//! Sunrise/sunset computation for the day/night simulation's
//! `setSunriseSunsetFromDate` mutation (see `graphql/night_clock.rs`) —
//! NOAA's public solar-position algorithm (the same one behind their online
//! solar calculator, widely reproduced/ported; single-pass, no iterative
//! refinement). Accurate to within about a minute for any real-world
//! circuit latitude — plenty for a racing sim's day/night ambience, not
//! full ephemeris precision, and deliberately dependency-free (no chrono,
//! no astronomy crate) to match this app's existing avoid-a-date-crate
//! convention (see NightMode's own doc comments in typiql_types.rs).

const DEG: f64 = std::f64::consts::PI / 180.0;

fn deg2rad(d: f64) -> f64 {
    d * DEG
}
fn rad2deg(r: f64) -> f64 {
    r / DEG
}

/// Julian Day Number (integer-valued, at noon UTC) for a Gregorian calendar
/// date — the standard integer algorithm, valid for any proleptic Gregorian
/// date. No external date crate needed.
fn julian_day_number(year: i32, month: u32, day: u32) -> f64 {
    let a = (14 - month as i64) / 12;
    let y = year as i64 + 4800 - a;
    let m = month as i64 + 12 * a - 3;
    (day as i64 + (153 * m + 2) / 5 + 365 * y + y / 4 - y / 100 + y / 400 - 32045) as f64
}

/// Inverse of `julian_day_number` — the standard Fliegel–Van Flandern
/// Gregorian inversion. Kept next to its forward counterpart, and covered by
/// a round-trip test, since the two magic-constant sets have to agree.
fn civil_from_julian_day_number(jdn: i64) -> (i32, u32, u32) {
    let a = jdn + 32044;
    let b = (4 * a + 3) / 146097;
    let c = a - 146097 * b / 4;
    let d = (4 * c + 3) / 1461;
    let e = c - 1461 * d / 4;
    let m = (5 * e + 2) / 153;
    let day = e - (153 * m + 2) / 5 + 1;
    let month = m + 3 - 12 * (m / 10);
    let year = 100 * b + d - 4800 + m / 10;
    (year as i32, month as u32, day as u32)
}

/// UTC calendar date of a Unix timestamp, as "YYYY-MM-DD".
///
/// Exists so the in-game date carried by AC telemetry (`AcTelemetryFrame`'s
/// `timestamp`, which is track-local rather than real-world UTC — see
/// `graphql/mod.rs`'s `sim_ms_from_game`) can drive sunrise/sunset without
/// pulling in a date crate. `floor`, not truncating division, so pre-1970
/// timestamps don't land a day late.
pub fn iso_date_from_epoch_seconds(secs: i64) -> String {
    let days = (secs as f64 / 86_400.0).floor() as i64;
    let (year, month, day) = civil_from_julian_day_number(2_440_588 + days);
    format!("{year:04}-{month:02}-{day:02}")
}

/// Parses "YYYY-MM-DD" into (year, month, day). No external date crate.
pub fn parse_iso_date(s: &str) -> Option<(i32, u32, u32)> {
    let mut parts = s.trim().splitn(3, '-');
    let year: i32 = parts.next()?.parse().ok()?;
    let month: u32 = parts.next()?.parse().ok()?;
    let day: u32 = parts.next()?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    Some((year, month, day))
}

fn time_julian_cent(jd: f64) -> f64 {
    (jd - 2451545.0) / 36525.0
}
fn geom_mean_long_sun(t: f64) -> f64 {
    (280.46646 + t * (36000.76983 + t * 0.0003032)).rem_euclid(360.0)
}
fn geom_mean_anomaly_sun(t: f64) -> f64 {
    357.52911 + t * (35999.05029 - 0.0001537 * t)
}
fn eccentricity_earth_orbit(t: f64) -> f64 {
    0.016708634 - t * (0.000042037 + 0.0000001267 * t)
}
fn sun_eq_of_center(t: f64) -> f64 {
    let m = geom_mean_anomaly_sun(t);
    let mrad = deg2rad(m);
    let sinm = mrad.sin();
    let sin2m = (2.0 * mrad).sin();
    let sin3m = (3.0 * mrad).sin();
    sinm * (1.914602 - t * (0.004817 + 0.000014 * t))
        + sin2m * (0.019993 - 0.000101 * t)
        + sin3m * 0.000289
}
fn sun_true_long(t: f64) -> f64 {
    geom_mean_long_sun(t) + sun_eq_of_center(t)
}
fn sun_apparent_long(t: f64) -> f64 {
    let o = sun_true_long(t);
    let omega = 125.04 - 1934.136 * t;
    o - 0.00569 - 0.00478 * deg2rad(omega).sin()
}
fn mean_obliquity_of_ecliptic(t: f64) -> f64 {
    let seconds = 21.448 - t * (46.8150 + t * (0.00059 - t * 0.001813));
    23.0 + (26.0 + seconds / 60.0) / 60.0
}
fn obliquity_correction(t: f64) -> f64 {
    let e0 = mean_obliquity_of_ecliptic(t);
    let omega = 125.04 - 1934.136 * t;
    e0 + 0.00256 * deg2rad(omega).cos()
}
fn sun_declination(t: f64) -> f64 {
    let e = obliquity_correction(t);
    let lambda = sun_apparent_long(t);
    let sint = deg2rad(e).sin() * deg2rad(lambda).sin();
    rad2deg(sint.asin())
}
fn equation_of_time(t: f64) -> f64 {
    let epsilon = obliquity_correction(t);
    let l0 = geom_mean_long_sun(t);
    let e = eccentricity_earth_orbit(t);
    let m = geom_mean_anomaly_sun(t);
    let y = {
        let tan_half = deg2rad(epsilon / 2.0).tan();
        tan_half * tan_half
    };
    let sin2l0 = (2.0 * deg2rad(l0)).sin();
    let sinm = deg2rad(m).sin();
    let cos2l0 = (2.0 * deg2rad(l0)).cos();
    let sin4l0 = (4.0 * deg2rad(l0)).sin();
    let sin2m = (2.0 * deg2rad(m)).sin();
    let e_time = y * sin2l0 - 2.0 * e * sinm + 4.0 * e * y * sinm * cos2l0
        - 0.5 * y * y * sin4l0
        - 1.25 * e * e * sin2m;
    rad2deg(e_time) * 4.0 // minutes of time
}
/// Solar zenith angle defining sunrise/sunset — bakes in standard
/// atmospheric refraction plus the sun's apparent radius, same convention
/// NOAA's calculator uses.
const SUNRISE_ZENITH_DEG: f64 = 90.833;
/// Solar zenith angle defining civil twilight (sun 6° below the horizon) —
/// conventionally the point where outdoor light stops being usable and
/// headlights go on, which is exactly the boundary the dawn/dusk ramp is
/// modelling.
const CIVIL_TWILIGHT_ZENITH_DEG: f64 = 96.0;

/// Hour angle (degrees) at which the sun reaches `zenith_deg`. `None` for a
/// latitude/declination that never reaches it that day (polar day/night, or
/// a high-latitude summer night that never gets dark enough for civil
/// twilight to end).
fn hour_angle_deg(lat: f64, solar_dec: f64, zenith_deg: f64) -> Option<f64> {
    let lat_rad = deg2rad(lat);
    let sd_rad = deg2rad(solar_dec);
    let ha_arg =
        deg2rad(zenith_deg).cos() / (lat_rad.cos() * sd_rad.cos()) - lat_rad.tan() * sd_rad.tan();
    if !(-1.0..=1.0).contains(&ha_arg) {
        return None;
    }
    Some(rad2deg(ha_arg.acos()))
}

/// Sunrise/sunset time-of-day (minutes since UTC midnight), for the given
/// calendar date and location (`latitude`/`longitude` in degrees, standard
/// geographic convention — longitude positive East). Returns `None` for a
/// date/latitude with no sunrise or sunset that day (polar day/night) — not
/// expected for any real racing circuit, but handled rather than panicking.
pub fn compute_sunrise_sunset(
    year: i32,
    month: u32,
    day: u32,
    latitude: f64,
    longitude: f64,
) -> Option<(f64, f64)> {
    let jd = julian_day_number(year, month, day);
    let t = time_julian_cent(jd);
    let eq_time = equation_of_time(t);
    let solar_dec = sun_declination(t);
    let ha_deg = hour_angle_deg(latitude, solar_dec, SUNRISE_ZENITH_DEG)?;

    // NOAA's own formula takes longitude WEST-positive (opposite of the
    // standard East-positive geographic convention this app/Nominatim use
    // everywhere else) — negate at this boundary only.
    let west_lon = -longitude;
    let sunrise_min = 720.0 - 4.0 * (west_lon + ha_deg) - eq_time;
    let sunset_min = 720.0 - 4.0 * (west_lon - ha_deg) - eq_time;

    Some((
        sunrise_min.rem_euclid(1440.0),
        sunset_min.rem_euclid(1440.0),
    ))
}

/// Width (minutes) of the dawn/dusk ramp for the given date and location —
/// i.e. `NightMode.sim_transition_minutes`, derived rather than guessed.
///
/// dayNightSim.ts centres the ramp ON sunrise/sunset with half-width
/// `transition / 2`, so half of it falls before sunrise and half after. Civil
/// twilight (sun from -6° up to the horizon) is the natural half-width: the
/// ramp then begins at civil dawn — the point conventionally treated as
/// "lights on" — and ends as far after sunrise as it began before it. Hence
/// the factor of 2. Each degree of hour angle is 4 minutes of rotation.
///
/// Latitude matters a lot here, which is the whole reason not to leave this
/// as a fixed default: civil twilight is ~21 minutes at the equator but
/// stretches past an hour at Spa in midwinter. Returns `None` at latitudes
/// where the sun never crosses one of the two boundaries that day.
pub fn compute_transition_minutes(
    year: i32,
    month: u32,
    day: u32,
    latitude: f64,
    _longitude: f64,
) -> Option<f64> {
    let t = time_julian_cent(julian_day_number(year, month, day));
    let solar_dec = sun_declination(t);
    let ha_sunrise = hour_angle_deg(latitude, solar_dec, SUNRISE_ZENITH_DEG)?;
    let ha_civil = hour_angle_deg(latitude, solar_dec, CIVIL_TWILIGHT_ZENITH_DEG)?;
    Some(2.0 * 4.0 * (ha_civil - ha_sunrise))
}

/// Rounds a raw transition width onto the Dawn/dusk slider's own domain
/// (0..240, step 5 — see DayNightSimPanel.tsx's `configSchema`) so a computed
/// value lands exactly on a slider stop instead of a hair off one, which
/// would otherwise read back as an unsaved edit.
pub fn quantize_transition_minutes(minutes: f64) -> i64 {
    ((minutes / 5.0).round() as i64 * 5).clamp(0, 240)
}

/// Minutes since midnight -> "HH:MM", matching dayNightSim.ts's
/// formatTimeOfDay convention on the frontend.
pub fn format_hhmm(minutes: f64) -> String {
    let m = (minutes.round() as i64).rem_euclid(1440);
    format!("{:02}:{:02}", m / 60, m % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equator_equinox_is_six_and_eighteen_utc() {
        // Longitude 0, equator, equinox: day = night = 12h exactly, solar
        // noon at longitude 0 is 12:00 UTC (modulo a few minutes for the
        // equation of time) — sunrise/sunset should fall almost exactly at
        // 06:00/18:00 UTC. This checks the algorithm from first principles,
        // independent of any recalled/possibly-misremembered almanac value.
        let (rise, set) = compute_sunrise_sunset(2024, 3, 20, 0.0, 0.0).unwrap();
        assert!(
            (rise - 6.0 * 60.0).abs() < 15.0,
            "sunrise {rise} not close to 06:00"
        );
        assert!(
            (set - 18.0 * 60.0).abs() < 15.0,
            "sunset {set} not close to 18:00"
        );
    }

    // These check well-known, independently-verifiable astronomical facts
    // (day length at a given latitude/date, roughly where solar noon should
    // fall) rather than exact clock times pulled from memory — a first
    // attempt at this pinned exact "published" sunrise/sunset times that
    // turned out to be misremembered (off by up to ~70 minutes on sunrise
    // specifically), while the algorithm itself was already correct
    // (confirmed via the equator/equinox check above, an exact solar
    // declination match at the solstice, and independently hand-verified
    // hour-angle trigonometry) — a lesson in not trusting recalled "I think
    // sunrise is around X" facts as ground truth for a regression test.
    #[test]
    fn silverstone_summer_solstice_day_length() {
        // Silverstone Circuit, UK: 52.0786 N, -1.0169 E, 2024-06-21 (solstice).
        // Well-known real-world day length for this latitude on the summer
        // solstice is ~16h45m-16h50m.
        let (rise, set) = compute_sunrise_sunset(2024, 6, 21, 52.0786, -1.0169).unwrap();
        let day_length_min = set - rise;
        assert!(
            (16.5 * 60.0..17.0 * 60.0).contains(&day_length_min),
            "day length {day_length_min} min not in expected 16.5-17h range"
        );
        // Solar noon (near-longitude-0 site) should fall near 12:00 UTC.
        assert!((rise + set) / 2.0 - 12.0 * 60.0 < 15.0);
    }

    #[test]
    fn monza_spring_equinox_day_length() {
        // Autodromo Nazionale Monza, Italy: 45.6156 N, 9.2811 E, 2024-03-20
        // (within a day of the equinox). Day length anywhere on Earth at the
        // equinox is close to 12h, always a little OVER due to atmospheric
        // refraction (the same effect baked into hour_angle_deg's 90.833°
        // constant) — typically 10-14 minutes over, not under.
        let (rise, set) = compute_sunrise_sunset(2024, 3, 20, 45.6156, 9.2811).unwrap();
        let day_length_min = set - rise;
        assert!(
            (12.0 * 60.0..12.0 * 60.0 + 20.0).contains(&day_length_min),
            "day length {day_length_min} min not in expected 12h-12h20m range"
        );
    }

    #[test]
    fn format_hhmm_wraps() {
        assert_eq!(format_hhmm(0.0), "00:00");
        assert_eq!(format_hhmm(283.0), "04:43");
        assert_eq!(format_hhmm(1440.0), "00:00");
        assert_eq!(format_hhmm(-30.0), "23:30");
    }

    #[test]
    fn parses_iso_date() {
        assert_eq!(parse_iso_date("2024-06-21"), Some((2024, 6, 21)));
        assert_eq!(parse_iso_date("bogus"), None);
        assert_eq!(parse_iso_date("2024-13-01"), None);
    }

    #[test]
    fn julian_day_number_round_trips_through_its_inverse() {
        // The forward and inverse algorithms carry different magic-constant
        // sets (-32045 vs +32044); this is what keeps them honest. Spans a
        // leap day, a century non-leap (1900), and a 400-year leap (2000).
        for (y, m, d) in [
            (1900, 2, 28),
            (1970, 1, 1),
            (2000, 2, 29),
            (2024, 6, 17),
            (2024, 12, 31),
            (2026, 9, 1),
        ] {
            let jdn = julian_day_number(y, m, d) as i64;
            assert_eq!(civil_from_julian_day_number(jdn), (y, m, d), "{y}-{m}-{d}");
        }
    }

    #[test]
    fn iso_date_from_epoch_seconds_matches_known_instants() {
        assert_eq!(iso_date_from_epoch_seconds(0), "1970-01-01");
        // The exact in-game instant this feature was verified against
        // (2024-06-17 12:57:27 UTC), plus its own midnight boundaries.
        assert_eq!(iso_date_from_epoch_seconds(1_718_629_047), "2024-06-17");
        assert_eq!(iso_date_from_epoch_seconds(1_718_582_400), "2024-06-17");
        assert_eq!(iso_date_from_epoch_seconds(1_718_582_399), "2024-06-16");
        // Negative (pre-epoch) must floor, not truncate toward zero.
        assert_eq!(iso_date_from_epoch_seconds(-1), "1969-12-31");
    }

    #[test]
    fn transition_is_about_forty_minutes_at_the_equator() {
        // Civil twilight at the equator is ~21 min year-round, so the
        // sunrise-centred ramp spans ~42 — which is why 40 was a defensible
        // hardcoded default before this was computed.
        let t = compute_transition_minutes(2024, 3, 20, 0.0, 0.0).unwrap();
        assert!((t - 42.0).abs() < 4.0, "equator transition {t} not ~42min");
    }

    #[test]
    fn transition_widens_with_latitude_in_winter() {
        // Spa (50.44°N) in midwinter has markedly longer twilight than the
        // equator — the whole reason for deriving this per track/date rather
        // than leaving one fixed number for every circuit.
        let equator = compute_transition_minutes(2024, 12, 21, 0.0, 0.0).unwrap();
        let spa = compute_transition_minutes(2024, 12, 21, 50.4372, 5.9714).unwrap();
        assert!(
            spa > equator + 20.0,
            "spa {spa} not much wider than equator {equator}"
        );
        assert!(spa < 240.0, "spa {spa} outside the slider's domain");
    }

    #[test]
    fn quantize_snaps_to_slider_stops_and_clamps() {
        assert_eq!(quantize_transition_minutes(42.3), 40);
        assert_eq!(quantize_transition_minutes(43.0), 45);
        assert_eq!(quantize_transition_minutes(-5.0), 0);
        assert_eq!(quantize_transition_minutes(9999.0), 240);
    }
}
