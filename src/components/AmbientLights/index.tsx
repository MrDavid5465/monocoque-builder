import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useMutation, useQuery } from '@apollo/client/react';
import { PrimaryButton, DefaultButton } from '@fluentui/react';
import { getTheme, Form, FormCard, Stack, TextField } from '../../lib/denim/lib';
import dispatcher, { IMy, IChannelGamma } from '../../lib/denim/lib/queries';
import { useLiveUpdatesHub, useHubListener } from '../Telemetry/liveUpdatesHub';
import { DevColorTest } from './DevColorTest';
import { ChannelMapper } from './ChannelMapper';
import { AdvancedHuenicornSettings } from './AdvancedHuenicornSettings';
import { ChannelColor, colorToCss } from './colorPreview';
import {
  GET_HUENICORN_STATUS,
  GET_HUENICORN_CHANNELS,
  START_HUENICORN,
  STOP_HUENICORN,
  RESET_HUENICORN_SCREEN_SELECTION,
  HUENICORN_WEB_UI_URL,
  IHuenicornStatus,
  IHuenicornChannels,
} from './queries';

// Bespoke page, not ReactiveAdmin-wrapped — mirrors SimWindDevices/index.tsx's
// own SimWindMain (a plain Form/status component on its default route),
// used here for the same reason: there's no record list to manage, only a
// couple of global settings plus a live process status. Huenicorn's own web
// UI already owns the channel/screen-region config, so this page doesn't
// attempt to reimplement that — see the link out below.
//
// Also mounts a hidden /dev-color-test sub-route (DevColorTest.tsx) — a
// calibration tool, not linked from this page's own UI, see its own doc
// comment for why it lives here instead of as a separate Denim app.
/** One row of the gamma `list` field. `channelId` is the row identity and
 *  `name` only drives the row label — neither is a rendered field, so both
 *  ride along on the row untouched (ListField preserves non-schema keys). */
interface GammaRow {
  channelId: number;
  name: string;
  day: number;
  night: number;
}

// The upstream project's actual repo (GitLab, not GitHub) — linked from the
// "not installed" gate below.
const HUENICORN_GITLAB_URL = 'https://gitlab.com/openjowelsofts/huenicorn';

const AmbientLightsMain: React.FC = () => {
  const theme = getTheme();
  const { data: myData } = useQuery<IMy>(dispatcher.my);
  const settings = myData?.my?.settings ?? {};
  // f32 -> GraphQL Float -> JS float round-trips with binary noise (e.g.
  // 0.30000001192092896) — round for display/editing, same precision the
  // slider's own `step` already implies.
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const [huenicornEnabled, setHuenicornEnabled] = useState(false);
  const [ambientTintIntensity, setAmbientTintIntensity] = useState(0.3);
  // '' = unset (DashboardDesigner falls back to the first active channel),
  // otherwise the string form of a Huenicorn channelId — Form's select
  // options are string-valued (see sinkSelectOptions in ShakerMatrix.tsx
  // for the same convention).
  const [ambientPrimaryChannel, setAmbientPrimaryChannel] = useState('');
  // How much to exaggerate the tint color's own saturation — 1 = as
  // captured (default), higher turns a pale/washed-out reading into a
  // genuinely vivid color (a pale red becomes a vibrant red). See
  // Photo360Viewer.tsx's own doc comment near `boostedR`/`boostedG`/`boostedB`.
  // Day and night are the endpoints of a blend, not two modes — Photo360Viewer
  // interpolates between them by the same smoothed night amount its
  // nightBoost uses, same day/night-blend shape as the gamma sliders below.
  const [ambientSaturationBoostDay, setAmbientSaturationBoostDay] = useState(1);
  const [ambientSaturationBoostNight, setAmbientSaturationBoostNight] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    if (settings.huenicornEnabled != null) setHuenicornEnabled(settings.huenicornEnabled);
  }, [settings.huenicornEnabled]);
  useEffect(() => {
    if (settings.ambientTintIntensity != null) setAmbientTintIntensity(round2(settings.ambientTintIntensity));
  }, [settings.ambientTintIntensity]);
  useEffect(() => {
    setAmbientPrimaryChannel(
      settings.ambientPrimaryChannel != null ? String(settings.ambientPrimaryChannel) : '',
    );
  }, [settings.ambientPrimaryChannel]);
  useEffect(() => {
    if (settings.ambientSaturationBoostDay != null) setAmbientSaturationBoostDay(round2(settings.ambientSaturationBoostDay));
  }, [settings.ambientSaturationBoostDay]);
  useEffect(() => {
    if (settings.ambientSaturationBoostNight != null) setAmbientSaturationBoostNight(round2(settings.ambientSaturationBoostNight));
  }, [settings.ambientSaturationBoostNight]);

  const [updateSettings] = useMutation(dispatcher.updateSettings, {
    refetchQueries: [{ query: dispatcher.my }],
  });

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      await updateSettings({
        variables: {
          settings: {
            huenicornEnabled,
            ambientTintIntensity,
            // Explicit null (not omitted) clears back to "first active
            // channel" — omitting the field would mean "leave unchanged"
            // per AppSettingsInput's MaybeUndefined convention.
            ambientPrimaryChannel: ambientPrimaryChannel === '' ? null : Number(ambientPrimaryChannel),
            ambientSaturationBoostDay,
            ambientSaturationBoostNight,
          },
        },
      });
      setSaveStatus('Saved');
    } catch (e: any) {
      setSaveStatus(e?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // Primary start/stop is owned by the backend's run_sim_watcher (tied to
  // sim_status + huenicornEnabled above) — this poll + these buttons are
  // for visibility/testing/override only, same status/action shape as the
  // Settings modal's udev-rule check.
  const { data: statusData } = useQuery<IHuenicornStatus>(GET_HUENICORN_STATUS, {
    pollInterval: 2000,
    fetchPolicy: 'network-only',
  });
  const huenicornStatus = statusData?.huenicornStatus;

  // Which command line is actually "live" is the build type, not a toggle —
  // see service_commands.rs's own doc comment — so the fix-it field below
  // edits whichever one huenicornStatus.installed is actually checking
  // against, same convention as the global Settings modal's Services tab.
  const commandFieldName = settings.debugBuild ? 'huenicornDebugCommand' : 'huenicornCommand';
  const [commandDraft, setCommandDraft] = useState('');
  const [savingCommand, setSavingCommand] = useState(false);
  useEffect(() => {
    const current = settings.debugBuild ? settings.huenicornDebugCommand : settings.huenicornCommand;
    setCommandDraft(current ?? '');
  }, [settings.debugBuild, settings.huenicornCommand, settings.huenicornDebugCommand]);

  // Saves only the one command field — omitting every other field reads as
  // "leave unchanged" per AppSettingsInput's MaybeUndefined convention, same
  // isolation as handleSaveGamma below.
  const handleSaveCommand = async () => {
    setSavingCommand(true);
    try {
      await updateSettings({ variables: { settings: { [commandFieldName]: commandDraft.trim() } } });
    } finally {
      setSavingCommand(false);
    }
  };

  const { data: channelsData } = useQuery<IHuenicornChannels>(GET_HUENICORN_CHANNELS, {
    pollInterval: 5000,
    fetchPolicy: 'network-only',
  });
  const channels = channelsData?.huenicornChannels ?? [];

  // Per-channel gamma for the BULBS — unlike everything above, which only
  // shapes the 360° viewer's tint, this changes what Huenicorn actually
  // sends to the lights (its own per-channel `gammaFactor`). Each channel
  // gets a day value and a night value; the backend interpolates between
  // them by the live day/night blend, so with the simulated in-game clock
  // running the lights ramp through dawn/dusk instead of snapping. See
  // huenicorn::run_gamma_pusher.
  const savedGamma: IChannelGamma[] = settings.ambientChannelGamma ?? [];
  // Only the user's *edits* live in state; the displayed rows are derived
  // during render (below). Storing the rows themselves in state and syncing
  // them from an effect is what produced a subtle ordering bug: the Form's
  // remount key is computed during render, so when the channel list arrived
  // the key changed one render BEFORE the effect updated the rows — the
  // form remounted against stale values and then never remounted again.
  const [gammaEdits, setGammaEdits] = useState<Record<number, { day: number; night: number }>>({});
  const [savingGamma, setSavingGamma] = useState(false);
  const [gammaStatus, setGammaStatus] = useState<string | null>(null);

  // Rows come from the live channel list while Huenicorn is up, falling back
  // to whatever was saved when it isn't — otherwise this whole section would
  // disappear (and look unconfigurable) any time the process is down, which
  // is exactly when someone might come here to set it up.
  const gammaSources = channels.length
    ? channels.map(c => ({ channelId: c.channelId, name: c.name, live: c.gammaFactor as number | undefined }))
    : savedGamma.map(g => ({
        channelId: g.channelId,
        name: `Channel ${g.channelId}`,
        live: undefined as number | undefined,
      }));
  const gammaRowKey = gammaSources.map(r => `${r.channelId}:${r.live ?? ''}`).join(',');
  // Keyed on saved *content*, not just `savedGamma.length` — the count is
  // unchanged when only the values differ, so a length-only key silently
  // dropped every reload of already-configured channels (saved values were
  // persisted correctly but the page redisplayed 0).
  const savedGammaKey = savedGamma.map(g => `${g.channelId}:${g.day}:${g.night}`).join(',');

  // Derived during render, never stored — so the rows and the Form's
  // remount key below always change in the SAME render. Precedence:
  // a live user edit, else the persisted value, else the channel's own
  // live gamma (so opening this page and hitting Save without touching a
  // slider leaves the lights exactly where Huenicorn's profile had them).
  const gammaRows: GammaRow[] = gammaSources.map(src => {
    const base = { channelId: src.channelId, name: src.name };
    const edit = gammaEdits[src.channelId];
    if (edit) return { ...base, day: edit.day, night: edit.night };
    const saved = savedGamma.find(g => g.channelId === src.channelId);
    if (saved) return { ...base, day: round2(saved.day), night: round2(saved.night) };
    return { ...base, day: round2(src.live ?? 0), night: round2(src.live ?? 0) };
  });

  // One `list` field — see the form-schema skill's `list` section. Replaces
  // the previous `gammaDay_${id}`/`gammaNight_${id}` name synthesis and the
  // `/^gamma(Day|Night)_(\d+)$/` parse that read it back. `fixed` because
  // the rows are the Hue channels themselves; there is nothing to add or
  // remove here. `channelId` rides along on each row without being a
  // rendered field — ListField preserves non-schema row keys.
  const gammaSchema = {
    channelGamma: {
      type: 'list' as const,
      label: '',
      fixed: true,
      rowKey: (r: GammaRow) => String(r.channelId),
      rowLabel: (r: GammaRow) => r.name,
      itemSchema: {
        day: { type: 'slider', label: 'Day', min: -1, max: 1, step: 0.05 },
        night: { type: 'slider', label: 'Night', min: -1, max: 1, step: 0.05 },
      },
    },
  };

  // Saves only `ambientChannelGamma`: every other field is omitted, which
  // AppSettingsInput's MaybeUndefined convention reads as "leave unchanged"
  // — so this button and the settings Save above can't clobber each other.
  const handleSaveGamma = async () => {
    setSavingGamma(true);
    setGammaStatus(null);
    try {
      await updateSettings({
        variables: {
          settings: {
            ambientChannelGamma: gammaRows.map(row => ({
              channelId: row.channelId,
              day: row.day ?? 0,
              night: row.night ?? 0,
            })),
          },
        },
      });
      // Drop the local edit overlay: the refetched `settings` is now the
      // source of truth, and keeping stale edits on top would mask it.
      setGammaEdits({});
      setGammaStatus('Saved');
    } catch (e: any) {
      setGammaStatus(e?.message ?? 'Failed to save');
    } finally {
      setSavingGamma(false);
    }
  };

  // Live swatch for whichever channel actually drives the 360° tint — reads
  // the exact same AmbientColorChanged subscription event the dashboard
  // itself consumes (see DashboardDesigner/index.tsx's onAmbientColor
  // handler), not a separate polling query, so this preview can't drift
  // from what the viewer actually shows and doesn't duplicate the ~30Hz
  // publish with its own HTTP round-trip. Same channel-selection rule: an
  // explicit ambientPrimaryChannel, else whichever channel arrives first.
  const [hub, hubSubscriber] = useLiveUpdatesHub({ includeAmbientColor: true, includeNightClock: false });
  const [currentColors, setCurrentColors] = useState<ChannelColor[]>([]);
  useHubListener(hub, 'AmbientColorChanged', (event: any) => setCurrentColors(event?.colors ?? []));
  const selectedColor = ambientPrimaryChannel !== ''
    ? currentColors.find(c => c.channelId === Number(ambientPrimaryChannel))
    : currentColors[0];

  const settingsSchema = {
    huenicornEnabled: { type: 'checkbox', label: 'Auto-launch when driving' },
    // Drives the 360° viewer's soft-light blend opacity — not a raw 1:1
    // opacity, it's scaled by night/spike conditions in Photo360Viewer's
    // render loop (0.3 here lands at ~15% opacity in daylight).
    ambientTintIntensity: { type: 'slider', label: 'Tint intensity (soft light)', min: 0, max: 1, step: 0.05 },
    ambientPrimaryChannel: {
      type: 'select',
      label: 'Primary channel (drives 360° tint)',
      options: [
        { text: 'First active channel', value: '' },
        ...channels.map(c => ({ text: c.name, value: String(c.channelId) })),
      ],
    },
    ambientSaturationBoostDay: {
      type: 'slider',
      label: 'Color vividness, day (1 = as captured, higher = pale colors become vibrant)',
      min: 1,
      max: 6,
      step: 0.5,
    },
    ambientSaturationBoostNight: {
      type: 'slider',
      label: 'Color vividness, night',
      min: 1,
      max: 6,
      step: 0.5,
    },
  };

  const [startHuenicorn, { loading: starting }] = useMutation(START_HUENICORN, {
    refetchQueries: [{ query: GET_HUENICORN_STATUS }],
  });
  const [stopHuenicorn, { loading: stopping }] = useMutation(STOP_HUENICORN, {
    refetchQueries: [{ query: GET_HUENICORN_STATUS }],
  });
  const [resetScreenSelection, { loading: resettingSelection }] = useMutation(
    RESET_HUENICORN_SCREEN_SELECTION,
    { refetchQueries: [{ query: GET_HUENICORN_STATUS }] },
  );

  const statusLabel = huenicornStatus?.apiReachable
    ? '✓ Running'
    : huenicornStatus?.running
      ? '… Starting'
      : '✗ Not running';
  const statusColor = huenicornStatus?.apiReachable
    ? '#3aa76d'
    : huenicornStatus?.running
      ? '#c9a227'
      : theme.palette.neutralSecondary;

  // Gates the whole configuration UI behind "is Huenicorn even installed" —
  // otherwise every card below (Start/Stop, gamma, screen mapping…) just
  // fails against a binary that will never launch, with no indication why.
  // `huenicornStatus === undefined` is "haven't heard back from the first
  // poll yet", not "not installed" — don't flash the gate for that.
  if (huenicornStatus && !huenicornStatus.installed) {
    return (
      <div style={{ padding: 16, color: theme.palette.neutralPrimary }}>
        <FormCard style={{ maxWidth: 480 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: '1.1em' }}>Huenicorn isn't installed</div>
          <div style={{ fontSize: '0.85em', opacity: 0.8, marginBottom: 12 }}>
            Ambient Lights needs Huenicorn — a separate companion program that captures your
            screen's colors and streams them to your Hue lights. The configured command
            (<code>{settings.debugBuild ? settings.huenicornDebugCommand || '(none set)' : settings.huenicornCommand}</code>)
            couldn't be found.
          </div>
          <a
            href={HUENICORN_GITLAB_URL}
            target="_blank"
            rel="noreferrer"
            style={{ color: theme.palette.themePrimary, fontSize: '0.85em' }}
          >
            View Huenicorn on GitLab →
          </a>

          <div style={{ fontWeight: 600, marginTop: 20, marginBottom: 4, fontSize: '0.9em' }}>
            Already have it built somewhere non-standard?
          </div>
          <div style={{ fontSize: '0.8em', opacity: 0.7, marginBottom: 8 }}>
            {settings.debugBuild
              ? 'This is a development build — set the dev command (e.g. a path to your own build).'
              : 'Point this at the binary or wrapper script directly.'}
          </div>
          <TextField
            label={settings.debugBuild ? 'huenicorn command (dev build)' : 'huenicorn command'}
            placeholder="huenicorn"
            value={commandDraft}
            onChange={(_e, v) => setCommandDraft(v ?? '')}
          />
          <PrimaryButton
            text={savingCommand ? 'Saving…' : 'Save'}
            onClick={handleSaveCommand}
            disabled={savingCommand || !commandDraft.trim()}
            style={{ marginTop: 8 }}
          />
        </FormCard>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, color: theme.palette.neutralPrimary }}>
      {hubSubscriber}
      {/* Cards flow left-to-right and wrap rather than stacking in one
          tall column — this page is several independent panels, and on a
          wide screen the vertical stack wasted most of the width.
          `alignItems: start` keeps a short card from stretching to match
          a tall neighbour in the same row. */}
      <Stack horizontal wrap tokens={{ childrenGap: 16 }} styles={{ inner: { alignItems: 'flex-start' } }}>
      <FormCard style={{ maxWidth: 420 }}>
        <Form
          key={`${settings.huenicornEnabled}-${settings.ambientTintIntensity}-${settings.ambientPrimaryChannel}-${settings.ambientSaturationBoostDay}-${settings.ambientSaturationBoostNight}-${channels.length}`}
          form={settingsSchema}
          name="ambientLightsSettings"
          initialValues={{
            huenicornEnabled: settings.huenicornEnabled ?? huenicornEnabled,
            ambientTintIntensity:
              settings.ambientTintIntensity != null
                ? round2(settings.ambientTintIntensity)
                : ambientTintIntensity,
            ambientPrimaryChannel:
              settings.ambientPrimaryChannel != null
                ? String(settings.ambientPrimaryChannel)
                : ambientPrimaryChannel,
            ambientSaturationBoostDay:
              settings.ambientSaturationBoostDay != null
                ? round2(settings.ambientSaturationBoostDay)
                : ambientSaturationBoostDay,
            ambientSaturationBoostNight:
              settings.ambientSaturationBoostNight != null
                ? round2(settings.ambientSaturationBoostNight)
                : ambientSaturationBoostNight,
          }}
          onChange={(_n: string, { clean }: any) => {
            if (clean.huenicornEnabled != null) setHuenicornEnabled(clean.huenicornEnabled);
            if (clean.ambientTintIntensity != null) setAmbientTintIntensity(clean.ambientTintIntensity);
            if (clean.ambientPrimaryChannel != null) setAmbientPrimaryChannel(clean.ambientPrimaryChannel);
            if (clean.ambientSaturationBoostDay != null) setAmbientSaturationBoostDay(clean.ambientSaturationBoostDay);
            if (clean.ambientSaturationBoostNight != null) setAmbientSaturationBoostNight(clean.ambientSaturationBoostNight);
          }}
        />
        <PrimaryButton text={saving ? 'Saving…' : 'Save'} onClick={handleSave} disabled={saving} />
        {saveStatus && <div style={{ fontSize: '0.8em', opacity: 0.6, marginTop: 6 }}>{saveStatus}</div>}
      </FormCard>

      <FormCard style={{ maxWidth: 420 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Light gamma (day / night)</div>
        <div style={{ fontSize: '0.8em', opacity: 0.7, marginBottom: 8 }}>
          Applied to the bulbs themselves, per channel. Higher is brighter (0 = send
          Huenicorn's color untouched). The day and night values are blended by the
          global day/night state, so a simulated in-game dusk ramps the lights down
          gradually rather than switching.
        </div>
        {gammaRows.length === 0 ? (
          <div style={{ fontSize: '0.85em', opacity: 0.6 }}>
            No channels yet — start Huenicorn to load its channel list.
          </div>
        ) : (
          <>
            <Form
              // The list field handles remounting individual rows itself
              // (see its echo detection), but this OUTER form is still an
              // ordinary uncontrolled per-form Form: its useForm seeds
              // `channelGamma` once at mount, so reloaded values only reach
              // it via a key change. Content-keyed, not length-keyed — a
              // length-only key was the original "save, refresh, back to
              // zero" bug.
              key={`gamma-${gammaRowKey}-${savedGammaKey}`}
              form={gammaSchema}
              name="ambientLightsGamma"
              initialValues={{ channelGamma: gammaRows }}
              onChange={(_n: string, { raw }: any) => {
                setGammaEdits(prev => {
                  const next = { ...prev };
                  (raw.channelGamma ?? []).forEach((r: GammaRow) => {
                    next[r.channelId] = { day: Number(r.day) || 0, night: Number(r.night) || 0 };
                  });
                  return next;
                });
              }}
            />
            <PrimaryButton
              text={savingGamma ? 'Saving…' : 'Save gamma'}
              onClick={handleSaveGamma}
              disabled={savingGamma}
            />
            {gammaStatus && (
              <div style={{ fontSize: '0.8em', opacity: 0.6, marginTop: 6 }}>{gammaStatus}</div>
            )}
            {!huenicornStatus?.apiReachable && (
              <div style={{ fontSize: '0.8em', opacity: 0.6, marginTop: 6 }}>
                Huenicorn isn't running — saved values apply the next time it starts.
              </div>
            )}
          </>
        )}
      </FormCard>

      <FormCard style={{ maxWidth: 420 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Huenicorn status</div>
        <div style={{ color: statusColor }}>{statusLabel}</div>
        {selectedColor && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 4,
                flexShrink: 0,
                background: colorToCss(selectedColor),
                border: `1px solid ${theme.palette.neutralTertiary}`,
              }}
            />
            <span style={{ fontSize: '0.8em', opacity: 0.7 }}>
              Channel {selectedColor.channelId} — raw streamed value (may not match the bulb — see below)
            </span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <PrimaryButton
            text="Start"
            onClick={() => startHuenicorn()}
            disabled={starting || !!huenicornStatus?.running}
          />
          <DefaultButton
            text="Stop"
            onClick={() => stopHuenicorn()}
            disabled={stopping || !huenicornStatus?.running}
          />
          <DefaultButton
            text={resettingSelection ? 'Reselecting…' : 'Reselect Screen'}
            onClick={() => resetScreenSelection()}
            disabled={resettingSelection || starting || stopping}
          />
        </div>
        <div style={{ fontSize: '0.78em', opacity: 0.6, marginTop: 6 }}>
          Huenicorn remembers your screen/region choice and skips the picker
          on future launches. Use this to make it ask again — a new picker
          dialog will pop up on your desktop after Huenicorn restarts.
        </div>
      </FormCard>

      <FormCard style={{ maxWidth: 420 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Screen mapping</div>
        <div style={{ fontSize: '0.8em', opacity: 0.7, marginBottom: 8 }}>
          Which rectangle of the screen each light channel samples color
          from. Drag a corner to resize; each channel's box is filled with
          its own currently-streamed color for reference.
        </div>
        <ChannelMapper channels={channels} colors={currentColors} apiReachable={!!huenicornStatus?.apiReachable} />
      </FormCard>

      <AdvancedHuenicornSettings apiReachable={!!huenicornStatus?.apiReachable} />
      </Stack>

      <a
        href={HUENICORN_WEB_UI_URL}
        target="_blank"
        rel="noreferrer"
        style={{ display: 'inline-block', marginTop: 16, fontSize: '0.8em', opacity: 0.6, color: theme.palette.themePrimary }}
      >
        Having trouble? Open Huenicorn's own config UI →
      </a>
    </div>
  );
};

const AmbientLights: React.FC = () => (
  <Routes>
    <Route path="dev-color-test" element={<DevColorTest />} />
    <Route path="/*" element={<AmbientLightsMain />} />
  </Routes>
);

export default AmbientLights;
