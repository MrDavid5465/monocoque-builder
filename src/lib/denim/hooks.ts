// The hooks a skin (or an app) reads Denim through. All of them need a
// <DenimProvider> above them.
import React from 'react';
import { useLocation } from 'react-router-dom';
import {
  AppStatusContext,
  AppStatusTone,
  DenimContext,
  IAppStatus,
  IDenimContext,
} from './DenimProvider';
import type { IApplication } from './lib/queries';
import { computeNav, groupApplications, appUrl, linkUrl, isLinkActive, INavState } from './nav';

/** The whole core state. Throws outside a <DenimProvider>. */
export function useDenim(): IDenimContext {
  const ctx = React.useContext(DenimContext);
  if (!ctx) throw new Error('useDenim() must be used inside <DenimProvider> (or a shell such as TopBarShell).');
  return ctx;
}

/** The application registry, flat and grouped by `app.group`. */
export function useApplications() {
  const { applications, defaultGroup, ready } = useDenim();
  const groups = React.useMemo(
    () => groupApplications(applications, defaultGroup),
    [applications, defaultGroup],
  );
  return { applications, groups, ready };
}

/**
 * Where the URL is: the active application and link (whole-segment
 * matching), whether chrome should show, and URL builders.
 */
export function useNav(): INavState & {
  appUrl: typeof appUrl;
  linkUrl: typeof linkUrl;
  isAppActive: (app: IApplication) => boolean;
  isLinkActive: (app: IApplication, linkPath: string) => boolean;
} {
  const { pathname } = useLocation();
  const { applications, RootComponent } = useDenim();
  const state = React.useMemo(
    () => computeNav(pathname, applications, !!RootComponent),
    [pathname, applications, RootComponent],
  );
  return React.useMemo(
    () => ({
      ...state,
      appUrl,
      linkUrl,
      isAppActive: (app: IApplication) => state.activeApp?.path === app.path,
      isLinkActive: (app: IApplication, linkPath: string) =>
        isLinkActive(state.isKiosk ? pathname.replace(/^\/kiosk/, '') : pathname, app.path, linkPath),
    }),
    [state, pathname],
  );
}

/** The settings store and its extension points (as data). */
export function useSettings() {
  const { settings, saveSettings, settingsSource, settingsTabs, settingsGeneralFields } = useDenim();
  return { settings, saveSettings, settingsSource, settingsTabs, settingsGeneralFields };
}

const toStatus = (s: IAppStatus | AppStatusTone | undefined | null): IAppStatus | undefined =>
  !s ? undefined : typeof s === 'string' ? { tone: s } : s;

/**
 * An application's status dot: what the application reported through
 * useReportAppStatus, else what the provider's `useAppStatus` hook returns.
 * Call it once per application, in a component of its own (it calls the
 * provider's hook).
 */
export function useAppStatus(app: IApplication): IAppStatus | undefined {
  const { useAppStatus: hook } = useDenim();
  const { reported } = React.useContext(AppStatusContext);
  // The provider's hook must be a stable function for the provider's whole
  // life, so this call is unconditional in practice.
  const fromHook = hook ? hook(app) : undefined;
  return reported[app.path] ?? toStatus(fromHook);
}

/**
 * Lets an application publish its own status dot, e.g. from its component:
 * `useReportAppStatus(app.path, connected ? 'ok' : 'error')`. The last report
 * stays after the component unmounts; report `undefined` to clear it.
 */
export function useReportAppStatus(
  appPath: string,
  status: IAppStatus | AppStatusTone | undefined | null,
): void {
  const { report } = React.useContext(AppStatusContext);
  const next = toStatus(status);
  const tone = next?.tone;
  const label = next?.label;
  React.useEffect(() => {
    report(appPath, tone ? { tone, label } : undefined);
  }, [appPath, tone, label, report]);
}

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';
const subscribeReduce = (onChange: () => void) => {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(REDUCE_QUERY);
  mq.addEventListener?.('change', onChange);
  return () => mq.removeEventListener?.('change', onChange);
};
const osPrefersReduced = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(REDUCE_QUERY).matches;

/**
 * True when the skin should not animate: the `reduceMotion` setting (per
 * device, see DEVICE_SETTINGS) or the OS's "reduce motion" preference.
 * Follows changes to either. Works outside a <DenimProvider> too (OS only).
 */
export function useReducedMotion(): boolean {
  const ctx = React.useContext(DenimContext);
  const os = React.useSyncExternalStore(subscribeReduce, osPrefersReduced, () => false);
  return os || !!ctx?.settings.reduceMotion;
}
