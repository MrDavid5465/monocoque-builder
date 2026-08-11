import React, { useState, useEffect, useRef } from 'react';
import { ComponentNode } from '../../../types/dashboard';
import { fillFraction } from './canvasUtils';

interface GifGaugeNodeProps {
  node: ComponentNode;
  nodeAbsX: number;
  nodeAbsY: number;
  isSelected: boolean;
  spriteUrl: (file: string) => string;
  telemetryData: Record<string, number>;
  excludeFromSweep?: boolean;
  simStatus: string;
  kioskMode: boolean;
  registerCounterRotate: (id: string, el: HTMLDivElement | null, steerMaxDeg: number | undefined, rotationDeg: number | undefined) => void;
  childEls: React.ReactNode;
}

const GifGaugeNode: React.FC<GifGaugeNodeProps> = ({
  node, nodeAbsX, nodeAbsY, isSelected,
  spriteUrl, telemetryData, excludeFromSweep = false, simStatus, kioskMode, registerCounterRotate, childEls,
}) => {
  const frameCount = node.gifFrameCount ?? 1;
  const cols = node.gifCols ?? frameCount;
  const rows = Math.ceil(frameCount / cols);
  const w = node.width ?? 100;
  const h = node.height ?? 100;

  const [startupFrame, setStartupFrame] = useState(0);
  const prevStatusRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (node.gifMode !== 'startup') return;
    if (simStatus === 'Active' && prevStatusRef.current !== 'Active') {
      setStartupFrame(0);
      let f = 0;
      timerRef.current = setInterval(() => {
        f++;
        if (f >= frameCount - 1) {
          clearInterval(timerRef.current!);
          f = frameCount - 1;
        }
        setStartupFrame(f);
      }, 1000 / (node.gifFps ?? 24));
    } else if (simStatus !== 'Active') {
      if (timerRef.current) clearInterval(timerRef.current);
      setStartupFrame(0);
    }
    prevStatusRef.current = simStatus;
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [simStatus, frameCount, node.gifFps, node.gifMode]);

  const frame = node.gifMode === 'startup'
    ? startupFrame
    : Math.min(Math.floor(fillFraction(node, telemetryData, excludeFromSweep) * frameCount), frameCount - 1);

  const col = frame % cols;
  const row = Math.floor(frame / cols);

  return (
    <>
      <div
        ref={node.counterRotate ? (el => registerCounterRotate(node.id, el, node.steerMaxDeg, node.rotation)) : undefined}
        style={{
          position: 'absolute',
          left: nodeAbsX,
          top: nodeAbsY,
          width: w,
          height: h,
          overflow: 'hidden',
          outline: isSelected ? '2px solid #4af' : 'none',
          cursor: kioskMode ? 'default' : 'default',
          userSelect: 'none',
          transform: node.counterRotate ? undefined : (node.rotation ? `rotate(${node.rotation}deg)` : undefined),
          transformOrigin: '50% 50%',
        }}
      >
        {node.file && (
          <img
            src={spriteUrl(node.file)}
            alt={node.name}
            draggable={false}
            style={{
              position: 'absolute',
              left: -col * w,
              top: -row * h,
              width: cols * w,
              height: rows * h,
              display: 'block',
            }}
          />
        )}
      </div>
      {childEls}
    </>
  );
};

export default GifGaugeNode;
