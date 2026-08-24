import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal, useMutation, useQuery, Stack, getStyle } from '../lib';
import { Pivot, PivotItem, getTheme } from '../../../lib';
import { userSettings } from './schema';
import { parseThemeKey, themeKey } from '../../../../themes';
import dispatcher, { ISettings, GamepadMapping } from '../../../lib/queries';
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
  const [udevStatus, setUdevStatus] = useState<'unknown' | 'installed' | 'missing'>('unknown');
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
  const [editMapping, setEditMapping] = useState<Partial<GamepadMapping> | null>(null);

  useEffect(() => {
    if (settings.gamepadMappings) setGamepadMappings(settings.gamepadMappings.map(stripTypename));
  }, [settings.gamepadMappings]);

  useEffect(() => {
    if (settings.steerMaxDeg != null) setSteerMaxDeg(settings.steerMaxDeg);
  }, [settings.steerMaxDeg]);

  const checkUdevStatus = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const ok = await invoke<boolean>('gamepad_udev_status');
      setUdevStatus(ok ? 'installed' : 'missing');
    } catch {
      setUdevStatus('unknown'); // running in browser, not Tauri
    }
  }, []);

  useEffect(() => { if (isOpen) checkUdevStatus(); }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInstallUdev = async () => {
    setUdevWorking(true);
    setUdevMsg(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<string>('setup_gamepad_udev');
      setUdevMsg(result === 'already-installed' ? 'Already installed.' : 'Rule installed — replug or re-login if needed.');
      setUdevStatus('installed');
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

  const groupOptions = [
    { value: '', text: '(none)' },
    ...groups.map(g => ({ value: g.name, text: g.name })),
  ];

  // dash and group are mutually exclusive (either pick a specific dashboard,
  // or a group whose members resolve their own) — whichever field the Form
  // just reported as changed (vs. the last-known value for this device)
  // wins, and clears the other.
  function setDashGroup(deviceName: string, next: { dash: string; group: string }) {
    setLocalDefaults(prev => {
      const cur = prev[deviceName] ?? { dash: '', group: '' };
      if (next.dash !== cur.dash) {
        return { ...prev, [deviceName]: { dash: next.dash, group: next.dash ? '' : cur.group } };
      }
      if (next.group !== cur.group) {
        return { ...prev, [deviceName]: { dash: next.group ? '' : cur.dash, group: next.group } };
      }
      return prev;
    });
  }

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
    setSaveError(null);

    try {
      await updateSettings({ variables: { settings: { ...generalValues, steerMaxDeg, gamepadMappings } } });

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
              <Form
                key={`default-${localDefaults['default']?.dash ?? ''}`}
                form={{ dash: { type: 'select', label: 'Default dashboard', options: dashOptions } }}
                name="defaultDashboard"
                initialValues={{ dash: localDefaults['default']?.dash ?? '' }}
                onChange={(_n: string, { clean }: any) => setDashGroup('default', { dash: clean.dash, group: '' })}
              />

              {/* ── This device ───────────────────────────────────────── */}
              <Stack tokens={{ childrenGap: '0.5em' }}>
                <span style={{ fontSize: '0.9em', fontWeight: 600 }}>This device</span>
                {!currentName ? (
                  <span style={{ fontSize: '0.78em', opacity: 0.5 }}>Set a device name in General to configure defaults for this device.</span>
                ) : (
                  <Stack horizontal tokens={{ childrenGap: 8 }}>
                    <Form
                      key={`device-${currentName}-${localDefaults[currentName]?.dash ?? ''}-${localDefaults[currentName]?.group ?? ''}`}
                      form={{
                        dash: { type: 'select', label: 'Dashboard override', options: dashOptions, styles: { root: { flex: 1 } } },
                        group: { type: 'select', label: 'Group (vehicle-specific)', options: groupOptions, styles: { root: { flex: 1 } } },
                      }}
                      name="thisDeviceDefault"
                      initialValues={{
                        dash: localDefaults[currentName]?.dash ?? '',
                        group: localDefaults[currentName]?.group ?? '',
                      }}
                      onChange={(_n: string, { clean }: any) => setDashGroup(currentName, clean)}
                    />
                  </Stack>
                )}
              </Stack>

              {/* ── All devices ───────────────────────────────────────── */}
              {Object.entries(deviceMap).length > 0 && (
                <Stack tokens={{ childrenGap: '0.5em' }}>
                  <span style={{ fontSize: '0.9em', fontWeight: 600 }}>All devices</span>
                  {Object.entries(deviceMap).map(([devId, devName]) => (
                    <Stack key={devId} tokens={{ childrenGap: 4 }} style={{ padding: '0.4em 0', borderBottom: '1px solid rgba(128,128,128,0.12)' }}>
                      <span style={{ fontSize: '0.8em', fontWeight: devId === appId ? 700 : 500, opacity: devId === appId ? 1 : 0.75 }}>
                        {devName || <span style={{ opacity: 0.5 }}>{devId.slice(0, 8)}</span>}
                        {devId === appId && <span style={{ fontWeight: 400, opacity: 0.5 }}> (this device)</span>}
                      </span>
                      {!devName ? (
                        <span style={{ fontSize: '0.75em', opacity: 0.45 }}>No name set</span>
                      ) : (
                        <Stack horizontal tokens={{ childrenGap: 8 }}>
                          <Form
                            key={`devrow-${devName}-${localDefaults[devName]?.dash ?? ''}-${localDefaults[devName]?.group ?? ''}`}
                            form={{
                              dash: { type: 'select', placeholder: 'Dashboard override', options: dashOptions, styles: { root: { flex: 1 } } },
                              group: { type: 'select', placeholder: 'Group override', options: groupOptions, styles: { root: { flex: 1 } } },
                            }}
                            name={`deviceDefault-${devName}`}
                            initialValues={{
                              dash: localDefaults[devName]?.dash ?? '',
                              group: localDefaults[devName]?.group ?? '',
                            }}
                            onChange={(_n: string, { clean }: any) => setDashGroup(devName, clean)}
                          />
                        </Stack>
                      )}
                    </Stack>
                  ))}
                </Stack>
              )}
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
                  A udev rule is required so the app can open <code>/dev/uinput</code> without root.
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
                    {udevStatus === 'installed' ? '✓ Rule installed'
                      : udevStatus === 'missing' ? '✗ Rule not found'
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

          <PivotItem headerText="Day/Night">
            <Stack style={{ paddingTop: '0.77em' }}>
              <DayNightSimPanel />
            </Stack>
          </PivotItem>

          <PivotItem headerText="Gamepad">
            {(() => {
              const theme = getTheme();
              const AXIS_LABELS = ['X', 'Y', 'Z', 'RX', 'RY', 'RZ'];
              const isEditing = editMapping !== null;
              const saveEdit = () => {
                if (!editMapping?.name?.trim()) return;
                const m: GamepadMapping = {
                  id: editMapping.id ?? `gp-${Date.now()}`,
                  name: editMapping.name.trim(),
                  mappingType: editMapping.mappingType ?? 'button',
                  index: editMapping.index ?? 0,
                };
                setGamepadMappings(prev =>
                  prev.some(x => x.id === m.id)
                    ? prev.map(x => x.id === m.id ? m : x)
                    : [...prev, m],
                );
                setEditMapping(null);
              };
              const editorSchema = {
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
                  label: editMapping?.mappingType === 'axis' ? 'Axis' : 'Button',
                  min: 0,
                  max: editMapping?.mappingType === 'axis' ? 5 : 31,
                  step: 1,
                },
              };
              const axisHint = editMapping?.mappingType === 'axis'
                ? AXIS_LABELS[editMapping.index ?? 0] ?? String(editMapping?.index ?? 0)
                : null;

              return (
                <Stack tokens={{ childrenGap: '0.8em' }} style={{ paddingTop: '0.77em' }}>
                  <span style={{ fontSize: '0.8em', opacity: 0.6 }}>
                    Define named actions here, then assign them to button/slider/encoder controls on the canvas.
                  </span>

                  {/* Mapping list */}
                  {gamepadMappings.length === 0 && !isEditing && (
                    <span style={{ fontSize: '0.82em', opacity: 0.5 }}>No mappings yet.</span>
                  )}
                  {gamepadMappings.map(m => (
                    <Stack key={m.id} horizontal verticalAlign="center" tokens={{ childrenGap: 6 }}
                      style={{ padding: '4px 0', borderBottom: `1px solid ${theme.palette.neutralLight}` }}
                    >
                      <span style={{ flex: 1, fontSize: '0.85em' }}>{m.name}</span>
                      <span style={{ fontSize: '0.75em', opacity: 0.55, minWidth: 64 }}>
                        {m.mappingType === 'button'
                          ? `btn ${m.index}`
                          : `axis ${AXIS_LABELS[m.index] ?? m.index}`}
                      </span>
                      <button onClick={() => setEditMapping({ ...m })}
                        style={{ padding: '1px 7px', fontSize: '0.75em', cursor: 'pointer', border: 'none', borderRadius: 3, background: theme.palette.neutralLighter }}>
                        Edit
                      </button>
                      <button onClick={() => setGamepadMappings(prev => prev.filter(x => x.id !== m.id))}
                        style={{ padding: '1px 7px', fontSize: '0.75em', cursor: 'pointer', border: 'none', borderRadius: 3, background: theme.palette.redDark, color: '#fff' }}>
                        ✕
                      </button>
                    </Stack>
                  ))}

                  {/* Inline editor */}
                  {isEditing ? (
                    <Stack tokens={{ childrenGap: 6 }} style={{ padding: '8px', background: theme.palette.neutralLighterAlt, borderRadius: 4 }}>
                      <Form
                        key={`${editMapping?.id ?? 'new'}-${editMapping?.mappingType ?? 'button'}`}
                        form={editorSchema}
                        name="gamepadMappingEditor"
                        initialValues={{
                          name: editMapping?.name ?? '',
                          mappingType: editMapping?.mappingType ?? 'button',
                          index: editMapping?.index ?? 0,
                        }}
                        onChange={(_n: string, { clean }: any) => {
                          setEditMapping(prev => {
                            const typeChanged = !!prev && clean.mappingType !== prev.mappingType;
                            return { ...prev, ...clean, index: typeChanged ? 0 : clean.index };
                          });
                        }}
                      />
                      {axisHint && (
                        <span style={{ fontSize: '0.75em', opacity: 0.6 }}>{axisHint}</span>
                      )}
                      <Stack horizontal tokens={{ childrenGap: 6 }}>
                        <button onClick={saveEdit}
                          disabled={!editMapping?.name?.trim()}
                          style={{ padding: '3px 12px', cursor: 'pointer', border: 'none', borderRadius: 3, background: theme.palette.themePrimary, color: '#fff', fontSize: '0.82em' }}>
                          Save
                        </button>
                        <button onClick={() => setEditMapping(null)}
                          style={{ padding: '3px 10px', cursor: 'pointer', border: 'none', borderRadius: 3, background: theme.palette.neutralLighter, fontSize: '0.82em' }}>
                          Cancel
                        </button>
                      </Stack>
                    </Stack>
                  ) : (
                    <button
                      onClick={() => setEditMapping({ mappingType: 'button', index: 0, name: '' })}
                      style={{ alignSelf: 'flex-start', padding: '3px 10px', cursor: 'pointer', border: 'none', borderRadius: 3, background: theme.palette.neutralLight, fontSize: '0.82em' }}
                    >
                      + Add mapping
                    </button>
                  )}
                </Stack>
              );
            })()}
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
