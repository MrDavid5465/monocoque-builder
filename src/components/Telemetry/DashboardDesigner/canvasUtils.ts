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

export interface ClockParts {
  // Display hour: 0-23 for '24h', 1-12 for '12h' (never 0 in 12h mode).
  hour: number;
  minute: number;
  second: number;
  // Meaningful only in '12h' mode.
  isPM: boolean;
}

// Shared by ClockTextNode/ClockSpriteNode — `useUtc` must be true for
// simulated time (dayNightSim.ts's convention: simTimeMs is UTC-only, an
// artificial in-game clock with no real-world timezone) and false for real
// time (an ordinary wall clock reads the VIEWER's own local timezone).
export function computeClockParts(ms: number, useUtc: boolean, format: '12h' | '24h'): ClockParts {
  const d = new Date(ms);
  const rawHour = useUtc ? d.getUTCHours() : d.getHours();
  const minute = useUtc ? d.getUTCMinutes() : d.getMinutes();
  const second = useUtc ? d.getUTCSeconds() : d.getSeconds();
  const isPM = rawHour >= 12;
  const hour = format === '12h' ? (rawHour % 12 === 0 ? 12 : rawHour % 12) : rawHour;
  return { hour, minute, second, isPM };
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

// ---------------------------------------------------------------------------
// Crop tool — pixel-space edge insets, shared by Canvas.tsx's render clipping
// and CropOverlay's handle geometry.
// ---------------------------------------------------------------------------
export interface EdgeInset { top: number; right: number; bottom: number; left: number; }

export function cropInsetPx(node: ComponentNode): EdgeInset {
  return {
    top: Math.max(0, node.cropTop ?? 0),
    right: Math.max(0, node.cropRight ?? 0),
    bottom: Math.max(0, node.cropBottom ?? 0),
    left: Math.max(0, node.cropLeft ?? 0),
  };
}

// Two independent axis-aligned insets intersect losslessly by taking the
// larger cut on each side — used to combine a fixed crop with a binding-driven
// reveal (e.g. sprite-bar-gauge's fill clip) into one clip-path.
export function maxInsetPx(a: EdgeInset, b: EdgeInset): EdgeInset {
  return {
    top: Math.max(a.top, b.top), right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom), left: Math.max(a.left, b.left),
  };
}

export function insetToClipPath(inset: EdgeInset): string | undefined {
  if (!inset.top && !inset.right && !inset.bottom && !inset.left) return undefined;
  return `inset(${inset.top}px ${inset.right}px ${inset.bottom}px ${inset.left}px)`;
}

export function scaleGroupChildren(children: ComponentNode[], sx: number, sy: number): ComponentNode[] {
  return children.map(child => ({
    ...child,
    x: Math.round((child.x ?? 0) * sx),
    y: Math.round((child.y ?? 0) * sy),
    ...(child.width  !== undefined ? { width:  Math.max(1, Math.round(child.width  * sx)) } : {}),
    ...(child.height !== undefined ? { height: Math.max(1, Math.round(child.height * sy)) } : {}),
    ...(child.rotationX !== undefined ? { rotationX: Math.round(child.rotationX * sx) } : {}),
    ...(child.rotationY !== undefined ? { rotationY: Math.round(child.rotationY * sy) } : {}),
    ...(child.children ? { children: scaleGroupChildren(child.children, sx, sy) } : {}),
  }));
}

// ---------------------------------------------------------------------------
// Transform-tool geometry — box/handle math for TransformOverlay
// ---------------------------------------------------------------------------
export interface Pt { x: number; y: number; }

export function rot(theta: number, d: Pt): Pt {
  const rad = theta * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  return { x: d.x * c - d.y * s, y: d.x * s + d.y * c };
}

export function localToWorld(pivotWorld: Pt, pivotLocal: Pt, theta: number, p: Pt): Pt {
  const d = { x: p.x - pivotLocal.x, y: p.y - pivotLocal.y };
  const r = rot(theta, d);
  return { x: pivotWorld.x + r.x, y: pivotWorld.y + r.y };
}

export function worldToLocal(pivotWorld: Pt, pivotLocal: Pt, theta: number, p: Pt): Pt {
  const d = { x: p.x - pivotWorld.x, y: p.y - pivotWorld.y };
  const r = rot(-theta, d);
  return { x: pivotLocal.x + r.x, y: pivotLocal.y + r.y };
}

export interface NodeBoxDescriptor {
  boxLocalX: number; boxLocalY: number; boxW: number; boxH: number;
  pivotLocal: Pt; pivotWorld: Pt; theta: number;
  isGroup: boolean; isNeedle: boolean;
}

// Computes a group's true min/max bounding box across (possibly nested) children —
// replaces the old max-from-origin-only version, which missed negative-offset children.
export function computeGroupAABB(node: ComponentNode): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!node.children?.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const child of node.children) {
    const cw = child.width ?? 100, ch = child.height ?? 100;
    let cLeft: number, cTop: number, cRight: number, cBottom: number;
    if (child.type === 'group') {
      const inner = computeGroupAABB(child);
      if (!inner) continue;
      cLeft = child.x + inner.minX; cTop = child.y + inner.minY;
      cRight = child.x + inner.maxX; cBottom = child.y + inner.maxY;
    } else if (child.type === 'needle-gauge') {
      const pivX = child.rotationX ?? cw / 2, pivY = child.rotationY ?? ch / 2;
      cLeft = child.x - pivX; cTop = child.y - pivY; cRight = cLeft + cw; cBottom = cTop + ch;
    } else {
      cLeft = child.x; cTop = child.y; cRight = child.x + cw; cBottom = child.y + ch;
    }
    minX = Math.min(minX, cLeft); minY = Math.min(minY, cTop);
    maxX = Math.max(maxX, cRight); maxY = Math.max(maxY, cBottom);
  }
  return { minX, minY, maxX, maxY };
}

// Pure function of (node, absX, absY) — the parent-offset the node's own x/y is
// relative to, exactly as NodeRenderer already computes during its own recursion.
// telemetryData/excludeFromSweep are optional and only consulted for
// sprite-text-gauge's hideLeadingZeros case, where the box's own width is
// content-dependent (it shrinks to whatever digits are actually visible) —
// every other node type's box is deliberately telemetry-independent so it
// doesn't jitter during a live/preview sweep; this is a scoped exception so
// the selection box stays in sync with what's actually on screen.
export function describeNodeBox(
  node: ComponentNode, absX: number, absY: number,
  telemetryData?: Record<string, number>, excludeFromSweep?: boolean,
): NodeBoxDescriptor | null {
  const isGroup = node.type === 'group';
  const isNeedle = node.type === 'needle-gauge';
  const theta = node.rotation ?? 0;

  if (isGroup) {
    const aabb = computeGroupAABB(node);
    if (!aabb) return null;
    return {
      boxLocalX: aabb.minX, boxLocalY: aabb.minY, boxW: aabb.maxX - aabb.minX, boxH: aabb.maxY - aabb.minY,
      pivotLocal: { x: 0, y: 0 }, pivotWorld: { x: absX + node.x, y: absY + node.y },
      theta, isGroup, isNeedle,
    };
  }
  if (node.type === 'sprite-text-gauge' && node.charWidth && node.charHeight) {
    const cw = node.charWidth, ch = node.charHeight;
    const spacing = node.charSpacing ?? 0;
    const numDigits = node.numDigits ?? 1;
    let visibleCount = numDigits;
    if (node.hideLeadingZeros) {
      const rawVal = applyBinding(node, telemetryData ?? {}, excludeFromSweep);
      const formatted = `${node.prefix ?? ''}${formatValue(rawVal, node.format)}${node.suffix ?? ''}`;
      const padded = formatted.padStart(numDigits, ' ').slice(-numDigits);
      const firstSignificant = padded.search(/\S/);
      if (firstSignificant > 0) visibleCount = numDigits - firstSignificant;
    }
    const contentW = visibleCount * cw + spacing * Math.max(0, visibleCount - 1);
    const contentH = ch;
    const anchorX = node.textAlign === 'center' ? contentW / 2 : node.textAlign === 'right' ? contentW : 0;
    const anchorY = node.verticalAlign === 'middle' ? contentH / 2 : node.verticalAlign === 'bottom' ? contentH : 0;
    return {
      boxLocalX: 0, boxLocalY: 0, boxW: contentW, boxH: contentH,
      pivotLocal: { x: contentW / 2, y: contentH / 2 },
      pivotWorld: { x: absX + node.x + (contentW / 2 - anchorX), y: absY + node.y + (contentH / 2 - anchorY) },
      theta, isGroup, isNeedle,
    };
  }
  const w = node.width ?? 100, h = node.height ?? 100;
  if (isNeedle) {
    const pivotLocal = { x: node.rotationX ?? w / 2, y: node.rotationY ?? h / 2 };
    return {
      boxLocalX: 0, boxLocalY: 0, boxW: w, boxH: h,
      pivotLocal, pivotWorld: { x: absX + node.x, y: absY + node.y },
      theta, isGroup, isNeedle,
    };
  }
  const pivotLocal = { x: w / 2, y: h / 2 };
  return {
    boxLocalX: 0, boxLocalY: 0, boxW: w, boxH: h,
    pivotLocal, pivotWorld: { x: absX + node.x + w / 2, y: absY + node.y + h / 2 },
    theta, isGroup, isNeedle,
  };
}
