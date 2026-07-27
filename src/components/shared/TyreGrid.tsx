import React, { useState, useEffect } from 'react';
import { IconButton, Icon } from '@fluentui/react';
import { getTheme } from '../../lib/denim/lib';
import { cornersToConfig, configToCorners, type Corner } from './tyreGridUtils';

// A bespoke multi-button corner-selector grid — no standard Fluent control
// for this shape, so it's hand-rolled (see the hand-rolled-components
// skill). Lives in components/shared/ rather than a single feature's folder
// since it's generic within this app: used directly by Shakers'
// ChannelHeader.tsx/CarLayout.tsx, and also wired into
// typical-admin-fabric/lib/templates/Fabric.tsx as the 'tyre-position'
// field type, so any per-form schema in this app can use it, not just
// Shakers'.
export const TyreGrid: React.FC<{ current?: string | null; onApply: (tyre: string) => void }> = ({ current, onApply }) => {
  const theme = getTheme();
  const [selected, setSelected] = useState<Set<Corner>>(() => configToCorners(current));
  useEffect(() => setSelected(configToCorners(current)), [current]);

  const toggle = (c: Corner) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(c)) next.delete(c); else next.add(c);
    return next;
  });

  const derived = cornersToConfig(selected);
  const unchanged = derived === (current ?? null);

  const cellBtn = (c: Corner): React.CSSProperties => ({
    background: selected.has(c) ? theme.palette.themePrimary : theme.palette.neutralLight,
    color: selected.has(c) ? theme.palette.white : theme.palette.neutralPrimary,
    border: 'none', borderRadius: 3, padding: '5px 0',
    cursor: 'pointer', fontSize: '0.75em', fontWeight: 700, width: 34,
  });

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
        {(['FL', 'FR', 'RL', 'RR'] as Corner[]).map(c => (
          <button key={c} style={cellBtn(c)} onClick={() => toggle(c)}>{c}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
        <span style={{ fontSize: '0.72em', color: derived ? theme.palette.neutralSecondary : theme.palette.redDark }}>
          {derived ?? 'Invalid'}
        </span>
        <IconButton
          title="Apply"
          disabled={!derived || unchanged}
          onClick={() => derived && onApply(derived)}
          styles={{
            root: {
              width: 24, height: 24,
              background: derived && !unchanged ? theme.palette.themePrimary : undefined,
            },
          }}
        >
          <Icon iconName="CheckMark" style={{ color: derived && !unchanged ? theme.palette.white : undefined }} />
        </IconButton>
      </div>
    </div>
  );
};

export default TyreGrid;
