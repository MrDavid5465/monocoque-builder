import React, { useContext, useEffect, useState } from 'react';
import { ComponentNode } from '../../../types/dashboard';
import { computeClockParts } from './canvasUtils';
import { ClockTimeContext } from './clockTimeContext';

interface ClockTextNodeProps {
  node: ComponentNode;
  nodeAbsX: number;
  nodeAbsY: number;
  isSelected: boolean;
  registerCounterRotate: (id: string, el: HTMLDivElement | null, steerMaxDeg: number | undefined, rotationDeg: number | undefined) => void;
  childEls: React.ReactNode;
  kioskMode: boolean;
}

// Own real-time-mode ticking timer, matching GifGaugeNode's precedent for a
// time-driven (not telemetry-driven) node — explicit and correct regardless
// of how often Canvas happens to re-render for unrelated reasons, rather
// than piggybacking on that incidental frequency.
const ClockTextNode: React.FC<ClockTextNodeProps> = ({ node, nodeAbsX, nodeAbsY, isSelected, registerCounterRotate, childEls, kioskMode }) => {
  const isSimulated = node.clockSource === 'simulated';
  // Read via Context, not a prop — see clockTimeContext.ts's doc comment for
  // why (prop-threading a ~60Hz value through every node in the tree was a
  // real, reproduced bug).
  const simTimeMs = useContext(ClockTimeContext);

  const [realNowMs, setRealNowMs] = useState(() => Date.now());
  useEffect(() => {
    // Don't tick at all outside kiosk/live view (i.e. while editing in the
    // designer) — a freshly-added clock node's own live ticking, combined
    // with the properties panel re-rendering for the same node, was
    // tripping React's "Maximum update depth exceeded" heuristic. A static
    // placeholder (see `display` below) is enough to lay out a dashboard.
    if (!kioskMode || isSimulated) return;
    const id = setInterval(() => setRealNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [kioskMode, isSimulated]);

  // The simulated clock ticks at ~60Hz at the source (matching telemetry —
  // see useGlobalNightMode.ts), far faster than a clock display needs
  // (whole seconds) — committing a fresh render on every one of those
  // pushes would re-render this node 60x/sec for no visible benefit, and
  // did so aggressively enough while the properties panel's Time Source
  // dropdown was also live to trip React's "Maximum update depth exceeded"
  // heuristic (reproduced live via rapid mode switching). Only commit a new
  // displayed instant when the whole SECOND actually changes.
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
    const { hour, minute, second, isPM } = computeClockParts(nowMs, isSimulated, format);
    const hh = format === '12h' ? String(hour) : String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    const ss = String(second).padStart(2, '0');
    display = `${hh}:${mm}${node.showSeconds ? `:${ss}` : ''}${format === '12h' ? ` ${isPM ? 'PM' : 'AM'}` : ''}`;
  }

  return (
    <>
      <div
        ref={node.counterRotate ? (el => registerCounterRotate(node.id, el, node.steerMaxDeg, node.rotation)) : undefined}
        style={{
          position: 'absolute', left: nodeAbsX, top: nodeAbsY,
          fontFamily: node.fontFamily ?? 'Arial, sans-serif',
          fontSize: node.fontSize ?? 32, fontWeight: node.fontWeight ?? 'normal',
          color: node.color ?? '#ffffff', textAlign: node.textAlign ?? 'left',
          outline: isSelected ? '2px solid #4af' : 'none', userSelect: 'none', whiteSpace: 'nowrap', lineHeight: 1,
          transform: node.counterRotate ? undefined : (node.rotation ? `rotate(${node.rotation}deg)` : undefined),
          transformOrigin: '50% 50%',
        }}
      >{display}</div>
      {childEls}
    </>
  );
};

export default ClockTextNode;
