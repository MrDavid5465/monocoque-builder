import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSubscription } from '@apollo/client/react';
import { DASHBOARD_UPDATES_SUB } from './DashboardDesigner/queries';
import { useHealthPoll } from '../../graphql/health';

// Every event type the backend's dashboardUpdates subscription (see
// graphql/mod.rs's DashboardUpdateEvent) can deliver. Kept here (not
// re-derived from the GraphQL schema) since this is the one place that
// needs to enumerate them for the dispatch-by-typename logic below.
export type LiveUpdateTypename =
  | 'DashboardEntryChanged'
  | 'DashTemplateChanged'
  | 'DeviceDefaultChanged'
  | 'TelemetryEvent'
  | 'NightModeChanged'
  | 'NightClockTick'
  | 'PreviewCarChanged'
  | 'CarDashPanChanged'
  | 'CarChanged'
  | 'RecordingStatus'
  | 'AmbientColorChanged'
  | 'HuenicornSettingsChanged'
  | 'AcTelemetry'
  | 'MonocoqueSoundDeviceChanged'
  | 'SoundDeviceProfileChanged'
  | 'LedsDeviceProfileChanged'
  | 'ShiftLightProfileChanged'
  | 'SimWindDeviceProfileChanged'
  | 'ShakerChannelChanged'
  | 'ShakerDspChannelChanged'
  | 'LfeChannelChanged'
  | 'MonocoqueLedsDeviceChanged'
  | 'MonocoqueShiftLightChanged'
  | 'MonocoqueSimWindDeviceChanged'
  | 'TelemetryStatus';

type Listener = (event: any) => void;

// Events that describe current state rather than a change, and that the
// backend sends only when that state changes. The hub keeps the latest of
// each and hands it to a listener as soon as it registers, so a component
// mounted after the last change still knows the current state.
const STATE_TYPENAMES: ReadonlySet<LiveUpdateTypename> = new Set<LiveUpdateTypename>(['TelemetryStatus']);

// What a consumer needs the shared connection to carry. The optional members
// of dashboardUpdates are off unless something asks for them, because each is
// a high-rate stream that most pages have no use for.
export interface LiveUpdatesDemand {
  includeTelemetry?: boolean;
  includeNightClock?: boolean;
  includeAmbientColor?: boolean;
  includeAcTelemetry?: boolean;
  // Every TelemetryFrame field on TelemetryEvent, not just the ones the
  // dashboards bind to. Implies includeTelemetry. Only the live recording
  // chart wants it.
  includeFullTelemetryFrame?: boolean;
  // How often this consumer wants telemetry frames, when it asks for them
  // (default 60, the dashboards' rate). The connection ticks at the highest
  // rate any telemetry consumer asks for.
  telemetryHz?: number;
}

const DEFAULT_TELEMETRY_HZ = 60;

export interface LiveUpdatesHub {
  subscribe: (typename: LiveUpdateTypename, listener: Listener) => () => void;
  // Declares a demand for the duration of the returned release function. The
  // hub carries the UNION of every live demand: with one provider at the app
  // root, a page deep in the tree can turn telemetry on for itself without
  // knowing anything about the connection, and it goes quiet again when that
  // page unmounts. See useLiveUpdatesDemand.
  request: (demand: LiveUpdatesDemand) => () => void;
}

// Populated by whichever component actually opened a hub (via
// useLiveUpdatesHub, directly or through <LiveUpdatesProvider>) — consumed
// by useHubListener/useGlobalNightMode/useGlobalPreviewCar in any
// descendant that didn't open one itself. Never read by the component that
// provides it: a component can't consume its own not-yet-rendered Provider
// via context, which is exactly why useLiveUpdatesHub returns the hub
// directly instead of only exposing it through context (see
// DashboardDesigner/index.tsx, which both provides AND directly uses one).
export const LiveUpdatesContext = createContext<LiveUpdatesHub | null>(null);

// A browser holds only ~6 concurrent HTTP/1.1 connections per origin, and
// each of DashboardEntryChanged/DashTemplateChanged/DeviceDefaultChanged/
// TelemetryEvent/NightModeChanged/NightClockTick/PreviewCarChanged/
// CarDashPanChanged used to be reachable only via its own always-open
// subscription. Fine for one browser window; with several dashboard kiosk
// windows open at once (all sharing that same per-origin budget — separate
// windows of the same browser still share one connection pool), a single
// window could already need 4 of these simultaneously (dashboardUpdates +
// nightModeUpdates + previewCarChanged + carDashPanChanged on a 360-type
// dashboard) — confirmed live: 2 such windows (8 connections) was enough to
// exhaust the pool, silently stalling whichever window's requests lost the
// race (its 360 photo never loaded) until the other window's connections
// were released (e.g. by navigating away). This hub opens ONE real
// dashboardUpdates subscription and demultiplexes it to any number of
// listeners by event typename — any component, anywhere, calls
// useHubListener (or the higher-level useGlobalNightMode/
// useGlobalPreviewCar, which use this internally) instead of opening its
// own subscription.
//
// The ONLY component that actually calls useSubscription. Apollo's
// useSubscription (via useSyncExternalStore under the hood) force-rerenders
// whichever component instance called it on EVERY incoming message,
// regardless of what onData's listener demux below does with it — confirmed
// live via a captured JS stack (checkForNestedUpdates -> forceStoreRerender
// -> Apollo's ConsumerObserver.next). This subscription carries telemetry
// AND the night-clock tick merged together at ~16ms each in kiosk view
// (~120Hz combined) — calling useSubscription directly inside
// useLiveUpdatesHub used to mean whichever (potentially large) component
// called that hook had its ENTIRE function body re-executed ~120x/sec
// continuously, independent of any memoization further down. A mutation
// response landing while that stream was mid-flight was enough on its own
// to trip React's nested-update-depth heuristic ("Maximum update depth
// exceeded") — reproduced live via rapid nudge-button clicks on the Day/
// Night popup, nothing to do with per-form or the button itself. Isolating
// the actual subscription in this tiny, childless leaf (renders null) means
// Apollo's forced re-render lands only on this leaf's own fiber — React's
// reconciliation doesn't revisit the parent or siblings just because one
// child's own internal store subscription fired. `skip: true` (ambient hub
// already available, or the owning hook's own `skip` param) still mounts
// this harmlessly — no data ever arrives, so onData never fires and no
// forced re-render happens either.
const LiveUpdatesSubscriber: React.FC<{
  includeTelemetry: boolean;
  includeNightClock: boolean;
  includeAmbientColor: boolean;
  includeAcTelemetry: boolean;
  includeFullTelemetryFrame: boolean;
  telemetryHz: number;
  skip: boolean;
  listenersRef: React.MutableRefObject<Map<LiveUpdateTypename, Set<Listener>>>;
  latestRef: React.MutableRefObject<Map<LiveUpdateTypename, any>>;
  onDown: () => void;
}> = ({ includeTelemetry, includeNightClock, includeAmbientColor, includeAcTelemetry, includeFullTelemetryFrame, telemetryHz, skip, listenersRef, latestRef, onDown }) => {
  useSubscription(DASHBOARD_UPDATES_SUB, {
    skip,
    fetchPolicy: 'no-cache',
    variables: { includeTelemetry, includeNightClock, includeAmbientColor, includeAcTelemetry, includeFullTelemetryFrame, telemetryHz },
    onData: ({ data }: any) => {
      const event = data.data?.dashboardUpdates;
      if (!event) return;
      if (STATE_TYPENAMES.has(event.__typename)) latestRef.current.set(event.__typename, event);
      listenersRef.current.get(event.__typename)?.forEach(l => l(event));
    },
    onError: onDown,
  });
  return null;
};

// `skip` lets a caller declare a hub unconditionally (satisfying the rules
// of hooks — this always calls useSubscription, via the leaf above) while
// still avoiding a real connection when it turns out an ambient hub
// (context or an explicitly-passed one) is already available; see
// useGlobalNightMode's own use of this for the exact pattern.
//
// Returns a tuple, not just the hub — the second element is the
// LiveUpdatesSubscriber leaf (see its own doc comment for why this can't
// just be called internally): the CALLER must render it somewhere in its
// own JSX output for React to actually mount it as a separate fiber. Every
// existing call site does this once, right alongside where it uses the hub
// itself.
export function useLiveUpdatesHub(opts: {
  includeTelemetry?: boolean;
  includeNightClock?: boolean;
  includeAmbientColor?: boolean;
  // Assetto Corsa's extended telemetry (NeckFX head movement). Off by
  // default and gated per-caller: it only means anything to a dashboard
  // driving motion from it, and it is the highest-rate member on this
  // stream.
  includeAcTelemetry?: boolean;
  skip?: boolean;
} = {}): [LiveUpdatesHub, React.ReactNode] {
  const {
    includeTelemetry = false,
    includeNightClock = true,
    includeAmbientColor = false,
    includeAcTelemetry = false,
    skip = false,
  } = opts;
  const listenersRef = useRef(new Map<LiveUpdateTypename, Set<Listener>>());
  const latestRef = useRef(new Map<LiveUpdateTypename, any>());

  // Live demands, plus a counter to force the recompute below when the set
  // changes. The set itself is a ref so registering never re-renders the
  // consumer that registered — only this hub, which re-renders its own
  // subscriber leaf with new variables.
  const demandsRef = useRef(new Set<LiveUpdatesDemand>());
  const [demandVersion, setDemandVersion] = useState(0);
  const request = useCallback((demand: LiveUpdatesDemand) => {
    demandsRef.current.add(demand);
    setDemandVersion(v => v + 1);
    return () => {
      demandsRef.current.delete(demand);
      setDemandVersion(v => v + 1);
    };
  }, []);

  const subscribe = useCallback((typename: LiveUpdateTypename, listener: Listener) => {
    let set = listenersRef.current.get(typename);
    if (!set) {
      set = new Set();
      listenersRef.current.set(typename, set);
    }
    set.add(listener);
    const latest = latestRef.current.get(typename);
    if (latest !== undefined) listener(latest);
    return () => { set!.delete(listener); };
  }, []);

  // A backend restart (e.g. a dev-mode rebuild) breaks the underlying
  // multipart HTTP stream this runs over — Apollo surfaces that as onError
  // and does NOT auto-retry. Since this hub is now the ONE connection every
  // listener (dashboard events, night mode, preview car, car dash pan)
  // depends on, losing it silently would freeze all of them at once until a
  // manual reload. `subscriptionDown` tears the subscription down the
  // moment it errors; useHealthPoll brings it back the moment the server
  // actually answers again.
  // Anything a caller asked for statically, plus anything any mounted
  // consumer is currently demanding. Changing these re-subscribes — still ONE
  // connection, reopened — which happens only when a consumer mounts,
  // unmounts, or changes what it needs, not per frame.
  const flags = useMemo(() => {
    const demands = [...demandsRef.current];
    const telemetryDemands = demands.filter(d => d.includeTelemetry || d.includeFullTelemetryFrame);
    const telemetryHz = Math.max(
      includeTelemetry ? DEFAULT_TELEMETRY_HZ : 0,
      ...telemetryDemands.map(d => d.telemetryHz ?? DEFAULT_TELEMETRY_HZ),
    );
    return {
      telemetryHz: telemetryHz > 0 ? telemetryHz : DEFAULT_TELEMETRY_HZ,
      telemetry: includeTelemetry || demands.some(d => d.includeTelemetry || d.includeFullTelemetryFrame),
      fullTelemetryFrame: demands.some(d => d.includeFullTelemetryFrame),
      nightClock: includeNightClock || demands.some(d => d.includeNightClock),
      ambientColor: includeAmbientColor || demands.some(d => d.includeAmbientColor),
      acTelemetry: includeAcTelemetry || demands.some(d => d.includeAcTelemetry),
    };
    // demandVersion is the trigger, not an input — the demands themselves
    // live in a ref so registering doesn't re-render the registering component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demandVersion, includeTelemetry, includeNightClock, includeAmbientColor, includeAcTelemetry]);

  const [subscriptionDown, setSubscriptionDown] = useState(false);
  useHealthPoll(subscriptionDown, () => setSubscriptionDown(false));
  const onDown = useCallback(() => setSubscriptionDown(true), []);

  // Stable identity across re-renders (subscribe itself is already
  // useCallback([])-stable) — callers that store this in a dependency array
  // (useGlobalNightMode does) don't get spurious effect re-runs.
  const hubRef = useRef<LiveUpdatesHub>({ subscribe, request });

  const subscriberEl = (
    <LiveUpdatesSubscriber
      includeTelemetry={flags.telemetry}
      includeNightClock={flags.nightClock}
      includeAmbientColor={flags.ambientColor}
      includeAcTelemetry={flags.acTelemetry}
      includeFullTelemetryFrame={flags.fullTelemetryFrame}
      telemetryHz={flags.telemetryHz}
      skip={skip || subscriptionDown}
      listenersRef={listenersRef}
      latestRef={latestRef}
      onDown={onDown}
    />
  );

  return [hubRef.current, subscriberEl];
}

// Registers `onEvent` for `typename` against `hub` — pass one explicitly
// when the calling component itself opened it (can't use context for your
// own hub, see LiveUpdatesContext's doc comment); omit it to use the
// nearest ancestor <LiveUpdatesProvider> via context instead. Passing
// `undefined` for `onEvent` (not just omitting the call) lets a caller
// conditionally listen without violating the rules of hooks — e.g.
// useHubListener(hub, 'TelemetryEvent', kioskMode ? handleTelemetry :
// undefined). `onEvent` is read via a ref so callers don't need to
// memoize it.
export function useHubListener<T = any>(
  hub: LiveUpdatesHub | null | undefined,
  typename: LiveUpdateTypename,
  onEvent: ((event: T) => void) | undefined,
) {
  const contextHub = useContext(LiveUpdatesContext);
  const activeHub = hub ?? contextHub;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const hasHandler = !!onEvent;

  useEffect(() => {
    if (!activeHub || !hasHandler) return;
    return activeHub.subscribe(typename, (e) => onEventRef.current?.(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHub, typename, hasHandler]);
}

// Declares what the shared connection must carry, for as long as this
// component is mounted.
//
// This is what lets a hub live at the app root while the decision about what
// it carries stays next to the code that needs it — no page has to thread
// flags up through its ancestors, and nothing stays switched on after the
// consumer that wanted it unmounts. Pass a hub explicitly only when the
// calling component opened it itself (same rule as useHubListener); otherwise
// omit it and the nearest provider is used.
//
// The booleans are destructured into the dependency array on purpose: a fresh
// object literal every render would otherwise re-register on every render.
export function useLiveUpdatesDemand(
  hub: LiveUpdatesHub | null | undefined,
  demand: LiveUpdatesDemand,
) {
  const contextHub = useContext(LiveUpdatesContext);
  const activeHub = hub ?? contextHub;
  const {
    includeTelemetry = false,
    includeNightClock = false,
    includeAmbientColor = false,
    includeAcTelemetry = false,
    includeFullTelemetryFrame = false,
    telemetryHz,
  } = demand;

  useEffect(() => {
    if (!activeHub) return;
    if (
      !includeTelemetry &&
      !includeNightClock &&
      !includeAmbientColor &&
      !includeAcTelemetry &&
      !includeFullTelemetryFrame
    ) {
      return;
    }
    return activeHub.request({
      includeTelemetry,
      includeNightClock,
      includeAmbientColor,
      includeAcTelemetry,
      includeFullTelemetryFrame,
      telemetryHz,
    });
  }, [activeHub, includeTelemetry, includeNightClock, includeAmbientColor, includeAcTelemetry, includeFullTelemetryFrame, telemetryHz]);
}

// Convenience component for the common case: open a hub and provide it to
// children, with no direct use by the provider itself — e.g. wrap a page
// root in this once, and any nested component (however deep) can call
// useHubListener/useGlobalNightMode/useGlobalPreviewCar with no explicit
// hub and pick this one up automatically. DashboardDesigner doesn't use
// this directly (it also needs its OWN listeners, which requires holding
// the hub itself — see LiveUpdatesContext's doc comment) but the pattern is
// available for any future page that just needs to provide, not consume.
export const LiveUpdatesProvider: React.FC<{
  includeTelemetry?: boolean;
  includeNightClock?: boolean;
  includeAmbientColor?: boolean;
  includeAcTelemetry?: boolean;
  children: React.ReactNode;
}> = ({ includeTelemetry, includeNightClock, includeAmbientColor, includeAcTelemetry, children }) => {
  const [hub, hubSubscriber] = useLiveUpdatesHub({
    includeTelemetry,
    includeNightClock,
    includeAmbientColor,
    includeAcTelemetry,
  });
  return (
    <LiveUpdatesContext.Provider value={hub}>
      {hubSubscriber}
      {children}
    </LiveUpdatesContext.Provider>
  );
};
