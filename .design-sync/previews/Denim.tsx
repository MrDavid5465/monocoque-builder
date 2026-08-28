import * as React from 'react';
import { MockedProvider } from '@apollo/client/testing/react';
import { Denim, denimDispatcher, Logo } from 'denim';

// The whole application shell: it fetches `my` (applications + settings),
// loads the theme from those settings, renders the Header, and routes each
// application to a component from the `components` registry keyed by the
// application's `frontEnd`.
//
// The mock uses denimDispatcher.my — the shell's own document. MockedProvider
// matches on document identity, so an equivalent hand-written query wouldn't
// match and the shell would sit on its Splashscreen forever.

const settings = {
  launchPage: '',
  theme: 'default',
  fontSize: 1,
  deviceMap: null,
  typiqlDataDir: '',
  steerMaxDeg: 900,
  setupComplete: true,
  shakerDspEnabled: true,
  shakerLfeSourceDevice: 'Surround',
  shakerLfeLpfHz: 120,
  huenicornEnabled: true,
  ambientTintIntensity: 0.3,
  ambientPrimaryChannel: 1,
  ambientSaturationBoost: 2,
  ambientChannelGamma: null,
  simdCommand: 'simd',
  monocoqueCommand: 'monocoque play',
  huenicornCommand: 'huenicorn',
  simdDebugCommand: null,
  monocoqueDebugCommand: null,
  huenicornDebugCommand: null,
  debugBuild: false,
  gamepadMappings: [],
};

const applications = [
  { path: 'telemetryadmin', defaultRoute: '', name: 'Telemetry Admin', links: [], frontEnd: 'TelemetryAdmin' },
  { path: 'shakers', defaultRoute: '', name: 'Shakers', links: [], frontEnd: 'Shakers' },
  { path: 'ambientlights', defaultRoute: '', name: 'Ambient Lights', links: [], frontEnd: 'AmbientLights' },
];

const mocks = [
  {
    request: { query: denimDispatcher.my },
    result: { data: { my: { applications, settings } } },
    delay: 0,
  },
];

const themes = { default: () => ({}) };

// No launchPage and no RootComponent: the shell shows its own welcome state.
export const AppShell = () => (
  <MockedProvider mocks={mocks} addTypename={false}>
    <Denim themes={themes} Logo={Logo} />
  </MockedProvider>
);

// A RootComponent fills the content area under the header — how a real app
// puts its landing screen in place.
export const WithRootComponent = () => (
  <MockedProvider mocks={mocks} addTypename={false}>
    <Denim
      themes={themes}
      Logo={Logo}
      RootComponent={() => (
        <div style={{ padding: 24 }}>
          <h2 style={{ marginTop: 0 }}>Sim rig</h2>
          <p style={{ opacity: 0.7 }}>Telemetry, shakers and ambient lighting in one place.</p>
        </div>
      )}
    />
  </MockedProvider>
);
