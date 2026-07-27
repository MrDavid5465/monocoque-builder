import React, { useMemo } from 'react';
import { useQuery, useMutation, useSubscription } from '@apollo/client/react';
import { getTheme } from '../../lib/denim/lib';
import { confirmAsync } from '../../lib/denim/components/ConfirmDialog';
import { GET_ITEMS, CREATE_ITEM, UPDATE_ITEM, REMOVE_ITEM, ITEM_CHANGED } from './queries';
import { toInput, nextDspSlot, nextPan } from './ShakerMatrix';
import { EffectRow, EFFECTS, EFFECT_LABELS, TYRE_SHORT, ShakerRec } from './EffectRow';
import TyreGrid from '../shared/TyreGrid';
import { GET_AUDIO_SINKS, AudioSinkInfo } from './dspQueries';
import {
  GET_SHAKER_CHANNELS, ADD_SHAKER_CHANNEL, UPDATE_SHAKER_CHANNEL, REMOVE_SHAKER_CHANNEL,
  SHAKER_CHANNEL_CHANGED, ShakerChannel,
} from './channelQueries';

type Sector = 'Front' | 'FL' | 'FR' | 'All' | 'RL' | 'RR' | 'Rear';

function getSector(channel: ShakerChannel): Sector {
  switch (channel.position) {
    case 'Front':      return 'Front';
    case 'FrontLeft':  return 'FL';
    case 'FrontRight': return 'FR';
    case 'RearLeft':   return 'RL';
    case 'RearRight':  return 'RR';
    case 'Rear':       return 'Rear';
    default:           return 'All';
  }
}

// ── Channel card ─────────────────────────────────────────────────────────────

const ChannelCard: React.FC<{
  channel: ShakerChannel;
  channelRecords: ShakerRec[];
  sinkOptions: { key: string; text: string }[];
  audioSinks: AudioSinkInfo[];
  onToggle: (eff: string, rec: ShakerRec | null, channel: ShakerChannel) => void;
  onUpdate: (rec: ShakerRec, override: Partial<ShakerRec>) => void;
  onDevidChange: (channel: ShakerChannel, devid: string) => void;
  onPositionChange: (channel: ShakerChannel, position: string) => void;
  onPanChange: (channel: ShakerChannel, pan: number) => void;
  onRemove: (channel: ShakerChannel) => void;
}> = ({ channel, channelRecords, sinkOptions, onToggle, onUpdate, onDevidChange, onPositionChange, onPanChange, onRemove }) => {
  const theme = getTheme();
  const border = `1px solid ${theme.palette.neutralTertiaryAlt}`;

  return (
    <div style={{
      border,
      borderRadius: 6,
      overflow: 'hidden',
      background: theme.palette.white,
      marginBottom: 6,
    }}>
      {/* Card header */}
      <div style={{
        background: theme.palette.neutralLight,
        padding: '5px 10px',
        borderBottom: border,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: '0.95em' }}>{TYRE_SHORT[channel.position ?? ''] ?? channel.position ?? `Chan ${channel.pan}`}</span>
          <span style={{ fontSize: '0.72em', opacity: 0.5 }}>pan {channel.pan}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          <select
            value={channel.devid}
            onChange={e => onDevidChange(channel, e.target.value)}
            style={{ fontSize: '0.72em', maxWidth: 140 }}
          >
            {sinkOptions.map(o => <option key={o.key} value={o.key}>{o.text}</option>)}
          </select>
          <span style={{ fontSize: '0.72em', opacity: 0.6 }}>Pan</span>
          <input
            type="number" min={0} max={Math.max(0, channel.channels - 1)}
            value={channel.pan}
            onChange={e => onPanChange(channel, Number(e.target.value))}
            style={{ width: 38, fontSize: '0.72em' }}
          />
          <TyreGrid current={channel.position ?? null} onApply={pos => onPositionChange(channel, pos)} />
          <button
            onClick={() => onRemove(channel)}
            style={{
              marginLeft: 'auto', fontSize: '0.7em', padding: '2px 6px', border: 'none', borderRadius: 3,
              cursor: 'pointer', background: theme.palette.neutralLighter, color: theme.palette.neutralPrimary,
            }}
          >
            Remove
          </button>
        </div>
      </div>

      {/* Effect rows */}
      <div style={{ padding: '4px 0' }}>
        {EFFECTS.map((eff, i) => {
          const rec = channelRecords.find(r => r.effect.toLowerCase() === eff) ?? null;
          return (
            <div
              key={eff}
              style={{
                padding: '6px 10px',
                borderTop: i > 0 ? `1px solid ${theme.palette.neutralLighter}` : undefined,
              }}
            >
              <EffectRow
                rec={rec}
                label={EFFECT_LABELS[eff]}
                onToggle={() => onToggle(eff, rec, channel)}
                onUpdate={override => rec && onUpdate(rec, override)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Sector panel ─────────────────────────────────────────────────────────────

const SectorPanel: React.FC<{
  label: string;
  channels: ShakerChannel[];
  allRecords: ShakerRec[];
  sinkOptions: { key: string; text: string }[];
  audioSinks: AudioSinkInfo[];
  onToggle: (eff: string, rec: ShakerRec | null, channel: ShakerChannel) => void;
  onUpdate: (rec: ShakerRec, override: Partial<ShakerRec>) => void;
  onDevidChange: (channel: ShakerChannel, devid: string) => void;
  onPositionChange: (channel: ShakerChannel, position: string) => void;
  onPanChange: (channel: ShakerChannel, pan: number) => void;
  onRemove: (channel: ShakerChannel) => void;
  placeholder?: boolean;
}> = ({ label, channels, allRecords, placeholder, ...rest }) => {
  const theme = getTheme();

  if (placeholder && channels.length === 0) {
    return (
      <div style={{
        border: `1px dashed ${theme.palette.neutralTertiaryAlt}`,
        borderRadius: 6,
        padding: '10px 12px',
        opacity: 0.35,
        fontSize: '0.8em',
        textAlign: 'center',
        color: theme.palette.neutralSecondary,
      }}>
        {label}
      </div>
    );
  }

  return (
    <div>
      {channels.length > 0 && (
        <div style={{
          fontSize: '0.72em',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          opacity: 0.45,
          marginBottom: 4,
          color: theme.palette.neutralPrimary,
        }}>
          {label}
        </div>
      )}
      {channels.map(ch => (
        <ChannelCard
          key={ch.id}
          channel={ch}
          channelRecords={allRecords.filter(r => r.channelId === ch.id)}
          {...rest}
        />
      ))}
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

const CarLayout: React.FC<{ profileId?: string | null }> = ({ profileId = null }) => {
  const theme = getTheme();

  const { data } = useQuery(GET_ITEMS);
  useSubscription(ITEM_CHANGED);

  const allRecords: ShakerRec[] = useMemo(
    () => (data as any)?.getMonocoqueSoundDevices ?? [],
    [data],
  );

  const records = useMemo(
    () => allRecords.filter(r => (r.profileId ?? null) === profileId),
    [allRecords, profileId],
  );

  const [addRec] = useMutation(CREATE_ITEM, { refetchQueries: [{ query: GET_ITEMS }] });
  const [updateRec] = useMutation(UPDATE_ITEM);
  const [removeRec] = useMutation(REMOVE_ITEM, { refetchQueries: [{ query: GET_ITEMS }] });

  const { data: channelsData } = useQuery(GET_SHAKER_CHANNELS);
  useSubscription(SHAKER_CHANNEL_CHANGED);
  const [addShakerChannel] = useMutation(ADD_SHAKER_CHANNEL, { refetchQueries: [{ query: GET_SHAKER_CHANNELS }] });
  const [updateShakerChannel] = useMutation(UPDATE_SHAKER_CHANNEL);
  const [removeShakerChannel] = useMutation(REMOVE_SHAKER_CHANNEL, { refetchQueries: [{ query: GET_SHAKER_CHANNELS }] });

  const allShakerChannels: ShakerChannel[] = useMemo(
    () => (channelsData as any)?.getShakerChannels ?? [],
    [channelsData],
  );
  const shakerChannels = useMemo(
    () => allShakerChannels.filter(c => (c.profileId ?? null) === profileId),
    [allShakerChannels, profileId],
  );

  const { data: sinksData } = useQuery(GET_AUDIO_SINKS, { fetchPolicy: 'network-only' });
  const audioSinks: AudioSinkInfo[] = (sinksData as any)?.getAudioSinks ?? [];
  const sinkOptions = [
    { key: '', text: '— Select output device —' },
    ...audioSinks.map(s => ({ key: s.name, text: `${s.description} (${s.channels}ch)` })),
  ];

  const sectors = useMemo(() => {
    const s: Record<Sector, ShakerChannel[]> = {
      Front: [], FL: [], FR: [], All: [], RL: [], RR: [], Rear: [],
    };
    for (const ch of shakerChannels) s[getSector(ch)].push(ch);
    return s;
  }, [shakerChannels]);

  const effectDefaults = useMemo(() => {
    const d: Record<string, Partial<ShakerRec>> = {};
    for (const eff of EFFECTS) {
      const rec = records.find(r => r.effect.toLowerCase() === eff);
      d[eff] = rec
        ? { modulation: rec.modulation, frequency: rec.frequency, frequencyMax: rec.frequencyMax, amplitude: rec.amplitude, amplitudeMax: rec.amplitudeMax }
        : { modulation: 'frequency' };
    }
    return d;
  }, [records]);

  const handleToggle = async (eff: string, rec: ShakerRec | null, channel: ShakerChannel) => {
    if (rec) {
      await removeRec({ variables: { id: rec.id } });
    } else {
      const def = effectDefaults[eff] ?? {};
      await addRec({
        variables: {
          values: {
            device: 'Sound', effect: eff, channelId: channel.id, volume: 100,
            modulation: def.modulation ?? 'frequency',
            frequency: def.frequency ?? null, frequencyMax: def.frequencyMax ?? null,
            amplitude: def.amplitude ?? null, amplitudeMax: def.amplitudeMax ?? null,
            profileId: profileId ?? null,
            dspSlot: nextDspSlot(allRecords),
          },
        },
      });
    }
  };

  const handleUpdate = async (rec: ShakerRec, override: Partial<ShakerRec>) => {
    await updateRec({ variables: { id: rec.id, update: toInput(rec, override) } });
  };

  const handleAddChannel = async () => {
    // See ShakerMatrix.tsx's handleAddChannel for the same
    // most-recently-used-device / per-device-pan-default reasoning.
    const lastUsedDevid = shakerChannels[shakerChannels.length - 1]?.devid;
    const sink = audioSinks.find(s => s.name === lastUsedDevid) ?? audioSinks[0];
    const devid = sink?.name ?? '';
    const deviceChannels = sink?.channels ?? 4;
    const pan = nextPan(shakerChannels.filter(c => c.devid === devid));

    const result = await addShakerChannel({
      variables: { values: { profileId, pan, devid, channels: deviceChannels, position: null } },
    });
    const newChannelId = (result.data as any)?.addShakerChannel?.id;
    if (!newChannelId) return;

    let slot = nextDspSlot(allRecords);
    for (const eff of EFFECTS) {
      await addRec({
        variables: {
          values: {
            device: 'Sound', effect: eff, channelId: newChannelId, volume: 100,
            modulation: 'frequency', frequency: null, frequencyMax: null,
            amplitude: null, amplitudeMax: null,
            profileId: profileId ?? null, dspSlot: slot,
          },
        },
      });
      slot += 1;
    }
  };

  const handleRemoveChannel = async (channel: ShakerChannel) => {
    const ok = await confirmAsync(
      `Remove this channel and all its effects? This can't be undone.`,
      { danger: true, confirmText: 'Remove Channel' },
    );
    if (!ok) return;

    const channelRecords = allRecords.filter(r => r.channelId === channel.id && (r.profileId ?? null) === (channel.profileId ?? null));
    for (const rec of channelRecords) {
      await removeRec({ variables: { id: rec.id } });
    }
    await removeShakerChannel({ variables: { id: channel.id } });
  };

  const handleDevidChange = async (channel: ShakerChannel, devid: string) => {
    const deviceChannels = audioSinks.find(s => s.name === devid)?.channels ?? channel.channels;
    await updateShakerChannel({ variables: { id: channel.id, update: { devid, channels: deviceChannels } } });
  };

  const handlePositionChange = async (channel: ShakerChannel, position: string) => {
    await updateShakerChannel({ variables: { id: channel.id, update: { position } } });
  };

  const handlePanChange = async (channel: ShakerChannel, pan: number) => {
    await updateShakerChannel({ variables: { id: channel.id, update: { pan } } });
  };

  const showFront  = sectors.Front.length > 0;
  const showFLFR   = sectors.FL.length > 0 || sectors.FR.length > 0;
  const showAll    = sectors.All.length > 0;
  const showRLRR   = sectors.RL.length > 0 || sectors.RR.length > 0;
  const showRear   = sectors.Rear.length > 0;

  const gap = 10;
  const sectorProps = {
    allRecords: records, sinkOptions, audioSinks,
    onToggle: handleToggle, onUpdate: handleUpdate,
    onDevidChange: handleDevidChange, onPositionChange: handlePositionChange,
    onPanChange: handlePanChange,
    onRemove: handleRemoveChannel,
  };

  return (
    <div style={{ padding: 16, color: theme.palette.neutralPrimary, maxWidth: 900 }}>
      <div style={{ marginBottom: 12 }}>
        <button
          onClick={handleAddChannel}
          style={{
            padding: '6px 14px', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875em',
            background: theme.palette.themePrimary, color: '#fff',
          }}
        >
          Add Channel
        </button>
      </div>

      {shakerChannels.length === 0 ? (
        <div style={{ padding: 24, opacity: 0.5 }}>No channels configured yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap }}>

          {/* Front ── full width */}
          {showFront && (
            <SectorPanel label="Front" channels={sectors.Front} {...sectorProps} />
          )}

          {/* FL | FR */}
          {showFLFR && (
            <div style={{ display: 'flex', gap, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <SectorPanel label="Front Left" channels={sectors.FL} placeholder {...sectorProps} />
              </div>
              <div style={{ flex: 1 }}>
                <SectorPanel label="Front Right" channels={sectors.FR} placeholder {...sectorProps} />
              </div>
            </div>
          )}

          {/* All ── full width */}
          {showAll && (
            <SectorPanel label="All / Body" channels={sectors.All} {...sectorProps} />
          )}

          {/* RL | RR */}
          {showRLRR && (
            <div style={{ display: 'flex', gap, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <SectorPanel label="Rear Left" channels={sectors.RL} placeholder {...sectorProps} />
              </div>
              <div style={{ flex: 1 }}>
                <SectorPanel label="Rear Right" channels={sectors.RR} placeholder {...sectorProps} />
              </div>
            </div>
          )}

          {/* Rear ── full width */}
          {showRear && (
            <SectorPanel label="Rear" channels={sectors.Rear} {...sectorProps} />
          )}

        </div>
      )}
    </div>
  );
};

export default CarLayout;
