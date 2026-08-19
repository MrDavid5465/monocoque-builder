import React, { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useSubscription } from '@apollo/client/react';
import { PrimaryButton } from '@fluentui/react';
import { getTheme, Form, FormCard } from '../../lib/denim/lib';
import settingsDispatcher from '../../lib/denim/lib/queries';
import { confirmAsync } from '../../lib/denim/components/ConfirmDialog';
import { GET_ITEMS, UPDATE_ITEM, CREATE_ITEM, REMOVE_ITEM, ITEM_CHANGED } from './queries';
import { EffectRow, EFFECTS, EFFECT_LABELS, ShakerRec } from './EffectRow';
import { LfeRow } from './LfeRow';
import ChannelHeader from './ChannelHeader';
import {
  GET_AUDIO_SINKS, ENABLE_SHAKER_DSP, DISABLE_SHAKER_DSP,
  WRITE_MONOCOQUE_CONFIG, RELOAD_MONOCOQUE, APPLY_DSP_CHANNEL_LIVE,
  GET_DSP_CHANNELS, ADD_DSP_CHANNEL, UPDATE_DSP_CHANNEL, REMOVE_DSP_CHANNEL, DSP_CHANNEL_CHANGED,
  AudioSinkInfo, ShakerDspChannel,
} from './dspQueries';
import {
  GET_LFE_CHANNELS, ADD_LFE_CHANNEL, UPDATE_LFE_CHANNEL, REMOVE_LFE_CHANNEL,
  LFE_CHANNEL_CHANGED, APPLY_LFE_CHANNEL_LIVE, APPLY_LFE_LPF_LIVE, LfeChannel,
} from './lfeQueries';
import {
  GET_SHAKER_CHANNELS, ADD_SHAKER_CHANNEL, UPDATE_SHAKER_CHANNEL, REMOVE_SHAKER_CHANNEL,
  SHAKER_CHANNEL_CHANGED, ShakerChannel,
} from './channelQueries';
import { ADD_PROFILE, GET_PROFILES, SoundDeviceProfile } from './Profiles/queries';
import { GET_SHIFT_LIGHTS, ShiftLightRec } from './ShiftLights/queries';
import { GET_LEDS, LedsDeviceRec } from './LedsDevices/queries';
import { GET_SIM_WINDS, SimWindDeviceRec } from './SimWindDevices/queries';
import { buildSoundDeviceBlocks, buildFullMonocoqueConfig, wrapMonocoqueConfigBlocks } from './monocoqueConfig';
import DetailsGrid from '../../lib/typical-admin-fabric/lib/List';
import { DisplaySchema } from '../../lib/typical-admin';

const TYRE_ORDER = ['FrontLeft', 'FrontRight', 'RearLeft', 'RearRight', 'Front', 'Rear', 'Left', 'Right', 'All'];

export type { ShakerRec };

// Sound-blocks-only, wrapped — kept for existing test coverage
// (shakerUtils.test.ts) and any other Sound-only caller. Every page's
// "Export to Config" button uses buildFullMonocoqueConfig instead (see
// monocoqueConfig.ts's own doc comment for why a partial export is unsafe).
export function buildConfigText(records: ShakerRec[], shakerChannels: ShakerChannel[], dspEnabled: boolean): string {
  return wrapMonocoqueConfigBlocks(buildSoundDeviceBlocks(records, shakerChannels, dspEnabled));
}

// Every MonocoqueSoundDevice row gets a permanent, globally-unique dspSlot
// at creation time (never reassigned after) — computed client-side the same
// way other derived fields already are on add. Global across all profiles,
// not just the live set: only one profile's rows are ever live/active at
// once, so slot values never need to be unique against inactive profiles,
// but keeping them globally unique avoids any ambiguity if that ever
// changes, and matches the one-time migration that backfilled existing rows
// this same way.
export function nextDspSlot(allRecords: ShakerRec[]): number {
  const max = allRecords.reduce((m, r) => Math.max(m, r.dspSlot ?? -1), -1);
  return max + 1;
}

// Same "max existing + 1" pattern as nextDspSlot — the caller scopes
// `channelsInScope` to whichever devid a new channel is being added on, so
// pan numbering restarts per device (real-hardware-style: each device's own
// channel 0, 1, 2...), matching ShakerChannel.pan's own doc comment. Pan is
// only a suggested default here — the user can still edit it directly via
// the per-channel pan control.
export function nextPan(channelsInScope: ShakerChannel[]): number {
  const max = channelsInScope.reduce((m, c) => Math.max(m, c.pan), -1);
  return max + 1;
}

export function toInput(r: ShakerRec, override: Partial<ShakerRec> = {}) {
  const m = { ...r, ...override };
  return {
    device: m.device, effect: m.effect, channelId: m.channelId, volume: m.volume,
    modulation: m.modulation, frequency: m.frequency ?? null,
    frequencyMax: m.frequencyMax ?? null, amplitude: m.amplitude ?? null,
    amplitudeMax: m.amplitudeMax ?? null, profileId: m.profileId ?? null,
  };
}

const ShakerMatrix: React.FC<{ profileId?: string | null }> = ({ profileId = null }) => {
  const theme = getTheme();
  const [exportStatus, setExportStatus] = React.useState<string | null>(null);
  const [dspStatus, setDspStatus] = React.useState<string | null>(null);

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

  // ── Channels — first-class, independently created/removed, no longer
  // inferred from whichever effect rows happen to exist (see
  // ShakerChannel's backend doc comment) ──
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
  const sortedChannels = useMemo(() => {
    return [...shakerChannels].sort((a, b) => {
      const ai = TYRE_ORDER.indexOf(a.position ?? ''), bi = TYRE_ORDER.indexOf(b.position ?? '');
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [shakerChannels]);

  // ── Global DSP enable + output device (AppSettings-backed, profileId-agnostic) ──
  const { data: myData } = useQuery(settingsDispatcher.my);
  const [updateSettings] = useMutation(settingsDispatcher.updateSettings, { refetchQueries: [{ query: settingsDispatcher.my }] });
  const { data: sinksData } = useQuery(GET_AUDIO_SINKS, { fetchPolicy: 'network-only' });
  const [enableDsp] = useMutation(ENABLE_SHAKER_DSP, { refetchQueries: [{ query: settingsDispatcher.my }, { query: GET_ITEMS }] });
  const [disableDsp] = useMutation(DISABLE_SHAKER_DSP, { refetchQueries: [{ query: settingsDispatcher.my }, { query: GET_ITEMS }] });
  const [writeConfig] = useMutation(WRITE_MONOCOQUE_CONFIG);
  const [reloadMonocoque] = useMutation(RELOAD_MONOCOQUE);

  // ── Other device categories, read-only here — exporting from this page
  // still has to write the WHOLE monocoque config, so it needs every
  // category's live rows too, not just this page's own Sound devices (see
  // monocoqueConfig.ts's doc comment). Deliberately plain useQuery, no
  // useSubscription — this page already runs 4 long-lived subscriptions
  // (ITEM_CHANGED, SHAKER_CHANNEL_CHANGED, DSP_CHANNEL_CHANGED,
  // LFE_CHANNEL_CHANGED) and the browser's ~6-connection HTTP/1.1 pool means
  // more would risk starving this page's own mutations (see
  // feedback_subscription_connection_limit). handleExport explicitly
  // refetches all three right before building the combined config instead,
  // so a stale cache (e.g. edited on another page in another tab) can't
  // silently drop a device from the exported file.
  const { refetch: refetchShiftLights } = useQuery(GET_SHIFT_LIGHTS);
  const { refetch: refetchLeds } = useQuery(GET_LEDS);
  const { refetch: refetchSimWind } = useQuery(GET_SIM_WINDS);

  const dspEnabled: boolean = (myData as any)?.my?.settings?.shakerDspEnabled ?? false;
  const audioSinks: AudioSinkInfo[] = (sinksData as any)?.getAudioSinks ?? [];
  // {text, value} shape for Fabric.tsx's 'select' field type — see
  // ChannelHeader.tsx's device options for the same pattern.
  const sinkSelectOptions = [
    { text: '— Select output device —', value: '' },
    ...audioSinks.map(s => ({ text: `${s.description} (${s.channels}ch)`, value: s.name })),
  ];

  // Bumped whenever a confirmAsync toggle is cancelled — dspEnabled itself
  // doesn't change in that case, but the DSP-mode Form's internal checkbox
  // state already flipped optimistically the instant the user clicked (Form
  // is uncontrolled after mount, unlike the plain Fluent Checkbox this used
  // to be), so the key needs a nudge to force a remount back to the real
  // value. See the Form's own key prop below.
  const [dspFormNonce, setDspFormNonce] = React.useState(0);

  const handleToggleDsp = async (checked: boolean) => {
    if (checked) {
      const ok = await confirmAsync(
        'Enabling DSP will route every active shaker channel through the DSP sink. Continue?',
        { danger: true, confirmText: 'Enable DSP' },
      );
      if (!ok) { setDspFormNonce(n => n + 1); return; }
      setDspStatus('Enabling…');
      try {
        await enableDsp();
        setDspStatus('DSP enabled.');
      } catch (e: any) {
        setDspStatus(`Error: ${e?.message ?? e}`);
      }
    } else {
      const ok = await confirmAsync(
        'Disable DSP and return to Monocoque\'s own direct output?',
        { confirmText: 'Disable DSP' },
      );
      if (!ok) { setDspFormNonce(n => n + 1); return; }
      setDspStatus('Disabling…');
      try {
        await disableDsp();
        setDspStatus('DSP disabled.');
      } catch (e: any) {
        setDspStatus(`Error: ${e?.message ?? e}`);
      }
    }
  };

  // ── Per-slot LPF/fader (ShakerDspChannel, one per effect+corner via its
  // own dspSlot — not shared per physical channel — scoped by the same
  // profileId convention as MonocoqueSoundDevice rows) ──
  const { data: dspChannelsData } = useQuery(GET_DSP_CHANNELS);
  useSubscription(DSP_CHANNEL_CHANGED);
  const [addDspChannel] = useMutation(ADD_DSP_CHANNEL, { refetchQueries: [{ query: GET_DSP_CHANNELS }] });
  const [updateDspChannel] = useMutation(UPDATE_DSP_CHANNEL);
  const [removeDspChannel] = useMutation(REMOVE_DSP_CHANNEL, { refetchQueries: [{ query: GET_DSP_CHANNELS }] });
  const [applyDspChannelLive] = useMutation(APPLY_DSP_CHANNEL_LIVE);

  const allDspChannels: ShakerDspChannel[] = useMemo(
    () => (dspChannelsData as any)?.getShakerDspChannels ?? [],
    [dspChannelsData],
  );
  const dspChannelsBySlot = useMemo(() => {
    const scoped = allDspChannels.filter(c => (c.profileId ?? null) === profileId);
    return new Map(scoped.map(c => [c.slot, c]));
  }, [allDspChannels, profileId]);

  const handleDspChannelChange = async (slot: number, override: { lpfHz?: number | null; fader?: number; muted?: boolean }) => {
    const existing = dspChannelsBySlot.get(slot);
    const lpfHz = 'lpfHz' in override ? override.lpfHz ?? null : existing?.lpfHz ?? null;
    const fader = override.fader ?? existing?.fader ?? 100;
    const muted = override.muted ?? existing?.muted ?? false;

    if (existing) {
      await updateDspChannel({ variables: { id: existing.id, update: { lpfHz, fader, muted } } });
    } else {
      await addDspChannel({ variables: { values: { profileId, slot, lpfHz, fader, muted } } });
    }

    // Only the live (profileId === null) scope drives the currently-running
    // filter-chain — pushing a value while DSP is off just errors (no
    // running process to update), so only attempt it while enabled.
    if (profileId === null && dspEnabled) {
      try {
        await applyDspChannelLive({ variables: { slot, lpfHz, fader, muted } });
      } catch {
        // DSP may have just been disabled concurrently, or pipewire/pw-cli
        // hiccuped — the persisted value above is still correct either way,
        // and the next enable/resume picks it up. Not worth surfacing.
      }
    }
  };

  // ── LFE (whole extra signal path: taps a real device's monitor, downmixes
  // to mono, shared LPF, fans out to every enabled corner — see LfeChannel's
  // doc comment). Source device + LPF are AppSettings-backed like DSP output
  // device; per-corner fader/mute are LfeChannel rows, one per pan, scoped
  // by the same profileId convention as everything else here ──
  const lfeSourceDevice: string = (myData as any)?.my?.settings?.shakerLfeSourceDevice ?? '';
  const lfeLpfHz: number | null = (myData as any)?.my?.settings?.shakerLfeLpfHz ?? null;
  const [lastLfeLpfHz, setLastLfeLpfHz] = React.useState(200);
  React.useEffect(() => { if (lfeLpfHz != null) setLastLfeLpfHz(lfeLpfHz); }, [lfeLpfHz]);

  const [applyLfeLpfLive] = useMutation(APPLY_LFE_LPF_LIVE);

  const handleLfeSourceChange = async (deviceName: string) => {
    await updateSettings({ variables: { settings: { shakerLfeSourceDevice: deviceName || null } } });
  };

  const handleLfeLpfChange = async (hz: number | null) => {
    await updateSettings({ variables: { settings: { shakerLfeLpfHz: hz } } });
    if (profileId === null && dspEnabled) {
      try {
        await applyLfeLpfLive({ variables: { lpfHz: hz } });
      } catch {
        // Same best-effort rationale as the per-effect live-apply calls below.
      }
    }
  };

  // Diffing refs for the LFE settings Form below — same immediate-commit,
  // diff-against-previous-snapshot shape as ChannelHeader.tsx (no drag
  // gating needed, these are a select/checkbox/slider, not continuous
  // drags). `lpfHz` is always present in the schema alongside `lpfOn` (never
  // conditionally included based on lpfOn's own value) for the same reason
  // documented on dspOnSchema in schemas.ts — only the *effective* value
  // sent to the backend (null while lpfOn is off) is conditional, not the
  // field's existence.
  const lfeSettingsPrevRef = useRef<any>(null);
  const lfeSettingsSkipFirst = useRef(true);

  const { data: lfeChannelsData } = useQuery(GET_LFE_CHANNELS);
  useSubscription(LFE_CHANNEL_CHANGED);
  const [addLfeChannel] = useMutation(ADD_LFE_CHANNEL, { refetchQueries: [{ query: GET_LFE_CHANNELS }] });
  const [updateLfeChannel] = useMutation(UPDATE_LFE_CHANNEL);
  const [removeLfeChannel] = useMutation(REMOVE_LFE_CHANNEL, { refetchQueries: [{ query: GET_LFE_CHANNELS }] });
  const [applyLfeChannelLive] = useMutation(APPLY_LFE_CHANNEL_LIVE);

  const lfeChannelsByChannelId = useMemo(() => {
    const all: LfeChannel[] = (lfeChannelsData as any)?.getLfeChannels ?? [];
    const scoped = all.filter(c => (c.profileId ?? null) === profileId);
    return new Map(scoped.map(c => [c.channelId, c]));
  }, [lfeChannelsData, profileId]);

  const handleLfeToggle = async (channel: ShakerChannel, lfeChannel: LfeChannel | null) => {
    if (lfeChannel) {
      await removeLfeChannel({ variables: { id: lfeChannel.id } });
    } else {
      await addLfeChannel({ variables: { values: { profileId, channelId: channel.id, fader: 100, muted: false } } });
    }
  };

  const handleLfeUpdate = async (lfeChannel: LfeChannel, override: { fader?: number; muted?: boolean }) => {
    const fader = override.fader ?? lfeChannel.fader;
    const muted = override.muted ?? lfeChannel.muted;
    await updateLfeChannel({ variables: { id: lfeChannel.id, update: { fader, muted } } });

    if (profileId === null && dspEnabled) {
      try {
        await applyLfeChannelLive({ variables: { channelId: lfeChannel.channelId, fader, muted } });
      } catch {
        // Best-effort, same rationale as handleDspChannelChange above.
      }
    }
  };

  const matrix = useMemo(() => {
    const m: Record<string, Record<string, ShakerRec | null>> = {};
    for (const eff of EFFECTS) {
      m[eff] = {};
      for (const ch of sortedChannels) {
        m[eff][ch.id] = records.find(r => r.effect.toLowerCase() === eff && r.channelId === ch.id) ?? null;
      }
    }
    return m;
  }, [records, sortedChannels]);

  const effectRecords = useMemo(() => {
    const e: Record<string, ShakerRec[]> = {};
    for (const eff of EFFECTS) e[eff] = records.filter(r => r.effect.toLowerCase() === eff);
    return e;
  }, [records]);

  const handleToggle = async (eff: string, channel: ShakerChannel, rec: ShakerRec | null) => {
    if (rec) {
      await removeRec({ variables: { id: rec.id } });
    } else {
      const src = effectRecords[eff]?.[0];
      await addRec({
        variables: {
          values: {
            device: 'Sound', effect: eff, channelId: channel.id, volume: 100,
            modulation: src?.modulation ?? 'frequency',
            frequency: src?.frequency ?? null, frequencyMax: src?.frequencyMax ?? null,
            amplitude: src?.amplitude ?? null, amplitudeMax: src?.amplitudeMax ?? null,
            profileId: profileId ?? null,
            dspSlot: nextDspSlot(allRecords),
          },
        },
      });
    }
  };

  const handleUpdate = (rec: ShakerRec, override: Partial<ShakerRec>) =>
    updateRec({ variables: { id: rec.id, update: toInput(rec, override) } });

  // ── Add/remove a whole channel — client-orchestrated, matching how every
  // other multi-row creation flow in this app works (see handleToggle
  // above, cloneToProfile in index.tsx): the macro-generated CRUD already
  // covers each individual add/remove, so a channel is just "add one
  // ShakerChannel, then one MonocoqueSoundDevice per EFFECTS entry" in
  // sequence, not a bespoke atomic backend mutation ──
  const handleAddChannel = async () => {
    // Default to the most-recently-used device among existing channels (best
    // effort — this app doesn't track true creation order), else the first
    // available sink. Pan defaults to the next unused value *on that
    // device* — real-hardware-style numbering restarts per device now that
    // pan no longer has to be globally unique (see ShakerChannel.pan's
    // backend doc comment) — the user can still edit it via the per-channel
    // pan control if it needs adjusting.
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
      if (rec.dspSlot != null) {
        const dsp = allDspChannels.find(c => c.slot === rec.dspSlot && (c.profileId ?? null) === (channel.profileId ?? null));
        if (dsp) await removeDspChannel({ variables: { id: dsp.id } });
      }
      await removeRec({ variables: { id: rec.id } });
    }
    await removeShakerChannel({ variables: { id: channel.id } });
  };

  const handleChannelDevidChange = async (channel: ShakerChannel, devid: string) => {
    const deviceChannels = audioSinks.find(s => s.name === devid)?.channels ?? channel.channels;
    await updateShakerChannel({ variables: { id: channel.id, update: { devid, channels: deviceChannels } } });
  };

  const handleChannelPositionChange = async (channel: ShakerChannel, position: string) => {
    await updateShakerChannel({ variables: { id: channel.id, update: { position } } });
  };

  const handleChannelPanChange = async (channel: ShakerChannel, pan: number) => {
    await updateShakerChannel({ variables: { id: channel.id, update: { pan } } });
  };

  const handleExport = async () => {
    setExportStatus('Exporting…');
    try {
      const [shiftLightsRes, ledsRes, simWindRes] = await Promise.all([refetchShiftLights(), refetchLeds(), refetchSimWind()]);
      const config = buildFullMonocoqueConfig({
        shakerRecords: records,
        shakerChannels,
        dspEnabled,
        shiftLights: ((shiftLightsRes.data as any)?.getMonocoqueShiftLights ?? []).filter((r: ShiftLightRec) => (r.profileId ?? null) === null),
        ledsDevices: ((ledsRes.data as any)?.getMonocoqueLedsDevices ?? []).filter((r: LedsDeviceRec) => (r.profileId ?? null) === null),
        simWindDevices: ((simWindRes.data as any)?.getMonocoqueSimWindDevices ?? []).filter((r: SimWindDeviceRec) => (r.profileId ?? null) === null),
      });
      await writeConfig({ variables: { config } });
      setExportStatus('Exported.');
    } catch (e: any) {
      setExportStatus(`Error: ${e?.message ?? e}`);
    }
  };

  const handleRestart = async () => {
    setExportStatus('Restarting…');
    try {
      await reloadMonocoque();
      setExportStatus('Restarted.');
    } catch (e: any) {
      setExportStatus(`Error: ${e?.message ?? e}`);
    }
  };

  // ── Grid schema — rows = channels, columns = controls, rendered via the
  // shared list component (src/lib/typical-admin-fabric/lib/List.tsx)
  // instead of a hand-rolled <table>, so this follows the same styling and
  // column-selection mechanism as every other admin list view. `channel`
  // bundles everything the old per-column <th> header used to show
  // (device/pan/position/remove); one column per EFFECTS entry renders the
  // exact same <EffectRow> cell content as before, just relocated from a
  // <td> into a schema onRender; `lfe` likewise wraps <LfeRow> unchanged.
  // Synthetic column keys (channel/engine/.../lfe) aren't real ShakerChannel
  // fields, so this is typed DisplaySchema<any> — matching how List.tsx's
  // own `schema` prop already accepts it — not DisplaySchema<ShakerChannel>.
  const matrixSchema: DisplaySchema<any> = {
    channel: {
      label: 'Channel',
      options: { minWidth: 220, maxWidth: 260 },
      onRender: ({ values }) => {
        const ch: ShakerChannel = values;
        return (
          <ChannelHeader
            channel={ch}
            audioSinks={audioSinks}
            onDevidChange={devid => handleChannelDevidChange(ch, devid)}
            onPanChange={pan => handleChannelPanChange(ch, pan)}
            onPositionChange={pos => handleChannelPositionChange(ch, pos)}
          />
        );
      },
    },
    ...EFFECTS.reduce((acc, eff) => {
      acc[eff] = {
        label: EFFECT_LABELS[eff],
        options: { minWidth: 200, maxWidth: 320 },
        onRender: ({ values }) => {
          const ch: ShakerChannel = values;
          const rec = matrix[eff]?.[ch.id] ?? null;
          return (
            <EffectRow
              rec={rec}
              onToggle={() => handleToggle(eff, ch, rec)}
              onUpdate={override => rec && handleUpdate(rec, override)}
              dspChannel={rec?.dspSlot != null ? dspChannelsBySlot.get(rec.dspSlot) ?? null : null}
              onDspChange={override => rec?.dspSlot != null && handleDspChannelChange(rec.dspSlot, override)}
              dspEnabled={dspEnabled}
            />
          );
        },
      };
      return acc;
    }, {} as DisplaySchema<any>),
    lfe: {
      label: 'LFE',
      options: { minWidth: 200, maxWidth: 320 },
      onRender: ({ values }) => {
        const ch: ShakerChannel = values;
        const lfeChannel = lfeChannelsByChannelId.get(ch.id) ?? null;
        return (
          <LfeRow
            channel={lfeChannel}
            onToggle={() => handleLfeToggle(ch, lfeChannel)}
            onUpdate={override => lfeChannel && handleLfeUpdate(lfeChannel, override)}
          />
        );
      },
    },
  };

  // ── Profile save/load card — a plain FormCard (see FormCard.tsx's own doc
  // comment) holding a Form + a Save button, not a separately-named
  // component: giving this composition its own "-Card" name would imply a
  // distinct visual variant needing its own styling upkeep, which it isn't
  // (see the hand-rolled-components skill). A profile is a saved snapshot
  // of the live shaker configuration — the idea is fine-tuning per car (see
  // SoundDeviceProfile.carId's backend doc comment; the car-side of that
  // link is wired from the Car configuration page, not here). One combobox
  // does double duty: picking an existing profile loads it into the live
  // scope immediately, and it's also the upsert target for Save — typing a
  // name that matches an existing profile overwrites it, typing one that
  // doesn't creates a new profile. Reuses this component's own
  // records/shakerChannels/addRec/removeRec/addShakerChannel/
  // removeShakerChannel (already scoped to profileId === null here, since
  // this card only renders in that branch below) rather than re-querying —
  // this used to be a separate ProfileCard component with its own
  // duplicate hooks before that consolidation.
  const [activeProfileId, setActiveProfileId] = useState<string | null>(() => {
    try { return JSON.parse(localStorage.getItem('shaker_active_profile') ?? 'null')?.id ?? null; }
    catch { return null; }
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  // Current combobox value — Save acts on this (not activeProfileId), so a
  // freshly-typed, not-yet-saved name is still saveable.
  const [profileTypedName, setProfileTypedName] = useState('');
  const profileSkipFirst = useRef(true);
  const profilePrevRef = useRef('');

  // Deliberately no useSubscription(PROFILE_CHANGED) here — this page
  // already holds several long-lived subscriptions (ITEM_CHANGED,
  // SHAKER_CHANNEL_CHANGED, DSP_CHANNEL_CHANGED, LFE_CHANNEL_CHANGED, plus
  // global ones elsewhere), and the browser's per-origin HTTP/1.1
  // connection limit (6) means one more can silently starve out every
  // other request on the page, including this card's own mutations.
  // refetchQueries on each mutation below keeps the list fresh without one.
  const { data: profilesData } = useQuery(GET_PROFILES);
  const [addProfile] = useMutation(ADD_PROFILE, { refetchQueries: [{ query: GET_PROFILES }] });

  const profiles: SoundDeviceProfile[] = (profilesData as any)?.getSoundDeviceProfiles ?? [];
  const activeProfile = profiles.find(p => p.id === activeProfileId) ?? null;

  // Clones the current live scope's channels + effect rows into `profileId`,
  // replacing whatever that profile currently holds. Channels must be cloned
  // first, with their new ids captured — effect rows reference their channel
  // by id (channelId), not by pan (no longer globally unique — see
  // ShakerChannel.pan's backend doc comment), so there's no way to
  // re-derive the mapping after the fact. Sequential (not Promise.all) since
  // each add's result is needed before the next step can use it.
  const cloneLiveInto = async (profileId: string) => {
    const existingDevices = allRecords.filter(r => r.profileId === profileId);
    await Promise.all(existingDevices.map(r => removeRec({ variables: { id: r.id } })));
    const existingChannels = allShakerChannels.filter(c => c.profileId === profileId);
    await Promise.all(existingChannels.map(c => removeShakerChannel({ variables: { id: c.id } })));

    const channelIdMap = new Map<string, string>();
    for (const c of shakerChannels) {
      const result = await addShakerChannel({
        variables: {
          values: { pan: c.pan, devid: c.devid, channels: c.channels, position: c.position ?? null, profileId },
        },
      });
      const newId = (result.data as any)?.addShakerChannel?.id;
      if (newId) channelIdMap.set(c.id, newId);
    }

    await Promise.all(records.map(r => {
      const newChannelId = channelIdMap.get(r.channelId);
      if (!newChannelId) return Promise.resolve();
      return addRec({
        variables: {
          values: {
            device: r.device, effect: r.effect, channelId: newChannelId, volume: r.volume,
            modulation: r.modulation, frequency: r.frequency ?? null,
            frequencyMax: r.frequencyMax ?? null, amplitude: r.amplitude ?? null,
            amplitudeMax: r.amplitudeMax ?? null, profileId,
          },
        },
      });
    }));
  };

  // Inverse direction — clones `profile`'s channels + effect rows into the
  // live scope, replacing whatever's currently live. Same shape as
  // ProfilesList.tsx's own handleLoad (its "Load" button does the same
  // thing); kept separate rather than shared since each call site already
  // scopes its own queries/mutations, matching this file's prior convention.
  const cloneIntoLive = async (profile: SoundDeviceProfile) => {
    const profileDevices = allRecords.filter(r => r.profileId === profile.id);
    const profileChannels = allShakerChannels.filter(c => c.profileId === profile.id);
    if (profileChannels.length === 0) return; // nothing saved for this profile yet

    await Promise.all(records.map(r => removeRec({ variables: { id: r.id } })));
    await Promise.all(shakerChannels.map(c => removeShakerChannel({ variables: { id: c.id } })));

    const channelIdMap = new Map<string, string>();
    for (const c of profileChannels) {
      const result = await addShakerChannel({
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
      return addRec({
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
  };

  const setActiveProfile = (profile: SoundDeviceProfile) => {
    localStorage.setItem('shaker_active_profile', JSON.stringify({ id: profile.id, name: profile.name }));
    setActiveProfileId(profile.id);
  };

  const profileSchema = {
    profile: {
      type: 'combobox' as const,
      label: 'Profile',
      placeholder: 'Type or select a profile…',
      options: profiles.map(p => ({ text: p.name, value: p.name })),
    },
  };

  const handleProfileSave = async () => {
    const name = profileTypedName.trim();
    if (!name) return;
    setProfileSaving(true);
    setProfileStatus(null);
    try {
      const found = profiles.find(p => p.name === name);
      if (found) {
        await cloneLiveInto(found.id);
        setActiveProfile(found);
        setProfileStatus(`Saved "${name}".`);
      } else {
        const result = await addProfile({ variables: { values: { name } } });
        const newId = (result.data as any)?.addSoundDeviceProfile?.id;
        if (newId) {
          await cloneLiveInto(newId);
          setActiveProfile({ id: newId, name });
          setProfileStatus(`Saved new profile "${name}".`);
        }
      }
    } finally {
      setProfileSaving(false);
    }
  };

  // ── Settings cards (DSP mode / LFE) — AppSettings-backed, profileId-
  // agnostic, so only shown for the live (profileId === null) scope. Each is
  // its own Form now instead of hand-wired Fluent controls, wrapped in
  // FormCard (ported from the original davidallanscott.ca app's ServerCard —
  // see FormCard.tsx's own doc comment) instead of a one-off styled div.
  const cardStyle: React.CSSProperties = { flex: '1 1 320px', minWidth: 280 };

  const dspSchema = {
    enabled: { type: 'checkbox', label: 'DSP mode (LPF + fader via PipeWire)' },
  };

  const lfeSettingsSchema = {
    sourceDevice: { type: 'select', label: 'LFE source device (monitored, requires DSP mode)', options: sinkSelectOptions },
    lpfOn: { type: 'checkbox', label: 'LFE LPF' },
    lpfHz: { type: 'slider', label: 'LFE LPF Hz', min: 20, max: 2000, step: 10 },
  };

  return (
    <div style={{ padding: 16, overflowX: 'auto', color: theme.palette.neutralPrimary }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        {exportStatus && <span style={{ fontSize: '0.8em', opacity: 0.6 }}>{exportStatus}</span>}
        <span style={{ marginLeft: 'auto', fontSize: '0.75em', opacity: 0.4 }}>
          Changes persist to TyPiQL immediately. Export writes the .config file.
        </span>
      </div>

      {profileId === null && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          <FormCard style={cardStyle}>
            <Form
              // Remounts when the active profile identity changes (a real
              // reset — switching which profile the combobox reflects), not
              // on every keystroke — see the per-form Form-remount
              // convention used throughout this app (EffectRow.tsx's own
              // `key` doc comment).
              key={activeProfile?.id ?? 'none'}
              form={profileSchema}
              name="profileSelect"
              initialValues={{ profile: activeProfile?.name ?? '' }}
              onChange={(_: string, { clean }: any) => {
                const val = clean.profile ?? '';
                setProfileTypedName(val);
                if (profileSkipFirst.current) { profileSkipFirst.current = false; profilePrevRef.current = val; return; }
                if (val === profilePrevRef.current) return;
                profilePrevRef.current = val;

                const found = profiles.find(p => p.name === val);
                if (found && found.id !== activeProfileId) {
                  cloneIntoLive(found).then(() => setActiveProfile(found));
                }
              }}
            />
            <PrimaryButton
              text={profileSaving ? 'Saving…' : 'Save'}
              onClick={handleProfileSave}
              disabled={!profileTypedName.trim() || profileSaving}
            />
            {profileStatus && <div style={{ fontSize: '0.8em', opacity: 0.6, marginTop: 6 }}>{profileStatus}</div>}
          </FormCard>

          <FormCard style={cardStyle}>
            <Form
              // Keyed on the *confirmed* value plus a cancel-only nonce (see
              // dspFormNonce's own doc comment) — remounts to reset the
              // checkbox's visual state whenever the real value changes,
              // including "changed back" via a cancelled confirm dialog.
              key={`${dspEnabled}-${dspFormNonce}`}
              form={dspSchema}
              name="dsp"
              initialValues={{ enabled: dspEnabled }}
              onChange={(_: string, { clean }: any) => {
                if (clean.enabled !== dspEnabled) handleToggleDsp(clean.enabled);
              }}
            />
            <span style={{ fontSize: '0.75em', opacity: 0.5 }}>
              One filter-chain per device in use — set via each channel's own device picker below.
            </span>
            {dspStatus && <div style={{ fontSize: '0.8em', opacity: 0.6, marginTop: 4 }}>{dspStatus}</div>}
          </FormCard>

          <FormCard style={cardStyle}>
            <Form
              form={lfeSettingsSchema}
              name="lfeSettings"
              initialValues={{
                sourceDevice: lfeSourceDevice,
                lpfOn: lfeLpfHz != null,
                lpfHz: lfeLpfHz ?? lastLfeLpfHz,
              }}
              onChange={(_: string, { clean }: any) => {
                if (lfeSettingsSkipFirst.current) {
                  lfeSettingsSkipFirst.current = false;
                  lfeSettingsPrevRef.current = clean;
                  return;
                }
                const prev = lfeSettingsPrevRef.current;
                if (clean.sourceDevice !== prev.sourceDevice) handleLfeSourceChange(clean.sourceDevice);
                const lpfHzOut = clean.lpfOn ? clean.lpfHz : null;
                const prevLpfHzOut = prev.lpfOn ? prev.lpfHz : null;
                if (lpfHzOut !== prevLpfHzOut) handleLfeLpfChange(lpfHzOut);
                lfeSettingsPrevRef.current = clean;
              }}
            />
          </FormCard>
        </div>
      )}

      {sortedChannels.length === 0 && (
        <div style={{ padding: '0 0 12px', opacity: 0.5 }}>
          No channels configured yet — click "Add Channel" (top-right of the grid) to get started.
        </div>
      )}
      <DetailsGrid
        name="ShakerChannels"
        items={sortedChannels}
        schema={matrixSchema}
        columnSelectable
        storageKey="shaker-matrix-columns"
        alwaysVisibleColumns={['channel']}
        onAdd={handleAddChannel}
        customButtons={[
          { key: 'export', label: 'Export to Config', icon: 'CloudDownload', onClick: handleExport },
          { key: 'restart', label: 'Restart Monocoque', icon: 'Refresh', onClick: handleRestart },
        ]}
        rowButtons={[
          { key: 'remove', label: 'Remove Channel', icon: 'Delete', danger: true, onClick: handleRemoveChannel },
        ]}
      />
    </div>
  );
};

export default ShakerMatrix;
