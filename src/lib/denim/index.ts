// denim: the headless core of the Denim app shell. No UI-kit imports; a skin
// such as denim-fabric (Fluent UI) renders it. See README and
// .claude/skills/denim-app-shell.

// Provider, context and the skin contract
export { DenimProvider, DenimContext } from './DenimProvider';
export type {
  DenimProviderProps,
  IDenimContext,
  DenimAppComponent,
  IAppStatus,
  AppStatusTone,
} from './DenimProvider';
export { splitShellProps } from './contract';
export type { DenimShellProps } from './contract';

// Hooks
export {
  useDenim,
  useApplications,
  useNav,
  useSettings,
  useAppStatus,
  useReportAppStatus,
  useReducedMotion,
} from './hooks';

// Routing
export { DenimRoutes, AppElement, AppDefaultRedirect } from './DenimRoutes';
export type { DenimRoutesProps, IRouteContext } from './DenimRoutes';

// Nav model (pure)
export { computeNav, groupApplications, isLinkActive, appUrl, linkUrl } from './nav';
export type { INavState, IApplicationGroup } from './nav';

// Settings
export {
  useSettingsForm,
  generalSettingsSchema,
  generalSettingsValues,
  changedSettings,
  sameSettingValue,
} from './settingsForm';
export type { ISettingsForm, ISettingsFormTab, ISettingsFieldMapping } from './settingsForm';
export type { IDenimSettings, ILocalSettings } from './lib/localSettings';
export {
  DEFAULT_SETTINGS,
  DEVICE_SETTINGS,
  readLocalSettings,
  splitDeviceSettings,
  writeLocalSettings,
} from './lib/localSettings';
export type { ISettingsTab, ISettingsTabProps, ISettingsExtensions } from './lib/settingsExtensions';

// Theme-key vocabulary (the colours themselves belong to a skin)
export * from './themes';

// Server contract, health, page reset
export * from './lib/queries';
export { default as denimDispatcher } from './lib/queries';
export { useHealthPoll, pingServer } from './lib/health';
export { applyPageReset } from './lib/pageReset';
export { default as useWindowDimensions } from './lib/useWindowDimensions';
