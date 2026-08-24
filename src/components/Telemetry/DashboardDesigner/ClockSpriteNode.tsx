import React, { useContext, useEffect, useState } from 'react';
import { ComponentNode } from '../../../types/dashboard';
import { computeClockParts } from './canvasUtils';
import { ClockTimeContext } from './clockTimeContext';

interface ClockSpriteNodeProps {
  node: ComponentNode;
  nodeAbsX: number;
  nodeAbsY: number;
  isSelected: boolean;
  spriteUrl: (file: string) => string;
  registerCounterRotate: (id: string, el: HTMLDivElement | null, steerMaxDeg: number | undefined, rotationDeg: number | undefined) => void;
  childEls: React.ReactNode;
  kioskMode: boolean;
}

// Renders the current time as individually-cropped sprite-sheet cells — the
// same per-character mechanism as sprite-text-gauge (Canvas.tsx's
// 'sprite-text-gauge' branch), just with the source string built from the
// clock instead of a telemetry binding. See ClockTextNode's doc comment for
// why real-time mode ticks its own timer, and why simulated mode throttles
// its display to whole-second updates instead of re-rendering on every ~60Hz
// tick push.
const ClockSpriteNode: React.FC<ClockSpriteNodeProps> = ({ node, nodeAbsX, nodeAbsY, isSelected, spriteUrl, registerCounterRotate, childEls, kioskMode }) => {
  const isSimulated = node.clockSource === 'simulated';
  // Read via Context, not a prop — see clockTimeContext.ts's doc comment.
  const simTimeMs = useContext(ClockTimeContext);

  const [realNowMs, setRealNowMs] = useState(() => Date.now());
  useEffect(() => {
    // Don't tick outside kiosk/live view — see ClockTextNode's matching
    // effect for why (Maximum update depth exceeded while editing).
    if (!kioskMode || isSimulated) return;
    const id = setInterval(() => setRealNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [kioskMode, isSimulated]);

  const [simDisplayMs, setSimDisplayMs] = useState(() => simTimeMs ?? Date.now());
  useEffect(() => {
    if (!kioskMode || !isSimulated || simTimeMs == null) return;
    setSimDisplayMs(prev => (Math.floor(simTimeMs / 1000) !== Math.floor(prev / 1000) ? simTimeMs : prev));
  }, [kioskMode, isSimulated, simTimeMs]);

  const format = node.clockFormat ?? '24h';
  let display: string;
  if (!kioskMode) {
    display = '00:00';
  } else {
    const nowMs = isSimulated ? simDisplayMs : realNowMs;
    const { hour, minute, second } = computeClockParts(nowMs, isSimulated, format);
    const hh = format === '12h' ? String(hour) : String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    const ss = String(second).padStart(2, '0');
    // No AM/PM suffix here — an arbitrary sprite sheet isn't guaranteed to
    // have AM/PM glyphs (see clock-sprite/schema.ts's clockFormat field
    // comment); use clock-text if that distinction needs to be visible.
    display = `${hh}:${mm}${node.showSeconds ? `:${ss}` : ''}`;
  }

  if (!node.charWidth || !node.charHeight) {
    // Unconfigured character grid — nothing sensible to crop yet, matches
    // sprite-text-gauge's own behavior of falling through rather than
    // guessing a cell size.
    return <>{childEls}</>;
  }

  const charMap = node.charMap ?? '0123456789. :-';
  const cw = node.charWidth;
  const ch = node.charHeight;
  const spacing = node.charSpacing ?? 0;
  const gridCols = node.charGridCols && node.charGridCols > 0 ? node.charGridCols : charMap.length;
  const gridRows = Math.ceil(charMap.length / gridCols);
  const chars = Array.from(display);
  const contentW = chars.length * cw + spacing * Math.max(0, chars.length - 1);
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
        {chars.map((ch_char, i) => {
          const cellMarginRight = i < chars.length - 1 ? spacing : 0;
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
    </>
  );
};

export default ClockSpriteNode;
