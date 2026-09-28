import React from 'react';
import { Label, Stack } from '@fluentui/react';
import { Form } from '../../lib/denim/lib';
import { TyreGrid } from '../shared/TyreGrid';
import { useRowCommit } from '../../lib/per-form/useRowCommit';
import { TYRE_SHORT } from './EffectRow';
import { ShakerChannel } from './channelQueries';
import { AudioSinkInfo } from './dspQueries';
import { channelPositionName } from './shakerUtils';

interface Props {
  channel: ShakerChannel;
  audioSinks: AudioSinkInfo[];
  onDevidChange: (devid: string) => void;
  onPanChange: (pan: number) => void;
  onPositionChange: (position: string) => void;
}

// The per-channel "header" cell of the shaker matrix grid — device/pan/
// position, all real per-form fields now (previously a raw <input> for pan
// living outside any form). One Form per channel, keyed on channel.id so it
// remounts (picking up fresh initialValues) when the row identity changes,
// same pattern as EffectRow/LfeRow. No drag-gating needed here (unlike
// EffectRow's sliders) — every field here commits immediately on selection.
// Removing a channel is a grid-level (toolbar) action now, not a per-row
// button — see ShakerMatrix.tsx's `rowButtons` prop on its DetailsGrid.
const ChannelHeader: React.FC<Props> = ({ channel, audioSinks, onDevidChange, onPanChange, onPositionChange }) => {
  const schema = {
    devid: {
      type: 'select',
      label: 'Device',
      options: [
        { text: '— Select output device —', value: '' },
        ...audioSinks.map(s => ({ text: `${s.description} (${s.channels}ch)`, value: s.name })),
      ],
    },
    // Options are the selected device's own channel names/positions (e.g. a
    // 4-channel device is Front Left/Front Right/Rear Left/Rear Right, not
    // "Channel 1..4") — value is still the 0-based index Monocoque expects,
    // the label is just human-readable. See channelPositionName's own doc
    // comment for the standard layouts covered.
    pan: {
      type: 'select',
      label: 'Pan',
      options: Array.from({ length: Math.max(1, channel.channels) }, (_, i) => ({
        text: channelPositionName(channel.channels, i), value: i,
      })),
    },
    // 'custom', not a Fabric builtin 'tyre-position' case: TyreGrid is this
    // app's own component (Monocoque tyre-position picker) with no place in
    // typical-admin-fabric, which is now a shared package submoduled by
    // apps that don't have it.
    position: {
      type: 'custom' as const,
      label: 'Position',
      onRender: ({ value, onChange, name }: any) => (
        <Stack>
          <Label>Position</Label>
          <TyreGrid current={value ?? null} onApply={(pos: string) => onChange(name, pos)} />
        </Stack>
      ),
    },
  };

  const initialValues = { devid: channel.devid, pan: channel.pan, position: channel.position ?? null };

  // Previously this kept bare skipFirst/prevRef with NO identity reset — the
  // latent form of the bug LfeRow/EffectRow document. It only stayed benign
  // because the Form is keyed on channel.id while these refs sat one level
  // up, so a channel swap left the mount tick already consumed and the next
  // real-data onChange would have committed as a phantom edit. Routing
  // through useRowCommit with channel.id as the identity closes that
  // uniformly rather than relying on the parent never reusing the component.
  const { handleChange } = useRowCommit<typeof initialValues>({
    identity: channel.id,
    initial: initialValues,
    onCommit: (next, _prev, changed) => {
      if (changed.includes('devid')) onDevidChange(next.devid);
      if (changed.includes('pan')) onPanChange(next.pan);
      if (changed.includes('position')) onPositionChange(next.position as string);
    },
  });

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: '1.05em', marginBottom: 4 }}>
        {TYRE_SHORT[channel.position ?? ''] ?? `Ch${channel.pan}`}
      </div>
      <Form
        key={channel.id}
        form={schema}
        name="channel"
        initialValues={initialValues}
        onChange={(_: string, { clean }: any) => handleChange(clean)}
      />
    </div>
  );
};
export default ChannelHeader;
