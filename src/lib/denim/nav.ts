// The nav model: which application and link the URL is on. Pure functions of
// (pathname, applications), so a skin, a test or a server can use them
// without React. `useNav()` (hooks.ts) is the React wrapper.
import type { IApplication, ILink } from './lib/queries';

const trimSlashes = (p: string) => p.replace(/\/+$/, '');

/** `/<app.path>` */
export const appUrl = (app: IApplication): string => `/${app.path}`;

/** `/<app.path>/<link.path>`, or the app root for an empty link path. */
export const linkUrl = (app: IApplication, link: ILink): string =>
  link.path ? `/${app.path}/${link.path}` : `/${app.path}`;

/**
 * A link is active on its own page and the pages under it, matched by whole
 * path segments: "check" must not light up on "checks". A link to the app
 * root ("") is active only on the root itself, or it would match every page.
 */
export function isLinkActive(pathname: string, appPath: string, linkPath: string): boolean {
  const base = trimSlashes(`/${appPath}${linkPath ? `/${linkPath}` : ''}`);
  const path = trimSlashes(pathname);
  return linkPath ? path === base || path.startsWith(`${base}/`) : path === base;
}

export interface INavState {
  /** The current location's pathname. */
  pathname: string;
  /** On a `/kiosk/<path>/*` route (chrome hidden). */
  isKiosk: boolean;
  /** The application whose `/<path>/*` (or `/kiosk/<path>/*`) the URL is in. */
  activeApp?: IApplication;
  /** The most specific active link of `activeApp` (longest matching path). */
  activeLink?: ILink;
  /**
   * Whether a skin should draw its chrome (header, sidebar): not on kiosk
   * routes, and not on non-application routes when the app has a
   * RootComponent (a landing page isn't designed to sit under app chrome).
   */
  showChrome: boolean;
}

/** Whole-segment match of the first path segment (the second under /kiosk). */
export function computeNav(
  pathname: string,
  applications: IApplication[],
  hasRootComponent: boolean,
): INavState {
  const segments = pathname.split('/').filter(Boolean);
  const isKiosk = segments[0] === 'kiosk';
  const appSegment = (isKiosk ? segments[1] : segments[0]) ?? '';
  const activeApp = applications.find(a => a.path === appSegment);
  const innerPath = isKiosk ? `/${segments.slice(1).join('/')}` : pathname;
  const activeLink = activeApp
    ? (activeApp.links ?? [])
        .filter(l => isLinkActive(innerPath, activeApp.path, l.path))
        .sort((a, b) => b.path.length - a.path.length)[0]
    : undefined;
  const showChrome = !isKiosk && (!!activeApp || !hasRootComponent);
  return { pathname, isKiosk, activeApp, activeLink, showChrome };
}

export interface IApplicationGroup {
  /** The group heading: `app.group`, or the shell's default group. */
  name: string;
  applications: IApplication[];
}

/**
 * Groups applications by `app.group`, keeping the configured order: groups
 * appear in the order of their first application, and applications keep
 * their order within a group. Applications without a group go under
 * `defaultGroup`, which is ordered like any other group.
 */
export function groupApplications(
  applications: IApplication[],
  defaultGroup: string,
): IApplicationGroup[] {
  const groups: IApplicationGroup[] = [];
  for (const app of applications) {
    const name = app.group?.trim() || defaultGroup;
    let group = groups.find(g => g.name === name);
    if (!group) {
      group = { name, applications: [] };
      groups.push(group);
    }
    group.applications.push(app);
  }
  return groups;
}
