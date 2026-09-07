// Pure computation for the simulated in-game day/night dawn/dusk ramp — see
// NightMode in src-tauri/src/typiql_types.rs for the field-level rationale.
// No telemetry field carries the sim's own date/time, so the *clock itself*
// is computed server-side (graphql/night_clock.rs) and pushed to every
// client via the nightClock subscription — this module only turns a given
// simulated-time instant into a day/night blend, it never extrapolates time
// itself (that used to happen here, per-client, from a stored anchor +
// Date.now(); different devices' clocks drifted apart from each other over
// hours, which was the whole reason the clock moved server-side). Every
// client receives the identical `simTimeMs` from the subscription, so
// computing the ramp from it here stays consistent across every dashboard.
//
// Deliberately UTC-only throughout (getUTCHours/Date.UTC, not local getters)
// so every viewer computes the identical simulated time-of-day regardless of
// its own timezone — only the numeric HH:MM offsets matter, not any
// real-world zone.

const DAY_MIN = 1440;

function wrapMinutes(x: number): number {
  return ((x % DAY_MIN) + DAY_MIN) % DAY_MIN;
}

// "HH:MM" (24h) -> minutes since midnight, or null if unparseable.
export function parseTimeOfDay(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function formatTimeOfDay(totalMinutes: number): string {
  const m = wrapMinutes(Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Shortest signed distance (minutes, -720..720) travelling from `from` to
// `to` around a 24h clock — positive means `to` is ahead of `from`.
function shortestSignedDistance(from: number, to: number): number {
  let d = wrapMinutes(to - from);
  if (d > DAY_MIN / 2) d -= DAY_MIN;
  return d;
}

export interface NightRampConfig {
  simSunrise?: string | null;
  simSunset?: string | null;
  simTransitionMinutes?: number | null;
}

// Sun elevation (degrees) bounding each blend: full night at or below the
// first, full day at or above the second.
//
// MEASURED, in game, not chosen — and they survived a correction that
// invalidated the first attempt. AC reports time-of-day in the track's CIVIL
// LOCAL time while the solar maths works in UTC, so every elevation derived
// from a clock observation was initially two hours wrong (see
// night_clock::clock_utc_offset_minutes).
//
// Three independent sessions at the Nurburgring agree on where the sky stops
// changing, approached from both directions:
//
//   21 Sept dusk   stopped changing 20:36 local  ->  -11.09
//   21 Sept dusk   (earlier session, same end)   ->  -10.73
//   22 June dawn   began brightening 03:30 local ->  -11.89
//
// Mean -11.24, hence full night at -11. The day end is measured the same way:
// 21 Sept the sky began changing at 18:45 local, which is +6.84, hence +7.
//
// A physically-derived curve was tried in place of this and REJECTED on the
// rig. It interpolated published horizontal-illuminance figures (100k lux in
// full sun, 3.4 at the end of civil twilight, 0.008 at nautical) in log space,
// and it agreed impressively about where night ARRIVES — reaching full dark at
// nautical twilight, within a degree of all three measurements above, and
// landing within 5 points of this band at sunset itself.
//
// Where it failed was the middle of twilight, and the gap is one-directional:
//
//   elev    this band   physical
//    -3       0.58        0.40
//    -6       0.81        0.61
//    -9       0.97        0.79
//
// Up to 20 points too bright through exactly the stretch that reads as "it's
// getting dark", which is what showed up in game as overexposed.
//
// The lesson is worth keeping. The model describes open air; the game renders
// its own sky, and that sky collapses toward dark faster than real twilight
// does once the sun is down. Where the two disagree, the measurements win —
// they were taken by watching the actual thing being modelled.
export const SUN_ELEVATION_NIGHT_DEG = -11;
export const SUN_ELEVATION_DAY_DEG = 7;

// Dusk's own bounds. Kept as separate constants even though they equal dawn's:
// the pairs were arrived at independently, so a future correction to either end
// of either band shouldn't have to first re-separate them.
export const SUN_ELEVATION_DUSK_NIGHT_DEG = -11;
export const SUN_ELEVATION_DUSK_DAY_DEG = 7;

// 0 = full day, 1 = full night, for a given sun elevation.
//
// `rising` picks the band. The two are kept separate because they were arrived
// at separately, and an earlier version that derived dusk by mirroring dawn was
// wrong twice over: it put the transition BEFORE sunset (52% night with the
// sun still 6 degrees up), and mirroring assumed a symmetry the game does not
// obviously have. The bands match today because both were measured and both
// landed in the same place — which is not the same thing as deriving one from
// the other, and mirroring still wouldn't produce them (it would put full
// night at -7, not -11).
//
// Smoothstep rather than linear. A linear ramp changes brightness fastest at
// the very start, when the sky is changing least, and the mismatch reads as
// the dashboard running ahead of the game. Easing both ends starts slow,
// moves quickest through the middle of the transition, and settles gently.
//
// The bias below then pulls the whole curve toward night, because a COCKPIT is
// not a sky. The interior is lit by ambient light only, so it loses light much
// faster than the horizon does — and the photographs being blended are of an
// interior.
//
// Fitted to one observation, in a PRACTICE session with manual time control:
// the in-game interior stops darkening noticeably at 22:50 sim, which a 10s
// interval trace of the same evening puts at -7.9 degrees. The exponent is
// chosen so the curve reaches full night there:
//
//   exponent   reaches 99% at   error vs the -7.9 anchor
//      1          -9.94              -2.04   (too late; keeps darkening
//                                             after the game has stopped)
//      2          -7.48              +0.42   <- chosen
//      3          -5.61              +2.29   (too early)
//
// Both endpoints are left exactly where they are, which is what having them
// independently confirmed correct requires.
//
// An earlier value of 3 came from a first report of near-max darkness at
// 22:00-22:30 (-2.66 to -5.78 degrees), made while driving a 2-hour-cycle
// multiplayer lobby with no time control. That was RETRACTED once the same
// thing was checked in a practice session where the clock could be held
// still — worth recording, because it is the one measurement in this file
// that a moving clock produced and it was two degrees out.
//
// Raise to darken sooner, lower to soften. 1 restores a plain smoothstep.
export const NIGHT_BIAS_EXPONENT = 2;

export function nightAmountFromSunElevation(elevationDeg: number, rising = true): number {
  const nightAt = rising ? SUN_ELEVATION_NIGHT_DEG : SUN_ELEVATION_DUSK_NIGHT_DEG;
  const dayAt = rising ? SUN_ELEVATION_DAY_DEG : SUN_ELEVATION_DUSK_DAY_DEG;
  const t = Math.max(0, Math.min(1, (elevationDeg - nightAt) / (dayAt - nightAt)));
  const lit = Math.pow(t * t * (3 - 2 * t), NIGHT_BIAS_EXPONENT);
  return 1 - lit;
}

export interface SimulatedNightState {
  // 0 = full day, 1 = full night, continuous through the dawn/dusk ramp.
  nightAmount: number;
}

// Turns a simulated-time instant (ms since epoch, as pushed by the
// nightClock subscription) into a day/night blend. Returns null if
// sunrise/sunset aren't configured yet.
//
// `sunElevationDeg` — also from the nightClock tick, computed server-side —
// wins whenever it's available, and the clock ramp below is the fallback for
// when it isn't (no track loaded, or no location configured for it).
//
// Elevation is preferred because it cannot disagree with the sky. The clock
// ramp has to assume where sunrise sits within the transition, and every
// version of that assumption has been wrong: centred on sunrise was too
// bright at sunrise, starting at sunrise was too bright too early, and both
// were computed from a real-world date that AC ignores anyway when it swings
// the sun on an equinox trajectory.
export function computeSimulatedNightState(
  simTimeMs: number,
  config: NightRampConfig,
  sunElevationDeg?: number | null,
  sunRising?: boolean | null,
): SimulatedNightState | null {
  if (sunElevationDeg != null && Number.isFinite(sunElevationDeg)) {
    return { nightAmount: nightAmountFromSunElevation(sunElevationDeg, sunRising ?? true) };
  }
  const sunriseMin = parseTimeOfDay(config.simSunrise);
  const sunsetMin = parseTimeOfDay(config.simSunset);
  if (sunriseMin == null || sunsetMin == null) return null;
  // The ramp starts AT the sunrise/sunset clock time and runs forward for the
  // full configured duration — it isn't centred on it. In-game, the sky is
  // still fully dark right at the calculated "sunrise" time; daylight only
  // arrives progressively over the following `simTransitionMinutes`, and the
  // same holds in reverse for sunset. A centred ramp made both transitions
  // appear to start too early (still dark well past the sunrise time).
  const t = Math.max(0, config.simTransitionMinutes ?? 40);

  const simDate = new Date(simTimeMs);
  const minOfDay = simDate.getUTCHours() * 60 + simDate.getUTCMinutes() + simDate.getUTCSeconds() / 60;

  const sinceSunrise = wrapMinutes(minOfDay - sunriseMin);
  const sinceSunset = wrapMinutes(minOfDay - sunsetMin);
  const inDawnRamp = t > 0 && sinceSunrise <= t;
  const inDuskRamp = t > 0 && sinceSunset <= t;

  let nightAmount: number;
  if (inDawnRamp) {
    nightAmount = 1 - sinceSunrise / t;
  } else if (inDuskRamp) {
    nightAmount = sinceSunset / t;
  } else {
    const dayLength = wrapMinutes(sunsetMin - sunriseMin);
    nightAmount = sinceSunrise < dayLength ? 0 : 1;
  }
  nightAmount = Math.max(0, Math.min(1, nightAmount));

  return { nightAmount };
}

// The manual toggle button, while simulation is active, doesn't switch back
// to manual mode — it stays simulated and instead nudges the simulated
// clock to whichever of midnight/noon is the OPPOSITE of what's currently
// showing (midnight is reliably deep-night, noon reliably deep-day,
// regardless of the configured sunrise/sunset), returning the delta the
// existing adjustNightClockTime mutation expects. Picks the shorter
// direction (could be forward or backward) since the simulated date itself
// is irrelevant to the day/night computation, only the time-of-day is.
export function computeToggleDeltaMinutes(simTimeMs: number, currentlyNight: boolean): number {
  const targetMinOfDay = currentlyNight ? 720 : 0; // night -> noon (force day), day -> midnight (force night)
  const simDate = new Date(simTimeMs);
  const currentMinOfDay = simDate.getUTCHours() * 60 + simDate.getUTCMinutes() + simDate.getUTCSeconds() / 60;
  return shortestSignedDistance(currentMinOfDay, targetMinOfDay);
}

export interface EffectiveNightState {
  isNight: boolean;
  // 0..1, continuous. Manual mode produces a hard 0/1 (its own ~2s CSS
  // crossfade handles the visual smoothing); simulated mode produces a
  // continuous ramp through dawn/dusk.
  nightAmount: number;
}

// `simEnabled` is an explicit mode switch, not a hint: true means the
// simulated clock is authoritative (falling back to manual only if
// sunrise/sunset aren't configured yet, or no nightClock tick has arrived
// yet), false means the manual toggle is authoritative regardless of
// whatever simulation config happens to be saved.
export function computeEffectiveNightState(
  record: { isNight: boolean; simEnabled?: boolean | null } & NightRampConfig,
  simTimeMs: number | null,
  sunElevationDeg?: number | null,
  sunRising?: boolean | null,
): EffectiveNightState {
  if (record.simEnabled && simTimeMs != null) {
    const sim = computeSimulatedNightState(simTimeMs, record, sunElevationDeg, sunRising);
    if (sim) return { isNight: sim.nightAmount >= 0.5, nightAmount: sim.nightAmount };
  }
  return { isNight: record.isNight, nightAmount: record.isNight ? 1 : 0 };
}
