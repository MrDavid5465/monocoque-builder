import React from 'react';
import { ComponentNode } from '../../../types/dashboard';

interface ArcGaugeFaceNodeProps {
  node: ComponentNode;
  nodeAbsX: number;
  nodeAbsY: number;
  isSelected: boolean;
  telemetryData: Record<string, number>;
  kioskMode: boolean;
  registerCounterRotate: (id: string, el: HTMLDivElement | null, steerMaxDeg: number | undefined, rotationDeg: number | undefined) => void;
  childEls: React.ReactNode;
  spriteUrl: (file: string) => string;
  isNight?: boolean;
  nightAmount?: number;
  dayNight?: boolean;
  nightOverlayZ?: number;
}

type Tier = 'major' | 'mid' | 'minor';

const ArcGaugeFaceNode: React.FC<ArcGaugeFaceNodeProps> = ({
  node, nodeAbsX, nodeAbsY, isSelected,
  telemetryData, registerCounterRotate, childEls, spriteUrl,
  isNight = false, nightAmount, dayNight = false, nightOverlayZ = 40,
}) => {
  // Falls back to the binary isNight (as 0/1) if a caller hasn't been
  // updated to pass the continuous value yet.
  const backlitAmount = (node.backlit && dayNight) ? (nightAmount ?? (isNight ? 1 : 0)) : 0;
  const w = node.width ?? 200;
  const h = node.height ?? 200;
  const cx = w / 2;
  const cy = h / 2;

  const maxValue = (node.gaugeMaxField && telemetryData[node.gaugeMaxField])
    || node.gaugeMaxValue
    || 9000;
  const minValue      = node.gaugeMinValue ?? 0;
  const startAngle    = ((node.gaugeStartAngle ?? 135) * Math.PI) / 180;
  const sweepAngle    = ((node.gaugeSweepAngle ?? 270) * Math.PI) / 180;
  const R             = (node.gaugeTickRadius || 0) > 0
    ? node.gaugeTickRadius!
    : Math.min(w, h) / 2 - 8;
  const majorInterval = node.gaugeMajorInterval ?? 1000;
  const midInterval   = node.gaugeMidInterval   ?? 500;
  const minorInterval = node.gaugeMinorInterval ?? 0;
  const rl            = node.gaugeRedlineValue  ?? 0;

  const valueToAngle = (v: number) =>
    startAngle + ((v - minValue) / (maxValue - minValue)) * sweepAngle;

  const tickEndpoints = (angle: number, len: number) => ({
    x1: cx + (R - len) * Math.cos(angle),
    y1: cy + (R - len) * Math.sin(angle),
    x2: cx + R * Math.cos(angle),
    y2: cy + R * Math.sin(angle),
  });

  // Build tick list
  const step = minorInterval || midInterval || majorInterval;
  const ticks: { value: number; tier: Tier }[] = [];
  for (let v = minValue; v <= maxValue + step * 0.001; v += step) {
    const r = Math.round(v);
    const tier: Tier = r % majorInterval === 0
      ? 'major'
      : (midInterval && r % midInterval === 0) ? 'mid'
      : 'minor';
    ticks.push({ value: r, tier });
  }

  // Redline arc path
  let redlineD = '';
  if (rl > 0 && rl < maxValue) {
    const a1 = valueToAngle(rl);
    const a2 = valueToAngle(maxValue);
    const large = (a2 - a1) > Math.PI ? 1 : 0;
    redlineD = `M ${cx + R * Math.cos(a1)} ${cy + R * Math.sin(a1)} A ${R} ${R} 0 ${large} 1 ${cx + R * Math.cos(a2)} ${cy + R * Math.sin(a2)}`;
  }

  const majorTicks = ticks.filter(t => t.tier === 'major');
  const labelOffset = node.gaugeLabelOffset ?? 26;
  const majorLen    = node.gaugeMajorLen    ?? 14;
  const divisor     = node.gaugeLabelDivisor ?? 1;

  // Sprite label helpers
  const charW   = node.charWidth   ?? 20;
  const charH   = node.charHeight  ?? 30;
  const spacing = node.charSpacing ?? 0;
  const charMap = node.charMap     ?? '0123456789';
  const isSprite = node.type === 'sprite-arc-gauge-face';
  const stripMode = isSprite && !!node.file;

  const renderSpriteLabel = (value: number, angle: number) => {
    const lr = R - majorLen - labelOffset;
    const lx = nodeAbsX + cx + lr * Math.cos(angle);
    const ly = nodeAbsY + cy + lr * Math.sin(angle);
    const rot = node.gaugeLabelRotate ? (angle * 180 / Math.PI) + 90 : 0;
    const chars = Array.from(String(Math.round(value / divisor)));
    const totalW = chars.length * charW + Math.max(0, chars.length - 1) * spacing;

    return (
      <div
        key={value}
        style={{
          position: 'absolute',
          left: lx - totalW / 2,
          top: ly - charH / 2,
          display: 'flex',
          flexDirection: 'row',
          transform: rot ? `rotate(${rot}deg)` : undefined,
          transformOrigin: '50% 50%',
          pointerEvents: 'none',
        }}
      >
        {chars.map((ch, i) => {
          if (stripMode) {
            const charIdx = charMap.indexOf(ch);
            return (
              <div key={i} style={{ width: charW, height: charH, overflow: 'hidden', flexShrink: 0, marginRight: i < chars.length - 1 ? spacing : 0 }}>
                <img
                  src={spriteUrl(node.file ?? '')}
                  alt=""
                  draggable={false}
                  style={{ position: 'relative', left: charIdx >= 0 ? -(charIdx * charW) : 0, height: charH, width: 'auto' }}
                />
              </div>
            );
          }
          return (
            <img
              key={i}
              src={spriteUrl(`${ch}.png`)}
              alt={ch}
              draggable={false}
              style={{ width: charW, height: charH, flexShrink: 0, marginRight: i < chars.length - 1 ? spacing : 0 }}
            />
          );
        })}
      </div>
    );
  };

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
          outline: isSelected ? '2px solid #4af' : 'none',
          userSelect: 'none',
          zIndex: backlitAmount >= 0.5 ? nightOverlayZ + 5 : undefined,
          transform: node.counterRotate ? undefined : (node.rotation ? `rotate(${node.rotation}deg)` : undefined),
          transformOrigin: '50% 50%',
        }}
      />

      {/* Ticks + drawn labels rendered in SVG */}
      <svg
        width={w}
        height={h}
        style={{
          position: 'absolute', left: nodeAbsX, top: nodeAbsY, overflow: 'visible', pointerEvents: 'none',
          zIndex: backlitAmount >= 0.5 ? nightOverlayZ + 5 : undefined,
          filter: backlitAmount > 0 ? `drop-shadow(0 0 5px rgba(255, 210, 80, ${(0.8 * backlitAmount).toFixed(3)}))` : undefined,
        }}
      >
        {redlineD && (
          <path
            d={redlineD}
            fill="none"
            stroke={node.gaugeRedlineColor ?? '#ff2020'}
            strokeWidth={majorLen * 0.8}
            strokeLinecap="round"
          />
        )}

        {ticks.map(({ value, tier }) => {
          const len = tier === 'major' ? majorLen
                    : tier === 'mid'   ? (node.gaugeMidLen    ?? 8)
                    :                    (node.gaugeMinorLen   ?? 5);
          const weight = tier === 'major' ? (node.gaugeMajorWeight ?? 2.5)
                       : tier === 'mid'   ? (node.gaugeMidWeight   ?? 1.5)
                       :                    (node.gaugeMinorWeight  ?? 1);
          const angle = valueToAngle(value);
          const isRed = rl > 0 && value >= rl;
          const { x1, y1, x2, y2 } = tickEndpoints(angle, len);
          return (
            <line
              key={value}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={isRed ? (node.gaugeRedlineColor ?? '#ff2020') : (node.gaugeTickColor ?? '#ffffff')}
              strokeWidth={weight}
              strokeLinecap="round"
            />
          );
        })}

        {/* Drawn text labels (arc-gauge-face only) */}
        {!isSprite && majorTicks.map(({ value }) => {
          const angle = valueToAngle(value);
          const lr = R - majorLen - labelOffset;
          const lx = cx + lr * Math.cos(angle);
          const ly = cy + lr * Math.sin(angle);
          const rot = node.gaugeLabelRotate ? (angle * 180 / Math.PI) + 90 : 0;
          return (
            <text
              key={value}
              x={lx} y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={node.gaugeLabelColor  ?? '#ffffff'}
              fontFamily={node.gaugeLabelFont   ?? 'Arial'}
              fontSize={node.gaugeLabelSize   ?? 28}
              fontWeight={node.gaugeLabelWeight ?? 'bold'}
              transform={rot ? `rotate(${rot} ${lx} ${ly})` : undefined}
            >
              {Math.round(value / divisor)}
            </text>
          );
        })}

        {!isSprite && node.gaugeSubLabel && (
          <text
            x={cx}
            y={cy + (node.gaugeLabelSize ?? 28) * 1.8}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={node.gaugeSubLabelColor ?? '#888888'}
            fontFamily={node.gaugeLabelFont ?? 'Arial'}
            fontSize={node.gaugeSubLabelSize ?? 16}
          >
            {node.gaugeSubLabel}
          </text>
        )}
      </svg>

      {/* Sprite labels (sprite-arc-gauge-face only) */}
      {isSprite && majorTicks.map(({ value }) => {
        const el = renderSpriteLabel(value, valueToAngle(value));
        if (backlitAmount < 0.5 || !el) return el;
        return React.cloneElement(el as React.ReactElement, {
          style: {
            ...(el as React.ReactElement).props.style,
            zIndex: nightOverlayZ + 5,
          },
        });
      })}

      {childEls}
    </>
  );
};

export default ArcGaugeFaceNode;
