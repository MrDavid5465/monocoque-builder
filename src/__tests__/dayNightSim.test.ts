import { describe, it, expect } from 'vitest';
import {
  parseTimeOfDay,
  formatTimeOfDay,
  computeSimulatedNightState,
  computeEffectiveNightState,
  computeToggleDeltaMinutes,
  NightRampConfig,
} from '../components/Telemetry/dayNightSim';

function config(overrides: Partial<NightRampConfig> = {}): NightRampConfig {
  return {
    simSunrise: '06:00',
    simSunset: '20:00',
    simTransitionMinutes: 40,
    ...overrides,
  };
}

// ─── parseTimeOfDay / formatTimeOfDay ──────────────────────────────────────

describe('parseTimeOfDay', () => {
  it('parses HH:MM into minutes since midnight', () => {
    expect(parseTimeOfDay('06:00')).toBe(360);
    expect(parseTimeOfDay('23:59')).toBe(1439);
    expect(parseTimeOfDay('00:00')).toBe(0);
  });
  it('returns null for missing/invalid input', () => {
    expect(parseTimeOfDay(undefined)).toBeNull();
    expect(parseTimeOfDay(null)).toBeNull();
    expect(parseTimeOfDay('')).toBeNull();
    expect(parseTimeOfDay('25:00')).toBeNull();
    expect(parseTimeOfDay('bogus')).toBeNull();
  });
});

describe('formatTimeOfDay', () => {
  it('formats minutes back into HH:MM, wrapping past 24h', () => {
    expect(formatTimeOfDay(360)).toBe('06:00');
    expect(formatTimeOfDay(0)).toBe('00:00');
    expect(formatTimeOfDay(1439)).toBe('23:59');
    expect(formatTimeOfDay(1440)).toBe('00:00');
    expect(formatTimeOfDay(-30)).toBe('23:30');
  });
});

// ─── computeSimulatedNightState ─────────────────────────────────────────────
// simTimeMs is now handed in directly (as the nightClock subscription would
// push it), rather than extrapolated from a stored anchor + Date.now().

describe('computeSimulatedNightState', () => {
  it('returns null when sunrise/sunset are unparseable', () => {
    const noon = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(computeSimulatedNightState(noon, config({ simSunrise: null }))).toBeNull();
    expect(computeSimulatedNightState(noon, config({ simSunset: 'nope' }))).toBeNull();
  });

  it('is full day at noon, far from either boundary', () => {
    const noon = Date.UTC(2026, 0, 1, 12, 0, 0);
    const state = computeSimulatedNightState(noon, config())!;
    expect(state.nightAmount).toBe(0);
  });

  it('is full night at midnight', () => {
    const midnight = Date.UTC(2026, 0, 1, 0, 0, 0);
    const state = computeSimulatedNightState(midnight, config())!;
    expect(state.nightAmount).toBe(1);
  });

  it('is exactly 0.5 at the sunrise instant', () => {
    const sixAm = Date.UTC(2026, 0, 1, 6, 0, 0);
    const state = computeSimulatedNightState(sixAm, config())!;
    expect(state.nightAmount).toBeCloseTo(0.5, 5);
  });

  it('ramps linearly through the dawn window', () => {
    // 10 min before sunrise, halfway through a 20-min-half-width dawn ramp -> 3/4 night.
    const tenMinBeforeSunrise = Date.UTC(2026, 0, 1, 5, 50, 0);
    const state = computeSimulatedNightState(tenMinBeforeSunrise, config({ simTransitionMinutes: 40 }))!;
    expect(state.nightAmount).toBeCloseTo(0.75, 5);
  });

  it('ramps the other direction through dusk (day -> night)', () => {
    const tenMinAfterSunset = Date.UTC(2026, 0, 1, 20, 10, 0);
    const state = computeSimulatedNightState(tenMinAfterSunset, config({ simTransitionMinutes: 40 }))!;
    expect(state.nightAmount).toBeCloseTo(0.75, 5);
  });

  it('handles a sunset near midnight without wraparound glitches', () => {
    const fiveMinAfterSunset = Date.UTC(2026, 0, 2, 0, 5, 0);
    const state = computeSimulatedNightState(
      fiveMinAfterSunset,
      config({ simSunrise: '06:00', simSunset: '23:50', simTransitionMinutes: 40 }),
    )!;
    expect(state.nightAmount).toBeGreaterThan(0.5);
    expect(state.nightAmount).toBeLessThan(1);
  });
});

// ─── computeToggleDeltaMinutes ──────────────────────────────────────────────
// The manual toggle button, while simulation is active, nudges the
// simulated clock to whichever of midnight/noon is the opposite of what's
// currently showing, rather than switching back to manual mode.

describe('computeToggleDeltaMinutes', () => {
  it('currently night -> moves forward to the nearer noon (force day)', () => {
    const sixAm = Date.UTC(2026, 0, 1, 6, 0, 0);
    expect(computeToggleDeltaMinutes(sixAm, true)).toBe(360); // 06:00 -> 12:00
    const elevenAm = Date.UTC(2026, 0, 1, 11, 0, 0);
    expect(computeToggleDeltaMinutes(elevenAm, true)).toBe(60); // 11:00 -> 12:00
  });

  it('currently day -> moves to the nearer midnight (force night), picking whichever direction is shorter', () => {
    const sixPm = Date.UTC(2026, 0, 1, 18, 0, 0);
    expect(computeToggleDeltaMinutes(sixPm, false)).toBe(360); // 18:00 -> forward to next 00:00
    const oneAm = Date.UTC(2026, 0, 1, 1, 0, 0);
    expect(computeToggleDeltaMinutes(oneAm, false)).toBe(-60); // 01:00 -> backward to same-day 00:00
  });
});

// ─── computeEffectiveNightState ─────────────────────────────────────────────

describe('computeEffectiveNightState', () => {
  it('uses the manual value when simEnabled is false, regardless of sim config', () => {
    const midnight = Date.UTC(2026, 0, 1, 0, 0, 0); // sim would say "night" here, but manual mode ignores it
    const c = { ...config(), simEnabled: false };
    expect(computeEffectiveNightState({ ...c, isNight: true }, midnight)).toMatchObject({ isNight: true, nightAmount: 1 });
    expect(computeEffectiveNightState({ ...c, isNight: false }, midnight)).toMatchObject({ isNight: false, nightAmount: 0 });
  });

  it('uses the simulated clock when simEnabled is true, regardless of the manual value', () => {
    const midnight = Date.UTC(2026, 0, 1, 0, 0, 0);
    const c = { ...config(), simEnabled: true };
    // Manual value says day, but sim mode is authoritative and it's simulated midnight -> night.
    const state = computeEffectiveNightState({ ...c, isNight: false }, midnight);
    expect(state.isNight).toBe(true);
    expect(state.nightAmount).toBe(1);
  });

  it('falls back to manual if simEnabled is true but sunrise/sunset are not configured', () => {
    const noon = Date.UTC(2026, 0, 1, 12, 0, 0);
    const state = computeEffectiveNightState({ isNight: true, simEnabled: true, simSunrise: null }, noon);
    expect(state).toMatchObject({ isNight: true, nightAmount: 1 });
  });

  it('falls back to manual if simEnabled is true but no clock tick has arrived yet', () => {
    const state = computeEffectiveNightState({ ...config(), isNight: true, simEnabled: true }, null);
    expect(state).toMatchObject({ isNight: true, nightAmount: 1 });
  });
});
