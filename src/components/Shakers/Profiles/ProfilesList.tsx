import React, { useMemo } from 'react';
import { useQuery, useMutation, useSubscription } from '@apollo/client/react';
import { useNavigate, useLocation } from 'react-router';
import { getTheme } from '../../../lib/denim/lib';
import { confirmAsync } from '../../../lib/denim/components/ConfirmDialog';
import DetailsGrid from '../../../lib/typical-admin-fabric/lib/List';
import { RowButtonConfig } from '../../../lib/typical-admin-fabric/lib/ListControls';
import { DisplaySchema } from '../../../lib/typical-admin';
import { GET_PROFILES, REMOVE_PROFILE, PROFILE_CHANGED, SoundDeviceProfile } from './queries';
import { GET_ITEMS, CREATE_ITEM, REMOVE_ITEM, ITEM_CHANGED } from '../queries';
import { ShakerRec, EFFECT_LABELS } from '../EffectRow';
import {
  GET_SHAKER_CHANNELS, ADD_SHAKER_CHANNEL, REMOVE_SHAKER_CHANNEL, SHAKER_CHANNEL_CHANGED, ShakerChannel,
} from '../channelQueries';

// A minimal custom `list` component for the Profiles admin route — replaces
// the default ReactiveAdmin list so a "Load" action (clone a saved
// profile's ShakerChannel + MonocoqueSoundDevice rows into the live scope —
// the inverse of index.tsx's SaveBar/cloneToProfile) can sit alongside the
// usual Edit/Delete actions. Rendered through the shared DetailsGrid, same
// as every other admin list in the app, rather than a hand-rolled table.
const ProfilesList: React.FC<{ dispatcher?: any; name?: any; schemaDefinition?: any }> = () => {
  const theme = getTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const base = pathname.replace(/\/$/, '');

  const { data: profilesData } = useQuery(GET_PROFILES);
  useSubscription(PROFILE_CHANGED);
  const [removeProfile] = useMutation(REMOVE_PROFILE, { refetchQueries: [{ query: GET_PROFILES }] });

  const { data: devicesData } = useQuery(GET_ITEMS);
  useSubscription(ITEM_CHANGED);
  const [addDevice] = useMutation(CREATE_ITEM, { refetchQueries: [{ query: GET_ITEMS }] });
  const [removeDevice] = useMutation(REMOVE_ITEM, { refetchQueries: [{ query: GET_ITEMS }] });

  const { data: channelsData } = useQuery(GET_SHAKER_CHANNELS);
  useSubscription(SHAKER_CHANNEL_CHANGED);
  const [addChannel] = useMutation(ADD_SHAKER_CHANNEL, { refetchQueries: [{ query: GET_SHAKER_CHANNELS }] });
  const [removeChannel] = useMutation(REMOVE_SHAKER_CHANNEL, { refetchQueries: [{ query: GET_SHAKER_CHANNELS }] });

  const profiles: SoundDeviceProfile[] = (profilesData as any)?.getSoundDeviceProfiles ?? [];
  const allDevices: ShakerRec[] = (devicesData as any)?.getMonocoqueSoundDevices ?? [];
  const allChannels: ShakerChannel[] = (channelsData as any)?.getShakerChannels ?? [];

  const effectsSummary = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of profiles) {
      const recs = allDevices.filter(r => r.profileId === p.id);
      const effects = [...new Set(recs.map(r => r.effect.toLowerCase()))];
      map[p.id] = effects.map(e => EFFECT_LABELS[e] ?? e).join(', ') || '—';
    }
    return map;
  }, [profiles, allDevices]);

  // Clones `profile`'s ShakerChannel + MonocoqueSoundDevice rows into the
  // live (profileId: null) scope, replacing whatever's currently live —
  // the reverse of SaveBar's cloneToProfile in index.tsx. Channels must be
  // cloned first and their new ids captured before the effect rows can be
  // cloned, since rows reference their channel by id (channelId), not by
  // pan (pan is no longer globally unique — see ShakerChannel.pan's
  // backend doc comment).
  const handleLoad = async (profile: SoundDeviceProfile) => {
    const liveDevices = allDevices.filter(r => (r.profileId ?? null) === null);
    const profileDevices = allDevices.filter(r => r.profileId === profile.id);
    const liveChannels = allChannels.filter(c => (c.profileId ?? null) === null);
    const profileChannels = allChannels.filter(c => c.profileId === profile.id);

    // A profile with no ShakerChannel rows of its own has nothing to load
    // (its effect rows, if any, are orphaned and can't be attached to
    // anything) — bail out before wiping the live set for no benefit.
    if (profileChannels.length === 0) {
      await confirmAsync(
        `"${profile.name}" has no channels saved — nothing to load.`,
        { confirmText: 'OK' },
      );
      return;
    }

    await Promise.all(liveDevices.map(r => removeDevice({ variables: { id: r.id } })));
    await Promise.all(liveChannels.map(c => removeChannel({ variables: { id: c.id } })));

    const channelIdMap = new Map<string, string>();
    for (const c of profileChannels) {
      const result = await addChannel({
        variables: {
          values: { pan: c.pan, devid: c.devid, channels: c.channels, position: c.position ?? null, profileId: null },
        },
      });
      const newId = (result.data as any)?.addShakerChannel?.id;
      if (newId) channelIdMap.set(c.id, newId);
    }

    await Promise.all(profileDevices.map(r => {
      const newChannelId = channelIdMap.get(r.channelId);
      if (!newChannelId) return Promise.resolve();
      return addDevice({
        variables: {
          values: {
            device: r.device, effect: r.effect, channelId: newChannelId, volume: r.volume,
            modulation: r.modulation, frequency: r.frequency ?? null,
            frequencyMax: r.frequencyMax ?? null, amplitude: r.amplitude ?? null,
            amplitudeMax: r.amplitudeMax ?? null, profileId: null,
          },
        },
      });
    }));

    localStorage.setItem('shaker_active_profile', JSON.stringify({ id: profile.id, name: profile.name }));
  };

  const handleDelete = async (profile: SoundDeviceProfile) => {
    const ok = await confirmAsync(
      `Delete profile "${profile.name}"? This can't be undone.`,
      { danger: true, confirmText: 'Delete' },
    );
    if (!ok) return;
    await removeProfile({ variables: { id: profile.id } });
  };

  const schema: DisplaySchema<any> = {
    name: { label: 'Name', options: { minWidth: 140, maxWidth: 220 } },
    car: {
      label: 'Car',
      onRender: ({ values }) => <span style={{ opacity: values.car ? 1 : 0.35 }}>{values.car ?? '—'}</span>,
    },
    game: {
      label: 'Game',
      onRender: ({ values }) => <span style={{ opacity: values.game ? 1 : 0.35 }}>{values.game ?? '—'}</span>,
    },
    effects: {
      label: 'Effects',
      onRender: ({ values }) => <span style={{ fontSize: '0.8em', opacity: 0.7 }}>{effectsSummary[values.id]}</span>,
    },
  };

  const rowButtons: RowButtonConfig[] = [
    { key: 'edit', label: 'Edit', icon: 'Edit', onClick: (p) => navigate(`/shakers/profiles/${p.id}/edit`) },
    { key: 'load', label: 'Load', icon: 'Download', onClick: handleLoad },
    { key: 'delete', label: 'Delete', icon: 'Delete', danger: true, onClick: handleDelete },
  ];

  return (
    <div style={{ padding: 16, color: theme.palette.neutralPrimary }}>
      <h3 style={{ margin: '0 0 10px' }}>Profiles</h3>
      {profiles.length === 0 && (
        <div style={{ opacity: 0.5, padding: '0 0 8px' }}>
          No profiles yet — click "Add" (top-right of the grid) to get started.
        </div>
      )}
      <DetailsGrid name="ShakerProfiles" items={profiles} schema={schema} onAdd={() => navigate(`${base}/new`)} rowButtons={rowButtons} />
    </div>
  );
};

export default ProfilesList;
