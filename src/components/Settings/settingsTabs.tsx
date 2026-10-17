// Monocoque Builder's tabs in the cross-feature Settings dialog (SidebarShell:
// sidebar footer -> Settings). Ported from the old vendored denim's
// Header/Settings/index.tsx onto the denim core's extension point: each tab
// reports its slice of AppSettings through `onChange` (merged into the one
// updateSettings save), and tabs with their own records (Dashboards' device
// defaults) save them through `registerSave`. The core sends only the
// values that differ from the saved settings, so a tab reports its whole
// form and a Save with no edits sends nothing.
//
// Denim's own General tab keeps Default page / Colour / Theme / Font size,
// plus this app's device name and config directory (generalFields.ts; the
// device name lives inside `deviceMap` and is mapped with the core's
// read/write).
//
// Keep this dialog for global, cross-feature preferences only; a feature's
// own configuration belongs in its own application.
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { Stack, getTheme, Form } from '../../lib/denim-fabric/lib';
import { useLayout } from '../../lib/denim-fabric';
import type { ISettingsTab, ISettingsTabProps } from '../../lib/denim-fabric';
import { GAMEPAD_UDEV_STATUS, SETUP_GAMEPAD_UDEV, GamepadMapping } from '../../graphql/appSettings';
import { getAppId } from '../../graphql/client';
import { GET_DASHBOARDS } from '../Telemetry/DashboardDesigner/queries';
import { GET_CONNECTED_CLIENTS, ConnectedClient } from '../Telemetry/clientsQueries';
import { GET_DASH_GROUPS } from '../Telemetry/Groups/queries';
import {
  GET_DEVICE_DEFAULTS,
  ADD_DEVICE_DEFAULT,
  UPDATE_DEVICE_DEFAULT,
  REMOVE_DEVICE_DEFAULT,
  DeviceDefault,
} from '../Telemetry/deviceDefaultsQueries';
import DayNightSimPanel from '../Telemetry/DayNightSimPanel';
import GameConfigPanel from '../Telemetry/GameConfigPanel';

const AXIS_LABELS = ['X', 'Y', 'Z', 'RX', 'RY', 'RZ'];

const pad = { paddingTop: '0.77em' };

// ── Dashboards (per-device default dashboard / group) ───────────────────────

/** One row of the per-device override list. `deviceId` is the row identity
 *  (stable across renames); `deviceName` is what the server keys
 *  DeviceDefault records by. */
interface DeviceRow {
  deviceId: string;
  deviceName: string;
  dash: string;
  group: string;
}

// `loads: true` (see settingsTabs below): the core holds Save while this tab
// is open and its queries haven't answered, and skips its registerSave
// until it is ready. Its forms seeded before the saved defaults arrived
// would show "(none)", and saving that deleted the default dashboard.
const DashboardsTab: React.FC<ISettingsTabProps> = ({ settings, isOpen, registerSave, setReady }) => {
  const appId = getAppId();
  const [addDefault] = useMutation(ADD_DEVICE_DEFAULT);
  const [updateDefault] = useMutation(UPDATE_DEVICE_DEFAULT);
  const [removeDefault] = useMutation(REMOVE_DEVICE_DEFAULT);

  const { data: dashData } = useQuery(GET_DASHBOARDS, { skip: !isOpen });
  const { data: groupsData } = useQuery(GET_DASH_GROUPS, { skip: !isOpen });
  const { data: deviceDefaultsData } = useQuery(GET_DEVICE_DEFAULTS, { skip: !isOpen, fetchPolicy: 'network-only' });

  const dashboards: Array<{ name: string }> = (dashData as any)?.getDashboardEntries ?? [];
  const groups: Array<{ id: string; name: string }> = (groupsData as any)?.getDashGroups ?? [];
  const deviceDefaults: DeviceDefault[] = (deviceDefaultsData as any)?.getDeviceDefaults ?? [];
  const deviceMap: Record<string, string> = settings.deviceMap ?? {};
  const ready = !!(dashData && groupsData && deviceDefaultsData);
  // First, before anything this tab reports.
  useEffect(() => setReady(ready), [ready, setReady]);

  // What's saved, by device name, plus the user's edits on top. Derived
  // rather than copied into state in an effect: this tab mounts when it is
  // clicked, often before its query has answered, and a copy made one render
  // late left the forms seeded with "(none)".
  const savedDefaults = useMemo(() => {
    const out: Record<string, { dash: string; group: string }> = {};
    deviceDefaults.forEach(d => {
      out[d.deviceName] = { dash: d.dash ?? '', group: d.group ?? '' };
    });
    return out;
  }, [deviceDefaults]);
  const [edits, setEdits] = useState<Record<string, { dash: string; group: string }>>({});
  const localDefaults = useMemo(() => ({ ...savedDefaults, ...edits }), [savedDefaults, edits]);

  const defaultsByName = useMemo(
    () => Object.fromEntries(deviceDefaults.map(d => [d.deviceName, d])),
    [deviceDefaults],
  );

  const dashOptions = [
    { value: '', text: '(none)' },
    ...dashboards.map(d => ({ value: d.name, text: d.name })),
  ];

  // De-duplicated by NAME, not id: a DeviceDefault stores `group` as a name,
  // so two groups sharing one name are indistinguishable downstream.
  const groupOptions = [
    { value: '', text: '(none)' },
    ...[...new Set(groups.map(g => g.name))].map(name => ({ value: name, text: name })),
  ];

  // Rows are DERIVED during render from deviceMap + localDefaults rather
  // than held in their own state (see the old dialog's note on the
  // AmbientLights gamma editor). Unnamed devices are excluded: defaults are
  // keyed by device NAME server-side.
  const namedDevices = Object.entries(deviceMap).filter(([, name]) => !!name);
  const unnamedDeviceCount = Object.keys(deviceMap).length - namedDevices.length;

  const deviceRows: DeviceRow[] = useMemo(
    () =>
      namedDevices
        .map(([deviceId, deviceName]) => ({
          deviceId,
          deviceName,
          dash: localDefaults[deviceName]?.dash ?? '',
          group: localDefaults[deviceName]?.group ?? '',
        }))
        // This device first.
        .sort((a, b) =>
          a.deviceId === appId ? -1
            : b.deviceId === appId ? 1
              : a.deviceName.localeCompare(b.deviceName)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deviceMap, localDefaults, appId],
  );

  const deviceOverridesSchema = {
    devices: {
      type: 'list' as const,
      label: '',
      fixed: true,
      horizontal: true,
      emptyText: 'No named devices yet.',
      rowKey: (r: DeviceRow) => r.deviceId,
      rowLabel: (r: DeviceRow) => (
        <span style={{ fontSize: '0.8em', fontWeight: r.deviceId === appId ? 700 : 500, opacity: r.deviceId === appId ? 1 : 0.75 }}>
          {r.deviceName}
          {r.deviceId === appId && <span style={{ fontWeight: 400, opacity: 0.5 }}> (this device)</span>}
        </span>
      ),
      itemSchema: () => ({
        dash: { type: 'select' as const, placeholder: 'Dashboard override', options: dashOptions },
        group: { type: 'select' as const, placeholder: 'Group override', options: groupOptions },
      }),
      // dash and group are mutually exclusive: setting one clears the other.
      deriveRow: ({ field, value }: { field: string; value: any }) => {
        if (field === 'dash') return value ? { group: '' } : undefined;
        if (field === 'group') return value ? { dash: '' } : undefined;
        return undefined;
      },
    },
  };

  // Writes this tab's own DeviceDefault records after the settings save.
  // Registered only once the tab has been opened, so a Save from another tab
  // no longer rewrites every device default; the core runs it only once the
  // tab is ready.
  useEffect(() => {
    registerSave(async () => {
      const allNames = new Set(['default', ...Object.values(deviceMap)]);
      for (const deviceName of allNames) {
        // Only what the user actually changed: a Save from this tab must not
        // rewrite (or, for an empty value, delete) records it merely showed.
        const saved = savedDefaults[deviceName] ?? { dash: '', group: '' };
        const local = localDefaults[deviceName] ?? saved;
        if ((local.dash || '') === (saved.dash || '') && (local.group || '') === (saved.group || '')) continue;
        const dash = local.dash || null;
        const group = local.group || null;
        const existing = defaultsByName[deviceName];
        if (!dash && !group) {
          if (existing) await removeDefault({ variables: { id: existing.id } });
        } else if (existing) {
          await updateDefault({ variables: { id: existing.id, update: { deviceName, dash, group } } });
        } else {
          await addDefault({ variables: { values: { deviceName, dash, group } } });
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedDefaults, localDefaults, defaultsByName, settings.deviceMap, registerSave]);

  const currentName = deviceMap[appId] ?? '';

  // No forms before the saved defaults and the options are in (they would
  // be seeded with "(none)").
  if (!ready) {
    return <Stack style={pad}><span style={{ fontSize: '0.85em', opacity: 0.6 }}>Loading…</span></Stack>;
  }

  return (
    <Stack tokens={{ childrenGap: '1em' }} style={pad}>
      {/* Keyed on the SERVER value, so it reseeds only when the loaded record changes. */}
      <Form
        key={`default-${defaultsByName['default']?.dash ?? ''}`}
        form={{ dash: { type: 'select', label: 'Default dashboard', options: dashOptions } }}
        name="defaultDashboard"
        initialValues={{ dash: localDefaults['default']?.dash ?? '' }}
        onChange={(_n: string, { clean }: any) =>
          setEdits(prev => ({ ...prev, default: { dash: clean.dash ?? '', group: '' } }))
        }
      />
      <Stack tokens={{ childrenGap: '0.5em' }}>
        <span style={{ fontSize: '0.9em', fontWeight: 600 }}>Devices</span>
        {!currentName && (
          <span style={{ fontSize: '0.78em', opacity: 0.5 }}>Set a device name on the General tab to configure defaults for this device.</span>
        )}
        <Form
          key={`devdefaults-${deviceDefaults.map(d => d.id).join(',')}`}
          form={deviceOverridesSchema}
          name="deviceOverrides"
          initialValues={{ devices: deviceRows }}
          onChange={(_n: string, { raw }: any) => {
            const rows: DeviceRow[] = raw.devices ?? [];
            setEdits(prev => {
              const next = { ...prev };
              rows.forEach(r => {
                next[r.deviceName] = { dash: r.dash ?? '', group: r.group ?? '' };
              });
              return next;
            });
          }}
        />
        {unnamedDeviceCount > 0 && (
          <span style={{ fontSize: '0.75em', opacity: 0.45 }}>
            {unnamedDeviceCount} device{unnamedDeviceCount === 1 ? '' : 's'} with no name set — overrides are stored per device name.
          </span>
        )}
      </Stack>
    </Stack>
  );
};

// ── Controller ──────────────────────────────────────────────────────────────

const ControllerTab: React.FC<ISettingsTabProps> = ({ settings, isOpen, onChange }) => {
  const theme = getTheme();
  const [steerMaxDeg, setSteerMaxDeg] = useState<number>(settings.steerMaxDeg ?? 400);
  const [udevWorking, setUdevWorking] = useState(false);
  const [udevMsg, setUdevMsg] = useState<string | null>(null);

  useEffect(() => {
    onChange({ steerMaxDeg });
  }, [steerMaxDeg, onChange]);

  // Backend query, not a Tauri command — the backend is the process that
  // would actually open /dev/uinput. `network-only` because the answer
  // changes out from under the cache when the rule is installed. Derived
  // from `data`: Apollo Client v4's useQuery has no onCompleted.
  const { data: udevData, error: udevError, refetch: refetchUdev } = useQuery(GAMEPAD_UDEV_STATUS, {
    skip: !isOpen,
    fetchPolicy: 'network-only',
  });
  const udevStatus: 'unknown' | 'installed' | 'missing' = udevError
    ? 'unknown'
    : (udevData as any)?.gamepadUdevStatus === undefined
      ? 'unknown'
      : (udevData as any).gamepadUdevStatus
        ? 'installed'
        : 'missing';
  const [setupUdev] = useMutation(SETUP_GAMEPAD_UDEV);

  const handleInstallUdev = async () => {
    setUdevWorking(true);
    setUdevMsg(null);
    try {
      const res: any = await setupUdev();
      const result = res?.data?.setupGamepadUdev;
      setUdevMsg(result === 'already-installed' ? 'Already usable.' : 'Rule installed — replug or re-login if needed.');
      // Re-ask rather than assuming success.
      await refetchUdev();
    } catch (e: any) {
      setUdevMsg(`Failed: ${e?.message ?? String(e)}`);
    } finally {
      setUdevWorking(false);
    }
  };

  const initialValues = useMemo(() => ({ steerMaxDeg: settings.steerMaxDeg ?? 400 }), [settings.steerMaxDeg]);

  return (
    <Stack tokens={{ childrenGap: '1em' }} style={pad}>
      <Stack>
        <span style={{ fontSize: '0.78em', opacity: 0.65, marginBottom: 8 }}>
          Total lock-to-lock degrees for your steering wheel. For example, enter 900 for a 900° wheel. The sim returns a normalised ±1.0 value — the app halves this to get per-side degrees for counter-rotation.
        </span>
        <Form
          form={{ steerMaxDeg: { type: 'slider', label: 'Steering wheel total rotation (degrees)', min: 90, max: 1440, step: 10 } }}
          name="controllerSettings"
          initialValues={initialValues}
          onChange={(_n: string, { clean }: any) => setSteerMaxDeg(clean.steerMaxDeg)}
        />
      </Stack>
      <span style={{ fontSize: '0.82em', opacity: 0.6 }}>
        This is the global default for counter-rotating dashboard elements. Individual components can override it in their properties panel.
      </span>

      <Stack style={{ borderTop: `1px solid ${theme.palette.neutralLight}`, paddingTop: '1em' }}>
        <label style={{ fontSize: '0.85em', fontWeight: 600, marginBottom: 4 }}>
          Virtual gamepad (uinput)
        </label>
        <span style={{ fontSize: '0.78em', opacity: 0.65, marginBottom: 8 }}>
          Button and slider controls send input via a Linux uinput virtual gamepad.
          The app needs write access to <code>/dev/uinput</code>. Many systems already
          grant it to the logged-in user via a <code>uaccess</code> ACL; the button below
          installs a udev rule for those that don't.
        </span>
        <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 10 }}>
          <span style={{
            fontSize: '0.8em',
            color: udevStatus === 'installed'
              ? theme.palette.green
              : udevStatus === 'missing'
                ? theme.palette.redDark
                : theme.palette.neutralSecondary,
          }}>
            {udevStatus === 'installed' ? '✓ Virtual gamepad ready'
              : udevStatus === 'missing' ? '✗ No access to /dev/uinput'
                : '— checking…'}
          </span>
          {udevStatus !== 'installed' && (
            <button
              onClick={handleInstallUdev}
              disabled={udevWorking || udevStatus === 'unknown'}
              style={{
                padding: '3px 10px', fontSize: '0.8em', cursor: udevWorking ? 'wait' : 'pointer',
                border: 'none', borderRadius: 3,
                background: theme.palette.themePrimary, color: '#fff',
              }}
            >
              {udevWorking ? 'Installing…' : 'Install rule'}
            </button>
          )}
        </Stack>
        {udevMsg && <span style={{ fontSize: '0.78em', marginTop: 4, opacity: 0.75 }}>{udevMsg}</span>}
      </Stack>
    </Stack>
  );
};

// ── Services ────────────────────────────────────────────────────────────────

const ServicesTab: React.FC<ISettingsTabProps> = ({ settings, onChange }) => {
  const [commands, setCommands] = useState({
    simdCommand: settings.simdCommand ?? 'simd',
    monocoqueCommand: settings.monocoqueCommand ?? 'monocoque play',
    huenicornCommand: settings.huenicornCommand ?? 'huenicorn',
  });
  const debugBuild: boolean = settings.debugBuild ?? false;

  useEffect(() => {
    onChange(commands);
  }, [commands, onChange]);

  const initialValues = useMemo(
    () => ({
      simdCommand: settings.simdCommand ?? 'simd',
      monocoqueCommand: settings.monocoqueCommand ?? 'monocoque play',
      huenicornCommand: settings.huenicornCommand ?? 'huenicorn',
    }),
    [settings.simdCommand, settings.monocoqueCommand, settings.huenicornCommand],
  );

  return (
    <Stack tokens={{ childrenGap: '1em' }} style={pad}>
      <span style={{ fontSize: '0.78em', opacity: 0.65 }}>
        Commands the simd/monocoque/Huenicorn watchdogs use to launch each service
        when it's found not running. Defaults are bare, PATH-resolved binary names —
        override these if your install only exposes a service under a different name
        or a wrapper script (e.g. a distrobox-based install).
      </span>
      {/* Which set is live is decided by the build type, not a toggle here
          (see service_commands.rs), so the panel states it. */}
      <span
        style={{
          fontSize: '0.78em',
          padding: '6px 8px',
          borderRadius: 4,
          background: debugBuild ? 'rgba(201, 162, 39, 0.12)' : 'rgba(58, 167, 109, 0.12)',
          color: debugBuild ? '#c9a227' : '#3aa76d',
        }}
      >
        {debugBuild
          ? 'Development build — these commands are ignored. Each service is launched from '
            + 'TYPIQL_<SERVICE>_DEV_COMMAND in the environment, and one with no variable set '
            + 'is not started at all.'
          : 'Release build — the commands below are in use.'}
      </span>
      <Form
        form={{
          simdCommand: { type: 'text', label: 'simd command', placeholder: 'simd' },
          monocoqueCommand: { type: 'text', label: 'monocoque command', placeholder: 'monocoque play' },
          huenicornCommand: { type: 'text', label: 'huenicorn command', placeholder: 'huenicorn' },
        }}
        name="servicesSettings"
        initialValues={initialValues}
        onChange={(_n: string, { clean }: any) =>
          setCommands({
            simdCommand: clean.simdCommand,
            monocoqueCommand: clean.monocoqueCommand,
            huenicornCommand: clean.huenicornCommand,
          })
        }
      />
    </Stack>
  );
};

// ── Day/Night, Game: self-contained panels ──────────────────────────────────

const DayNightTab: React.FC<ISettingsTabProps> = () => (
  <Stack style={pad}>
    <DayNightSimPanel />
  </Stack>
);

// Next to Services: it answers the same question (is what this app depends
// on actually there), for the game rather than a companion process.
const GameTab: React.FC<ISettingsTabProps> = () => (
  <Stack style={pad}>
    <GameConfigPanel />
  </Stack>
);

// ── Gamepad ─────────────────────────────────────────────────────────────────

// Strip Apollo's `__typename`: GamepadMappingInput rejects unknown fields.
const stripTypename = (m: GamepadMapping): GamepadMapping =>
  ({ id: m.id, name: m.name, mappingType: m.mappingType, index: m.index });

// One row per mapping: Name | Type | index slider side by side, or stacked
// on a phone, where three columns leave the slider (and its number box) no
// room and the row ran off the screen.
const gamepadSchema = (horizontal: boolean) => ({
  mappings: {
    type: 'list' as const,
    label: '',
    singular: 'mapping',
    addLabel: '+ Add mapping',
    removeLabel: 'Remove mapping',
    emptyText: 'No mappings yet.',
    horizontal,
    rowKey: (m: GamepadMapping) => m.id,
    // Fresh id per add — evaluated at click time.
    newRow: () => ({ id: `gp-${Date.now()}`, name: '', mappingType: 'button', index: 0 }),
    itemSchema: ({ row }: { row: GamepadMapping }) => ({
      name: { type: 'text' as const, label: 'Name', placeholder: 'e.g. Headlights', required: true },
      mappingType: {
        type: 'select' as const,
        label: 'Type',
        options: [
          { text: 'Button', value: 'button' },
          { text: 'Axis', value: 'axis' },
        ],
      },
      index: {
        type: 'slider' as const,
        label: row.mappingType === 'axis'
          ? `Axis (${AXIS_LABELS[row.index] ?? row.index})`
          : 'Button',
        min: 0,
        max: row.mappingType === 'axis' ? 5 : 31,
        step: 1,
      },
    }),
    // Switching button<->axis resets the index (31 is a valid button, not axis).
    deriveRow: ({ field }: { field: string }) =>
      field === 'mappingType' ? { index: 0 } : undefined,
  },
});

const GamepadTab: React.FC<ISettingsTabProps> = ({ settings, onChange }) => {
  const saved: GamepadMapping[] = settings.gamepadMappings ?? [];
  const [mappings, setMappings] = useState<GamepadMapping[]>(() => saved.map(stripTypename));
  const [valid, setValid] = useState(true);
  const narrow = useLayout() === 'narrow';
  const schema = useMemo(() => gamepadSchema(!narrow), [narrow]);

  useEffect(() => {
    onChange(
      { gamepadMappings: mappings.map(stripTypename) },
      valid,
      'Please fix the highlighted gamepad mappings before saving.',
    );
  }, [mappings, valid, onChange]);

  // Seeded from the SERVER-side mappings, so adding or removing a row
  // doesn't reseed mid-interaction.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialValues = useMemo(() => ({ mappings: saved.map(stripTypename) }), [settings.gamepadMappings]);

  return (
    <Stack tokens={{ childrenGap: '0.8em' }} style={pad}>
      <span style={{ fontSize: '0.8em', opacity: 0.6 }}>
        Define named actions here, then assign them to button/slider/encoder controls on the canvas.
      </span>
      <Form
        form={schema}
        name="gamepadMappings"
        initialValues={initialValues}
        onChange={(_n: string, { raw, isValid }: any) => {
          setMappings(raw.mappings ?? []);
          setValid(isValid);
        }}
      />
    </Stack>
  );
};

// ── Clients ─────────────────────────────────────────────────────────────────

function relativeTime(lastSeen: string): string {
  const secs = Math.floor(Date.now() / 1000) - parseInt(lastSeen, 10);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

const ClientsTab: React.FC<ISettingsTabProps> = ({ settings, isOpen }) => {
  const { data: clientsData } = useQuery(GET_CONNECTED_CLIENTS, { skip: !isOpen, fetchPolicy: 'network-only' });
  const clients: ConnectedClient[] = (clientsData as any)?.getConnectedClients ?? [];
  const deviceMap: Record<string, string> = settings.deviceMap ?? {};
  return (
    <Stack tokens={{ childrenGap: '0.5em' }} style={pad}>
      {clients.length === 0 && (
        <span style={{ opacity: 0.6, fontSize: '0.85em' }}>No connected clients yet.</span>
      )}
      {clients.map(client => {
        const name = deviceMap[client.id] ?? client.name;
        return (
          <Stack
            key={client.id}
            horizontal
            verticalAlign="center"
            tokens={{ childrenGap: 8 }}
            style={{ padding: '0.4em 0', borderBottom: '1px solid rgba(128,128,128,0.2)' }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: parseInt(client.lastSeen, 10) > Date.now() / 1000 - 60 ? '#4caf50' : '#999',
                flexShrink: 0,
              }}
            />
            <Stack style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: '0.9em', fontWeight: name ? 600 : 400 }}>
                {name ?? `${client.id.slice(0, 8)}…`}
              </span>
              <span style={{ fontSize: '0.75em', opacity: 0.6 }}>
                {client.id.slice(0, 8)}… · {relativeTime(client.lastSeen)}
              </span>
            </Stack>
          </Stack>
        );
      })}
    </Stack>
  );
};

export const settingsTabs: ISettingsTab[] = [
  { key: 'dashboards', headerText: 'Dashboards', Component: DashboardsTab, loads: true },
  { key: 'controller', headerText: 'Controller', Component: ControllerTab },
  { key: 'services', headerText: 'Services', Component: ServicesTab },
  { key: 'daynight', headerText: 'Day/Night', Component: DayNightTab },
  { key: 'game', headerText: 'Game', Component: GameTab },
  { key: 'gamepad', headerText: 'Gamepad', Component: GamepadTab },
  { key: 'clients', headerText: 'Clients', Component: ClientsTab },
];
