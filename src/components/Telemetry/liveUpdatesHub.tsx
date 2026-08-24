import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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
  | 'RecordingStatus'
  | 'AmbientColorChanged'
  | 'HuenicornSettingsChanged';

type Listener = (event: any) => void;

export interface LiveUpdatesHub {
  subscribe: (typename: LiveUpdateTypename, listener: Listener) => () => void;
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
  skip: boolean;
  listenersRef: React.MutableRefObject<Map<LiveUpdateTypename, Set<Listener>>>;
  onDown: () => void;
}> = ({ includeTelemetry, includeNightClock, includeAmbientColor, skip, listenersRef, onDown }) => {
  useSubscription(DASHBOARD_UPDATES_SUB, {
    skip,
    fetchPolicy: 'no-cache',
    variables: { includeTelemetry, includeNightClock, includeAmbientColor },
    onData: ({ data }: any) => {
      const event = data.data?.dashboardUpdates;
      if (!event) return;
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
  skip?: boolean;
} = {}): [LiveUpdatesHub, React.ReactNode] {
  const {
    includeTelemetry = false,
    includeNightClock = true,
    includeAmbientColor = false,
    skip = false,
  } = opts;
  const listenersRef = useRef(new Map<LiveUpdateTypename, Set<Listener>>());

  const subscribe = useCallback((typename: LiveUpdateTypename, listener: Listener) => {
    let set = listenersRef.current.get(typename);
    if (!set) {
      set = new Set();
      listenersRef.current.set(typename, set);
    }
    set.add(listener);
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
  const [subscriptionDown, setSubscriptionDown] = useState(false);
  useHealthPoll(subscriptionDown, () => setSubscriptionDown(false));
  const onDown = useCallback(() => setSubscriptionDown(true), []);

  // Stable identity across re-renders (subscribe itself is already
  // useCallback([])-stable) — callers that store this in a dependency array
  // (useGlobalNightMode does) don't get spurious effect re-runs.
  const hubRef = useRef<LiveUpdatesHub>({ subscribe });

  const subscriberEl = (
    <LiveUpdatesSubscriber
      includeTelemetry={includeTelemetry}
      includeNightClock={includeNightClock}
      includeAmbientColor={includeAmbientColor}
      skip={skip || subscriptionDown}
      listenersRef={listenersRef}
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
  children: React.ReactNode;
}> = ({ includeTelemetry, includeNightClock, includeAmbientColor, children }) => {
  const [hub, hubSubscriber] = useLiveUpdatesHub({
    includeTelemetry,
    includeNightClock,
    includeAmbientColor,
  });
  return (
    <LiveUpdatesContext.Provider value={hub}>
      {hubSubscriber}
      {children}
    </LiveUpdatesContext.Provider>
  );
};
