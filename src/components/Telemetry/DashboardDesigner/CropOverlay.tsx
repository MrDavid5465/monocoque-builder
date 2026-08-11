import React, { useRef } from 'react';
import { ComponentNode } from '../../../types/dashboard';
import { describeNodeBox, localToWorld, rot, Pt } from './canvasUtils';

type Edge = 'left' | 'right' | 'top' | 'bottom';

interface View { scale: number; offsetX: number; offsetY: number; }

interface Props {
  node: ComponentNode;
  absX: number;
  absY: number;
  onUpdate: (id: string, patch: Partial<ComponentNode>) => void;
  onDragCommit?: (id: string) => void;
  viewRef: React.RefObject<View>;
  overlayActiveRef: React.MutableRefObject<boolean>;
}

// Always leaves at least this many px visible on the axis being cropped —
// mirrors TransformOverlay's own minimum box size, so a crop drag can never
// zero out the sprite entirely.
const MIN_VISIBLE = 8;
const HANDLE_THICK = 10;
const DIM = 'rgba(20, 20, 20, 0.6)';

// Crop only ever trims the node's own axis-aligned box — it has no notion of
// scale/move/rotate — so unlike TransformOverlay this only needs 4 edge
// handles, dragged in the box's LOCAL (unrotated) space. That's also the
// space clip-path insets apply in on the actual <img>, since clip-path is
// computed before the element's own `transform: rotate(...)`.
//
// Screen→local conversion can't reuse containerRef + view.offset/scale the
// way describeNodeBox's own pivotWorld does: for a node nested inside a
// group, describeNodeBox is called with absX=0 (deliberately group-relative
// — see NodeRenderer's group branch), matching how the DOM composes the
// group wrapper's own offset with its children automatically. Re-deriving
// that composed screen position by hand would mean walking every ancestor
// group's offset. Instead, an invisible 0×0 marker sits exactly at this
// container's own rotation pivot (its `transformOrigin`) — a rotation pivot
// is by definition the one point that doesn't move under the container's
// own `rotate()`, so the marker's real getBoundingClientRect() gives the
// TRUE on-screen position of local point `pivotLocal`, already correctly
// composed through every ancestor transform (group nesting, pan/zoom, DOM
// zoom) regardless of nesting depth. From there, undoing just this
// container's own rotation and the shared view.scale recovers local space.
const CropOverlay: React.FC<Props> = ({ node, absX, absY, onUpdate, onDragCommit, viewRef, overlayActiveRef }) => {
  const dragRef = useRef<Edge | null>(null);
  const originMarkerRef = useRef<HTMLDivElement>(null);

  const box = describeNodeBox(node, absX, absY);
  if (!box) return null;
  const w = box.boxW, h = box.boxH;

  const cropLeft   = Math.min(Math.max(0, node.cropLeft   ?? 0), Math.max(0, w - MIN_VISIBLE));
  const cropRight  = Math.min(Math.max(0, node.cropRight  ?? 0), Math.max(0, w - MIN_VISIBLE - cropLeft));
  const cropTop    = Math.min(Math.max(0, node.cropTop    ?? 0), Math.max(0, h - MIN_VISIBLE));
  const cropBottom = Math.min(Math.max(0, node.cropBottom ?? 0), Math.max(0, h - MIN_VISIBLE - cropTop));

  const boxTopLeftLocal: Pt = { x: box.boxLocalX, y: box.boxLocalY };
  const boxTopLeftWorld = localToWorld(box.pivotWorld, box.pivotLocal, box.theta, boxTopLeftLocal);
  const originLocal: Pt = { x: box.pivotLocal.x - boxTopLeftLocal.x, y: box.pivotLocal.y - boxTopLeftLocal.y };

  const screenToLocal = (clientX: number, clientY: number): Pt => {
    const marker = originMarkerRef.current;
    const view = viewRef.current;
    if (!marker || !view) return { x: 0, y: 0 };
    const originScreen = marker.getBoundingClientRect();
    const dScreen = { x: clientX - originScreen.left, y: clientY - originScreen.top };
    const dCanvas = { x: dScreen.x / view.scale, y: dScreen.y / view.scale };
    const dLocal = rot(-box.theta, dCanvas);
    return { x: box.pivotLocal.x + dLocal.x, y: box.pivotLocal.y + dLocal.y };
  };

  const onEdgeDown = (e: React.PointerEvent, edge: Edge) => {
    e.stopPropagation();
    overlayActiveRef.current = true;
    dragRef.current = edge;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    const edge = dragRef.current;
    if (!edge) return;
    const local = screenToLocal(e.clientX, e.clientY);
    const lx = local.x - box.boxLocalX, ly = local.y - box.boxLocalY;
    if (edge === 'left') {
      onUpdate(node.id, { cropLeft: Math.round(Math.max(0, Math.min(w - (node.cropRight ?? 0) - MIN_VISIBLE, lx))) });
    } else if (edge === 'right') {
      onUpdate(node.id, { cropRight: Math.round(Math.max(0, Math.min(w - (node.cropLeft ?? 0) - MIN_VISIBLE, w - lx))) });
    } else if (edge === 'top') {
      onUpdate(node.id, { cropTop: Math.round(Math.max(0, Math.min(h - (node.cropBottom ?? 0) - MIN_VISIBLE, ly))) });
    } else {
      onUpdate(node.id, { cropBottom: Math.round(Math.max(0, Math.min(h - (node.cropTop ?? 0) - MIN_VISIBLE, h - ly))) });
    }
  };

  const onUp = () => {
    if (dragRef.current) onDragCommit?.(node.id);
    dragRef.current = null;
    overlayActiveRef.current = false;
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: boxTopLeftWorld.x - absX, top: boxTopLeftWorld.y - absY,
        width: w, height: h,
        transform: box.theta ? `rotate(${box.theta}deg)` : undefined,
        transformOrigin: `${originLocal.x}px ${originLocal.y}px`,
        boxSizing: 'border-box', zIndex: 100, touchAction: 'none',
      }}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      <div ref={originMarkerRef} style={{ position: 'absolute', left: originLocal.x, top: originLocal.y, width: 0, height: 0 }} />
      <div style={{ position: 'absolute', inset: 0, border: '1px dashed #4af', pointerEvents: 'none' }} />

      {/* Dimmed strips show what the crop is currently hiding */}
      {cropLeft > 0 && <div style={{ position: 'absolute', left: 0, top: 0, width: cropLeft, height: h, background: DIM, pointerEvents: 'none' }} />}
      {cropRight > 0 && <div style={{ position: 'absolute', right: 0, top: 0, width: cropRight, height: h, background: DIM, pointerEvents: 'none' }} />}
      {cropTop > 0 && <div style={{ position: 'absolute', left: 0, top: 0, width: w, height: cropTop, background: DIM, pointerEvents: 'none' }} />}
      {cropBottom > 0 && <div style={{ position: 'absolute', left: 0, bottom: 0, width: w, height: cropBottom, background: DIM, pointerEvents: 'none' }} />}

      {/* Surviving (post-crop) region outline */}
      <div style={{
        position: 'absolute',
        left: cropLeft, top: cropTop,
        width: Math.max(0, w - cropLeft - cropRight), height: Math.max(0, h - cropTop - cropBottom),
        border: '1px solid #fff', boxSizing: 'border-box', pointerEvents: 'none',
      }} />

      {/* Edge drag handles, centered on the current crop boundary */}
      <div
        onPointerDown={e => onEdgeDown(e, 'left')} onPointerMove={onMove} onPointerUp={onUp}
        style={{ position: 'absolute', left: cropLeft - HANDLE_THICK / 2, top: 0, width: HANDLE_THICK, height: h, cursor: 'ew-resize', touchAction: 'none' }}
      />
      <div
        onPointerDown={e => onEdgeDown(e, 'right')} onPointerMove={onMove} onPointerUp={onUp}
        style={{ position: 'absolute', left: w - cropRight - HANDLE_THICK / 2, top: 0, width: HANDLE_THICK, height: h, cursor: 'ew-resize', touchAction: 'none' }}
      />
      <div
        onPointerDown={e => onEdgeDown(e, 'top')} onPointerMove={onMove} onPointerUp={onUp}
        style={{ position: 'absolute', left: 0, top: cropTop - HANDLE_THICK / 2, width: w, height: HANDLE_THICK, cursor: 'ns-resize', touchAction: 'none' }}
      />
      <div
        onPointerDown={e => onEdgeDown(e, 'bottom')} onPointerMove={onMove} onPointerUp={onUp}
        style={{ position: 'absolute', left: 0, top: h - cropBottom - HANDLE_THICK / 2, width: w, height: HANDLE_THICK, cursor: 'ns-resize', touchAction: 'none' }}
      />
    </div>
  );
};

export default CropOverlay;
