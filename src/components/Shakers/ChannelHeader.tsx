import React, { useRef } from 'react';
import { IconButton } from '@fluentui/react';
import { Form } from '../../lib/denim/lib';
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
  onRemove: () => void;
}

// The per-channel "header" cell of the shaker matrix grid — device/pan/
// position, all real per-form fields now (previously a raw <input> for pan
// living outside any form). One Form per channel, keyed on channel.id so it
// remounts (picking up fresh initialValues) when the row identity changes,
// same pattern as EffectRow/LfeRow. No drag-gating needed here (unlike
// EffectRow's sliders) — every field here commits immediately on selection.
const ChannelHeader: React.FC<Props> = ({ channel, audioSinks, onDevidChange, onPanChange, onPositionChange, onRemove }) => {
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
    position: {
      type: 'tyre-position',
      label: 'Position',
    },
  };

  const initialValues = { devid: channel.devid, pan: channel.pan, position: channel.position ?? null };
  const prevRef = useRef(initialValues);
  const skipFirst = useRef(true);

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ fontWeight: 700, fontSize: '1.05em', marginBottom: 4 }}>
        {TYRE_SHORT[channel.position ?? ''] ?? `Ch${channel.pan}`}
      </div>
      <Form
        key={channel.id}
        form={schema}
        name="channel"
        initialValues={initialValues}
        onChange={(_: string, { clean }: any) => {
          if (skipFirst.current) { skipFirst.current = false; prevRef.current = clean; return; }
          const prev = prevRef.current;
          if (clean.devid !== prev.devid) onDevidChange(clean.devid);
          if (clean.pan !== prev.pan) onPanChange(clean.pan);
          if (clean.position !== prev.position) onPositionChange(clean.position);
          prevRef.current = clean;
        }}
      />
      <div style={{ position: 'absolute', top: 0, right: 0 }}>
        <IconButton
          iconProps={{ iconName: 'Delete' }}
          title="Remove Channel"
          onClick={onRemove}
        />
      </div>
    </div>
  );
};
export default ChannelHeader;
