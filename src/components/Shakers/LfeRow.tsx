import React, { useRef } from 'react';
import { IconButton, Icon } from '@fluentui/react';
import { Form } from '../../lib/denim/lib';
import { getTheme } from '../../lib/denim/lib';
import { lfeSchema } from './schemas';
import { LfeChannel } from './lfeQueries';

interface LfeRowProps {
  // null = this corner has no LfeChannel row yet (disabled).
  channel: LfeChannel | null;
  onToggle: () => void;
  onUpdate: (override: { fader?: number; muted?: boolean }) => void;
}

// Mirrors EffectRow's Form + drag-commit-gating + identity-only-key pattern
// (see EffectRow.tsx's own doc comments for the full reasoning), but much
// smaller: LFE has no tyre/lpf/advanced fields of its own, just
// enabled/fader in the Form, plus a standalone top-right Mute icon button
// (see EffectRow.tsx's own mute button for the same rationale — it commits
// directly via onUpdate rather than through this Form's own commit-diffing).
export const LfeRow: React.FC<LfeRowProps> = ({ channel, onToggle, onUpdate }) => {
  const theme = getTheme();
  const enabled = channel !== null;
  const muted = channel?.muted ?? false;

  const dragging = useRef(false);
  const pending = useRef<any>(null);
  const skipFirst = useRef(true);
  const prevRef = useRef<any>(null);

  // The inner <Form> below remounts (fresh internal values, fresh mount-tick
  // onChange) whenever `channel` flips identity — most commonly right here
  // on first load, when GET_LFE_CHANNELS resolves from "still loading"
  // (channel null) to real data a beat after LfeRow's own first render.
  // These refs, however, live up here in LfeRow, which never itself
  // remounts (ShakerMatrix doesn't key it) — so without this reset,
  // `skipFirst` stays consumed from the *first* (pre-data) mount forever,
  // and the *second* mount's real-data onChange sails straight into
  // commit() as if the user had just toggled Enabled themselves. Since
  // commit() reacts to `enabled`, that fires a real onToggle() — deleting
  // the row that just loaded as enabled — which flips `channel` back to
  // null, remounting again with the same stale-skipFirst problem, this time
  // re-adding it — an infinite add/remove ping-pong, reproduced and
  // confirmed live (the "flickering on/off" after a page refresh). Doing
  // this comparison inline during render (not in a useEffect) matters: the
  // remounted Form's own mount-effect fires as part of the same commit,
  // effects run child-before-parent, so a parent useEffect here would reset
  // these refs one render too late to catch it.
  const identity = channel?.id ?? 'none';
  const lastIdentity = useRef(identity);
  if (lastIdentity.current !== identity) {
    lastIdentity.current = identity;
    skipFirst.current = true;
    prevRef.current = null;
  }

  const commit = (clean: any) => {
    const prev = prevRef.current ?? clean;

    if (clean.enabled !== prev.enabled) {
      onToggle();
      prevRef.current = clean;
      return;
    }

    if (clean.fader !== prev.fader) {
      onUpdate({ fader: clean.fader });
    }

    prevRef.current = clean;
  };

  const drag = {
    onActivate: () => { dragging.current = true; },
    onDeactivate: () => { dragging.current = false; if (pending.current) commit(pending.current); },
  };

  const schema = lfeSchema({ enabled, drag });

  const initialValues = {
    enabled,
    fader: channel?.fader ?? 100,
  };

  return (
    <div style={{ position: 'relative' }}>
      <Form
        key={identity}
        form={schema}
        name="lfe"
        initialValues={initialValues}
        onChange={(_name: string, { clean }: any) => {
          pending.current = clean;
          if (skipFirst.current) { skipFirst.current = false; prevRef.current = clean; return; }
          if (!dragging.current) commit(clean);
        }}
      />
      {enabled && (
        <div style={{ position: 'absolute', top: 0, right: 0 }}>
          <IconButton title={muted ? 'Unmute' : 'Mute'} onClick={() => onUpdate({ muted: !muted })}>
            <Icon iconName={muted ? 'Volume0' : 'Volume3'} style={{ color: muted ? theme.palette.redDark : undefined }} />
          </IconButton>
        </div>
      )}
    </div>
  );
};
