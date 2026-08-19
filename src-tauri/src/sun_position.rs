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
/// Hour angle (degrees) of sunrise/sunset — `90.833°` bakes in standard
/// atmospheric refraction plus the sun's apparent radius, same convention
/// NOAA's calculator uses. `None` for a latitude/declination with no
/// sunrise or sunset that day (polar day/night).
fn hour_angle_deg(lat: f64, solar_dec: f64) -> Option<f64> {
    let lat_rad = deg2rad(lat);
    let sd_rad = deg2rad(solar_dec);
    let ha_arg =
        deg2rad(90.833).cos() / (lat_rad.cos() * sd_rad.cos()) - lat_rad.tan() * sd_rad.tan();
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
    let ha_deg = hour_angle_deg(latitude, solar_dec)?;

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
}
