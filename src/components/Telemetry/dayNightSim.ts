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
// DUSK is measured, not chosen, and the numbers survived a correction that
// invalidated the first attempt. AC reports time-of-day in the track's CIVIL
// LOCAL time while the solar maths works in UTC, so every elevation derived
// from a clock observation was initially two hours wrong (see
// night_clock::clock_utc_offset_minutes).
//
// Corrected, two independent sessions agree: on 21 Sept the sky began
// changing at +6.84 and stopped at -10.73, and on 22 June it read fully dark
// at -11.27. Those two end-points are within half a degree of each other
// having been 11.5 degrees apart before the correction, which is the real
// evidence the offset is right. Hence full day at +7, full night at -11.
//
// DAWN is NOT measured to the same standard and is known to disagree. It came
// from stepping up from 05:15 — already -3.9 degrees — and reporting the first
// change seen after starting, so it is bounded by where the scrub began rather
// than by the sky. Taken at face value it says the sky is dark at -3.9, while
// the dusk pair says it is fully lit at -7.26; both cannot be true of a
// symmetric sky. Left as-is pending a dawn re-measure using the dusk method
// (scrub from well before anything is expected), at which point these two
// bands will most likely collapse into one.
export const SUN_ELEVATION_NIGHT_DEG = -2;
export const SUN_ELEVATION_DAY_DEG = 15;

// Dusk's own bounds, from the measurement above.
export const SUN_ELEVATION_DUSK_NIGHT_DEG = -11;
export const SUN_ELEVATION_DUSK_DAY_DEG = 7;

// 0 = full day, 1 = full night, for a given sun elevation.
//
// `rising` picks the band. The two are separate because they were arrived at
// separately, and an earlier version that derived dusk by mirroring dawn was
// wrong twice over: it put the transition BEFORE sunset (52% night with the
// sun still 6 degrees up), and mirroring assumed a symmetry the game does not
// obviously have. The bands should match the sky, not each other.
//
// Smoothstep rather than linear. A linear ramp changes brightness fastest at
// the very start, when the sky is changing least, and the mismatch reads as
// the dashboard running ahead of the game. Easing both ends starts slow,
// moves quickest through the middle of the transition, and settles gently.
export function nightAmountFromSunElevation(elevationDeg: number, rising = true): number {
  const nightAt = rising ? SUN_ELEVATION_NIGHT_DEG : SUN_ELEVATION_DUSK_NIGHT_DEG;
  const dayAt = rising ? SUN_ELEVATION_DAY_DEG : SUN_ELEVATION_DUSK_DAY_DEG;
  const t = Math.max(0, Math.min(1, (elevationDeg - nightAt) / (dayAt - nightAt)));
  const lit = t * t * (3 - 2 * t);
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
