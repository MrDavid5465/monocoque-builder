import React, { useState, useEffect, useMemo } from 'react';
import { Modal, useMutation, useQuery, Stack, getStyle } from '../lib';
import { Pivot, PivotItem, getTheme } from '../../../lib';
import { userSettings } from './schema';
import { parseThemeKey, themeKey } from '../../../../themes';
import dispatcher, { ISettings, GamepadMapping, GAMEPAD_UDEV_STATUS, SETUP_GAMEPAD_UDEV } from '../../../lib/queries';
import { Form, PrimaryButton } from '../../../lib';
import { getAppId } from '../../../../../graphql/client';
import { GET_DASHBOARDS } from '../../../../../components/Telemetry/DashboardDesigner/queries';
import { GET_CONNECTED_CLIENTS, ConnectedClient } from '../../../../../components/Telemetry/clientsQueries';
import { GET_DASH_GROUPS } from '../../../../../components/Telemetry/Groups/queries';
import {
  GET_DEVICE_DEFAULTS,
  ADD_DEVICE_DEFAULT,
  UPDATE_DEVICE_DEFAULT,
  REMOVE_DEVICE_DEFAULT,
  DeviceDefault,
} from '../../../../../components/Telemetry/deviceDefaultsQueries';
import DayNightSimPanel from '../../../../../components/Telemetry/DayNightSimPanel';
import GameConfigPanel from '../../../../../components/Telemetry/GameConfigPanel';

const AXIS_LABELS = ['X', 'Y', 'Z', 'RX', 'RY', 'RZ'];

interface Props {
  isOpen: boolean;
  dismissModal: () => any;
  settings: Partial<ISettings>;
}

function relativeTime(lastSeen: string): string {
  const secs = Math.floor(Date.now() / 1000) - parseInt(lastSeen, 10);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/** One row of the Dashboards tab's per-device override list. `deviceId` is
 *  the row identity (stable across renames); `deviceName` is what the
 *  server keys DeviceDefault records by. */
interface DeviceRow {
  deviceId: string;
  deviceName: string;
  dash: string;
  group: string;
}

const Index: React.FC<Props> = ({ isOpen, dismissModal, settings }) => {
  const style = getStyle();
  const appId = getAppId();

  // Pushed up from the General tab's Form via onChange rather than pulled
  // from a ref at save time — Fluent's Pivot unmounts inactive tabs, so a
  // ref into the General Form goes back to null the moment the user
  // switches tabs, and pulling from it at save time silently drops every
  // General field from the save payload (this was the actual bug: saving
  // from another tab sent a mutation missing required fields like `theme`,
  // which the server rejected with the error never surfaced anywhere).
  const [generalValues, setGeneralValues] = useState<any>({});
  const [generalValid, setGeneralValid] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [steerMaxDeg, setSteerMaxDeg] = useState<number>(settings.steerMaxDeg ?? 400);
  const [simdCommand, setSimdCommand] = useState<string>(settings.simdCommand ?? 'simd');
  const [monocoqueCommand, setMonocoqueCommand] = useState<string>(settings.monocoqueCommand ?? 'monocoque play');
  const [huenicornCommand, setHuenicornCommand] = useState<string>(settings.huenicornCommand ?? 'huenicorn');
  const debugBuild: boolean = settings.debugBuild ?? false;
  const [udevWorking, setUdevWorking] = useState(false);
  const [udevMsg, setUdevMsg] = useState<string | null>(null);

  // Strip Apollo's injected `__typename` — sending it straight back through
  // updateSettings' GamepadMappingInput fails server-side ("unknown field
  // __typename"), since InputObjects only accept their declared fields.
  const stripTypename = (m: GamepadMapping): GamepadMapping =>
    ({ id: m.id, name: m.name, mappingType: m.mappingType, index: m.index });

  const [gamepadMappings, setGamepadMappings] = useState<GamepadMapping[]>(
    () => (settings.gamepadMappings ?? []).map(stripTypename),
  );
  // Replaces the old `editMapping` draft: with every row expanded there is
  // no single "row being edited", so validity is whatever the list field's
  // derived per-row validations report.
  const [gamepadValid, setGamepadValid] = useState(true);

  const gamepadSchema = {
    mappings: {
      type: 'list' as const,
      label: '',
      singular: 'mapping',
      addLabel: '+ Add mapping',
      removeLabel: 'Remove mapping',
      emptyText: 'No mappings yet.',
      horizontal: true,
      rowKey: (m: GamepadMapping) => m.id,
      // Fresh id per add — evaluated at click time, not schema-build time.
      newRow: () => ({ id: `gp-${Date.now()}`, name: '', mappingType: 'button', index: 0 }),
      // Same key set every call (name/mappingType/index) — only the config
      // varies, which is the documented rule for a function itemSchema.
      // `id` isn't a rendered field and rides along on the row untouched.
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
          // Carries the axis hint (X/Y/Z/RX/RY/RZ) that used to be a
          // separate line under the editor.
          label: row.mappingType === 'axis'
            ? `Axis (${AXIS_LABELS[row.index] ?? row.index})`
            : 'Button',
          min: 0,
          max: row.mappingType === 'axis' ? 5 : 31,
          step: 1,
        },
      }),
      // Switching button<->axis must reset the index: 31 is a valid button
      // but not a valid axis. deriveRow is told which field moved, so this
      // no longer needs the old compare-against-previous inference.
      deriveRow: ({ field }: { field: string }) =>
        field === 'mappingType' ? { index: 0 } : undefined,
    },
  };

  useEffect(() => {
    if (settings.gamepadMappings) setGamepadMappings(settings.gamepadMappings.map(stripTypename));
  }, [settings.gamepadMappings]);

  useEffect(() => {
    if (settings.steerMaxDeg != null) setSteerMaxDeg(settings.steerMaxDeg);
  }, [settings.steerMaxDeg]);

  useEffect(() => {
    if (settings.simdCommand != null) setSimdCommand(settings.simdCommand);
  }, [settings.simdCommand]);

  useEffect(() => {
    if (settings.monocoqueCommand != null) setMonocoqueCommand(settings.monocoqueCommand);
  }, [settings.monocoqueCommand]);

  useEffect(() => {
    if (settings.huenicornCommand != null) setHuenicornCommand(settings.huenicornCommand);
  }, [settings.huenicornCommand]);

  // Backend query, not a Tauri command — the backend is the process that
  // would actually open /dev/uinput, and this way the browser build can ask
  // too instead of being stuck on "unknown". `network-only` because the
  // answer changes out from under the cache when the rule is installed.
  //
  // Derived from `data` rather than an onCompleted callback: Apollo Client
  // v4 dropped onCompleted/onError from useQuery (they survive only on
  // useMutation, which is why every other onCompleted in this repo is on a
  // mutation). Passing them silently does nothing.
  const {
    data: udevData,
    error: udevError,
    refetch: refetchUdev,
  } = useQuery(GAMEPAD_UDEV_STATUS, {
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
      // Re-ask rather than assuming success — the install runs on the host,
      // and the authoritative answer is whether /dev/uinput opens now.
      await refetchUdev();
    } catch (e: any) {
      setUdevMsg(`Failed: ${e?.message ?? String(e)}`);
    } finally {
      setUdevWorking(false);
    }
  };

  // Local edit state: deviceName → { dash, group }
  const [localDefaults, setLocalDefaults] = useState<Record<string, { dash: string; group: string }>>({});

  // refetchQueries is required, not just nice-to-have: `AppSettings` has no
  // `id` field, so Apollo's normalized cache can't merge this mutation's
  // response into the separately-cached `my` query on its own — without
  // this, the theme (and everything else here) only took effect after a
  // full page reload. Same fix already applied to this same dispatcher's
  // updateSettings call in ShakerMatrix.tsx.
  const [updateSettings] = useMutation(dispatcher.updateSettings, { refetchQueries: [{ query: dispatcher.my }] });
  const [addDefault] = useMutation(ADD_DEVICE_DEFAULT);
  const [updateDefault] = useMutation(UPDATE_DEVICE_DEFAULT);
  const [removeDefault] = useMutation(REMOVE_DEVICE_DEFAULT);

  const { data: dashData } = useQuery(GET_DASHBOARDS, { skip: !isOpen });
  const { data: clientsData } = useQuery(GET_CONNECTED_CLIENTS, { skip: !isOpen, fetchPolicy: 'network-only' });
  const { data: groupsData } = useQuery(GET_DASH_GROUPS, { skip: !isOpen });
  const { data: deviceDefaultsData } = useQuery(GET_DEVICE_DEFAULTS, { skip: !isOpen, fetchPolicy: 'network-only' });

  const dashboards: Array<{ name: string }> = (dashData as any)?.getDashboardEntries ?? [];
  const clients: ConnectedClient[] = (clientsData as any)?.getConnectedClients ?? [];
  const groups: Array<{ id: string; name: string }> = (groupsData as any)?.getDashGroups ?? [];
  const deviceDefaults: DeviceDefault[] = (deviceDefaultsData as any)?.getDeviceDefaults ?? [];
  const deviceMap: Record<string, string> = settings.deviceMap ?? {};

  // Index existing records by deviceName for fast lookup during save
  const defaultsByName = useMemo(
    () => Object.fromEntries(deviceDefaults.map(d => [d.deviceName, d])),
    [deviceDefaults],
  );

  // Initialise local state once device defaults load
  useEffect(() => {
    if (!deviceDefaultsData) return;
    setLocalDefaults(prev => {
      const next: Record<string, { dash: string; group: string }> = {};
      deviceDefaults.forEach(d => {
        next[d.deviceName] = { dash: d.dash ?? '', group: d.group ?? '' };
      });
      // Preserve any edits the user has already made
      return Object.keys(prev).length ? prev : next;
    });
  }, [deviceDefaultsData]); // eslint-disable-line react-hooks/exhaustive-deps

  const dashOptions = [
    { value: '', text: '(none)' },
    ...dashboards.map(d => ({ value: d.name, text: d.name })),
  ];

  // De-duplicated by NAME, not id: a DeviceDefault stores `group` as a name,
  // so two groups sharing one name are indistinguishable to everything
  // downstream — listing the name twice offers a choice that doesn't exist,
  // and made Fluent's Dropdown emit a duplicate-React-key warning on every
  // render (it keys options by value). The underlying duplicate group is a
  // data problem worth fixing at the source; this just stops the picker
  // pretending the two are separate.
  const groupOptions = [
    { value: '', text: '(none)' },
    ...[...new Set(groups.map(g => g.name))].map(name => ({ value: name, text: name })),
  ];

  // Rows are DERIVED during render from deviceMap + localDefaults rather
  // than held in their own state. Holding them separately is what broke the
  // AmbientLights gamma editor: the Form's key changed one render before the
  // state it was keyed on, so it remounted against stale values and then
  // never remounted again.
  //
  // Devices with no name are excluded — defaults are keyed by device NAME
  // server-side, so an unnamed device has nowhere to store one. They're
  // surfaced as a count below the list instead of as dead rows.
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
        // This device first — it replaces the separate "This device" editor,
        // which edited the very same record as one of the rows below it.
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
      // Constant key set (dash/group); deviceId/deviceName aren't rendered
      // fields and ride along on the row untouched.
      // No per-field flex needed: `horizontal` shares the row evenly.
      itemSchema: () => ({
        dash: { type: 'select' as const, placeholder: 'Dashboard override', options: dashOptions },
        group: { type: 'select' as const, placeholder: 'Group override', options: groupOptions },
      }),
      // dash and group are mutually exclusive: either pick a specific
      // dashboard, or a group whose members resolve their own. Setting one
      // clears the other; clearing one leaves the other alone. deriveRow is
      // TOLD which field moved, so this drops the old inference that diffed
      // the incoming pair against the last-known value for the device.
      deriveRow: ({ field, value }: { field: string; value: any }) => {
        if (field === 'dash') return value ? { group: '' } : undefined;
        if (field === 'group') return value ? { dash: '' } : undefined;
        return undefined;
      },
    },
  };

  async function upsertDefault(deviceName: string, dash: string | null, group: string | null) {
    const existing = defaultsByName[deviceName];
    if (existing) {
      await updateDefault({ variables: { id: existing.id, update: { deviceName, dash, group } } });
    } else {
      await addDefault({ variables: { values: { deviceName, dash, group } } });
    }
  }

  async function handleSave() {
    if (!generalValid) {
      setSaveError('Please fix the highlighted fields on the General tab before saving.');
      return;
    }
    if (!gamepadValid) {
      setSaveError('Please fix the highlighted gamepad mappings before saving.');
      return;
    }
    setSaveError(null);

    try {
      await updateSettings({
        variables: {
          settings: {
            ...generalValues,
            steerMaxDeg,
            gamepadMappings,
            simdCommand,
            monocoqueCommand,
            huenicornCommand,
            // Explicit null (not '') clears back to unset — omitting the
            // field would mean "leave unchanged" per AppSettingsInput's
            // MaybeUndefined convention.
          },
        },
      });

      // Collect all device names that need a record: global default + all devices in the name map
      const allNames = new Set(['default', ...Object.values(deviceMap)]);

      for (const deviceName of allNames) {
        const local = localDefaults[deviceName];
        const dash = local?.dash || null;
        const group = local?.group || null;

        if (!dash && !group) {
          const existing = defaultsByName[deviceName];
          if (existing) {
            await removeDefault({ variables: { id: existing.id } });
          }
        } else {
          await upsertDefault(deviceName, dash, group);
        }
      }

      dismissModal();
    } catch (e: any) {
      setSaveError(e?.message ?? 'Save failed.');
    }
  }

  const currentName = settings.deviceMap?.[appId] ?? '';

  return (
    <Modal isOpen={isOpen} onDismiss={dismissModal} titleAriaId={'title'}>
      <Stack className={style.modalHeader}>
        <span id={'title'}>Settings</span>
      </Stack>
      <Stack className={style.modalBody}>
        {/* Fixed size so the dialog doesn't visibly resize switching between a
            sparse tab (Gamepad) and a dense one (Dashboards) — sized to comfortably
            fit the largest tab's content, with its own scroll for anything that
            still overflows (e.g. Clients with many connected devices). Width in
            particular matters here: without a cap, the Controller tab's flex:1
            range input has nothing to constrain it and blows the whole dialog
            out to almost double the width of every other tab. */}
        <div style={{ height: '43.75em', width: '34em', overflowY: 'auto' }}>
        <Pivot>
          <PivotItem headerText="General">
            {settings && (
              <Stack tokens={{ childrenGap: '0.77em' }} style={{ paddingTop: '0.77em' }}>
                <Form
                  form={userSettings(settings.deviceMap as Record<string, string>)}
                  name={'userSettings'}
                  initialValues={{
                    ...settings,
                    deviceMap: currentName,
                    themeMode: parseThemeKey(settings.theme).mode,
                    themeColor: parseThemeKey(settings.theme).color,
                  }}
                  onChange={(_name: string, { clean, isValid }: any) => {
                    const { themeColor, themeMode, ...rest } = clean;
                    setGeneralValues({ ...rest, theme: themeKey(themeMode, themeColor) });
                    setGeneralValid(isValid);
                  }}
                />
              </Stack>
            )}
          </PivotItem>

          <PivotItem headerText="Dashboards">
            <Stack tokens={{ childrenGap: '1em' }} style={{ paddingTop: '0.77em' }}>
              {/* ── Global default ────────────────────────────────────── */}
              {/* Keyed on the SERVER value, not local state: the old
                  `default-${localDefaults...}` hash remounted this Form on
                  every keystroke of its own edit. It now reseeds only when
                  the loaded record changes. */}
              <Form
                key={`default-${defaultsByName['default']?.dash ?? ''}`}
                form={{ dash: { type: 'select', label: 'Default dashboard', options: dashOptions } }}
                name="defaultDashboard"
                initialValues={{ dash: localDefaults['default']?.dash ?? '' }}
                onChange={(_n: string, { clean }: any) =>
                  setLocalDefaults(prev => ({ ...prev, default: { dash: clean.dash ?? '', group: '' } }))
                }
              />

              {/* ── Per-device overrides ──────────────────────────────── */}
              {/* One `list` field replaces the former "This device" +
                  "All devices" pair. Those were two editors over the SAME
                  DeviceDefault record whenever this device was named, each
                  with its own content-hash key. This device now simply sorts
                  to the top of the one list. */}
              <Stack tokens={{ childrenGap: '0.5em' }}>
                <span style={{ fontSize: '0.9em', fontWeight: 600 }}>Devices</span>
                {!currentName && (
                  <span style={{ fontSize: '0.78em', opacity: 0.5 }}>Set a device name in General to configure defaults for this device.</span>
                )}
                <Form
                  key={`devdefaults-${deviceDefaults.map(d => d.id).join(',')}`}
                  form={deviceOverridesSchema}
                  name="deviceOverrides"
                  initialValues={{ devices: deviceRows }}
                  onChange={(_n: string, { raw }: any) => {
                    const rows: DeviceRow[] = raw.devices ?? [];
                    setLocalDefaults(prev => {
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
          </PivotItem>

          <PivotItem headerText="Controller">
            <Stack tokens={{ childrenGap: '1em' }} style={{ paddingTop: '0.77em' }}>
              <Stack>
                <span style={{ fontSize: '0.78em', opacity: 0.65, marginBottom: 8 }}>
                  Total lock-to-lock degrees for your steering wheel. For example, enter 900 for a 900° wheel. The sim returns a normalised ±1.0 value — the app halves this to get per-side degrees for counter-rotation.
                </span>
                <Form
                  key={`steerMaxDeg-${settings.steerMaxDeg ?? 'default'}`}
                  form={{ steerMaxDeg: { type: 'slider', label: 'Steering wheel total rotation (degrees)', min: 90, max: 1440, step: 10 } }}
                  name="controllerSettings"
                  initialValues={{ steerMaxDeg }}
                  onChange={(_n: string, { clean }: any) => setSteerMaxDeg(clean.steerMaxDeg)}
                />
              </Stack>
              <Stack>
                <span style={{ fontSize: '0.82em', opacity: 0.6 }}>
                  This is the global default for counter-rotating dashboard elements. Individual components can override it in their properties panel.
                </span>
              </Stack>

              <Stack style={{ borderTop: `1px solid ${getTheme().palette.neutralLight}`, paddingTop: '1em' }}>
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
                      ? getTheme().palette.green
                      : udevStatus === 'missing'
                      ? getTheme().palette.redDark
                      : getTheme().palette.neutralSecondary,
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
                        background: getTheme().palette.themePrimary, color: '#fff',
                      }}
                    >
                      {udevWorking ? 'Installing…' : 'Install rule'}
                    </button>
                  )}
                </Stack>
                {udevMsg && (
                  <span style={{ fontSize: '0.78em', marginTop: 4, opacity: 0.75 }}>{udevMsg}</span>
                )}
              </Stack>
            </Stack>
          </PivotItem>

          <PivotItem headerText="Services">
            <Stack tokens={{ childrenGap: '1em' }} style={{ paddingTop: '0.77em' }}>
              <span style={{ fontSize: '0.78em', opacity: 0.65 }}>
                Commands the simd/monocoque/Huenicorn watchdogs use to launch each service
                when it's found not running. Defaults are bare, PATH-resolved binary names —
                override these if your install only exposes a service under a different name
                or a wrapper script (e.g. a distrobox-based install).
              </span>
              {/* Which set is live is decided by the build type, not a
                  toggle here (see service_commands.rs) — so the panel states
                  it rather than leaving it to be inferred. */}
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
                key={`services-${simdCommand}-${monocoqueCommand}-${huenicornCommand}`}
                form={{
                  simdCommand: { type: 'text', label: 'simd command', placeholder: 'simd' },
                  monocoqueCommand: { type: 'text', label: 'monocoque command', placeholder: 'monocoque play' },
                  huenicornCommand: { type: 'text', label: 'huenicorn command', placeholder: 'huenicorn' },
                }}
                name="servicesSettings"
                initialValues={{
                  simdCommand,
                  monocoqueCommand,
                  huenicornCommand,
                }}
                onChange={(_n: string, { clean }: any) => {
                  setSimdCommand(clean.simdCommand);
                  setMonocoqueCommand(clean.monocoqueCommand);
                  setHuenicornCommand(clean.huenicornCommand);
                }}
              />
            </Stack>
          </PivotItem>

          <PivotItem headerText="Day/Night">
            <Stack style={{ paddingTop: '0.77em' }}>
              <DayNightSimPanel />
            </Stack>
          </PivotItem>

          {/* Sits next to Services because it answers the same kind of
              question — is the thing this app depends on actually there —
              just for the game rather than for a companion process. */}
          <PivotItem headerText="Game">
            <Stack style={{ paddingTop: '0.77em' }}>
              <GameConfigPanel />
            </Stack>
          </PivotItem>

          <PivotItem headerText="Gamepad">
            <Stack tokens={{ childrenGap: '0.8em' }} style={{ paddingTop: '0.77em' }}>
              <span style={{ fontSize: '0.8em', opacity: 0.6 }}>
                Define named actions here, then assign them to button/slider/encoder controls on the canvas.
              </span>
              {/* One `list` field, replacing the previous row list + single
                  inline editor + editMapping draft state. Every row is now
                  expanded and editable in place rather than one at a time.
                  Keyed on the SERVER-side mappings, not local state, so
                  adding or removing a row doesn't remount mid-interaction —
                  it only reseeds when settings load or a save round-trips. */}
              <Form
                key={`gamepad-${(settings.gamepadMappings ?? []).map(m => m.id).join(',')}`}
                form={gamepadSchema}
                name="gamepadMappings"
                initialValues={{ mappings: gamepadMappings }}
                onChange={(_n: string, { raw, isValid }: any) => {
                  setGamepadMappings(raw.mappings ?? []);
                  setGamepadValid(isValid);
                }}
              />
            </Stack>
          </PivotItem>

          <PivotItem headerText="Clients">
            <Stack tokens={{ childrenGap: '0.5em' }} style={{ paddingTop: '0.77em' }}>
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
                        background: parseInt(client.lastSeen, 10) > Date.now() / 1000 - 60
                          ? '#4caf50'
                          : '#999',
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
          </PivotItem>
        </Pivot>
        </div>

        <Stack horizontal verticalAlign="center" tokens={{ childrenGap: '0.77em' }} style={{ paddingTop: '1em' }}>
          <PrimaryButton onClick={handleSave}>Save</PrimaryButton>
          {saveError && (
            <span style={{ fontSize: '0.82em', color: getTheme().palette.redDark }}>{saveError}</span>
          )}
        </Stack>
      </Stack>
    </Modal>
  );
};
export default Index;
