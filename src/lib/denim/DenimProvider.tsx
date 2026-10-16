// The headless core of Denim: one provider that owns the application
// registry, the settings store and the backend's health, and hands them to a
// skin through hooks (hooks.ts). It renders no markup of its own; a skin
// (a denim-fabric bar such as denim-fabric-topbar or denim-fabric-sidebar,
// or your own) draws everything.
import React from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { IApplication, IMy, UPDATE_SETTINGS, buildMyQuery } from './lib/queries';
import { useHealthPoll } from './lib/health';
import { IDenimSettings, readLocalSettings, splitDeviceSettings, writeLocalSettings } from './lib/localSettings';
import { ISettingsTab } from './lib/settingsExtensions';
import { applyPageReset } from './lib/pageReset';

applyPageReset();

/** The component a shell renders for an application, at `/<path>/*`. */
export type DenimAppComponent = React.ComponentType<{ app: IApplication }>;

/** A status dot for one application in the nav. */
export type AppStatusTone = 'ok' | 'warning' | 'error' | 'busy' | 'off';
export interface IAppStatus {
  tone: AppStatusTone;
  /** Accessible text, e.g. "Wheelbase disconnected". */
  label?: string;
}

export interface DenimProviderProps {
  /** Maps each application's `frontEnd` to the component rendered at `/<path>/*`. */
  components?: Record<string, DenimAppComponent>;
  /**
   * A static app list. When given, Denim does not query `my.applications`;
   * with settingsSource "local" as well, it sends no request at all.
   */
  applications?: IApplication[];
  /**
   * Extra `Application` fields to select from `my.applications`, e.g.
   * "group icon" (see OPTIONAL_APPLICATION_FIELDS). The backend must have
   * them. Ignored when `applications` is given.
   */
  applicationFields?: string;
  /** Where settings live: browser localStorage (default) or the backend's `my.settings`. */
  settingsSource?: 'local' | 'server';
  /** Initial values before anything is saved, e.g. `{ theme: "light-blue", launchPage: "projects" }`. */
  defaultSettings?: Partial<IDenimSettings>;
  /** Extra AppSettings fields selected in `my.settings` (settingsSource "server") for your settings tabs. */
  settingsFields?: string;
  /** Extra tabs in the Settings dialog. */
  settingsTabs?: ISettingsTab[];
  /** Extra per-form fields appended to the Settings dialog's General tab. */
  settingsGeneralFields?: Record<string, any>;
  /**
   * Shown at `/` (and while `my` loads) instead of the launch-page redirect;
   * chrome is hidden on every non-application route.
   */
  RootComponent?: React.ComponentType<any>;
  /** Group heading for applications without `group`. Default "Applications". */
  defaultGroup?: string;
  /**
   * Optional hook giving an application's status dot, called once per
   * application in the nav, e.g. from a live query. Pass a stable function
   * (module level): it is called as a hook.
   */
  useAppStatus?: (app: IApplication) => IAppStatus | AppStatusTone | undefined | null;
  children?: React.ReactNode;
}

/** Everything a skin reads. Use the narrower hooks in hooks.ts where they fit. */
export interface IDenimContext {
  /** The registered applications, in configured order ([] while loading). */
  applications: IApplication[];
  components: Record<string, DenimAppComponent>;
  RootComponent?: React.ComponentType<any>;
  defaultGroup: string;
  /**
   * "loading": the first `my` fetch is in flight. "waiting": it failed and
   * Denim is polling the backend until it answers. "ready": render the app.
   * Always "ready" when nothing needs the backend.
   */
  status: 'loading' | 'waiting' | 'ready';
  ready: boolean;
  settings: IDenimSettings;
  settingsSource: 'local' | 'server';
  /** Merges `values` into the settings and persists them (localStorage or `updateSettings`). */
  saveSettings: (values: Record<string, any>) => Promise<void>;
  settingsTabs: ISettingsTab[];
  settingsGeneralFields?: Record<string, any>;
  useAppStatus?: DenimProviderProps['useAppStatus'];
}

export const DenimContext = React.createContext<IDenimContext | null>(null);

interface IAppStatusStore {
  reported: Record<string, IAppStatus | undefined>;
  report: (appPath: string, status: IAppStatus | undefined) => void;
}
export const AppStatusContext = React.createContext<IAppStatusStore>({
  reported: {},
  report: () => {},
});

// Drops nulls so an unset server field falls back to the default instead of
// overriding it with null.
function withoutNulls(obj: Record<string, any> | null | undefined) {
  const out: Record<string, any> = {};
  Object.entries(obj ?? {}).forEach(([k, v]) => {
    if (v !== null && v !== undefined) out[k] = v;
  });
  return out;
}

const NO_COMPONENTS: Record<string, DenimAppComponent> = {};
const NO_TABS: ISettingsTab[] = [];

export const DenimProvider: React.FC<DenimProviderProps> = ({
  components = NO_COMPONENTS,
  applications: staticApplications,
  applicationFields = '',
  settingsSource = 'local',
  defaultSettings,
  settingsFields = '',
  settingsTabs = NO_TABS,
  settingsGeneralFields,
  RootComponent,
  defaultGroup = 'Applications',
  useAppStatus,
  children,
}) => {
  const serverSettings = settingsSource === 'server';
  const queryApplications = !staticApplications;
  // Nothing to ask the backend: render immediately, no `my` request.
  const needsMy = queryApplications || serverSettings;
  const myQuery = React.useMemo(
    () =>
      buildMyQuery({
        applications: queryApplications,
        settings: serverSettings,
        settingsFields,
        applicationFields,
      }),
    [queryApplications, serverSettings, settingsFields, applicationFields],
  );
  const myResult = useQuery<IMy>(myQuery, { skip: !needsMy });
  const { loading, data } = myResult;
  const refetch = myResult.refetch;

  // localStorage holds the settings in "local" mode, and in "server" mode
  // caches the last-seen ones so the first paint is already themed.
  const [localSettings, setLocalSettings] = React.useState<IDenimSettings>(() =>
    readLocalSettings(defaultSettings),
  );
  const serverValues = data?.my?.settings;
  // Device settings (DEVICE_SETTINGS, e.g. reduceMotion) come from this
  // browser even in server mode.
  const settings: IDenimSettings = React.useMemo(
    () =>
      serverSettings && serverValues
        ? {
            ...readLocalSettings(defaultSettings),
            ...withoutNulls(serverValues),
            ...splitDeviceSettings(localSettings)[0],
          }
        : localSettings,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverSettings, serverValues, localSettings],
  );
  React.useEffect(() => {
    if (serverSettings && serverValues) {
      const { launchPage, theme, fontSize } = settings;
      writeLocalSettings({ ...splitDeviceSettings(localSettings)[0], launchPage, theme, fontSize });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSettings, serverValues]);

  const [updateSettings] = useMutation(UPDATE_SETTINGS, {
    // The settings object usually has no `id`, so Apollo can't merge the
    // mutation result into the cached `my`; refetch it instead.
    refetchQueries: [{ query: myQuery }],
    awaitRefetchQueries: true,
  });
  const saveSettings = React.useCallback(
    async (values: Record<string, any>) => {
      if (serverSettings) {
        // Device settings stay in this browser; the rest goes to the server.
        const [device, rest] = splitDeviceSettings(values);
        if (Object.keys(device).length) {
          // Into the stored copy, which also caches the server's last-seen
          // theme for the first paint (the state here may predate it).
          writeLocalSettings({ ...readLocalSettings(defaultSettings), ...device });
          setLocalSettings(prev => ({ ...prev, ...device }));
        }
        if (Object.keys(rest).length) await updateSettings({ variables: { settings: rest } });
      } else {
        setLocalSettings(prev => {
          const next = { ...prev, ...values };
          writeLocalSettings(next);
          return next;
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverSettings, updateSettings],
  );

  // Covers two related startup/reconnect races: a desktop webview loading
  // before its bundled backend has started (the first `my` fetch fails,
  // `loading` settles to false with no data, and nothing would ever retry
  // it), and a client whose connection drops mid-session. Only active once
  // the fetch has actually finished failing, not during the first load.
  const waiting = needsMy && !loading && !data;
  useHealthPoll(waiting, () => {
    refetch();
  });
  const ready = !needsMy || !!data;
  const status: IDenimContext['status'] = ready ? 'ready' : waiting ? 'waiting' : 'loading';

  const queriedApplications = data?.my?.applications;
  const applications: IApplication[] = React.useMemo(
    () => staticApplications ?? queriedApplications ?? [],
    [staticApplications, queriedApplications],
  );

  const value: IDenimContext = React.useMemo(
    () => ({
      applications,
      components,
      RootComponent,
      defaultGroup,
      status,
      ready,
      settings,
      settingsSource,
      saveSettings,
      settingsTabs,
      settingsGeneralFields,
      useAppStatus,
    }),
    [
      applications, components, RootComponent, defaultGroup, status, ready, settings,
      settingsSource, saveSettings, settingsTabs, settingsGeneralFields, useAppStatus,
    ],
  );

  // App-reported status dots live in their own context, so a report only
  // re-renders the nav items that read them.
  const [reported, setReported] = React.useState<Record<string, IAppStatus | undefined>>({});
  const report = React.useCallback((appPath: string, next: IAppStatus | undefined) => {
    setReported(prev =>
      prev[appPath]?.tone === next?.tone && prev[appPath]?.label === next?.label
        ? prev
        : { ...prev, [appPath]: next },
    );
  }, []);
  const statusStore = React.useMemo(() => ({ reported, report }), [reported, report]);

  return (
    <DenimContext.Provider value={value}>
      <AppStatusContext.Provider value={statusStore}>{children}</AppStatusContext.Provider>
    </DenimContext.Provider>
  );
};

export default DenimProvider;
