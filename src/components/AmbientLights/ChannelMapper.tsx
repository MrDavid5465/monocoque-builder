import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { Checkbox, PrimaryButton, getTheme } from '@fluentui/react';
import { ChannelColor, colorToCss } from './colorPreview';
import {
  GET_HUENICORN_CHANNELS,
  IHuenicornChannel,
  ISetChannelActive,
  ISetChannelUV,
  SAVE_HUENICORN_PROFILE,
  SET_CHANNEL_ACTIVE,
  SET_CHANNEL_UV,
  UVCorner,
} from './queries';

interface Rect {
  uvAX: number;
  uvAY: number;
  uvBX: number;
  uvBY: number;
}

const HANDLES: Array<{ corner: UVCorner; cx: (r: Rect) => number; cy: (r: Rect) => number }> = [
  { corner: UVCorner.TopLeft, cx: r => r.uvAX, cy: r => r.uvAY },
  { corner: UVCorner.TopRight, cx: r => r.uvBX, cy: r => r.uvAY },
  { corner: UVCorner.BottomLeft, cx: r => r.uvAX, cy: r => r.uvBY },
  { corner: UVCorner.BottomRight, cx: r => r.uvBX, cy: r => r.uvBY },
];

// Mirrors Huenicorn's own Channel::setUV clamp (Channel.cpp) so the box
// doesn't visibly lag the pointer while a drag tick's PUT is in flight — the
// mutation's response still overwrites this with the authoritative value,
// this is only for the frame or two before that response lands.
function applyCornerLocally(r: Rect, corner: UVCorner, x: number, y: number): Rect {
  switch (corner) {
    case UVCorner.TopLeft:
      return { uvAX: x, uvAY: y, uvBX: Math.max(x, r.uvBX), uvBY: Math.max(y, r.uvBY) };
    case UVCorner.TopRight:
      return { uvAX: Math.min(x, r.uvAX), uvAY: y, uvBX: x, uvBY: Math.max(y, r.uvBY) };
    case UVCorner.BottomLeft:
      return { uvAX: x, uvAY: Math.min(y, r.uvAY), uvBX: Math.max(x, r.uvBX), uvBY: y };
    case UVCorner.BottomRight:
      return { uvAX: Math.min(x, r.uvAX), uvAY: Math.min(y, r.uvAY), uvBX: x, uvBY: y };
  }
}

// Touch-friendly replacement for Huenicorn's own web UI screen-region
// editor (ScreenWidget.js/WebUI.js) — see AmbientLights/index.tsx's own
// doc comment. Percentage-positioned SVG children, same coordinate model
// as the original, but Pointer Events (not mouse-only) with
// setPointerCapture per handle so a drag tracks correctly on a touchscreen
// without needing document-level move/up listeners.
export const ChannelMapper: React.FC<{
  channels: IHuenicornChannel[];
  colors: ChannelColor[];
  apiReachable: boolean;
}> = ({ channels, colors, apiReachable }) => {
  const theme = getTheme();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rects, setRects] = useState<Record<number, Rect>>({});
  // Which channel a drag is currently live for — while set, that channel's
  // rect is not overwritten by the `channels` prop sync below, so a slow
  // drag can't get yanked back mid-gesture by GET_HUENICORN_CHANNELS' own
  // ~5s poll landing in between.
  const draggingChannelId = useRef<number | null>(null);
  const pendingPush = useRef<{ channelId: number; corner: UVCorner; x: number; y: number } | null>(null);
  const rafHandle = useRef<number | null>(null);

  const [setChannelUv] = useMutation<ISetChannelUV>(SET_CHANNEL_UV);
  const [setChannelActive] = useMutation<ISetChannelActive>(SET_CHANNEL_ACTIVE, {
    refetchQueries: [{ query: GET_HUENICORN_CHANNELS }],
  });
  const [saveProfile, { loading: saving }] = useMutation(SAVE_HUENICORN_PROFILE);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    setRects(prev => {
      const next = { ...prev };
      channels.forEach(c => {
        if (draggingChannelId.current === c.channelId) return;
        next[c.channelId] = { uvAX: c.uvAX, uvAY: c.uvAY, uvBX: c.uvBX, uvBY: c.uvBY };
      });
      return next;
    });
  }, [channels]);

  useEffect(() => {
    if (selectedId != null && !channels.some(c => c.channelId === selectedId && c.active)) {
      setSelectedId(null);
    }
  }, [channels, selectedId]);

  const colorByChannel = new Map(colors.map(c => [c.channelId, c]));

  const flushPending = useCallback(() => {
    const pending = pendingPush.current;
    pendingPush.current = null;
    rafHandle.current = null;
    if (!pending) return;
    setChannelUv({ variables: pending })
      .then(({ data }) => {
        const uv = data?.setChannelUv;
        if (!uv) return;
        setRects(prev => ({ ...prev, [pending.channelId]: uv }));
      })
      .catch(() => {});
  }, [setChannelUv]);

  // Coalesces to at most one setChannelUv call per animation frame — a raw
  // pointermove stream would otherwise fire far more often than the IPC/
  // GraphQL round-trip needs.
  const schedulePush = (channelId: number, corner: UVCorner, x: number, y: number) => {
    pendingPush.current = { channelId, corner, x, y };
    if (rafHandle.current == null) {
      rafHandle.current = requestAnimationFrame(flushPending);
    }
  };

  const svgRef = useRef<SVGSVGElement>(null);
  const pointFromEvent = (e: React.PointerEvent): { x: number; y: number } => {
    const bbox = svgRef.current?.getBoundingClientRect();
    if (!bbox) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (e.clientX - bbox.left) / bbox.width)),
      y: Math.max(0, Math.min(1, (e.clientY - bbox.top) / bbox.height)),
    };
  };

  const handlePointerDown = (channelId: number) => (e: React.PointerEvent<SVGCircleElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingChannelId.current = channelId;
  };

  const handlePointerMove = (channelId: number, corner: UVCorner) => (e: React.PointerEvent<SVGCircleElement>) => {
    if (draggingChannelId.current !== channelId) return;
    const { x, y } = pointFromEvent(e);
    setRects(prev => {
      const r = prev[channelId];
      if (!r) return prev;
      return { ...prev, [channelId]: applyCornerLocally(r, corner, x, y) };
    });
    schedulePush(channelId, corner, x, y);
  };

  const handlePointerUp = (channelId: number) => (e: React.PointerEvent<SVGCircleElement>) => {
    if (draggingChannelId.current !== channelId) return;
    draggingChannelId.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleSave = async () => {
    setSaveStatus(null);
    try {
      await saveProfile();
      setSaveStatus('Saved');
    } catch (e: any) {
      setSaveStatus(e?.message ?? 'Failed to save');
    }
  };

  if (channels.length === 0) {
    return (
      <div style={{ fontSize: '0.85em', opacity: 0.6 }}>
        No channels yet — start Huenicorn to load its channel list.
      </div>
    );
  }

  const active = channels.filter(c => c.active);
  const inactive = channels.filter(c => !c.active);
  const selectedRect = selectedId != null ? rects[selectedId] : undefined;

  const rectStyle = (channelId: number, isSelected: boolean) => {
    const color = colorByChannel.get(channelId);
    const fill = color ? colorToCss(color) : theme.palette.neutralTertiary;
    return {
      fill,
      fillOpacity: isSelected ? 0.55 : 0.25,
      stroke: isSelected ? theme.palette.themePrimary : theme.palette.neutralSecondary,
      strokeWidth: isSelected ? 2 : 1,
    };
  };

  return (
    <div>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: theme.palette.neutralLighterAlt, borderRadius: 4 }}>
        <svg ref={svgRef} width="100%" height="100%" style={{ display: 'block', touchAction: 'none' }}>
          {active
            .filter(c => c.channelId !== selectedId)
            .map(c => {
              const r = rects[c.channelId];
              if (!r) return null;
              return (
                <rect
                  key={c.channelId}
                  x={`${r.uvAX * 100}%`}
                  y={`${r.uvAY * 100}%`}
                  width={`${(r.uvBX - r.uvAX) * 100}%`}
                  height={`${(r.uvBY - r.uvAY) * 100}%`}
                  {...rectStyle(c.channelId, false)}
                />
              );
            })}

          {selectedId != null && selectedRect && (
            <>
              <rect
                x={`${selectedRect.uvAX * 100}%`}
                y={`${selectedRect.uvAY * 100}%`}
                width={`${(selectedRect.uvBX - selectedRect.uvAX) * 100}%`}
                height={`${(selectedRect.uvBY - selectedRect.uvAY) * 100}%`}
                {...rectStyle(selectedId, true)}
              />
              {HANDLES.map(h => (
                <circle
                  key={h.corner}
                  cx={`${h.cx(selectedRect) * 100}%`}
                  cy={`${h.cy(selectedRect) * 100}%`}
                  r="1.6%"
                  fill={theme.palette.themePrimary}
                  stroke={theme.palette.white}
                  strokeWidth={1}
                  style={{ cursor: 'move' }}
                  onPointerDown={handlePointerDown(selectedId)}
                  onPointerMove={handlePointerMove(selectedId, h.corner)}
                  onPointerUp={handlePointerUp(selectedId)}
                />
              ))}
            </>
          )}
        </svg>
      </div>

      {selectedId != null && selectedRect && (
        <div style={{ fontSize: '0.75em', opacity: 0.6, marginTop: 4 }}>
          {Math.round((selectedRect.uvBX - selectedRect.uvAX) * 100)}% × {Math.round((selectedRect.uvBY - selectedRect.uvAY) * 100)}%
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[...active, ...inactive].map(c => {
          const color = colorByChannel.get(c.channelId);
          return (
            <div
              key={c.channelId}
              onClick={() => c.active && setSelectedId(prev => (prev === c.channelId ? null : c.channelId))}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 8px',
                borderRadius: 3,
                cursor: c.active ? 'pointer' : 'default',
                background: selectedId === c.channelId ? theme.palette.neutralLighter : 'transparent',
                opacity: c.active ? 1 : 0.5,
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  flexShrink: 0,
                  background: color ? colorToCss(color) : theme.palette.neutralTertiary,
                  border: `1px solid ${theme.palette.neutralTertiary}`,
                }}
              />
              <span style={{ flex: 1, fontSize: '0.85em' }}>{c.name}</span>
              <div onClick={e => e.stopPropagation()}>
                <Checkbox
                  checked={c.active}
                  onChange={(_, checked) => {
                    setChannelActive({ variables: { channelId: c.channelId, active: !!checked } });
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <PrimaryButton text={saving ? 'Saving…' : 'Save profile'} onClick={handleSave} disabled={saving} />
        {saveStatus && <span style={{ fontSize: '0.8em', opacity: 0.6 }}>{saveStatus}</span>}
      </div>
      {!apiReachable && (
        <div style={{ fontSize: '0.8em', opacity: 0.6, marginTop: 6 }}>
          Huenicorn isn't running — start it above to edit the screen mapping.
        </div>
      )}
    </div>
  );
};

export default ChannelMapper;
