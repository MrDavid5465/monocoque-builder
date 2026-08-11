import { useState, useEffect, useRef, useMemo } from 'react';
import { TelemetryBinding } from '../../../types/dashboard';

export interface SweepParams {
  durationMs: number;
  peak: number;
  holdMs: number;
  loop: boolean;
}

export interface SineParams {
  periodMs: number;
  amplitude: number;
  center: number;
  loop: boolean;
}

export type SequenceConfig =
  | { type: 'sweep'; params: SweepParams }
  | { type: 'sine'; params: SineParams };

// Shared default, used both as the fallback for dashboards saved before
// sequenceConfig was persisted and as the seed value PlaybackPanel's type
// switcher writes when toggling to 'sweep'.
export const DEFAULT_SWEEP_CONFIG: SequenceConfig = {
  type: 'sweep',
  params: { durationMs: 2000, peak: 0.9, holdMs: 300, loop: false },
};

// Seed value PlaybackPanel's type switcher writes when toggling to 'sine'.
export const DEFAULT_SINE_CONFIG: SequenceConfig = {
  type: 'sine',
  params: { periodMs: 3000, amplitude: 0.6, center: 0.4, loop: true },
};

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

// A single test value gets synthesized per telemetry field, shared across
// every gauge bound to it — matching how a real field like rpm is one value
// across the whole dashboard. When multiple gauges bind the same field with
// different ranges (e.g. a full-range needle plus a redline-only background
// gauge), the union of those ranges is used, not just whichever binding
// happened to be encountered first — otherwise gauges with a wider range
// than the first-seen one never see their low end swept/previewed at all.
function collectFieldRanges(
  bindings: Array<{ binding?: TelemetryBinding }>,
): Map<string, { inputMin: number; inputMax: number }> {
  const fields = new Map<string, { inputMin: number; inputMax: number }>();
  for (const item of bindings) {
    const b = item.binding;
    if (!b) continue;
    const existing = fields.get(b.field);
    fields.set(b.field, existing
      ? { inputMin: Math.min(existing.inputMin, b.inputMin), inputMax: Math.max(existing.inputMax, b.inputMax) }
      : { inputMin: b.inputMin, inputMax: b.inputMax });
  }
  return fields;
}

// Static counterpart to computeFrame's per-tick sweep/sine math — holds every
// bound field at a fixed fraction (0 = inputMin, 1 = inputMax) instead of
// animating it. Backs the editor's manual "preview position" slider, which
// makes bound elements visible for placement without needing to run a sweep.
export function computeStaticFrame(
  fraction: number,
  bindings: Array<{ binding?: TelemetryBinding }>,
): Record<string, number> {
  const fields = collectFieldRanges(bindings);
  const values: Record<string, number> = {};
  for (const [field, { inputMin, inputMax }] of fields) {
    values[field] = inputMin + fraction * (inputMax - inputMin);
  }
  return values;
}

export function computeFrame(
  config: SequenceConfig,
  elapsed: number,
  bindings: Array<{ binding?: TelemetryBinding }>,
): { values: Record<string, number>; done: boolean } {
  const fields = collectFieldRanges(bindings);

  if (config.type === 'sweep') {
    const { durationMs, peak, holdMs } = config.params;
    const totalMs = 2 * durationMs + holdMs;
    const done = !config.params.loop && elapsed >= totalMs;
    const cycleElapsed = config.params.loop ? elapsed % totalMs : Math.min(elapsed, totalMs);

    let t: number;
    if (cycleElapsed < durationMs) {
      t = easeInOut(cycleElapsed / durationMs) * peak;
    } else if (cycleElapsed < durationMs + holdMs) {
      t = peak;
    } else {
      t = easeInOut(1 - (cycleElapsed - durationMs - holdMs) / durationMs) * peak;
    }

    const values: Record<string, number> = {};
    for (const [field, { inputMin, inputMax }] of fields) {
      values[field] = inputMin + t * (inputMax - inputMin);
    }
    return { values, done };
  } else {
    const { periodMs, amplitude, center } = config.params;
    const values: Record<string, number> = {};
    const phase = (2 * Math.PI * elapsed) / periodMs;
    for (const [field, { inputMin, inputMax }] of fields) {
      const range = inputMax - inputMin;
      values[field] = inputMin + center * range + Math.sin(phase) * amplitude * range * 0.5;
    }
    return { values, done: false };
  }
}

const EMPTY_FRAME: Record<string, number> = {};

export function useTelemetryPlayback(
  config: SequenceConfig | null,
  nodes: Array<{ binding?: TelemetryBinding }>,
  onComplete?: () => void,
): Record<string, number> {
  const [frame, setFrame] = useState<Record<string, number>>(EMPTY_FRAME);
  const rafRef      = useRef<number | null>(null);
  const startRef    = useRef<number | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const configKey = useMemo(() => (config ? JSON.stringify(config) : null), [config]);

  useEffect(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    startRef.current = null;

    if (!configKey) {
      setFrame(EMPTY_FRAME);
      return;
    }

    const currentConfig: SequenceConfig = JSON.parse(configKey);

    const tick = (timestamp: number) => {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const { values, done } = computeFrame(currentConfig, elapsed, nodesRef.current);
      setFrame(values);
      if (done) {
        setFrame(EMPTY_FRAME);
        onCompleteRef.current?.();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [configKey]);  

  return frame;
}
