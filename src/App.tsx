import React, { useEffect } from "react";
import "./App.css";

import Logo from "./Logo";
import { THEMES } from "./lib/themes";
import { Link, Navigate } from "react-router-dom";
import Denim, {
  getStyle as getDenimStyle,
} from "./lib/denim";

import qStyles from "./lib/styles";
import { getTheme, mergeStyleSets } from "@fluentui/react";
import Shakers from "./components/Shakers"
import LedsDevices from "./components/LedsDevices";
import ShiftLights from "./components/ShiftLights";
import SimWindDevices from "./components/SimWindDevices";
import AmbientLights from "./components/AmbientLights";
import TelemetryAdmin from "./components/TelemetryAdmin";
import TelemetryControls from "./components/Telemetry/Controls";
import { useMutation, useQuery } from "@apollo/client/react";
import { HEARTBEAT_CLIENT } from "./components/Telemetry/clientsQueries";
import { getAppId } from "./graphql/client";
import dispatcher, { IMy } from "./lib/denim/lib/queries";
import SetupWizard from "./components/Onboarding/SetupWizard";
import { ConfirmDialogHost } from "./lib/denim/components/ConfirmDialog";
import { LiveUpdatesProvider } from "./components/Telemetry/liveUpdatesHub";

export const getStyle = () => {
  return { ...getDenimStyle(), ...mergeStyleSets(qStyles(getTheme())) };
};

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

// Root landing ("/") — the user's own Launch Page setting wins when set,
// otherwise falls back to Telemetry Admin. Already resolved from cache by
// the time this renders: Denim's own top-level `my` query gates rendering
// any routes at all until it resolves, so this never shows a loading flash.
const DefaultLanding: React.FC = () => {
  const { data, loading } = useQuery<IMy>(dispatcher.my, { fetchPolicy: 'cache-first' });
  if (loading || !data) return null;
  const launchPage = data.my?.settings?.launchPage;
  return <Navigate to={launchPage ? `/${launchPage}` : '/telemetryadmin/default'} replace />;
};

const App: React.FC = () => {
  const style = getStyle();
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
      <Denim
        Logo={Logo}
        Brand={(props) => (
          <Link to="/telemetryadmin/default">
            <Logo className={style.logoLink} {...props} />
          </Link>
        )}
        RootComponent={DefaultLanding}
        Controls={TelemetryControls}
        components={{ Shakers, LedsDevices, ShiftLights, SimWindDevices, AmbientLights, TelemetryAdmin }}
        themes={THEMES}
        />
      </LiveUpdatesProvider>
    </>
  );
}

export default App;
