// The contract between the core and a skin (a UI-kit package such as
// denim-fabric, or your own).
//
// A skin's shell is a component taking DenimShellProps (the provider's props
// plus its own) that renders <DenimProvider> and, inside it:
//
//   1. a splash while `useDenim().status !== "ready"` ("waiting" means the
//      backend is down and Denim is polling it); RootComponent, if given,
//      stands in for the splash;
//   2. the theme for `settings.theme` ("<mode>-<color>") and
//      `settings.fontSize`, in the skin's own UI kit;
//   3. chrome (header, sidebar, ...) from useApplications() and useNav(),
//      hidden when `useNav().showChrome` is false (kiosk routes, landing
//      pages);
//   4. <DenimRoutes wrap={...} /> for the content;
//   5. a Settings dialog driven by useSettingsForm(), rendering each
//      extension tab's `Component` with its `props`.
//
// Everything else (look, layout, breakpoints, icons, motion) is the skin's
// choice; a skin that animates turns its motion off while
// useReducedMotion() is true.
import type { DenimProviderProps } from './DenimProvider';

/** Props every shell accepts: the provider's, minus children. */
export type DenimShellProps = Omit<DenimProviderProps, 'children'>;

const PROVIDER_KEYS = [
  'components',
  'applications',
  'applicationFields',
  'settingsSource',
  'defaultSettings',
  'settingsFields',
  'settingsTabs',
  'settingsGeneralFields',
  'RootComponent',
  'defaultGroup',
  'useAppStatus',
] as const satisfies readonly (keyof DenimShellProps)[];

/**
 * Splits a shell's props into the provider's and the skin's own:
 * `const [core, own] = splitShellProps(props)`.
 */
export function splitShellProps<P extends DenimShellProps>(
  props: P,
): [DenimShellProps, Omit<P, keyof DenimShellProps>] {
  const core: Record<string, unknown> = {};
  const own: Record<string, unknown> = {};
  Object.entries(props).forEach(([k, v]) => {
    if ((PROVIDER_KEYS as readonly string[]).includes(k)) core[k] = v;
    else own[k] = v;
  });
  return [core as DenimShellProps, own as Omit<P, keyof DenimShellProps>];
}
