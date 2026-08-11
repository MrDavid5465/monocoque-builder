import React, { useRef } from 'react';
import { ComponentNode } from '../../../types/dashboard';
import { describeNodeBox, localToWorld, worldToLocal, scaleGroupChildren, Pt, NodeBoxDescriptor } from './canvasUtils';

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type OverlayDragState =
  | { kind: 'move'; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'scale'; handle: HandleId; box0: NodeBoxDescriptor }
  | { kind: 'rotate'; startAngleDeg: number; startRotation: number; pivotWorld: Pt };

interface View { scale: number; offsetX: number; offsetY: number; }

interface Props {
  node: ComponentNode;
  absX: number;
  absY: number;
  // The DOM frame the overlay's own left/top are rendered relative to.
  // Defaults to absX/absY (correct whenever the overlay is mounted as a
  // sibling of the node's own content, which is every case except one).
  // A GROUP's own overlay is mounted INSIDE the group's already-positioned
  // wrapper div (so counter-rotation/manual rotation has a well-defined
  // origin) — that wrapper already applies `left: absX+node.x`, so the
  // overlay must render relative to the group's OWN position (nodeAbsX),
  // not its parent's, or node.x gets double-counted (wrong position, and
  // the box drifts at 2x the rate of the real content during a move-drag).
  // absX/absY themselves are NEVER adjusted for this — they still feed
  // describeNodeBox's pivot math and buildScalePatch's write-back, which
  // must stay in the node's true parent frame regardless of DOM nesting.
  renderOffsetX?: number;
  renderOffsetY?: number;
  onUpdate: (id: string, patch: Partial<ComponentNode>) => void;
  onDragCommit?: (id: string) => void;
  viewRef: React.RefObject<View>;
  containerRef: React.RefObject<HTMLDivElement>;
  // Set true while any handle drag is active here, so Canvas's pinch-zoom
  // tracker (a capture-phase listener that sees every touch regardless of
  // stopPropagation) knows not to also start a two-finger zoom gesture from
  // an incidental second touch (e.g. a palm/thumb) — without this, pinch's
  // continuous view writes corrupt this component's own screen→canvas math
  // mid-drag, which is what produced the runaway/exploding resize on touch.
  overlayActiveRef: React.MutableRefObject<boolean>;
  // Only consulted by describeNodeBox for sprite-text-gauge's hideLeadingZeros
  // case — see the comment on describeNodeBox itself for why this is a scoped
  // exception to "the box never reacts to live telemetry."
  telemetryData?: Record<string, number>;
  excludeFromSweep?: boolean;
}

const HANDLES: { id: HandleId; corner: boolean }[] = [
  { id: 'nw', corner: true }, { id: 'n', corner: false }, { id: 'ne', corner: true },
  { id: 'e', corner: false }, { id: 'se', corner: true }, { id: 's', corner: false },
  { id: 'sw', corner: true }, { id: 'w', corner: false },
];

function handleLocalPos(id: HandleId, w: number, h: number): Pt {
  switch (id) {
    case 'nw': return { x: 0, y: 0 };
    case 'n':  return { x: w / 2, y: 0 };
    case 'ne': return { x: w, y: 0 };
    case 'e':  return { x: w, y: h / 2 };
    case 'se': return { x: w, y: h };
    case 's':  return { x: w / 2, y: h };
    case 'sw': return { x: 0, y: h };
    case 'w':  return { x: 0, y: h / 2 };
  }
}

// The opposite anchor point (local, within box0's own rect) for a given handle.
function anchorFor(id: HandleId, box0: NodeBoxDescriptor): Pt {
  const minX = box0.boxLocalX, minY = box0.boxLocalY, maxX = minX + box0.boxW, maxY = minY + box0.boxH;
  switch (id) {
    case 'nw': return { x: maxX, y: maxY };
    case 'n':  return { x: minX + box0.boxW / 2, y: maxY };
    case 'ne': return { x: minX, y: maxY };
    case 'e':  return { x: minX, y: minY + box0.boxH / 2 };
    case 'se': return { x: minX, y: minY };
    case 's':  return { x: minX + box0.boxW / 2, y: minY };
    case 'sw': return { x: maxX, y: minY };
    case 'w':  return { x: maxX, y: minY + box0.boxH / 2 };
  }
}

const CURSOR: Record<HandleId, string> = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
};

const TransformOverlay: React.FC<Props> = ({ node, absX, absY, renderOffsetX, renderOffsetY, onUpdate, onDragCommit, viewRef, containerRef, overlayActiveRef, telemetryData, excludeFromSweep }) => {
  const roX = renderOffsetX ?? absX;
  const roY = renderOffsetY ?? absY;
  const dragRef = useRef<OverlayDragState | null>(null);

  const box = describeNodeBox(node, absX, absY, telemetryData, excludeFromSweep);
  if (!box) return null;

  const screenToCanvas = (clientX: number, clientY: number): Pt => {
    const el = containerRef.current;
    const view = viewRef.current;
    if (!el || !view) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: (clientX - rect.left - view.offsetX) / view.scale, y: (clientY - rect.top - view.offsetY) / view.scale };
  };

  const boxTopLeftLocal: Pt = { x: box.boxLocalX, y: box.boxLocalY };
  const boxTopLeftWorld = localToWorld(box.pivotWorld, box.pivotLocal, box.theta, boxTopLeftLocal);
  const originLocal: Pt = { x: box.pivotLocal.x - boxTopLeftLocal.x, y: box.pivotLocal.y - boxTopLeftLocal.y };

  const buildScalePatch = (box0: NodeBoxDescriptor, handle: HandleId, sx: number, sy: number): Partial<ComponentNode> => {
    const anchor = anchorFor(handle, box0);
    const pivotLocalNew: Pt = box0.isGroup ? { x: 0, y: 0 }
      : box0.isNeedle ? { x: box0.pivotLocal.x * sx, y: box0.pivotLocal.y * sy }
      : { x: box0.boxW * sx / 2, y: box0.boxH * sy / 2 };
    const anchorLocalNew: Pt = { x: anchor.x * sx, y: anchor.y * sy };
    const anchorWorld = localToWorld(box0.pivotWorld, box0.pivotLocal, box0.theta, anchor);
    const anchorToPivotNewLocal: Pt = { x: anchorLocalNew.x - pivotLocalNew.x, y: anchorLocalNew.y - pivotLocalNew.y };
    // rotate(theta, anchorToPivotNewLocal) then subtract from anchorWorld
    const rad = box0.theta * Math.PI / 180;
    const c = Math.cos(rad), s = Math.sin(rad);
    const rotated = { x: anchorToPivotNewLocal.x * c - anchorToPivotNewLocal.y * s, y: anchorToPivotNewLocal.x * s + anchorToPivotNewLocal.y * c };
    const pivotWorldNew: Pt = { x: anchorWorld.x - rotated.x, y: anchorWorld.y - rotated.y };

    if (box0.isGroup || box0.isNeedle) {
      const newParentX = Math.round(pivotWorldNew.x - absX), newParentY = Math.round(pivotWorldNew.y - absY);
      if (box0.isGroup) return { x: newParentX, y: newParentY, children: scaleGroupChildren(node.children ?? [], sx, sy) };
      const newW = Math.max(4, Math.round(box0.boxW * sx)), newH = Math.max(4, Math.round(box0.boxH * sy));
      return {
        x: newParentX, y: newParentY, width: newW, height: newH,
        rotationX: Math.round(box0.pivotLocal.x * sx), rotationY: Math.round(box0.pivotLocal.y * sy),
      };
    }
    const boxTopLeftWorldNew = localToWorld(pivotWorldNew, pivotLocalNew, box0.theta, { x: 0, y: 0 });
    return {
      x: Math.round(boxTopLeftWorldNew.x - absX), y: Math.round(boxTopLeftWorldNew.y - absY),
      width: Math.max(4, Math.round(box0.boxW * sx)), height: Math.max(4, Math.round(box0.boxH * sy)),
    };
  };

  const onMoveDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    overlayActiveRef.current = true;
    dragRef.current = { kind: 'move', startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onScaleDown = (e: React.PointerEvent, handle: HandleId) => {
    e.stopPropagation();
    overlayActiveRef.current = true;
    dragRef.current = { kind: 'scale', handle, box0: box };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onRotateDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    overlayActiveRef.current = true;
    const m = screenToCanvas(e.clientX, e.clientY);
    const startAngleDeg = Math.atan2(m.y - box.pivotWorld.y, m.x - box.pivotWorld.x) * 180 / Math.PI;
    dragRef.current = { kind: 'rotate', startAngleDeg, startRotation: node.rotation ?? 0, pivotWorld: box.pivotWorld };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onDragMove = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    const view = viewRef.current;
    if (ds.kind === 'move') {
      const s = view?.scale ?? 1;
      onUpdate(node.id, {
        x: Math.round(ds.origX + (e.clientX - ds.startX) / s),
        y: Math.round(ds.origY + (e.clientY - ds.startY) / s),
      });
    } else if (ds.kind === 'scale') {
      const m = screenToCanvas(e.clientX, e.clientY);
      const mLocal = worldToLocal(ds.box0.pivotWorld, ds.box0.pivotLocal, ds.box0.theta, m);
      const anchor = anchorFor(ds.handle, ds.box0);
      const w = ds.box0.boxW, h = ds.box0.boxH;
      const isCorner = HANDLES.find(h2 => h2.id === ds.handle)?.corner;
      // Every branch below unconditionally assigns both before use.
      let sx: number, sy: number;
      // Ceiling guards against a single wild pointermove reading (touch
      // coordinates are noisier than mouse, and a coalesced/large jump could
      // otherwise project to an enormous one-frame scale factor) blowing the
      // node up to an absurd size in one step.
      const MAX_SCALE_FACTOR = 20;
      if (isCorner) {
        const orig = handleLocalPos(ds.handle, w, h);
        const sxSign = Math.sign(orig.x - anchor.x) || 1;
        const sySign = Math.sign(orig.y - anchor.y) || 1;
        const dx = mLocal.x - anchor.x, dy = mLocal.y - anchor.y;
        const raw = (dx * sxSign * w + dy * sySign * h) / (w * w + h * h);
        const scale = Math.min(MAX_SCALE_FACTOR, Math.max(raw, 4 / w, 4 / h));
        sx = scale; sy = scale;
      } else if (ds.handle === 'e' || ds.handle === 'w') {
        const sign = ds.handle === 'e' ? 1 : -1;
        const newW = Math.max(4, (mLocal.x - anchor.x) * sign);
        sx = Math.min(MAX_SCALE_FACTOR, newW / w); sy = 1;
      } else {
        const sign = ds.handle === 's' ? 1 : -1;
        const newH = Math.max(4, (mLocal.y - anchor.y) * sign);
        sy = Math.min(MAX_SCALE_FACTOR, newH / h); sx = 1;
      }
      onUpdate(node.id, buildScalePatch(ds.box0, ds.handle, sx, sy));
    } else if (ds.kind === 'rotate') {
      const m = screenToCanvas(e.clientX, e.clientY);
      const curAngleDeg = Math.atan2(m.y - ds.pivotWorld.y, m.x - ds.pivotWorld.x) * 180 / Math.PI;
      const newRotation = Math.round((ds.startRotation + (curAngleDeg - ds.startAngleDeg)) * 10) / 10;
      onUpdate(node.id, { rotation: newRotation });
    }
  };

  const onDragUp = () => {
    if (dragRef.current) onDragCommit?.(node.id);
    dragRef.current = null;
    overlayActiveRef.current = false;
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: boxTopLeftWorld.x - roX, top: boxTopLeftWorld.y - roY,
        width: box.boxW, height: box.boxH,
        transform: box.theta ? `rotate(${box.theta}deg)` : undefined,
        transformOrigin: `${originLocal.x}px ${originLocal.y}px`,
        border: '1px dashed #4af', boxSizing: 'border-box', pointerEvents: 'auto', zIndex: 100,
        touchAction: 'none',
      }}
      onPointerDown={onMoveDown}
      onPointerMove={onDragMove}
      onPointerUp={onDragUp}
    >
      {HANDLES.map(({ id, corner }) => {
        const p = handleLocalPos(id, box.boxW, box.boxH);
        return (
          <React.Fragment key={id}>
            {corner && (
              <div
                onPointerDown={onRotateDown}
                onPointerMove={onDragMove}
                onPointerUp={onDragUp}
                style={{ position: 'absolute', left: p.x - 22, top: p.y - 22, width: 44, height: 44, cursor: 'grab', zIndex: 100, touchAction: 'none' }}
              />
            )}
            <div
              onPointerDown={e => onScaleDown(e, id)}
              onPointerMove={onDragMove}
              onPointerUp={onDragUp}
              style={{ position: 'absolute', left: p.x - 16, top: p.y - 16, width: 32, height: 32, cursor: CURSOR[id], zIndex: 101, touchAction: 'none' }}
            >
              <div style={{
                position: 'absolute', left: 11, top: 11, width: 10, height: 10,
                background: '#fff', border: '1px solid #4af', boxSizing: 'border-box', pointerEvents: 'none',
              }} />
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default TransformOverlay;
