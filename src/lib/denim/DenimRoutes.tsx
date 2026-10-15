// Denim's routing: one route per application at `/<path>/*`, the same
// component header-less at `/kiosk/<path>/*`, a `defaultRoute` redirect that
// leaves deep links alone, and the `/` page. Headless: a skin wraps each
// route's content in its own layout through `wrap`.
import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useDenim } from './hooks';
import type { IApplication } from './lib/queries';

export interface IRouteContext {
  /** The application this route renders; undefined for the `/` page. */
  app?: IApplication;
  /** A `/kiosk/<path>/*` route (no chrome). */
  kiosk: boolean;
}

export interface DenimRoutesProps {
  /** Wraps each route's content in the skin's layout (padding, scroll area). */
  wrap?: (content: React.ReactNode, ctx: IRouteContext) => React.ReactNode;
  /**
   * Replaces the `/` page. By default: RootComponent if given, else a
   * redirect to the launch page, else `welcome`.
   */
  home?: React.ReactNode;
  /** Shown at `/` when there is no RootComponent and no launch page. */
  welcome?: React.ReactNode;
}

// Renders an app's `defaultRoute` redirect ONLY when the browser is actually
// at that app's root.
//
// The routes below are `${app.path}/*`, so their element renders for every
// route underneath them too. A bare <Navigate> there fired on deep links as
// well as on the root: opening /dashboards/dashboards/963/show redirected
// straight back to /dashboards/dashboards, making every dashboard
// unreachable.
//
// `replace` so a redirect that does fire doesn't leave the app root in
// history for Back to bounce off.
export const AppDefaultRedirect: React.FC<{ path: string; defaultRoute: string }> = ({
  path,
  defaultRoute,
}) => {
  const { pathname } = useLocation();
  if (pathname.replace(/\/+$/, '') !== `/${path}`) return null;
  return <Navigate to={`/${path}/${defaultRoute}`} replace />;
};

// Module level, so its identity is stable: a component defined inside render
// is a new type every render and remounts its whole subtree each time.
const Empty: React.FC = () => null;

/** One application's content: its default-route redirect and its component. */
export const AppElement: React.FC<{ app: IApplication; kiosk?: boolean }> = ({ app, kiosk }) => {
  const { components } = useDenim();
  const Component = components[app.frontEnd] ?? Empty;
  return (
    <>
      {app.defaultRoute && (
        <AppDefaultRedirect
          path={kiosk ? `kiosk/${app.path}` : app.path}
          defaultRoute={app.defaultRoute}
        />
      )}
      <Component app={app} />
    </>
  );
};

const identity = (content: React.ReactNode) => content;

export const DenimRoutes: React.FC<DenimRoutesProps> = ({ wrap = identity, home, welcome }) => {
  const { applications, RootComponent, settings } = useDenim();

  const defaultHome = RootComponent ? (
    <RootComponent />
  ) : settings.launchPage ? (
    <Navigate to={`/${settings.launchPage}`} />
  ) : (
    welcome ?? <h1>Welcome. Pick an application to begin.</h1>
  );

  return (
    <Routes>
      {/* No 404: anything that isn't an application is the `/` page. */}
      <Route path="*" element={wrap(home ?? defaultHome, { kiosk: false })} />
      {applications.map(app => (
        <Route
          key={app.path}
          path={`${app.path}/*`}
          // Keyed, so two applications sharing a component never share its state.
          element={wrap(<AppElement key={app.path} app={app} />, { app, kiosk: false })}
        />
      ))}
      {applications.map(app => (
        <Route
          key={`kiosk/${app.path}`}
          // `/*`, matching the route above: without it every kiosk deep link
          // (/kiosk/dashboards/dashboards/963/show) fell through to the
          // catch-all, and the default-route redirect walked bare
          // /kiosk/<path> straight off the route it had just arrived on.
          path={`kiosk/${app.path}/*`}
          element={wrap(<AppElement key={app.path} app={app} kiosk />, { app, kiosk: true })}
        />
      ))}
    </Routes>
  );
};

export default DenimRoutes;
