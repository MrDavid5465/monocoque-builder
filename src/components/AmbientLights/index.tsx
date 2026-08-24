import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useMutation, useQuery } from '@apollo/client/react';
import { PrimaryButton, DefaultButton } from '@fluentui/react';
import { getTheme, Form, FormCard } from '../../lib/denim/lib';
import dispatcher, { IMy } from '../../lib/denim/lib/queries';
import { useLiveUpdatesHub, useHubListener } from '../Telemetry/liveUpdatesHub';
import { DevColorTest } from './DevColorTest';
import {
  GET_HUENICORN_STATUS,
  GET_HUENICORN_CHANNELS,
  START_HUENICORN,
  STOP_HUENICORN,
  HUENICORN_WEB_UI_URL,
  IHuenicornStatus,
  IHuenicornChannels,
} from './queries';

interface ChannelColor {
  channelId: number;
  r: number;
  g: number;
  b: number;
}

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
const AmbientLightsMain: React.FC = () => {
  const theme = getTheme();
  const { data: myData } = useQuery<IMy>(dispatcher.my);
  const settings = myData?.my?.settings ?? {};
  // f32 -> GraphQL Float -> JS float round-trips with binary noise (e.g.
  // 0.30000001192092896) — round for display/editing, same precision the
  // slider's own `step` already implies.
  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Deliberately NOT hue-boosted, only brightness-lifted — this is the
  // literal {r,g,b} Huenicorn is streaming to the bridge, the same signal
  // that drives the 360° tint (see Photo360Viewer.tsx's ambientTint
  // uniform). Confirmed live that it can disagree noticeably with what the
  // bulb actually renders (a visibly purple-blue light streaming r/g/b
  // within ~0.03 of each other, red the highest of the three) — exaggerating
  // hue here would risk showing a confidently wrong color (e.g. orange for
  // a blue-dominant reading) rather than an honest "here's what's actually
  // being sent." Only lifting brightness so a dim-but-real reading isn't
  // just an indistinguishable near-black square against this page's dark
  // background.
  const liftForPreview = (c: { r: number; g: number; b: number }) => {
    const luma = (c.r + c.g + c.b) / 3 || 0.0001;
    const lift = Math.max(1, 0.5 / luma);
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    return { r: clamp(c.r * lift), g: clamp(c.g * lift), b: clamp(c.b * lift) };
  };

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
  const [ambientSaturationBoost, setAmbientSaturationBoost] = useState(1);
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
    if (settings.ambientSaturationBoost != null) setAmbientSaturationBoost(round2(settings.ambientSaturationBoost));
  }, [settings.ambientSaturationBoost]);

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
            ambientSaturationBoost,
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

  const { data: channelsData } = useQuery<IHuenicornChannels>(GET_HUENICORN_CHANNELS, {
    pollInterval: 5000,
    fetchPolicy: 'network-only',
  });
  const channels = channelsData?.huenicornChannels ?? [];

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
    ambientTintIntensity: { type: 'slider', label: 'Tint intensity', min: 0, max: 1, step: 0.05 },
    ambientPrimaryChannel: {
      type: 'select',
      label: 'Primary channel (drives 360° tint)',
      options: [
        { text: 'First active channel', value: '' },
        ...channels.map(c => ({ text: c.name, value: String(c.channelId) })),
      ],
    },
    ambientSaturationBoost: {
      type: 'slider',
      label: 'Color vividness (1 = as captured, higher = pale colors become vibrant)',
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

  return (
    <div style={{ padding: 16, color: theme.palette.neutralPrimary }}>
      {hubSubscriber}
      <FormCard style={{ maxWidth: 420 }}>
        <Form
          key={`${settings.huenicornEnabled}-${settings.ambientTintIntensity}-${settings.ambientPrimaryChannel}-${settings.ambientSaturationBoost}-${channels.length}`}
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
            ambientSaturationBoost:
              settings.ambientSaturationBoost != null
                ? round2(settings.ambientSaturationBoost)
                : ambientSaturationBoost,
          }}
          onChange={(_n: string, { clean }: any) => {
            if (clean.huenicornEnabled != null) setHuenicornEnabled(clean.huenicornEnabled);
            if (clean.ambientTintIntensity != null) setAmbientTintIntensity(clean.ambientTintIntensity);
            if (clean.ambientPrimaryChannel != null) setAmbientPrimaryChannel(clean.ambientPrimaryChannel);
            if (clean.ambientSaturationBoost != null) setAmbientSaturationBoost(clean.ambientSaturationBoost);
          }}
        />
        <PrimaryButton text={saving ? 'Saving…' : 'Save'} onClick={handleSave} disabled={saving} />
        {saveStatus && <div style={{ fontSize: '0.8em', opacity: 0.6, marginTop: 6 }}>{saveStatus}</div>}
      </FormCard>

      <FormCard style={{ maxWidth: 420, marginTop: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Huenicorn status</div>
        <div style={{ color: statusColor }}>{statusLabel}</div>
        {selectedColor && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            {(() => {
              const lifted = liftForPreview(selectedColor);
              return (
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    flexShrink: 0,
                    background: `rgb(${Math.round(lifted.r * 255)}, ${Math.round(lifted.g * 255)}, ${Math.round(lifted.b * 255)})`,
                    border: `1px solid ${theme.palette.neutralTertiary}`,
                  }}
                />
              );
            })()}
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
        </div>
        <a
          href={HUENICORN_WEB_UI_URL}
          target="_blank"
          rel="noreferrer"
          style={{ display: 'inline-block', marginTop: 12, fontSize: '0.85em', color: theme.palette.themePrimary }}
        >
          Open Huenicorn's own config UI (channel-to-screen mapping) →
        </a>
      </FormCard>
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
