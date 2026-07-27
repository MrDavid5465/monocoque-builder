import { describe, it, expect } from 'vitest';
import { toInput, buildConfigText, nextPan } from '../components/Shakers/ShakerMatrix';
import { ShakerRec } from '../components/Shakers/EffectRow';
import { ShakerChannel } from '../components/Shakers/channelQueries';

// ─── test fixtures ────────────────────────────────────────────────────────────

function rec(overrides: Partial<ShakerRec>): ShakerRec {
  return {
    id: 'r1', device: 'Sound', effect: 'engine',
    channelId: 'c1', volume: 100, modulation: 'frequency',
    ...overrides,
  };
}

function chan(overrides: Partial<ShakerChannel>): ShakerChannel {
  return {
    id: 'c1', pan: 0, devid: 'dev1', channels: 4, position: null,
    ...overrides,
  };
}

// ─── nextPan ──────────────────────────────────────────────────────────────────

describe('nextPan', () => {
  it('returns 0 for no existing channels', () => {
    expect(nextPan([])).toBe(0);
  });

  it('returns max pan + 1', () => {
    expect(nextPan([chan({ pan: 0 }), chan({ pan: 2 })])).toBe(3);
  });
});

// ─── toInput ─────────────────────────────────────────────────────────────────

describe('toInput', () => {
  it('serialises a record with no override', () => {
    const r = rec({ channelId: 'c2', volume: 80 });
    const input = toInput(r);
    expect(input.channelId).toBe('c2');
    expect(input.volume).toBe(80);
  });

  it('applies override values', () => {
    const r = rec({ volume: 80 });
    const input = toInput(r, { volume: 60 });
    expect(input.volume).toBe(60);
  });

  it('converts undefined frequency to null', () => {
    const r = rec({ frequency: undefined });
    const input = toInput(r);
    expect(input.frequency).toBeNull();
  });

  it('preserves non-null frequency values', () => {
    const r = rec({ frequency: 80, frequencyMax: 150 });
    const input = toInput(r);
    expect(input.frequency).toBe(80);
    expect(input.frequencyMax).toBe(150);
  });
});

// ─── buildConfigText ──────────────────────────────────────────────────────────

describe('buildConfigText', () => {
  it('produces valid top-level monocoque config structure', () => {
    const text = buildConfigText([], [], false);
    expect(text).toMatch(/^configs = \(/);
    expect(text).toContain('sim = "default"');
    expect(text).toContain('car = "default"');
    expect(text).toContain('devices = (');
    expect(text).toMatch(/\);\n$/);
  });

  it('includes required fields for each record, sourced from its channel', () => {
    const c = chan({ id: 'ch1', pan: 0, devid: 'dev-001', channels: 4 });
    const r = rec({ effect: 'engine', channelId: 'ch1', volume: 100 });
    const text = buildConfigText([r], [c], false);
    expect(text).toContain('device       = "Sound"');
    expect(text).toContain('effect       = "engine"');
    expect(text).toContain('devid        = "dev-001"');
    expect(text).toContain('channels     = 4');
    expect(text).toContain('pan          = 0');
    expect(text).toContain('volume       = 100');
  });

  it('includes tyre field for tyre-capable effects when position set', () => {
    const c = chan({ id: 'ch1', position: 'FrontLeft' });
    const r = rec({ effect: 'suspension', channelId: 'ch1' });
    expect(buildConfigText([r], [c], false)).toContain('tyre         = "FrontLeft"');
  });

  // Only emitted for tyre-capable effects at all — Monocoque's gettyre() is
  // only ever called for TYRESLIP/TYRELOCK/ABSBRAKES/SUSPENSION (confirmed
  // directly against confighelper.c), so engine/gear never reach that code
  // path and never need the line, avoiding the real NULL/garbage-pointer bug
  // (confirmed via gdb: SIGSEGV in confighelper.c:591) some other way.
  it('omits tyre field entirely for non-tyre effects (engine/gear)', () => {
    const c = chan({ id: 'ch1', position: 'FrontLeft' });
    const r = rec({ effect: 'engine', channelId: 'ch1' });
    expect(buildConfigText([r], [c], false)).not.toContain('tyre         =');
  });

  it('falls back to tyre = "AllFour" for a tyre effect with no position set yet', () => {
    const c = chan({ id: 'ch1', position: null });
    const r = rec({ effect: 'abs', channelId: 'ch1' });
    expect(buildConfigText([r], [c], false)).toContain('tyre         = "AllFour"');
  });

  it('includes frequency fields when set', () => {
    const c = chan({ id: 'c1' });
    const r = rec({ channelId: 'c1', frequency: 80, frequencyMax: 150, amplitude: 50, amplitudeMax: 90 });
    const text = buildConfigText([r], [c], false);
    expect(text).toContain('frequency    = 80');
    expect(text).toContain('frequencyMax = 150');
    expect(text).toContain('amplitude    = 50');
    expect(text).toContain('amplitudeMax = 90');
  });

  it('omits optional numeric fields when null', () => {
    const c = chan({ id: 'c1' });
    const r = rec({ channelId: 'c1', frequency: null, frequencyMax: null, amplitude: null, amplitudeMax: null });
    const text = buildConfigText([r], [c], false);
    expect(text).not.toContain('frequency    =');
    expect(text).not.toContain('frequencyMax =');
    expect(text).not.toContain('amplitude    =');
    expect(text).not.toContain('amplitudeMax =');
  });

  it('separates multiple device blocks with commas', () => {
    const channels = [chan({ id: 'c1', pan: 0 }), chan({ id: 'c2', pan: 100 })];
    const records = [rec({ channelId: 'c1' }), rec({ channelId: 'c2' })];
    const text = buildConfigText(records, channels, false);
    // Two blocks joined by ","
    expect(text.match(/\},\n {8}\{/)).toBeTruthy();
  });

  it('always uses the real physical pan from its channel, regardless of dspSlot', () => {
    const c = chan({ id: 'c1', pan: 2 });
    const r = rec({ channelId: 'c1', dspSlot: 17 });
    const text = buildConfigText([r], [c], false);
    expect(text).toContain('pan          = 2');
    expect(text).not.toContain('pan          = 17');
  });

  it('uses the real pan even if dspSlot is unset', () => {
    const c = chan({ id: 'c1', pan: 2 });
    const r = rec({ channelId: 'c1', dspSlot: null });
    const text = buildConfigText([r], [c], false);
    expect(text).toContain('pan          = 2');
  });

  // While DSP is enabled, devid/volume are substituted fresh at export time
  // only — never persisted to storage (see ShakerChannel.devid's backend
  // doc comment) — so buildConfigText itself has to compute the DSP-mode
  // override, unlike every other field which just echoes stored values. The
  // exported devid now also encodes which device it's on (device_slug),
  // since the same effect can have independent modules on multiple devices.
  it('substitutes the per-device-per-effect DSP sink devid and volume=100 when dspEnabled', () => {
    const c = chan({ id: 'c1', devid: 'real-hw-device' });
    const r = rec({ effect: 'engine', channelId: 'c1', volume: 55 });
    const text = buildConfigText([r], [c], true);
    expect(text).toContain('devid        = "shaker_dsp_real_hw_device_engine_in"');
    expect(text).toContain('volume       = 100');
    expect(text).not.toContain('real-hw-device');
  });

  it('uses the real devid and stored volume when DSP is disabled', () => {
    const c = chan({ id: 'c1', devid: 'real-hw-device' });
    const r = rec({ effect: 'engine', channelId: 'c1', volume: 55 });
    const text = buildConfigText([r], [c], false);
    expect(text).toContain('devid        = "real-hw-device"');
    expect(text).toContain('volume       = 55');
  });
});
