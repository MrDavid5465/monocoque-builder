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

export interface SimulatedNightState {
  // 0 = full day, 1 = full night, continuous through the dawn/dusk ramp.
  nightAmount: number;
}

// Turns a simulated-time instant (ms since epoch, as pushed by the
// nightClock subscription) into a day/night blend. Returns null if
// sunrise/sunset aren't configured yet.
export function computeSimulatedNightState(simTimeMs: number, config: NightRampConfig): SimulatedNightState | null {
  const sunriseMin = parseTimeOfDay(config.simSunrise);
  const sunsetMin = parseTimeOfDay(config.simSunset);
  if (sunriseMin == null || sunsetMin == null) return null;
  const halfT = Math.max(0, (config.simTransitionMinutes ?? 40) / 2);

  const simDate = new Date(simTimeMs);
  const minOfDay = simDate.getUTCHours() * 60 + simDate.getUTCMinutes() + simDate.getUTCSeconds() / 60;

  const dSunrise = shortestSignedDistance(sunriseMin, minOfDay); // minutes AFTER sunrise (negative = before)
  const dSunset = shortestSignedDistance(sunsetMin, minOfDay);
  const inDawnRamp = halfT > 0 && Math.abs(dSunrise) <= halfT;
  const inDuskRamp = halfT > 0 && Math.abs(dSunset) <= halfT;

  let nightAmount: number;
  if (inDawnRamp) {
    nightAmount = 0.5 - dSunrise / (2 * halfT);
  } else if (inDuskRamp) {
    nightAmount = 0.5 + dSunset / (2 * halfT);
  } else {
    const dayLength = wrapMinutes(sunsetMin - sunriseMin);
    const sinceSunrise = wrapMinutes(minOfDay - sunriseMin);
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
): EffectiveNightState {
  if (record.simEnabled && simTimeMs != null) {
    const sim = computeSimulatedNightState(simTimeMs, record);
    if (sim) return { isNight: sim.nightAmount >= 0.5, nightAmount: sim.nightAmount };
  }
  return { isNight: record.isNight, nightAmount: record.isNight ? 1 : 0 };
}
