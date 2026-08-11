import { describe, it, expect } from 'vitest';
import { applyBinding, formatValue, fillFraction, computeRotation } from '../components/Telemetry/DashboardDesigner/canvasUtils';
import { ComponentNode } from '../types/dashboard';

function node(overrides: Partial<ComponentNode> = {}): ComponentNode {
  return { id: 'n', type: 'static-sprite', name: 'n', x: 0, y: 0, ...overrides };
}

const binding = { field: 'rpm', inputMin: 0, inputMax: 8000, outputMin: -135, outputMax: 135 };

// ─── applyBinding ─────────────────────────────────────────────────────────────

describe('applyBinding', () => {
  it('returns 0 when node has no binding', () => {
    expect(applyBinding(node(), {})).toBe(0);
  });

  it('returns outputMin at inputMin', () => {
    const n = node({ binding });
    expect(applyBinding(n, { rpm: 0 })).toBe(-135);
  });

  it('returns outputMax at inputMax', () => {
    const n = node({ binding });
    expect(applyBinding(n, { rpm: 8000 })).toBe(135);
  });

  it('interpolates at midpoint', () => {
    const n = node({ binding });
    expect(applyBinding(n, { rpm: 4000 })).toBe(0);
  });

  it('clamps below inputMin', () => {
    const n = node({ binding });
    expect(applyBinding(n, { rpm: -500 })).toBe(-135);
  });

  it('clamps above inputMax', () => {
    const n = node({ binding });
    expect(applyBinding(n, { rpm: 9999 })).toBe(135);
  });

  it('uses inputMin as default when field missing from data', () => {
    const n = node({ binding });
    expect(applyBinding(n, {})).toBe(-135);
  });
});

// ─── formatValue ─────────────────────────────────────────────────────────────

describe('formatValue', () => {
  it('rounds to integer by default', () => {
    expect(formatValue(123.7, undefined)).toBe('124');
  });

  it('formats decimal1', () => {
    expect(formatValue(12.345, 'decimal1')).toBe('12.3');
  });

  it('formats decimal2', () => {
    expect(formatValue(12.345, 'decimal2')).toBe('12.35');
  });

  it('formats comma-integer', () => {
    expect(formatValue(12345.9, 'comma-integer')).toBe('12,346');
  });

  it('formats raw as string', () => {
    expect(formatValue(3.14159, 'raw')).toBe('3.14159');
  });

  it('formats time correctly', () => {
    // 1 minute, 23 seconds, 456 ms → "1:23.456"
    const ms = 60000 + 23 * 1000 + 456;
    expect(formatValue(ms, 'time')).toBe('1:23.456');
  });

  it('clamps time to 0 for negative values', () => {
    expect(formatValue(-100, 'time')).toBe('0:00.000');
  });
});

// ─── fillFraction ─────────────────────────────────────────────────────────────

describe('fillFraction', () => {
  const b = { field: 'throttle', inputMin: 0, inputMax: 1, outputMin: 0, outputMax: 1 };

  it('returns 0 when no binding', () => {
    expect(fillFraction(node(), {})).toBe(0);
  });

  it('returns 0 at inputMin', () => {
    expect(fillFraction(node({ binding: b }), { throttle: 0 })).toBe(0);
  });

  it('returns 1 at inputMax', () => {
    expect(fillFraction(node({ binding: b }), { throttle: 1 })).toBe(1);
  });

  it('returns 0.5 at midpoint', () => {
    expect(fillFraction(node({ binding: b }), { throttle: 0.5 })).toBe(0.5);
  });

  it('clamps to [0, 1]', () => {
    expect(fillFraction(node({ binding: b }), { throttle: 2 })).toBe(1);
    expect(fillFraction(node({ binding: b }), { throttle: -1 })).toBe(0);
  });
});

// ─── computeRotation ──────────────────────────────────────────────────────────

describe('computeRotation', () => {
  const b = { field: 'rpm', inputMin: 0, inputMax: 8000, outputMin: -135, outputMax: 135 };

  it('returns undefined for non-needle types', () => {
    expect(computeRotation(node({ type: 'bar-gauge' }), {})).toBeUndefined();
  });

  it('returns undefined when needle has no binding', () => {
    expect(computeRotation(node({ type: 'needle-gauge' }), {})).toBeUndefined();
  });

  it('returns outputMin at inputMin', () => {
    const n = node({ type: 'needle-gauge', binding: b });
    expect(computeRotation(n, { rpm: 0 })).toBe(-135);
  });

  it('returns outputMax at inputMax', () => {
    const n = node({ type: 'needle-gauge', binding: b });
    expect(computeRotation(n, { rpm: 8000 })).toBe(135);
  });
});

