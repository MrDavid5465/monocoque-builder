import React, { useCallback, useContext, useEffect, useState } from "react";
import "./App.css";

import Logo from "./Logo";
import { Link, Navigate, useLocation } from "react-router-dom";
import Shell from "./lib/denim-fabric-sidebar";
import type { IApplication, IAppStatus } from "./lib/denim-fabric";
import { ConfirmDialogHost } from "./lib/denim-fabric/shared/ConfirmDialog";

import Shakers from "./components/Shakers"
import LedsDevices from "./components/LedsDevices";
import ShiftLights from "./components/ShiftLights";
import SimWindDevices from "./components/SimWindDevices";
import AmbientLights from "./components/AmbientLights";
import Dashboards from "./components/Dashboards";
import TelemetryControls, { DotMode, MODE_TITLE } from "./components/Telemetry/Controls";
import { useMutation, useQuery } from "@apollo/client/react";
import { HEARTBEAT_CLIENT } from "./components/Telemetry/clientsQueries";
import { getAppId } from "./graphql/client";
import dispatcher, { IMy, SETTINGS_FIELDS, APPLICATION_FIELDS } from "./graphql/appSettings";
import SetupWizard from "./components/Onboarding/SetupWizard";
import { settingsTabs } from "./components/Settings/settingsTabs";
import { LiveUpdatesProvider } from "./components/Telemetry/liveUpdatesHub";
import { HubSubscriptionRouter } from "./components/Telemetry/hubSubscriptionRouter";

const ClientHeartbeat: React.FC = () => {
  const [heartbeat] = useMutation(HEARTBEAT_CLIENT);
  useEffect(() => {
    const id = getAppId();
    heartbeat({ variables: { id } });
    const interval = setInterval(() => heartbeat({ variables: { id } }), 30000);
    return () => clearInterval(interval);
  }, [heartbeat]);
  return null;
};

const SetupGuard: React.FC = () => {
  const { data, loading } = useQuery<IMy>(dispatcher.my, { fetchPolicy: 'cache-first' });
  const [wizardDone, setWizardDone] = React.useState(false);
  if (loading || wizardDone || !data) return null;
  const setupComplete = data.my?.settings?.setupComplete;
  if (setupComplete) return null;
  return <SetupWizard onComplete={() => setWizardDone(true)} />;
};

// ── Telemetry status ─────────────────────────────────────────────────────────
//
// The old top bar carried TelemetryControls on every non-kiosk page: a
// recording/playback/live dot, plus car/track registration while the sim is
// live. The sidebar has no always-visible header slot (its footer only
// shows in the full-width sidebar), so the controls run here, beside the
// shell, and their dot becomes the Dashboards app's status dot in the
// sidebar (visible in the full sidebar, the icon rail and the phone menu).
const TelemetryModeContext = React.createContext<DotMode | undefined>(undefined);

const MODE_TONE: Record<DotMode, IAppStatus['tone']> = {
  recording: 'error',
  playing: 'busy',
  active: 'ok',
  idle: 'off',
};

// Called by the shell once per application (a hook, so module level).
function useMonocoqueAppStatus(app: IApplication): IAppStatus | undefined {
  const mode = useContext(TelemetryModeContext);
  if (app.path !== 'dashboards' || !mode) return undefined;
  return { tone: MODE_TONE[mode], label: MODE_TITLE[mode] };
}

// Not on kiosk routes: the old header wasn't either, and a kiosk dashboard
// runs its own telemetry stream (a second one would cost a connection).
const TelemetryMonitor: React.FC<{ onMode: (mode: DotMode) => void }> = ({ onMode }) => {
  const { pathname } = useLocation();
  if (pathname === '/kiosk' || pathname.startsWith('/kiosk/')) return null;
  return <TelemetryControls hideDot onMode={onMode} />;
};

// The `/` page when no Launch Page is set: the Dashboards app's
// device/group-driven default. With a Launch Page the shell redirects there.
// (On a phone, `/` is the sidebar's menu screen instead.)
const defaultLanding = <Navigate to="/dashboards/default" replace />;

const components = { Shakers, LedsDevices, ShiftLights, SimWindDevices, AmbientLights, Dashboards };

const Brand: React.FC<{ className?: string }> = ({ className }) => (
  <Link to="/dashboards/default" aria-label="Monocoque Builder home" style={{ display: 'flex' }}>
    <Logo className={className} />
  </Link>
);

const App: React.FC = () => {
  const [telemetryMode, setTelemetryMode] = useState<DotMode | undefined>(undefined);
  const onMode = useCallback((mode: DotMode) => setTelemetryMode(mode), []);
  return (
    <>
      <ClientHeartbeat />
      <SetupGuard />
      <ConfirmDialogHost />
      {/* THE live-updates connection for the whole app. Every optional
          stream is off here: what it actually carries is decided by
          useLiveUpdatesDemand, declared next to the code that needs it (see
          liveUpdatesHub). Pages below therefore share one subscription
          instead of each opening its own — which is what the per-origin
          connection budget requires once several kiosk windows are open, and
          what keeps a future subscribe-to-one pass from opening one
          connection per entity. */}
      <LiveUpdatesProvider
        includeTelemetry={false}
        includeNightClock={false}
        includeAmbientColor={false}
        includeAcTelemetry={false}
      >
      <HubSubscriptionRouter>
      <TelemetryMonitor onMode={onMode} />
      <TelemetryModeContext.Provider value={telemetryMode}>
      <Shell
        title="Monocoque Builder"
        Logo={Logo}
        Brand={Brand}
        defaultGroup="SYSTEM"
        components={components}
        // Settings live on the server (shared by every device of the rig).
        // The same fields as the app's own `my` query (graphql/appSettings),
        // so the two never fight over Apollo's cache entry.
        settingsSource="server"
        settingsFields={SETTINGS_FIELDS}
        applicationFields={APPLICATION_FIELDS}
        settingsTabs={settingsTabs}
        useAppStatus={useMonocoqueAppStatus}
        welcome={defaultLanding}
      />
      </TelemetryModeContext.Provider>
      </HubSubscriptionRouter>
      </LiveUpdatesProvider>
    </>
  );
}

export default App;
