import React, { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Callout, DirectionalHint } from '@fluentui/react';
import { DashboardConfig, ComponentNode } from '../../../types/dashboard';
import { GamepadMapping } from '../../../lib/denim/lib/queries';
import { applyBinding, formatValue, fillFraction, colorFraction, computeRotation, computeTranslate, isHiddenByLimit, cropInsetPx, maxInsetPx, insetToClipPath, EdgeInset } from './canvasUtils';
import GifGaugeNode from './GifGaugeNode';
import ArcGaugeFaceNode from './ArcGaugeFaceNode';
import ClockTextNode from './ClockTextNode';
import ClockSpriteNode from './ClockSpriteNode';
import { ClockTimeContext } from './clockTimeContext';
import TransformOverlay from './TransformOverlay';
import CropOverlay from './CropOverlay';
import DayNightSimPanel from '../DayNightSimPanel';
import { useGamepadIO, useHeldGamepadButton } from './useGamepadIO';

interface SpriteFile { file: string; thumbnail: string; }

export type CanvasTool = 'transform' | 'crop';

// Node types that render a single primary sprite image and so support the
// Crop tool — see cropInsetPx/CropOverlay. sprite-text-gauge (per-character
// cells) and the drawn/SVG types are excluded on purpose.
const CROPPABLE_TYPES = new Set<ComponentNode['type']>([
  'static-sprite', 'needle-gauge', 'bar-gauge', 'sprite-bar-gauge', 'transform-sprite', 'sprite-arc-fill',
]);

type CanvasDragState =
  | { kind: 'move'; id: string; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'pan-bg'; startX: number; startY: number; origOffsetX: number; origOffsetY: number }
  | { kind: 'pan-view'; startX: number; startY: number; origOffsetX: number; origOffsetY: number };

interface Props {
  dashboard: DashboardConfig;
  sprites: SpriteFile[];
  gamepadMappings?: GamepadMapping[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<ComponentNode>) => void;
  onUpdateDashboard?: (patch: Partial<DashboardConfig>) => void;
  kioskMode: boolean;
  onKioskButton?: () => void;
  isNight?: boolean;
  // 0=day, 1=night, continuous — see dayNightSim.ts. Drives every day/night
  // crossfade/glow; `isNight` above stays around for purely-binary bits
  // (the toolbar toggle icon, usingCarNightPhoto's photo selection).
  nightAmount?: number;
  // Server-authoritative simulated clock, ms since epoch UTC — see
  // useGlobalNightMode.ts. Only read by clock-text/clock-sprite nodes whose
  // clockSource is 'simulated'; real-clock nodes ignore this and tick off
  // their own local timer instead (see ClockTextNode/ClockSpriteNode).
  simTimeMs?: number | null;
  onToggleNightMode?: () => void;
  forceNightPreview?: boolean;
  skipTransition?: boolean;
  telemetryData?: Record<string, number>;
  // True only while the kiosk boot-up sweep animation is actively running —
  // used to hold nodes with `binding.startupSweep === false` at their rest
  // value even though `telemetryData` may hold a swept value for their field
  // (shared per field name, not per node — see canvasUtils.ts).
  kioskSweepActive?: boolean;
  globalSteerMaxDeg?: number;
  panBgMode?: boolean;
  liveBackground?: React.ReactNode;
  liveBackgroundInteractive?: boolean;
  // True when liveBackground is already a genuine night-specific photo (a car's
  // uploaded night 360°, not a day photo or generic default being reused for
  // night). Suppresses the darkening overlay below, which otherwise assumes the
  // background has no day/night distinction of its own and double-darkens an
  // already-correct night photo.
  liveBackgroundIsNightPhoto?: boolean;
  simStatus?: string;
  // Fired once when a canvas-driven move or resize drag ends (pointer up), so
  // the properties panel — which shows a snapshot taken at mount/selection
  // time, not live-bound to the node — knows to refresh its displayed values.
  onDragCommit?: (id: string) => void;
  activeTool: CanvasTool;
}

export interface CanvasHandle {
  getCanvasEl: () => HTMLDivElement | null;
  zoomBy: (factor: number) => void;
  zoomReset: () => void;
}


const NIGHT_OVERLAY_Z = 40;

// ---------------------------------------------------------------------------
// ButtonControlNode — button-control component with state machine
// ---------------------------------------------------------------------------
interface ControlSubProps {
  node: ComponentNode;
  nodeAbsX: number;
  nodeAbsY: number;
  isSelected: boolean;
  spriteUrl: (f: string) => string;
  kioskMode: boolean;
  childEls: React.ReactNode;
  gamepadMappings: GamepadMapping[];
}

function resolveButtonIndex(node: ComponentNode, mappings: GamepadMapping[]): number | null {
  if (node.gamepadMappingId) {
    const m = mappings.find(m => m.id === node.gamepadMappingId && m.mappingType === 'button');
    return m?.index ?? null;
  }
  return node.gamepadButtonIndex ?? null;
}

function resolveAxisIndex(node: ComponentNode, mappings: GamepadMapping[]): number | null {
  if (node.gamepadMappingId) {
    const m = mappings.find(m => m.id === node.gamepadMappingId && m.mappingType === 'axis');
    return m?.index ?? null;
  }
  return node.gamepadAxisIndex ?? null;
}

function resolveEncoderButtonIndex(node: ComponentNode, pos: number, mappings: GamepadMapping[]): number | null {
  const mappingId = node.encoderMappingIds?.[pos];
  if (mappingId) {
    const m = mappings.find(m => m.id === mappingId && m.mappingType === 'button');
    return m?.index ?? null;
  }
  return node.encoderGamepadIndices?.[pos] ?? null;
}

const ButtonControlNode: React.FC<ControlSubProps> = ({
  node, nodeAbsX, nodeAbsY, isSelected, spriteUrl, kioskMode, childEls, gamepadMappings,
}) => {
  const [ctrlState, setCtrlState] = React.useState<'off' | 'on' | 'pressed'>('off');
  const { sendButton } = useGamepadIO();
  const { press: pressHeld, release: releaseHeld } = useHeldGamepadButton();

  const stateKey = (node.showPressedState && ctrlState === 'pressed') ? 'Pressed'
    : ctrlState === 'on' ? 'On'
    : 'Off';

  const bg          = (node as any)[`ctrl${stateKey}Bg`]          ?? (ctrlState === 'on' ? '#555' : '#333');
  const borderColor = (node as any)[`ctrl${stateKey}Border`]      ?? (ctrlState === 'on' ? '#aaa' : '#666');
  const borderWidth = (node as any)[`ctrl${stateKey}BorderWidth`] ?? 1;
  const textColor   = (node as any)[`ctrl${stateKey}Color`]       ?? '#fff';
  const opacity     = (node as any)[`ctrl${stateKey}Opacity`]     ?? 1;
  const file        = (node as any)[`ctrl${stateKey}File`] as string | undefined;

  const transMs = node.ctrlTransitionMs ?? 150;
  const transStyle: React.CSSProperties = node.ctrlTransition === 'fade'
    ? { transition: `background-color ${transMs}ms ease, border-color ${transMs}ms ease, opacity ${transMs}ms ease, color ${transMs}ms ease` }
    : {};

  const w = node.width  ?? 80;
  const h = node.height ?? 40;
  const r = node.ctrlBorderRadius ?? 6;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!kioskMode) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (node.buttonMode !== 'toggle') {
      setCtrlState('pressed');
      const btnIdx = resolveButtonIndex(node, gamepadMappings);
      // Momentary = held for an arbitrary duration (horn, highbeam-flash) —
      // watchdog-protected, with a heartbeat for as long as it's held.
      if (btnIdx != null) pressHeld(btnIdx);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!kioskMode) return;
    e.stopPropagation();
    if (node.buttonMode === 'toggle') {
      setCtrlState(prev => {
        const next = prev === 'off' ? 'on' : 'off';
        const btnIdx = resolveButtonIndex(node, gamepadMappings);
        // Toggle = a persistent on/off state change, not a held press — no
        // heartbeat, no watchdog (there's nothing to time out).
        if (btnIdx != null) sendButton(btnIdx, next === 'on');
        return next;
      });
    } else {
      setCtrlState('off');
      const btnIdx = resolveButtonIndex(node, gamepadMappings);
      if (btnIdx != null) releaseHeld(btnIdx);
    }
  };

  const handlePointerLeave = (_e: React.PointerEvent) => {
    if (!kioskMode) return;
    if (node.buttonMode !== 'toggle' && ctrlState === 'pressed') {
      setCtrlState('off');
      const btnIdx = resolveButtonIndex(node, gamepadMappings);
      if (btnIdx != null) releaseHeld(btnIdx);
    }
  };

  // Real touchscreens (as opposed to a mouse) can fire `pointercancel`
  // instead of `pointerup` mid-press — the browser reinterprets an active
  // touch as a scroll/pan gesture and yanks it away, which happens even with
  // pointer capture held. Without a handler here that touch never resolves
  // to a pointerup or pointerleave, so the heartbeat interval in
  // useHeldGamepadButton just keeps running and the mapped button stays
  // logically "held" until the backend's watchdog force-releases it ~600ms
  // later (see gamepad.rs) — a real symptom seen live on the "tablet "
  // kiosk. Same release logic as pointerLeave.
  const handlePointerCancel = handlePointerLeave;

  const shine = node.ctrlShine && (
    <div style={{
      position: 'absolute', inset: 0, borderRadius: r,
      background: node.ctrlShineColor ?? 'rgba(255,255,255,0.5)',
      opacity: node.ctrlShineOpacity ?? 0.15,
      pointerEvents: 'none',
    }} />
  );

  if (node.buttonStyle === 'sprite' && file) {
    return (
      <>
        <div
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onPointerCancel={handlePointerCancel}
          style={{
            position: 'absolute', left: nodeAbsX, top: nodeAbsY,
            width: w, height: h, borderRadius: r, overflow: 'hidden',
            outline: isSelected ? '2px solid #4af' : 'none',
            cursor: kioskMode ? 'pointer' : 'move',
            userSelect: 'none', touchAction: 'none', ...transStyle,
          }}
        >
          <img src={spriteUrl(file)} alt={node.ctrlLabel ?? ''} draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'fill', opacity, display: 'block', ...transStyle }}
          />
          {node.ctrlLabel && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: textColor, fontSize: node.ctrlFontSize ?? 14, pointerEvents: 'none', ...transStyle,
            }}>
              {node.ctrlLabel}
            </div>
          )}
          {shine}
        </div>
        {childEls}
      </>
    );
  }

  return (
    <>
      <div
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerCancel}
        style={{
          position: 'absolute', left: nodeAbsX, top: nodeAbsY,
          width: w, height: h, borderRadius: r, overflow: 'hidden',
          background: bg, border: `${borderWidth}px solid ${borderColor}`,
          opacity, boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          outline: isSelected ? '2px solid #4af' : 'none',
          cursor: kioskMode ? 'pointer' : 'move',
          userSelect: 'none', touchAction: 'none', ...transStyle,
        }}
      >
        {node.ctrlLabel && (
          <span style={{ color: textColor, fontSize: node.ctrlFontSize ?? 14, ...transStyle }}>
            {node.ctrlLabel}
          </span>
        )}
        {shine}
      </div>
      {childEls}
    </>
  );
};

// ---------------------------------------------------------------------------
// SliderControlNode — linear axis slider
// ---------------------------------------------------------------------------
const SliderControlNode: React.FC<ControlSubProps> = ({
  node, nodeAbsX, nodeAbsY, isSelected, spriteUrl, kioskMode, childEls, gamepadMappings,
}) => {
  const [value, setValue] = React.useState(() => node.sliderDefault ?? 0);
  const dragRef = React.useRef<{ trackRect: DOMRect } | null>(null);
  const { sendAxis } = useGamepadIO();

  const isV   = node.sliderOrientation === 'vertical';
  const w     = node.width  ?? (isV ? 30 : 200);
  const h     = node.height ?? (isV ? 200 : 30);
  const min   = node.sliderMin ?? -1;
  const max   = node.sliderMax ?? 1;
  const range = max - min || 1;

  const thumbW = node.sliderThumbW ?? (isV ? w : 16);
  const thumbH = node.sliderThumbH ?? (isV ? 16 : h);

  const fraction = Math.max(0, Math.min(1, (value - min) / range));
  const thumbLeft = isV ? (w - thumbW) / 2 : fraction * (w - thumbW);
  const thumbTop  = isV ? (1 - fraction) * (h - thumbH) : (h - thumbH) / 2;

  const updateFromEvent = (e: React.PointerEvent<HTMLDivElement>, rect: DOMRect) => {
    const frac = isV
      ? 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
      : Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newVal = min + frac * range;
    setValue(newVal);
    const axisIdx = resolveAxisIndex(node, gamepadMappings);
    if (axisIdx != null) sendAxis(axisIdx, newVal);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!kioskMode) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = { trackRect: rect };
    updateFromEvent(e, rect);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    updateFromEvent(e, dragRef.current.trackRect);
  };

  const handlePointerUp = () => { dragRef.current = null; };

  const trackColor = node.sliderTrackColor ?? '#444';
  const trackR     = node.sliderTrackBorderRadius ?? 4;
  const thumbColor = node.sliderThumbColor ?? '#aaa';

  return (
    <>
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: 'absolute', left: nodeAbsX, top: nodeAbsY,
          width: w, height: h, borderRadius: trackR, background: trackColor,
          outline: isSelected ? '2px solid #4af' : 'none',
          cursor: kioskMode ? (isV ? 'ns-resize' : 'ew-resize') : 'move',
          userSelect: 'none', touchAction: 'none', boxSizing: 'border-box',
        }}
      >
        {/* Thumb */}
        <div style={{
          position: 'absolute',
          left: thumbLeft, top: thumbTop,
          width: thumbW, height: thumbH,
          borderRadius: Math.min(thumbW, thumbH) / 2,
          overflow: node.sliderThumbFile ? 'hidden' : undefined,
          background: node.sliderThumbFile ? undefined : thumbColor,
          pointerEvents: 'none',
        }}>
          {node.sliderThumbFile && (
            <img src={spriteUrl(node.sliderThumbFile)} alt="" draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
            />
          )}
        </div>
      </div>
      {childEls}
    </>
  );
};

// ---------------------------------------------------------------------------
// EncoderControlNode — rotary encoder with arc-arranged position buttons
// ---------------------------------------------------------------------------
const EncoderControlNode: React.FC<ControlSubProps> = ({
  node, nodeAbsX, nodeAbsY, isSelected, spriteUrl, kioskMode, childEls, gamepadMappings,
}) => {
  const [activePos, setActivePos] = React.useState(() => node.encoderDefault ?? 0);
  const { sendButton } = useGamepadIO();

  const w          = node.width  ?? 120;
  const h          = node.height ?? 120;
  const cx         = w / 2;
  const cy         = h / 2;
  const positions  = node.encoderPositions ?? 5;
  const arcRadius  = node.encoderBtnRadius ?? Math.min(w, h) * 0.38;
  const btnSize    = node.encoderBtnSize   ?? Math.max(8, Math.min(w, h) * 0.14);
  const startAngle = node.encoderStartAngle ?? -120;
  const arcSpan    = node.encoderArcSpan   ?? 240;
  const knobSize   = node.encoderKnobSize  ?? Math.min(w, h) * 0.28;
  const transMs    = node.encoderBtnTransitionMs ?? 150;
  const transStyle: React.CSSProperties = node.encoderBtnTransition === 'fade'
    ? { transition: `background-color ${transMs}ms ease, opacity ${transMs}ms ease` }
    : {};

  const selectPosition = (pos: number) => {
    setActivePos(pos);
    const idx = resolveEncoderButtonIndex(node, pos, gamepadMappings);
    if (idx != null) {
      // Brief self-timed pulse, not an arbitrary-duration hold — no
      // heartbeat/watchdog needed (see useHeldGamepadButton's doc comment).
      sendButton(idx, true);
      setTimeout(() => sendButton(idx, false), 100);
    }
  };

  const buttons = Array.from({ length: positions }, (_, i) => {
    const angleDeg = positions > 1
      ? startAngle + i * arcSpan / (positions - 1)
      : startAngle;
    const rad  = angleDeg * Math.PI / 180;
    const bx   = cx + arcRadius * Math.sin(rad) - btnSize / 2;
    const by   = cy - arcRadius * Math.cos(rad) - btnSize / 2;
    const isOn = i === activePos;
    const file  = isOn ? node.encoderBtnOnFile : node.encoderBtnOffFile;
    const color = isOn ? (node.encoderBtnOnColor ?? '#44aaff') : (node.encoderBtnOffColor ?? '#333');
    const br    = node.encoderBtnBorderRadius ?? btnSize / 2;
    const bc    = node.encoderBtnBorderColor ?? 'transparent';

    return (
      <div
        key={i}
        onClick={e => { if (kioskMode) { e.stopPropagation(); selectPosition(i); } }}
        style={{
          position: 'absolute', left: bx, top: by,
          width: btnSize, height: btnSize, borderRadius: br,
          border: `1px solid ${bc}`,
          background: file ? undefined : color,
          overflow: file ? 'hidden' : undefined,
          cursor: kioskMode ? 'pointer' : 'default',
          boxSizing: 'border-box',
          ...transStyle,
        }}
      >
        {file && (
          <img src={spriteUrl(file)} alt="" draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
          />
        )}
      </div>
    );
  });

  return (
    <>
      <div
        onPointerDown={e => { if (kioskMode) e.stopPropagation(); }}
        style={{
          position: 'absolute', left: nodeAbsX, top: nodeAbsY,
          width: w, height: h,
          outline: isSelected ? '2px solid #4af' : 'none',
          cursor: kioskMode ? 'default' : 'default',
          userSelect: 'none',
        }}
      >
        {/* Position buttons */}
        {buttons}
        {/* Centre knob */}
        <div style={{
          position: 'absolute',
          left: cx - knobSize / 2, top: cy - knobSize / 2,
          width: knobSize, height: knobSize,
          borderRadius: '50%', overflow: node.encoderKnobFile ? 'hidden' : undefined,
          background: node.encoderKnobFile ? undefined : (node.encoderKnobColor ?? '#555'),
          pointerEvents: 'none',
        }}>
          {node.encoderKnobFile && (
            <img src={spriteUrl(node.encoderKnobFile)} alt="" draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
            />
          )}
        </div>
      </div>
      {childEls}
    </>
  );
};

// ---------------------------------------------------------------------------
// Recursive node renderer
// ---------------------------------------------------------------------------
interface NodeRendererProps {
  node: ComponentNode;
  absX: number;        // absolute canvas position of parent container
  absY: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  startDrag: (e: React.PointerEvent, id: string, origX: number, origY: number) => void;
  onUpdate: (id: string, patch: Partial<ComponentNode>) => void;
  onDragCommit?: (id: string) => void;
  activeTool: CanvasTool;
  viewRef: React.RefObject<{ scale: number; offsetX: number; offsetY: number }>;
  containerRef: React.RefObject<HTMLDivElement>;
  overlayActiveRef: React.MutableRefObject<boolean>;
  spriteUrl: (file: string) => string;
  kioskMode: boolean;
  telemetryData: Record<string, number>;
  kioskSweepActive: boolean;
  isNight: boolean;
  nightAmount: number;
  dayNight: boolean;
  skipTransition: boolean;
  registerCounterRotate: (id: string, el: HTMLDivElement | null, steerMaxDeg: number | undefined, rotationDeg: number | undefined) => void;
  gamepadMappings: GamepadMapping[];
  simStatus: string;
}

const NodeRenderer: React.FC<NodeRendererProps> = ({
  node, absX, absY, selectedId, onSelect, startDrag, onUpdate, onDragCommit, activeTool, viewRef, containerRef, overlayActiveRef, spriteUrl, kioskMode, telemetryData, kioskSweepActive, isNight, nightAmount, dayNight, skipTransition,
  registerCounterRotate, gamepadMappings, simStatus,
}) => {
  const nodeAbsX = absX + node.x;
  const nodeAbsY = absY + node.y;
  const isSelected = node.id === selectedId;
  const excludeFromSweep = kioskSweepActive && node.binding?.startupSweep === false;

  if (isHiddenByLimit(node, telemetryData, excludeFromSweep)) return null;

  const sharedChildProps = { selectedId, onSelect, startDrag, onUpdate, onDragCommit, activeTool, viewRef, containerRef, overlayActiveRef, spriteUrl, kioskMode, telemetryData, kioskSweepActive, isNight, nightAmount, dayNight, skipTransition, registerCounterRotate, gamepadMappings, simStatus };

  const overlay = (!isSelected || kioskMode) ? null
    : activeTool === 'transform'
    ? <TransformOverlay
        node={node} absX={absX} absY={absY}
        // A group's own overlay renders INSIDE the group's already-positioned
        // wrapper div (see below) — it must draw relative to the group's own
        // position, not its parent's, or node.x/y get double-counted.
        renderOffsetX={node.type === 'group' ? nodeAbsX : undefined}
        renderOffsetY={node.type === 'group' ? nodeAbsY : undefined}
        onUpdate={onUpdate} onDragCommit={onDragCommit} viewRef={viewRef} containerRef={containerRef} overlayActiveRef={overlayActiveRef}
        telemetryData={telemetryData} excludeFromSweep={excludeFromSweep}
      />
    : (activeTool === 'crop' && CROPPABLE_TYPES.has(node.type))
    ? <CropOverlay
        node={node} absX={absX} absY={absY}
        onUpdate={onUpdate} onDragCommit={onDragCommit} viewRef={viewRef} overlayActiveRef={overlayActiveRef}
      />
    : null;

  // Groups wrap children in a positioned div so counter-rotation has a well-defined origin.
  if (node.type === 'group') {
    const childEls = node.children?.map(child => (
      // Children use absX=0, absY=0 relative to the group wrapper div
      <NodeRenderer key={child.id} node={child} absX={0} absY={0} {...sharedChildProps} />
    ));

    const groupStyle: React.CSSProperties = {
      position: 'absolute',
      left: nodeAbsX,
      top: nodeAbsY,
      // transform-origin 0 0 so counter-rotation (and manual rotation) pivots
      // around the group's own canvas position, not its content's bounding box.
      transformOrigin: '0 0',
      transform: node.counterRotate ? undefined : (node.rotation ? `rotate(${node.rotation}deg)` : undefined),
    };

    return (
      <div
        ref={node.counterRotate ? (el => registerCounterRotate(node.id, el, node.steerMaxDeg, node.rotation)) : undefined}
        style={groupStyle}
      >
        {childEls}
        {overlay}
      </div>
    );
  }

  // Remaining non-group types: use absolute positioning relative to absX/absY
  const childEls = node.children?.map(child => (
    <NodeRenderer key={child.id} node={child} absX={nodeAbsX} absY={nodeAbsY} {...sharedChildProps} />
  ));

  // ── Sprite-based types (needle, static, bar, sprite-bar, sprite-text) ──
  if (
    node.type === 'static-sprite' ||
    node.type === 'needle-gauge' ||
    node.type === 'bar-gauge' ||
    node.type === 'sprite-bar-gauge' ||
    node.type === 'sprite-text-gauge' ||
    node.type === 'transform-sprite'
  ) {
    const bindingDeg = computeRotation(node, telemetryData, excludeFromSweep);
    const deg = node.type === 'needle-gauge' ? (node.rotation ?? 0) + (bindingDeg ?? 0) : node.rotation;
    const move = computeTranslate(node, telemetryData, excludeFromSweep);
    const transformParts = [
      deg != null ? `rotate(${deg}deg)` : null,
      move ? `translate(${move.x}px, ${move.y}px)` : null,
    ].filter(Boolean);
    const transform = transformParts.length ? transformParts.join(' ') : undefined;
    const transformOrigin = node.type === 'needle-gauge' ? undefined : '50% 50%'; // needle's is set from pivX/pivY below
    const pivX = node.rotationX ?? Math.round((node.width ?? 100) / 2);
    const pivY = node.rotationY ?? Math.round((node.height ?? 100) / 2);
    const imgLeft = node.type === 'needle-gauge' ? nodeAbsX - pivX : nodeAbsX;
    const imgTop  = node.type === 'needle-gauge' ? nodeAbsY - pivY : nodeAbsY;
    const w = node.width ?? 100;
    const h = node.height ?? 100;

    // sprite-bar-gauge: clip the filled image based on fill fraction, combined
    // (per-side max) with any fixed Crop-tool inset so a crop always wins over
    // whatever the fill would otherwise reveal.
    let fillInset: EdgeInset = { top: 0, right: 0, bottom: 0, left: 0 };
    if (node.type === 'sprite-bar-gauge') {
      const frac = fillFraction(node, telemetryData, excludeFromSweep);
      const dir = node.fillDirection ?? 'ltr';
      if (dir === 'ltr') fillInset = { ...fillInset, right: Math.round((1 - frac) * w) };
      else if (dir === 'rtl') fillInset = { ...fillInset, left: Math.round((1 - frac) * w) };
      else if (dir === 'btt') fillInset = { ...fillInset, top: Math.round((1 - frac) * h) };
      else fillInset = { ...fillInset, bottom: Math.round((1 - frac) * h) };
    }
    const clipPath = insetToClipPath(maxInsetPx(fillInset, cropInsetPx(node)));

    // sprite-text-gauge: render individual character cells
    if (node.type === 'sprite-text-gauge' && node.charWidth && node.charHeight) {
      const rawVal = applyBinding(node, telemetryData, excludeFromSweep);
      const formatted = `${node.prefix ?? ''}${formatValue(rawVal, node.format)}${node.suffix ?? ''}`;
      const charMap = node.charMap ?? '0123456789. :-';
      const cw = node.charWidth;
      const ch = node.charHeight;
      const spacing = node.charSpacing ?? 0;
      const numDigits = node.numDigits ?? formatted.length;
      const padded = formatted.padStart(numDigits, ' ').slice(-numDigits);
      const gridCols = node.charGridCols && node.charGridCols > 0 ? node.charGridCols : charMap.length;
      const gridRows = Math.ceil(charMap.length / gridCols);
      const firstSignificant = node.hideLeadingZeros ? padded.search(/\S/) : -1;
      const visiblePadded = firstSignificant > 0 ? padded.slice(firstSignificant) : padded;
      const visibleCount = visiblePadded.length;
      const contentW = visibleCount * cw + spacing * Math.max(0, visibleCount - 1);
      const contentH = ch;
      const anchorX = node.textAlign === 'center' ? contentW / 2 : node.textAlign === 'right' ? contentW : 0;
      const anchorY = node.verticalAlign === 'middle' ? contentH / 2 : node.verticalAlign === 'bottom' ? contentH : 0;

      return (
        <>
          <div
            ref={node.counterRotate ? (el => registerCounterRotate(node.id, el, node.steerMaxDeg, node.rotation)) : undefined}
            style={{
              position: 'absolute', left: nodeAbsX - anchorX, top: nodeAbsY - anchorY,
              display: 'flex', flexDirection: 'row',
              outline: isSelected ? '2px solid #4af' : 'none',
              userSelect: 'none',
              transform: node.counterRotate ? undefined : (node.rotation ? `rotate(${node.rotation}deg)` : undefined),
              transformOrigin: '50% 50%',
            }}
          >
            {Array.from(visiblePadded).map((ch_char, i) => {
              const cellMarginRight = i < visibleCount - 1 ? spacing : 0;
              const charIdx = charMap.indexOf(ch_char);
              const col = charIdx >= 0 ? charIdx % gridCols : 0;
              const row = charIdx >= 0 ? Math.floor(charIdx / gridCols) : 0;
              const offsetX = charIdx >= 0 ? -(col * cw) : 0;
              const offsetY = charIdx >= 0 ? -(row * ch) : 0;
              return (
                <div key={i} style={{ width: cw, height: ch, overflow: 'hidden', flexShrink: 0, marginRight: cellMarginRight }}>
                  <img
                    src={spriteUrl(node.file ?? '')}
                    alt=""
                    draggable={false}
                    style={{ position: 'relative', left: offsetX, top: offsetY, width: 'auto', height: ch * gridRows }}
                  />
                </div>
              );
            })}
          </div>
          {childEls}
          {overlay}
        </>
      );
    }

    // Continuous through dawn/dusk (glow alpha scales with nightAmount) —
    // z-index still snaps at the halfway point since stacking order isn't
    // something that can fade.
    const backlitAmount = (node.backlit && dayNight) ? nightAmount : 0;
    const backlitOnTop = backlitAmount >= 0.5;
    const glowFilter = backlitAmount > 0 ? `drop-shadow(0 0 6px rgba(255, 210, 80, ${(0.85 * backlitAmount).toFixed(3)}))` : undefined;

    return (
      <>
        {/* Background sprite for sprite-bar-gauge */}
        {node.type === 'sprite-bar-gauge' && node.backgroundFile && (
          <img
            src={spriteUrl(node.backgroundFile)}
            alt=""
            draggable={false}
            style={{ position: 'absolute', left: imgLeft, top: imgTop, width: w, height: h, pointerEvents: 'none', clipPath: insetToClipPath(cropInsetPx(node)) }}
          />
        )}
        {node.nightFile ? (
          /* Day/night crossfade: stack two images at the same position */
          <div
            style={{
              position: 'absolute', left: imgLeft, top: imgTop, width: w, height: h,
              outline: isSelected ? '2px solid #4af' : 'none',
              zIndex: backlitOnTop ? NIGHT_OVERLAY_Z + 5 : undefined,
              filter: glowFilter,
            }}
          >
            <img
              src={spriteUrl(node.file ?? '')}
              alt={node.name}
              draggable={false}
              style={{
                position: 'absolute', inset: 0, width: w, height: h,
                opacity: 1 - nightAmount,
                transition: skipTransition ? undefined : 'opacity 2s ease',
                transform,
                transformOrigin: node.type === 'needle-gauge' ? `${pivX}px ${pivY}px` : transformOrigin,
                clipPath,
              }}
            />
            <img
              src={spriteUrl(node.nightFile)}
              alt=""
              draggable={false}
              style={{
                position: 'absolute', inset: 0, width: w, height: h,
                opacity: nightAmount,
                transition: skipTransition ? undefined : 'opacity 2s ease',
                transform,
                transformOrigin: node.type === 'needle-gauge' ? `${pivX}px ${pivY}px` : transformOrigin,
                clipPath,
              }}
            />
          </div>
        ) : (
          <img
            src={spriteUrl(node.file ?? '')}
            alt={node.name}
            style={{
              position: 'absolute',
              left: imgLeft, top: imgTop,
              width: w, height: h,
              outline: isSelected ? '2px solid #4af' : 'none',
              userSelect: 'none',
              zIndex: backlitOnTop ? NIGHT_OVERLAY_Z + 5 : undefined,
              filter: glowFilter,
              transform,
              transformOrigin: node.type === 'needle-gauge' ? `${pivX}px ${pivY}px` : transformOrigin,
              clipPath,
            }}
            draggable={false}
          />
        )}
        {childEls}
        {overlay}
      </>
    );
  }

  // ── sprite-arc-fill ── angular reveal of a raster arc image via a conic-gradient mask,
  // the arc analogue of sprite-bar-gauge's linear clip-path fill. Not folded into the shared
  // sprite block above since that block already juggles rotation + linear clip-path.
  if (node.type === 'sprite-arc-fill') {
    const frac = fillFraction(node, telemetryData, excludeFromSweep);
    const w = node.width ?? 100;
    const h = node.height ?? 100;
    const cx = node.arcCenterX ?? Math.round(w / 2);
    const cy = node.arcCenterY ?? Math.round(h / 2);
    const start = node.arcStartAngle ?? 0;
    const sweep = node.arcSweepAngle ?? 360;
    const revealDeg = sweep * frac;
    const mask = `conic-gradient(from ${start}deg at ${cx}px ${cy}px, black 0deg ${revealDeg}deg, transparent ${revealDeg}deg 360deg)`;
    const backlitAmount = (node.backlit && dayNight) ? nightAmount : 0;
    const glowFilter = backlitAmount > 0 ? `drop-shadow(0 0 6px rgba(255, 210, 80, ${(0.85 * backlitAmount).toFixed(3)}))` : undefined;
    return (
      <>
        <img
          src={spriteUrl(node.file ?? '')}
          alt={node.name}
          style={{
            position: 'absolute',
            left: nodeAbsX, top: nodeAbsY,
            width: w, height: h,
            outline: isSelected ? '2px solid #4af' : 'none',
            userSelect: 'none',
            zIndex: backlitAmount >= 0.5 ? NIGHT_OVERLAY_Z + 5 : undefined,
            filter: glowFilter,
            maskImage: mask,
            WebkitMaskImage: mask,
            clipPath: insetToClipPath(cropInsetPx(node)),
            transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
            transformOrigin: '50% 50%',
          }}
          draggable={false}
        />
        {childEls}
        {overlay}
      </>
    );
  }

  // ── text-gauge ──
  if (node.type === 'text-gauge') {
    const rawVal = applyBinding(node, telemetryData, excludeFromSweep);
    const display = `${node.prefix ?? ''}${formatValue(rawVal, node.format)}${node.suffix ?? ''}`;
    return (
      <>
        <div
          ref={node.counterRotate ? (el => registerCounterRotate(node.id, el, node.steerMaxDeg, node.rotation)) : undefined}
          style={{
            position: 'absolute', left: nodeAbsX, top: nodeAbsY,
            fontFamily: node.fontFamily ?? 'Arial, sans-serif',
            fontSize: node.fontSize ?? 32,
            fontWeight: node.fontWeight ?? 'normal',
            color: node.color ?? '#ffffff',
            textAlign: node.textAlign ?? 'left',
            outline: isSelected ? '2px solid #4af' : 'none',
            userSelect: 'none',
            whiteSpace: 'nowrap',
            lineHeight: 1,
            transform: node.counterRotate ? undefined : (node.rotation ? `rotate(${node.rotation}deg)` : undefined),
            transformOrigin: '50% 50%',
          }}
        >
          {display}
        </div>
        {childEls}
        {overlay}
      </>
    );
  }

  // ── graph-bar-gauge ──
  if (node.type === 'graph-bar-gauge') {
    const frac = fillFraction(node, telemetryData, excludeFromSweep);
    const cfrac = colorFraction(node, telemetryData, excludeFromSweep);
    const w = node.width ?? 200;
    const h = node.height ?? 24;
    const gt = node.graphType ?? 'h-bar';
    const bgColor = node.backgroundColor ?? '#222';
    const r = node.borderRadius ?? 4;

    const lerp = (a: string, b: string, t: number) => {
      const hex = (s: string) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
      const ca = hex(a.padEnd(7, '0')), cb = hex(b.padEnd(7, '0'));
      return `rgb(${Math.round(ca[0] + (cb[0] - ca[0]) * t)},${Math.round(ca[1] + (cb[1] - ca[1]) * t)},${Math.round(ca[2] + (cb[2] - ca[2]) * t)})`;
    };
    const lo = node.colorLow ?? '#00cc44';
    const mid = node.colorMid;
    const hi = node.colorHigh ?? '#cc2200';
    const fillColor = mid
      ? (cfrac < 0.5 ? lerp(lo, mid, cfrac * 2) : lerp(mid, hi, (cfrac - 0.5) * 2))
      : lerp(lo, hi, cfrac);

    const rawVal = applyBinding(node, telemetryData, excludeFromSweep);
    const display = formatValue(rawVal, node.format ?? 'integer');
    const segs = node.segments ?? 12;

    let innerEl: React.ReactNode;
    if (gt === 'h-bar') {
      innerEl = (
        <div style={{ position: 'relative', width: w, height: h, background: bgColor, borderRadius: r, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: `${frac * 100}%`, height: '100%', background: fillColor, borderRadius: r }} />
          {node.showValue && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: Math.max(10, h * 0.55), fontFamily: 'Arial,sans-serif', fontWeight: 'bold', mixBlendMode: 'difference' }}>{display}</span>}
        </div>
      );
    } else if (gt === 'v-bar') {
      innerEl = (
        <div style={{ position: 'relative', width: w, height: h, background: bgColor, borderRadius: r, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, bottom: 0, width: '100%', height: `${frac * 100}%`, background: fillColor, borderRadius: r }} />
          {node.showValue && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: Math.max(10, w * 0.35), fontFamily: 'Arial,sans-serif', fontWeight: 'bold', mixBlendMode: 'difference' }}>{display}</span>}
        </div>
      );
    } else if (gt === 'segments') {
      const litCount = Math.round(frac * segs);
      innerEl = (
        <div style={{ display: 'flex', flexDirection: 'row', gap: 2, width: w, height: h }}>
          {Array.from({ length: segs }, (_, i) => {
            const segFrac = i / (segs - 1);
            const segColor = mid
              ? (segFrac < 0.5 ? lerp(lo, mid, segFrac * 2) : lerp(mid, hi, (segFrac - 0.5) * 2))
              : lerp(lo, hi, segFrac);
            return (
              <div key={i} style={{ flex: 1, height: '100%', background: i < litCount ? segColor : bgColor, borderRadius: 2 }} />
            );
          })}
        </div>
      );
    } else {
      // arc
      const R = Math.min(w, h) / 2 - 4;
      const cx2 = w / 2, cy2 = h / 2;
      const startA = 135 * Math.PI / 180;
      const sweepA = 270 * Math.PI / 180;
      const endA = startA + sweepA * frac;
      const sx = cx2 + R * Math.cos(startA), sy = cy2 + R * Math.sin(startA);
      const ex = cx2 + R * Math.cos(endA), ey = cy2 + R * Math.sin(endA);
      const large = sweepA * frac > Math.PI ? 1 : 0;
      const exFull = cx2 + R * Math.cos(startA + sweepA), eyFull = cy2 + R * Math.sin(startA + sweepA);
      innerEl = (
        <svg width={w} height={h}>
          <path d={`M ${sx} ${sy} A ${R} ${R} 0 1 1 ${exFull} ${eyFull}`} fill="none" stroke={bgColor} strokeWidth={Math.max(4, h * 0.18)} strokeLinecap="round"/>
          {frac > 0 && <path d={`M ${sx} ${sy} A ${R} ${R} 0 ${large} 1 ${ex} ${ey}`} fill="none" stroke={fillColor} strokeWidth={Math.max(4, h * 0.18)} strokeLinecap="round"/>}
          {node.showValue && <text x={cx2} y={cy2 + 6} textAnchor="middle" fill="#fff" fontFamily="Arial,sans-serif" fontSize={Math.max(10, R * 0.45)} fontWeight="bold">{display}</text>}
        </svg>
      );
    }

    return (
      <>
        <div
          ref={node.counterRotate ? (el => registerCounterRotate(node.id, el, node.steerMaxDeg, node.rotation)) : undefined}
          style={{
            position: 'absolute', left: nodeAbsX, top: nodeAbsY,
            outline: isSelected ? '2px solid #4af' : 'none',
            userSelect: 'none',
            transform: node.counterRotate ? undefined : (node.rotation ? `rotate(${node.rotation}deg)` : undefined),
            transformOrigin: '50% 50%',
          }}
        >
          {innerEl}
        </div>
        {childEls}
        {overlay}
      </>
    );
  }

  // ── flag-display (plain coloured cells / grid) ──
  if (node.type === 'flag-display') {
    const flag = Math.round(telemetryData['courseFlag'] ?? 0);
    const pit  = (telemetryData['inPit'] ?? 0) > 0;
    const state = pit ? 10 : flag;
    const isGreen = state === 0;

    const FLAG_COLOR: Record<number, string> = {
      1: '#ffcc00', 2: '#ee1100', 4: '#0055ee',
      5: '#ffffff', 6: '#111111', 9: '#ff7700', 10: '#aa00cc',
    };

    const cols = node.gridCols ?? 1;
    const rows = node.gridRows ?? 1;
    const gap  = node.gridGap ?? 0;
    const w    = node.width ?? 80;
    const h    = node.height ?? 80;
    const r    = node.borderRadius ?? 0;
    const bw   = node.borderWidth ?? 0;
    const bc   = node.borderColor ?? '#333';
    const borderStyle = bw > 0 ? { border: `${bw}px solid ${bc}`, boxSizing: 'border-box' as const } : {};

    const gearRaw  = Math.round(telemetryData['gear'] ?? 0);
    const gearStr  = gearRaw < 0 ? 'R' : gearRaw === 0 ? 'N' : String(gearRaw);
    const showGear = (node.showGear ?? true) && isGreen;
    const gearSize = node.gearFontSize ?? Math.min(w / cols, h / rows) * 0.65;

    const cellEls: React.ReactNode[] = [];
    for (let ri = 0; ri < rows; ri++) {
      for (let ci = 0; ci < cols; ci++) {
        let cellBg: React.CSSProperties;
        if (isGreen) {
          cellBg = { background: '#1a1a1a' };
        } else if (state === 3) {
          // chequered: alternate cells
          if (cols === 1 && rows === 1) {
            cellBg = { backgroundImage: 'repeating-conic-gradient(#000 0% 25%,#fff 0% 50%)', backgroundSize: '16px 16px' };
          } else {
            cellBg = { background: (ri + ci) % 2 === 0 ? '#ffffff' : '#000000' };
          }
        } else if (state === 7) {
          // black & white: diagonal split per cell (or left/right halves for grid)
          if (cols === 1 && rows === 1) {
            cellBg = { background: 'linear-gradient(135deg,#ffffff 50%,#111111 50%)' };
          } else {
            cellBg = { background: ci < cols / 2 ? '#ffffff' : '#111111' };
          }
        } else if (state === 8) {
          // meatball: black cells, centre cell orange
          const cRow = ri === Math.floor(rows / 2);
          const cCol = ci === Math.floor(cols / 2);
          cellBg = { background: (cRow && cCol) ? '#ff6600' : '#111111' };
        } else {
          cellBg = { background: FLAG_COLOR[state] ?? '#1a1a1a' };
        }
        cellEls.push(<div key={`${ri}-${ci}`} style={{ ...cellBg, borderRadius: r, ...borderStyle }} />);
      }
    }

    return (
      <>
        <div
          style={{
            position: 'absolute', left: nodeAbsX, top: nodeAbsY,
            width: w, height: h,
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
            gap,
            outline: isSelected ? '2px solid #4af' : 'none',
            userSelect: 'none',
            transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
            transformOrigin: '50% 50%',
          }}
        >
          {cellEls}
          {showGear && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transform: `translate(${node.gearOffsetX ?? 0}px, ${node.gearOffsetY ?? 0}px)`,
              fontSize: gearSize, fontFamily: 'Arial,sans-serif', fontWeight: 'bold',
              color: node.gearColor ?? '#ffffff',
              lineHeight: 1, pointerEvents: 'none',
            }}>
              {gearStr}
            </div>
          )}
        </div>
        {childEls}
        {overlay}
      </>
    );
  }

  // ── flag-display-sprite ──
  if (node.type === 'flag-display-sprite') {
    const flag = Math.round(telemetryData['courseFlag'] ?? 0);
    const pit  = (telemetryData['inPit'] ?? 0) > 0;
    const state = pit ? 10 : flag;
    const isGreen = state === 0;

    const FLAG_FILE_KEY: Partial<Record<number, keyof ComponentNode>> = {
      0: 'fileGreen', 1: 'fileYellow', 2: 'fileRed',   3: 'fileChequered',
      4: 'fileBlue',  5: 'fileWhite',  6: 'fileBlack',  7: 'fileBlackWhite',
      8: 'fileBlackOrange', 9: 'fileOrange', 10: 'fileInPit',
    };

    const fileKey    = FLAG_FILE_KEY[state];
    const activeFile = fileKey ? (node[fileKey] as string | undefined) : undefined;
    const displayFile = activeFile ?? node.fileOff;

    const gearRaw  = Math.round(telemetryData['gear'] ?? 0);
    const gearStr  = gearRaw < 0 ? 'R' : gearRaw === 0 ? 'N' : String(gearRaw);
    const showGear = (node.showGear ?? false) && isGreen;
    const w = node.width ?? 100;
    const h = node.height ?? 100;

    return (
      <>
        <div
          style={{
            position: 'absolute', left: nodeAbsX, top: nodeAbsY,
            width: w, height: h,
            outline: isSelected ? '2px solid #4af' : 'none',
            userSelect: 'none',
            transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
            transformOrigin: '50% 50%',
          }}
        >
          {displayFile
            ? <img src={spriteUrl(displayFile)} alt="" draggable={false} style={{ width: w, height: h, display: 'block' }} />
            : <div style={{ width: w, height: h, background: '#1a1a1a', borderRadius: 4 }} />
          }
          {showGear && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transform: `translate(${node.gearOffsetX ?? 0}px, ${node.gearOffsetY ?? 0}px)`,
              fontSize: node.gearFontSize ?? Math.min(w, h) * 0.55,
              fontFamily: 'Arial,sans-serif', fontWeight: 'bold',
              color: node.gearColor ?? '#ffffff',
              lineHeight: 1, pointerEvents: 'none',
            }}>
              {gearStr}
            </div>
          )}
        </div>
        {childEls}
        {overlay}
      </>
    );
  }

  // ── button-control ──
  if (node.type === 'button-control') {
    return (
      <>
        <ButtonControlNode
          node={node} nodeAbsX={nodeAbsX} nodeAbsY={nodeAbsY}
          isSelected={isSelected} spriteUrl={spriteUrl} kioskMode={kioskMode} childEls={childEls}
          gamepadMappings={gamepadMappings}
        />
        {overlay}
      </>
    );
  }

  // ── slider-control ──
  if (node.type === 'slider-control') {
    return (
      <>
        <SliderControlNode
          node={node} nodeAbsX={nodeAbsX} nodeAbsY={nodeAbsY}
          isSelected={isSelected} spriteUrl={spriteUrl} kioskMode={kioskMode} childEls={childEls}
          gamepadMappings={gamepadMappings}
        />
        {overlay}
      </>
    );
  }

  // ── encoder-control ──
  if (node.type === 'encoder-control') {
    return (
      <>
        <EncoderControlNode
          node={node} nodeAbsX={nodeAbsX} nodeAbsY={nodeAbsY}
          isSelected={isSelected} spriteUrl={spriteUrl} kioskMode={kioskMode} childEls={childEls}
          gamepadMappings={gamepadMappings}
        />
        {overlay}
      </>
    );
  }

  // ── arc-gauge-face / sprite-arc-gauge-face ──
  if (node.type === 'arc-gauge-face' || node.type === 'sprite-arc-gauge-face') {
    return (
      <>
        <ArcGaugeFaceNode
          node={node} nodeAbsX={nodeAbsX} nodeAbsY={nodeAbsY}
          isSelected={isSelected}
          telemetryData={telemetryData} kioskMode={kioskMode}
          registerCounterRotate={registerCounterRotate} childEls={childEls}
          spriteUrl={spriteUrl}
          isNight={isNight} nightAmount={nightAmount} dayNight={dayNight}
          nightOverlayZ={NIGHT_OVERLAY_Z}
        />
        {overlay}
      </>
    );
  }

  // ── gif-gauge ──
  if (node.type === 'gif-gauge') {
    return (
      <>
        <GifGaugeNode
          node={node} nodeAbsX={nodeAbsX} nodeAbsY={nodeAbsY}
          isSelected={isSelected}
          spriteUrl={spriteUrl} telemetryData={telemetryData} excludeFromSweep={excludeFromSweep} simStatus={simStatus}
          kioskMode={kioskMode} registerCounterRotate={registerCounterRotate}
          childEls={childEls}
        />
        {overlay}
      </>
    );
  }

  // ── clock-text / clock-sprite ── simTimeMs comes via ClockTimeContext,
  // NOT a prop here — see clockTimeContext.ts's doc comment for why.
  if (node.type === 'clock-text') {
    return (
      <>
        <ClockTextNode
          node={node} nodeAbsX={nodeAbsX} nodeAbsY={nodeAbsY}
          isSelected={isSelected}
          registerCounterRotate={registerCounterRotate} childEls={childEls}
          kioskMode={kioskMode}
        />
        {overlay}
      </>
    );
  }
  if (node.type === 'clock-sprite') {
    return (
      <>
        <ClockSpriteNode
          node={node} nodeAbsX={nodeAbsX} nodeAbsY={nodeAbsY}
          isSelected={isSelected} spriteUrl={spriteUrl}
          registerCounterRotate={registerCounterRotate} childEls={childEls}
          kioskMode={kioskMode}
        />
        {overlay}
      </>
    );
  }

  return <>{childEls}{overlay}</>;
};

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------
const Canvas = forwardRef<CanvasHandle, Props>(({
  dashboard, sprites, gamepadMappings = [], selectedId, onSelect, onUpdate, onUpdateDashboard, kioskMode, onKioskButton, isNight: isNightProp, nightAmount: nightAmountProp, simTimeMs, onToggleNightMode, forceNightPreview, skipTransition, telemetryData,
  kioskSweepActive = false,
  globalSteerMaxDeg, panBgMode, liveBackground, liveBackgroundInteractive, liveBackgroundIsNightPhoto, simStatus = '',
  onDragCommit, activeTool,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef     = useRef<HTMLDivElement>(null);
  const nightGearRef = useRef<HTMLButtonElement>(null);
  const [showDayNightSettings, setShowDayNightSettings] = useState(false);
  const [view, setView] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;

  const telemetryDataRef = useRef<Record<string, number>>({});
  telemetryDataRef.current = telemetryData ?? {};
  const neckFxRef = useRef(dashboard.neckFx);
  neckFxRef.current = dashboard.neckFx;
  // When a live 360° background is showing, telemetry sways the photo's pan instead
  // (see Photo360Viewer) — swaying the whole canvas too would move interactive
  // buttons off-target and expose the canvas edges.
  const hasLiveBackgroundRef = useRef(!!liveBackground);
  hasLiveBackgroundRef.current = !!liveBackground;
  const neckFxGainXRef    = useRef(dashboard.neckFxGainX   ?? 1);
  const neckFxGainYRef    = useRef(dashboard.neckFxGainY   ?? 1);
  const neckFxDisableXRef = useRef(dashboard.neckFxDisableX ?? false);
  const neckFxDisableYRef = useRef(dashboard.neckFxDisableY ?? false);
  neckFxGainXRef.current    = dashboard.neckFxGainX   ?? 1;
  neckFxGainYRef.current    = dashboard.neckFxGainY   ?? 1;
  neckFxDisableXRef.current = dashboard.neckFxDisableX ?? false;
  neckFxDisableYRef.current = dashboard.neckFxDisableY ?? false;

  const counterRotateRefsRef = useRef<Map<string, { el: HTMLDivElement; steerMaxDeg: number | undefined; rotationDeg: number | undefined }>>(new Map());
  const globalSteerMaxDegRef = useRef<number>(globalSteerMaxDeg ?? 200);
  globalSteerMaxDegRef.current = globalSteerMaxDeg ?? 200;

  const registerCounterRotate = useCallback((id: string, el: HTMLDivElement | null, steerMaxDeg: number | undefined, rotationDeg: number | undefined) => {
    if (el) counterRotateRefsRef.current.set(id, { el, steerMaxDeg, rotationDeg });
    else    counterRotateRefsRef.current.delete(id);
  }, []);

  const dragState = useRef<CanvasDragState | null>(null);
  const scaleRef  = useRef(view.scale);
  scaleRef.current = view.scale;
  // Set by TransformOverlay while a move/scale/rotate touch is in progress on
  // a handle. Pinch-zoom below must not also activate from an incidental
  // second touch (e.g. a palm/thumb brushing the screen while a finger is
  // precisely gripping a small handle) — without this, the pinch handler's
  // continuous view.scale/offset writes would corrupt the overlay's own
  // screen→canvas math mid-gesture, producing runaway/exploding resize.
  const overlayActiveRef = useRef(false);

  // Button-driven zoom (toolbar zoom in/out/reset) — anchored at the
  // container's own center rather than a cursor position, since there's no
  // pointer coordinate behind a button click. Same clamp as wheel/pinch zoom.
  const zoomBy = useCallback((factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    setView(v => {
      const newScale = Math.max(0.1, Math.min(8, v.scale * factor));
      const { clientWidth, clientHeight } = el;
      const cx = clientWidth / 2, cy = clientHeight / 2;
      const canvasX = (cx - v.offsetX) / v.scale, canvasY = (cy - v.offsetY) / v.scale;
      return { scale: newScale, offsetX: Math.round(cx - canvasX * newScale), offsetY: Math.round(cy - canvasY * newScale) };
    });
  }, []);

  const zoomReset = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { clientWidth, clientHeight } = el;
    setView({
      scale: 1,
      offsetX: Math.round((clientWidth - dashboard.canvasWidth) / 2),
      offsetY: Math.round((clientHeight - dashboard.canvasHeight) / 2),
    });
  }, [dashboard.canvasWidth, dashboard.canvasHeight]);

  useImperativeHandle(ref, () => ({
    getCanvasEl: () => innerRef.current,
    zoomBy,
    zoomReset,
  }));

  // NeckFX sway loop
  useEffect(() => {
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const sway = { x: 0, y: 0, rot: 0 };
    let rafId: number;
    const tick = () => {
      const data   = telemetryDataRef.current;
      const active = neckFxRef.current && !hasLiveBackgroundRef.current;
      const gLat = active ? Math.max(-3, Math.min(3, data['gLat'] ?? 0)) : 0;
      const gLon = active ? Math.max(-4, Math.min(4, data['gLon'] ?? 0)) : 0;
      const gainX    = neckFxGainXRef.current;
      const gainY    = neckFxGainYRef.current;
      const disableX = neckFxDisableXRef.current;
      const disableY = neckFxDisableYRef.current;
      sway.x   = lerp(sway.x,   disableX ? 0 : -gLat * 25  * gainX, 0.08);
      sway.y   = lerp(sway.y,   disableY ? 0 :  gLon * 12  * gainY, 0.08);
      sway.rot = lerp(sway.rot, disableX ? 0 : -gLat * 1.5 * gainX, 0.08);
      if (innerRef.current && !hasLiveBackgroundRef.current) {
        innerRef.current.style.transform =
          `translate(${sway.x}px, ${sway.y}px) rotate(${sway.rot}deg)`;
      }
      const steer = data['steering'] ?? 0;
      const globalMaxDeg = globalSteerMaxDegRef.current;
      for (const { el, steerMaxDeg, rotationDeg } of counterRotateRefsRef.current.values()) {
        const maxDeg = steerMaxDeg ?? globalMaxDeg;
        el.style.transform = `rotate(${((rotationDeg ?? 0) - steer * maxDeg / 2).toFixed(2)}deg)`;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Centered-at-scale-1 default view — no auto-fit. Runs once per mount (this
  // component remounts via `key={dashboardName}` when the edited dashboard
  // changes, so the view always resets rather than persisting/restoring).
  // Edit mode only — kiosk mode uses the fit-to-container effect below.
  useEffect(() => {
    if (kioskMode || !containerRef.current) return;
    const { clientWidth, clientHeight } = containerRef.current;
    setView({
      scale: 1,
      offsetX: Math.round((clientWidth - dashboard.canvasWidth) / 2),
      offsetY: Math.round((clientHeight - dashboard.canvasHeight) / 2),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kiosk mode: no interactive pan/zoom (see wheel/pinch/pan guards below) —
  // instead the canvas is continuously fit to its container, centered, the
  // same as it always displayed pre-pan/zoom. Recomputes on container resize
  // so rotating/resizing the kiosk window keeps the dashboard filling it.
  useEffect(() => {
    if (!kioskMode || !containerRef.current) return;
    const compute = () => {
      if (!containerRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      const s = Math.min(clientWidth / dashboard.canvasWidth, clientHeight / dashboard.canvasHeight);
      setView({
        scale: s,
        offsetX: Math.round((clientWidth  - dashboard.canvasWidth  * s) / 2),
        offsetY: Math.round((clientHeight - dashboard.canvasHeight * s) / 2),
      });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [kioskMode, dashboard.canvasWidth, dashboard.canvasHeight]);

  // Wheel always zooms the whole canvas view, regardless of tool/selection —
  // cursor-anchored so the point under the pointer stays fixed on screen.
  // Edit mode only — kiosk mode stays fixed to its fit-to-container view.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || kioskMode) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pixelDelta = e.deltaMode === 0 ? e.deltaY : e.deltaY * 16;
      const factor = Math.exp(-pixelDelta * (e.ctrlKey ? 0.0025 : 0.0012));
      setView(v => {
        const newScale = Math.max(0.1, Math.min(8, v.scale * factor));
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        const canvasX = (cx - v.offsetX) / v.scale, canvasY = (cy - v.offsetY) / v.scale;
        return { scale: newScale, offsetX: Math.round(cx - canvasX * newScale), offsetY: Math.round(cy - canvasY * newScale) };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [kioskMode]);

  // Pinch-to-zoom (mobile) — the touch analogue of the wheel handler above,
  // zooming/panning so the midpoint between the two fingers stays fixed on
  // screen. Tracked via CAPTURE-phase native listeners on the container so a
  // second finger touching down is always seen even though children (drag
  // handles, sprites, the pan-view/pan-bg starters below) call
  // stopPropagation() on their own bubble-phase handlers — capture fires
  // before that stopPropagation can have any effect. Deliberately reads/writes
  // only via the `pointers`/`pinch` closures below (never React state) during
  // the gesture itself; `setView` is only called with a freshly computed
  // value, never a functional updater that would need `view` in its deps.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || kioskMode) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { startDist: number; startScale: number; startMidCanvasX: number; startMidCanvasY: number } | null = null;

    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && !overlayActiveRef.current) {
        const [a, b] = [...pointers.values()];
        const rect = el.getBoundingClientRect();
        const m = mid(a, b);
        const v = viewRef.current;
        pinch = {
          startDist: dist(a, b),
          startScale: v.scale,
          startMidCanvasX: (m.x - rect.left - v.offsetX) / v.scale,
          startMidCanvasY: (m.y - rect.top - v.offsetY) / v.scale,
        };
        dragState.current = null; // a single-finger pan/move may already be in progress — pinch takes over
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinch) {
        e.preventDefault();
        const [a, b] = [...pointers.values()];
        const rect = el.getBoundingClientRect();
        const m = mid(a, b);
        const newScale = Math.max(0.1, Math.min(8, pinch.startScale * (dist(a, b) / pinch.startDist)));
        setView({
          scale: newScale,
          offsetX: Math.round(m.x - rect.left - pinch.startMidCanvasX * newScale),
          offsetY: Math.round(m.y - rect.top - pinch.startMidCanvasY * newScale),
        });
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };

    el.addEventListener('pointerdown', onDown, { capture: true });
    el.addEventListener('pointermove', onMove, { capture: true });
    el.addEventListener('pointerup', onUp, { capture: true });
    el.addEventListener('pointercancel', onUp, { capture: true });
    return () => {
      el.removeEventListener('pointerdown', onDown, { capture: true });
      el.removeEventListener('pointermove', onMove, { capture: true });
      el.removeEventListener('pointerup', onUp, { capture: true });
      el.removeEventListener('pointercancel', onUp, { capture: true });
    };
  }, [kioskMode]);

  const spriteUrl = useCallback(
    (file: string) => sprites.find(s => s.file === file)?.thumbnail ?? '',
    [sprites],
  );

  const startDrag = useCallback((e: React.PointerEvent, id: string, origX: number, origY: number) => {
    e.stopPropagation();
    dragState.current = { kind: 'move', id, startX: e.clientX, startY: e.clientY, origX, origY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const startBgPan = (e: React.PointerEvent) => {
    dragState.current = {
      kind: 'pan-bg',
      startX: e.clientX, startY: e.clientY,
      origOffsetX: dashboard.bgOffsetX ?? 0,
      origOffsetY: dashboard.bgOffsetY ?? 0,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const startViewPan = (e: React.PointerEvent) => {
    dragState.current = {
      kind: 'pan-view',
      startX: e.clientX, startY: e.clientY,
      origOffsetX: view.offsetX, origOffsetY: view.offsetY,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragState.current) return;
    const s = scaleRef.current;
    const ds = dragState.current;
    if (ds.kind === 'move') {
      onUpdate(ds.id, {
        x: Math.round(ds.origX + (e.clientX - ds.startX) / s),
        y: Math.round(ds.origY + (e.clientY - ds.startY) / s),
      });
    } else if (ds.kind === 'pan-bg') {
      onUpdateDashboard?.({
        bgOffsetX: Math.round(ds.origOffsetX + (e.clientX - ds.startX) / s),
        bgOffsetY: Math.round(ds.origOffsetY + (e.clientY - ds.startY) / s),
      });
    } else if (ds.kind === 'pan-view') {
      setView(v => ({ ...v, offsetX: ds.origOffsetX + (e.clientX - ds.startX), offsetY: ds.origOffsetY + (e.clientY - ds.startY) }));
    }
  };

  const onPointerUp = () => {
    const ds = dragState.current;
    if (ds && ds.kind === 'move') onDragCommit?.(ds.id);
    dragState.current = null;
  };

  const isNight = forceNightPreview ?? (isNightProp ?? false);
  // forceNightPreview (thumbnail capture) always wants a definite day/night
  // shot, never a mid-transition blend, so it overrides nightAmount to a
  // hard 0/1 the same way it already overrides isNight.
  const nightAmount = forceNightPreview !== undefined ? (forceNightPreview ? 1 : 0) : (nightAmountProp ?? 0);
  const eb = dashboard.kioskExitButton ?? { x: 1240, y: 20, opacity: 0.15 };

  const nodeProps = {
    selectedId, onSelect, startDrag, onUpdate, onDragCommit, activeTool, viewRef, containerRef, overlayActiveRef, spriteUrl, kioskMode,
    telemetryData: telemetryData ?? {},
    kioskSweepActive,
    isNight, nightAmount, dayNight: dashboard.dayNight, skipTransition: skipTransition ?? false,
    registerCounterRotate,
    gamepadMappings,
    simStatus,
  };

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', background: '#111', position: 'relative', overflow: 'hidden', isolation: 'isolate', touchAction: 'none' }}
      onPointerDown={e => { if (!kioskMode && !panBgMode) startViewPan(e); }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        ref={innerRef}
        style={{
          position: 'absolute',
          left: view.offsetX, top: view.offsetY,
          width: dashboard.canvasWidth, height: dashboard.canvasHeight,
          zoom: view.scale,
          // Edit-mode-only — the canvas itself has no background color of its
          // own (only whatever `dashboard.background` sprite/photo is set),
          // so with none set it was rendering fully transparent over this
          // panel's dark container, making the dashboard's actual edges
          // invisible while laying it out. `outline` (not `border`) so it
          // doesn't add to the box's own size — every child is positioned in
          // absolute coordinates against `canvasWidth`/`canvasHeight`
          // exactly, and a border would throw that off by 1px. Stripped
          // back out of the captured image explicitly in
          // captureCanvasScreenshot regardless (thumbnails should show the
          // dashboard as kiosk/live view renders it, not this editor
          // affordance), not relied on implicitly just because it's edit-
          // mode-only here too.
          outline: kioskMode ? undefined : '1px solid rgba(255, 255, 255, 0.3)',
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerDown={panBgMode ? (e => { e.stopPropagation(); startBgPan(e); }) : undefined}
      >
        {dashboard.dayNight && !liveBackgroundIsNightPhoto && (
          <div
            style={{
              position: 'absolute', inset: 0,
              zIndex: NIGHT_OVERLAY_Z,
              background: 'rgba(0, 0, 0, 0.850)',
              opacity: nightAmount,
              transition: skipTransition ? undefined : 'opacity 2s ease',
              pointerEvents: 'none',
            }}
          />
        )}
        {liveBackground && (
          <div style={{
            position: 'absolute', top: 0, left: 0,
            width: '100%', height: '100%',
            zIndex: -1,
            pointerEvents: liveBackgroundInteractive ? 'all' : 'none',
          }}>
            {liveBackground}
          </div>
        )}
        {!liveBackground && dashboard.background && (() => {
          const overflow = dashboard.bgOverflow ?? 0;
          const offX = dashboard.bgOffsetX ?? 0;
          const offY = dashboard.bgOffsetY ?? 0;
          return (
            <img
              src={spriteUrl(dashboard.background)}
              alt=""
              style={{
                position: 'absolute',
                left: -overflow + offX,
                top: -overflow + offY,
                width: dashboard.canvasWidth + overflow * 2,
                height: dashboard.canvasHeight + overflow * 2,
                objectFit: 'cover',
                pointerEvents: 'none',
                userSelect: 'none',
                zIndex: -1,
              }}
              draggable={false}
            />
          );
        })()}
        <ClockTimeContext.Provider value={simTimeMs ?? null}>
          {dashboard.components.map(node => (
            <NodeRenderer key={node.id} node={node} absX={0} absY={0} {...nodeProps} />
          ))}
        </ClockTimeContext.Provider>

        <button
          onClick={e => { e.stopPropagation(); onKioskButton?.(); }}
          style={{
            position: 'absolute', left: eb.x, top: eb.y,
            opacity: kioskMode ? eb.opacity : 1,
            background: 'transparent', border: 'none',
            width: 32, height: 32, cursor: 'pointer',
            fontSize: 20, color: '#fff',
          }}
          title={kioskMode ? 'Back to editor' : 'Enter kiosk mode'}
        >{kioskMode ? '←' : '⛶'}</button>
        {kioskMode && dashboard.dayNight && dashboard.nightModeButton && (
          <>
            <button
              ref={nightGearRef}
              onClick={e => {
                e.stopPropagation();
                setShowDayNightSettings(s => !s);
              }}
              style={{
                position: 'absolute', right: 56, bottom: 8,
                zIndex: NIGHT_OVERLAY_Z + 10,
                background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 6, width: 40, height: 40, cursor: 'pointer',
                fontSize: 20, color: '#fff',
              }}
              title="Day/night settings"
            >⚙️</button>
            <button
              onClick={e => {
                e.stopPropagation();
                onToggleNightMode?.();
              }}
              style={{
                position: 'absolute', right: 8, bottom: 8,
                zIndex: NIGHT_OVERLAY_Z + 10,
                background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 6, width: 40, height: 40, cursor: 'pointer',
                fontSize: 20, color: '#fff',
              }}
              title={isNight ? 'Switch to day' : 'Switch to night'}
            >{isNight ? '☀️' : '🌙'}</button>
            {showDayNightSettings && (
              <Callout
                target={nightGearRef}
                onDismiss={() => setShowDayNightSettings(false)}
                directionalHint={DirectionalHint.topRightEdge}
                setInitialFocus
              >
                <div style={{ padding: '1em' }}>
                  <DayNightSimPanel />
                </div>
              </Callout>
            )}
          </>
        )}
      </div>
    </div>
  );
});

export default Canvas;
