import { ComponentNode } from '../../../types/dashboard';

// `excludeFromSweep` forces the rest value (inputMin) even though `data`
// holds a live/swept number for this field — needed because the kiosk boot
// sweep computes one shared value per telemetry FIELD NAME (e.g. "speed"),
// not per node, so a node that opted out via `binding.startupSweep: false`
// would otherwise still visually animate whenever any other node sharing
// its field (e.g. a needle also bound to "speed") legitimately sweeps.
export function applyBinding(node: ComponentNode, data: Record<string, number>, excludeFromSweep = false): number {
  if (!node.binding) return 0;
  const { field, inputMin, inputMax, outputMin, outputMax } = node.binding;
  const raw = excludeFromSweep ? inputMin : (data[field] ?? inputMin);
  const t = Math.max(0, Math.min(1, (raw - inputMin) / (inputMax - inputMin)));
  return outputMin + t * (outputMax - outputMin);
}

export function formatValue(value: number, fmt: ComponentNode['format']): string {
  switch (fmt) {
    case 'decimal1':      return value.toFixed(1);
    case 'decimal2':      return value.toFixed(2);
    case 'comma-integer': return Math.round(value).toLocaleString();
    case 'time': {
      const ms = Math.max(0, Math.round(value));
      const minutes = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      const millis = ms % 1000;
      return `${minutes}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
    }
    case 'raw':           return String(value);
    default:              return String(Math.round(value));
  }
}

export function fillFraction(node: ComponentNode, data: Record<string, number>, excludeFromSweep = false): number {
  if (!node.binding) return 0;
  const { field, inputMin, inputMax } = node.binding;
  const raw = excludeFromSweep ? inputMin : (data[field] ?? inputMin);
  return Math.max(0, Math.min(1, (raw - inputMin) / (inputMax - inputMin)));
}

// Fraction driving the colorLow/Mid/High gradient, independent of fillFraction
// (fill level) when colorField is set — e.g. a tire widget where fill level
// tracks wear but colour tracks temperature. Falls back to fillFraction when
// colorField is absent, preserving existing single-binding gauges.
export function colorFraction(node: ComponentNode, data: Record<string, number>, excludeFromSweep = false): number {
  if (!node.colorField) return fillFraction(node, data, excludeFromSweep);
  const inputMin = node.colorInputMin ?? 0;
  const inputMax = node.colorInputMax ?? 100;
  const raw = excludeFromSweep ? inputMin : (data[node.colorField] ?? inputMin);
  return Math.max(0, Math.min(1, (raw - inputMin) / (inputMax - inputMin)));
}

export function computeRotation(node: ComponentNode, data: Record<string, number>, excludeFromSweep = false): number | undefined {
  if (node.type !== 'needle-gauge' || !node.binding) return undefined;
  const { field, inputMin, inputMax, outputMin, outputMax } = node.binding;
  const raw = excludeFromSweep ? inputMin : (data[field] ?? inputMin);
  const t = Math.max(0, Math.min(1, (raw - inputMin) / (inputMax - inputMin)));
  return outputMin + t * (outputMax - outputMin);
}

export function computeTranslate(node: ComponentNode, data: Record<string, number>, excludeFromSweep = false): { x: number; y: number } | undefined {
  if (node.type !== 'transform-sprite' || !node.binding) return undefined;
  const { field, inputMin, inputMax } = node.binding;
  const raw = excludeFromSweep ? inputMin : (data[field] ?? inputMin);
  const t = Math.max(0, Math.min(1, (raw - inputMin) / (inputMax - inputMin)));
  const offset = (node.moveMin ?? 0) + t * ((node.moveMax ?? 0) - (node.moveMin ?? 0));
  return node.moveAxis === 'y' ? { x: 0, y: offset } : { x: offset, y: 0 };
}

// Whether a bound node should render nothing because its telemetry value has gone
// outside [inputMin, inputMax] and its binding opted into 'hide' (vs. the default
// 'stop', which clamps to the boundary and keeps rendering). Deliberately uses the
// *unclamped* fraction (unlike fillFraction/computeRotation) so both directions —
// below inputMin and above inputMax — trigger hiding.
export function isHiddenByLimit(node: ComponentNode, data: Record<string, number>, excludeFromSweep = false): boolean {
  if (node.binding?.limitBehavior !== 'hide') return false;
  const { field, inputMin, inputMax } = node.binding;
  const raw = excludeFromSweep ? inputMin : (data[field] ?? inputMin);
  const t = (raw - inputMin) / (inputMax - inputMin);
  return t < 0 || t > 1;
}

export function scaleNode(node: ComponentNode, factor: number): Partial<ComponentNode> {
  const w = node.width ?? 100;
  const h = node.height ?? 100;
  const newW = Math.max(4, Math.round(w * factor));
  const newH = Math.max(4, Math.round(h * factor));

  if (node.type === 'needle-gauge' && node.rotationX != null && node.rotationY != null) {
    return {
      width: newW, height: newH,
      rotationX: Math.round(node.rotationX * newW / w),
      rotationY: Math.round(node.rotationY * newH / h),
    };
  }
  return {
    width: newW, height: newH,
    x: Math.round(node.x - (newW - w) / 2),
    y: Math.round(node.y - (newH - h) / 2),
  };
}
