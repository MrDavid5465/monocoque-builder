import * as React from 'react';
import { Header, Logo } from 'denim';

// The app chrome: brand, the application nav built from `my.applications`,
// and the settings/controls cluster. `my` is the same payload the app's own
// `my` query returns — applications drive the nav, settings drive theming.
//
// Note the application list is NOT visible in the bar: it lives behind the
// waffle/hamburger panel, which opens on click. So there is no static cell
// contrasting populated vs empty applications — they render identically.

const my = {
  settings: { theme: 'default', fontSize: 1, launchPage: 'dashboards' },
  applications: [
    { name: 'Dashboards', path: 'dashboards', frontEnd: 'Dashboards', defaultRoute: 'dashboards', links: [] },
    { name: 'Shakers', path: 'shakers', frontEnd: 'Shakers', defaultRoute: '', links: [] },
    { name: 'Ambient Lights', path: 'ambientlights', frontEnd: 'AmbientLights', defaultRoute: '', links: [] },
  ],
};

const themes = { default: () => ({}) };

export const WithApplications = () => <Header my={my} themes={themes} />;

// A brand slot replaces the default mark; Controls adds app-specific
// actions to the right-hand cluster.
export const WithBrandAndControls = () => (
  <Header
    my={my}
    themes={themes}
    Brand={() => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
        <Logo style={{ width: 22, height: 22 }} />
        Sim Rig
      </span>
    )}
    Controls={() => <span style={{ fontSize: 12, opacity: 0.7 }}>Session: Silverstone</span>}
  />
);

