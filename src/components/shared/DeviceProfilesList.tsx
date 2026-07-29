import React, { useMemo } from 'react';
import { DocumentNode } from 'graphql';
import { useQuery, useMutation, useSubscription } from '@apollo/client/react';
import { useNavigate, useLocation } from 'react-router';
import { getTheme } from '../../lib/denim/lib';
import { confirmAsync } from '../../lib/denim/components/ConfirmDialog';
import DetailsGrid from '../../lib/typical-admin-fabric/lib/List';
import { RowButtonConfig } from '../../lib/typical-admin-fabric/lib/ListControls';
import { DisplaySchema } from '../../lib/typical-admin';

export interface DeviceProfilesListConfig {
  // Profile queries
  getProfilesQuery: DocumentNode;
  removeProfileMutation: DocumentNode;
  profileChangedSubscription: DocumentNode;
  profilesResultKey: string;
  // Device queries
  getDevicesQuery: DocumentNode;
  createDeviceMutation: DocumentNode;
  removeDeviceMutation: DocumentNode;
  deviceChangedSubscription: DocumentNode;
  devicesResultKey: string;
  // Business logic
  liveToInput: (rec: any, profileId: string | null) => any;
  storageKey: string;
}

const DeviceProfilesList: React.FC<DeviceProfilesListConfig & { dispatcher?: any; name?: any; schemaDefinition?: any }> = (config) => {
  const {
    getProfilesQuery, removeProfileMutation, profileChangedSubscription,
    profilesResultKey,
    getDevicesQuery, createDeviceMutation, removeDeviceMutation, deviceChangedSubscription,
    devicesResultKey, liveToInput, storageKey,
  } = config;

  const theme = getTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const base = pathname.replace(/\/$/, '');

  const { data: profilesData } = useQuery(getProfilesQuery);
  useSubscription(profileChangedSubscription);
  const { data: devicesData } = useQuery(getDevicesQuery);
  useSubscription(deviceChangedSubscription);

  const [removeProfile] = useMutation(removeProfileMutation, { refetchQueries: [{ query: getProfilesQuery }] });
  const [addDevice] = useMutation(createDeviceMutation, { refetchQueries: [{ query: getDevicesQuery }] });
  const [removeDevice] = useMutation(removeDeviceMutation, { refetchQueries: [{ query: getDevicesQuery }] });

  const profiles: any[] = (profilesData as any)?.[profilesResultKey] ?? [];
  const allDevices: any[] = (devicesData as any)?.[devicesResultKey] ?? [];

  const deviceCountByProfile = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of profiles) {
      map[p.id] = allDevices.filter(r => r.profileId === p.id).length;
    }
    return map;
  }, [profiles, allDevices]);

  const handleLoad = async (profile: any) => {
    const live = allDevices.filter(r => (r.profileId ?? null) === null);
    const profileRecs = allDevices.filter(r => r.profileId === profile.id);
    await Promise.all(live.map(r => removeDevice({ variables: { id: r.id } })));
    await Promise.all(profileRecs.map(r => addDevice({ variables: { values: liveToInput(r, null) } })));
    localStorage.setItem(storageKey, JSON.stringify({ id: profile.id, name: profile.name }));
  };

  // Same confirm-then-delete pattern as ReactiveAdmin's own Delete.tsx
  // (typical-admin/Delete.tsx) — asked before every destructive action.
  const handleDelete = async (profile: any) => {
    const ok = await confirmAsync(`Are you sure you'd like to delete this profile?`, { danger: true });
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
    devices: {
      label: 'Devices',
      options: { minWidth: 70, maxWidth: 90 },
      onRender: ({ values }) => <span style={{ opacity: 0.7 }}>{deviceCountByProfile[values.id] ?? 0}</span>,
    },
  };

  const rowButtons: RowButtonConfig[] = [
    { key: 'edit', label: 'Edit', icon: 'Edit', onClick: (p) => navigate(`${base}/${p.id}/edit`) },
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
      <DetailsGrid name="DeviceProfiles" items={profiles} schema={schema} onAdd={() => navigate(`${base}/new`)} rowButtons={rowButtons} />
    </div>
  );
};

export default DeviceProfilesList;
