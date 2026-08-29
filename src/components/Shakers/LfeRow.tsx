import React from 'react';
import { IconButton, Icon } from '@fluentui/react';
import { Form } from '../../lib/denim/lib';
import { getTheme } from '../../lib/denim/lib';
import { useRowCommit } from '../../lib/per-form/useRowCommit';
import { lfeSchema } from './schemas';
import { LfeChannel } from './lfeQueries';

interface LfeValues {
  enabled: boolean;
  fader: number;
}

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

  // The inner <Form> remounts (fresh internal values, fresh mount-tick
  // onChange) whenever `channel` flips identity — most commonly on first
  // load, when GET_LFE_CHANNELS resolves from "still loading" (channel null)
  // to real data a beat after LfeRow's own first render. The commit state,
  // however, lives up here in LfeRow, which never itself remounts
  // (ShakerMatrix doesn't key it). Without resetting on identity change the
  // mount tick stays consumed from the *first* (pre-data) mount forever, and
  // the second mount's real-data onChange sails straight into a commit as if
  // the user had toggled Enabled themselves — firing a real onToggle() that
  // deletes the row that just loaded as enabled, flipping `channel` back to
  // null, remounting, re-adding: an infinite add/remove ping-pong, confirmed
  // live as "flickering on/off" after a page refresh.
  //
  // useRowCommit owns that reset now, and does it inline during render for
  // the same reason this code did: the remounted Form's mount-effect fires
  // in the same commit and effects run child-before-parent, so an effect
  // here would reset one render too late to catch it.
  const identity = channel?.id ?? 'none';

  const { handleChange, drag } = useRowCommit<LfeValues>({
    identity,
    onCommit: (next, _prev, changed) => {
      // Toggling wins outright: the row's identity is about to change from
      // the parent re-rendering with fresh data, so nothing else in this
      // snapshot is still meaningful to commit this tick.
      if (changed.includes('enabled')) { onToggle(); return; }
      if (changed.includes('fader')) onUpdate({ fader: next.fader });
    },
  });

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
        onChange={(_name: string, { clean }: any) => handleChange(clean)}
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
