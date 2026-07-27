import { useState, useRef, useMemo } from 'react';
import { DocumentNode } from 'graphql';
import { useQuery, useMutation } from '@apollo/client/react';

export interface DeviceProfileCardConfig {
  addProfileMutation: DocumentNode;
  getProfilesQuery: DocumentNode;
  profilesResultKey: string;
  addProfileResultKey: string;
  getDevicesQuery: DocumentNode;
  createDeviceMutation: DocumentNode;
  removeDeviceMutation: DocumentNode;
  devicesResultKey: string;
  liveToInput: (rec: any, profileId: string | null) => any;
  storageKey: string;
}

// All the state/logic behind the "profile save/load card" pattern (see
// ShakerMatrix.tsx's own inline version, which this generalizes for
// LedsDevices/ShiftLights/SimWindDevices) — deliberately NOT a component.
// The card itself is nothing but a plain FormCard wrapping a Form + a
// PrimaryButton; giving that composition its own "-Card" component name
// implied it was a distinct visual variant needing its own upkeep (the
// exact drift the FormCard/ThumbnailCard styling-parity fix guarded
// against). Callers render <FormCard> directly and wire this hook's
// returned pieces into it.
export function useDeviceProfileCard(config: DeviceProfileCardConfig) {
  const {
    addProfileMutation, getProfilesQuery, profilesResultKey, addProfileResultKey,
    getDevicesQuery, createDeviceMutation, removeDeviceMutation, devicesResultKey,
    liveToInput, storageKey,
  } = config;

  const [activeProfileId, setActiveProfileId] = useState<string | null>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? 'null')?.id ?? null; }
    catch { return null; }
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Current combobox value — Save acts on this (not activeProfileId), so a
  // freshly-typed, not-yet-saved name is still saveable.
  const [typedName, setTypedName] = useState('');
  const skipFirst = useRef(true);
  const prevRef = useRef('');

  // Deliberately no live subscription here — see ShakerMatrix's own
  // ProfileCard doc comment: stacking up subscriptions on a page risks
  // hitting the browser's per-origin HTTP/1.1 connection ceiling and
  // silently starving out this card's own mutations. refetchQueries below
  // keeps everything fresh without one.
  const { data: profilesData } = useQuery(getProfilesQuery);
  const [addProfile] = useMutation(addProfileMutation, { refetchQueries: [{ query: getProfilesQuery }] });

  const { data: devicesData } = useQuery(getDevicesQuery);
  const [addDevice] = useMutation(createDeviceMutation, { refetchQueries: [{ query: getDevicesQuery }] });
  const [removeDevice] = useMutation(removeDeviceMutation, { refetchQueries: [{ query: getDevicesQuery }] });

  const profiles: any[] = (profilesData as any)?.[profilesResultKey] ?? [];
  const activeProfile = profiles.find(p => p.id === activeProfileId) ?? null;

  const allDevices: any[] = (devicesData as any)?.[devicesResultKey] ?? [];
  const liveDevices = useMemo(
    () => allDevices.filter(r => (r.profileId ?? null) === null),
    [allDevices],
  );

  const cloneLiveInto = async (profileId: string) => {
    const existing = allDevices.filter(r => r.profileId === profileId);
    await Promise.all(existing.map(r => removeDevice({ variables: { id: r.id } })));
    await Promise.all(liveDevices.map(r => addDevice({ variables: { values: liveToInput(r, profileId) } })));
  };

  const cloneIntoLive = async (profile: any) => {
    const profileRecs = allDevices.filter(r => r.profileId === profile.id);
    if (profileRecs.length === 0) return; // nothing saved for this profile yet
    await Promise.all(liveDevices.map(r => removeDevice({ variables: { id: r.id } })));
    await Promise.all(profileRecs.map(r => addDevice({ variables: { values: liveToInput(r, null) } })));
  };

  const setActive = (profile: any) => {
    localStorage.setItem(storageKey, JSON.stringify({ id: profile.id, name: profile.name }));
    setActiveProfileId(profile.id);
  };

  const schema = {
    profile: {
      type: 'combobox' as const,
      label: 'Profile',
      placeholder: 'Type or select a profile…',
      options: profiles.map(p => ({ text: p.name, value: p.name })),
    },
  };

  const handleChange = (_: string, { clean }: any) => {
    const val = clean.profile ?? '';
    setTypedName(val);
    if (skipFirst.current) { skipFirst.current = false; prevRef.current = val; return; }
    if (val === prevRef.current) return;
    prevRef.current = val;

    const found = profiles.find(p => p.name === val);
    if (found && found.id !== activeProfileId) {
      cloneIntoLive(found).then(() => setActive(found));
    }
  };

  const handleSave = async () => {
    const name = typedName.trim();
    if (!name) return;
    setSaving(true);
    setStatus(null);
    try {
      const found = profiles.find(p => p.name === name);
      if (found) {
        await cloneLiveInto(found.id);
        setActive(found);
        setStatus(`Saved "${name}".`);
      } else {
        const result = await addProfile({ variables: { values: { name } } });
        const newId = (result.data as any)?.[addProfileResultKey]?.id;
        if (newId) {
          await cloneLiveInto(newId);
          setActive({ id: newId, name });
          setStatus(`Saved new profile "${name}".`);
        }
      }
    } finally {
      setSaving(false);
    }
  };

  return {
    // Remounts the Form when the active profile identity changes (a real
    // reset — switching which profile the combobox reflects), not on every
    // keystroke — see the per-form Form-remount convention used throughout
    // this app (EffectRow.tsx's own `key` doc comment).
    formKey: activeProfile?.id ?? 'none',
    schema,
    initialValues: { profile: activeProfile?.name ?? '' },
    handleChange,
    handleSave,
    saving,
    status,
    typedName,
  };
}
