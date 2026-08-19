import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useMutation, useQuery, useSubscription } from '@apollo/client/react';
import {
  ADD_NIGHT_MODE,
  ADJUST_NIGHT_CLOCK_TIME,
  GET_NIGHT_CLOCK_SNAPSHOT,
  GET_NIGHT_MODES,
  NIGHT_MODE_UPDATES,
  NightModeRecord,
  UPDATE_NIGHT_MODE,
} from './nightModeQueries';
import { computeEffectiveNightState, computeToggleDeltaMinutes } from './dayNightSim';

export interface NightModeLiveFeed {
  record: NightModeRecord | undefined;
  simTimeMs: number | null;
}

// Lets ONE useGlobalNightMode() call on a page (the one nearest the root,
// e.g. DashboardDesigner/index.tsx) share the single nightModeUpdates
// subscription it opens with every OTHER useGlobalNightMode() call nested
// underneath it (e.g. DayNightSimPanel inside Canvas.tsx's gear popup),
// purely on the frontend — no backend schema changes involved, no second
// subscription connection either. See this file's main doc comment below
// for the full mechanism and why a second always-on subscription on the
// same page is a real bug here, not just wasted bandwidth.
const NightModeFeedContext = createContext<NightModeLiveFeed | null>(null);
export const NightModeFeedProvider = NightModeFeedContext.Provider;

// Day/night is a single global value shared across every dashboard and kiosk
// display (not per-dashboard). There's effectively one record — the app
// creates it on first use and thereafter updates it in place. Live updates
// come from other clients via a NightMode-carrying subscription, so every
// window mounting this hook stays in sync.
//
// Two independent sources can drive the result: the manual toggle below,
// and a simulated in-game clock (see dayNightSim.ts) — since telemetry never
// reports the sim's own date/time. `simEnabled` is an explicit mode switch
// (set via setSimActive, from the gear-icon popup / Settings), not a
// recency heuristic — whichever mode is selected is authoritative until
// switched again. `nightAmount` is the continuous form (0=day, 1=night) —
// 0/1 in manual mode (its own ~2s CSS crossfade handles the visual
// smoothing), or a smooth ramp through dawn/dusk in simulated mode, driven
// by the server-authoritative clock tick (graphql/night_clock.rs) rather
// than any client-side time extrapolation — every subscriber renders
// directly off the latest pushed tick, same direct-render convention as the
// telemetry subscription, with no local scheduling/timers needed.
//
// Connection budget matters here: this app's subscriptions are each their
// own long-lived multipart-HTTP stream (this Apollo Client has no WebSocket
// link, so there's no multiplexing multiple logical subscriptions over one
// physical connection) and browsers cap concurrent connections per origin at
// ~6. A dashboard page already keeps 1-2 of those open — a standalone
// always-on NightMode subscription on top of that starved the pool and hung
// unrelated mutations mid-request (confirmed live: an updateNightMode
// request was sent but its response never arrived while both were open).
// So: the FIRST call site on a page (e.g. DashboardDesigner/index.tsx) calls
// this with no argument, opens the one real `nightModeUpdates` subscription,
// and re-provides its own resolved `feed` (part of this hook's return value)
// via `<NightModeFeedProvider>` around its subtree. Every OTHER call site
// nested under that provider (DayNightSimPanel, reached through Canvas.tsx's
// gear popup) then picks up that same feed via context automatically instead
// of opening a second connection. `externalFeed` is there for a caller that
// already tracks the data some other way and wants to hand it in directly
// rather than relying on context. Only when NEITHER an explicit feed NOR a
// provider ancestor is present does this fall back to opening its own
// subscription — correct for a lone consumer like Cars/DashPanEditor, or
// DayNightSimPanel rendered from the standalone Settings modal.
export function useGlobalNightMode(externalFeed?: NightModeLiveFeed): {
  isNight: boolean;
  nightAmount: number;
  simEnabled: boolean;
  simTimeMs: number | null;
  toggleNightMode: () => void;
  setSimActive: (active: boolean) => void;
  feed: NightModeLiveFeed;
} {
  const { data } = useQuery(GET_NIGHT_MODES, { fetchPolicy: 'cache-and-network' });
  const [addNightMode] = useMutation(ADD_NIGHT_MODE);
  const [updateNightMode] = useMutation(UPDATE_NIGHT_MODE);
  const [adjustNightClockTime] = useMutation(ADJUST_NIGHT_CLOCK_TIME);

  const queried = ((data as any)?.getNightModes ?? [])[0] as NightModeRecord | undefined;

  const contextFeed = useContext(NightModeFeedContext);
  const feed = externalFeed ?? contextFeed ?? undefined;

  const [ownLive, setOwnLive] = useState<NightModeRecord | undefined>(undefined);
  const [ownSimTimeMs, setOwnSimTimeMs] = useState<number | null>(null);

  // One-shot preload so a freshly-mounted popup shows the real current time
  // immediately instead of "—" until the subscription's first push arrives
  // (previously up to 1s away; still up to one tick away even at the faster
  // rate below). Only needed by whichever hook instance actually opens the
  // subscription (`feed === undefined`) — a nested consumer reading via
  // context doesn't need its own snapshot, it just relies on the root
  // instance's already-preloaded value flowing through the feed.
  const { data: snapshotData } = useQuery(GET_NIGHT_CLOCK_SNAPSHOT, {
    fetchPolicy: 'cache-and-network',
    skip: feed !== undefined,
  });

  useSubscription(NIGHT_MODE_UPDATES, {
    skip: feed !== undefined,
    onData: ({ data }: any) => {
      const event = data.data?.nightModeUpdates;
      if (!event) return;
      if (event.__typename === 'NightModeChanged') {
        if (event.value) setOwnLive(event.value);
      } else if (event.__typename === 'NightClockTick') {
        setOwnSimTimeMs(event.simTimeMs);
      }
    },
  });

  const live = feed ? feed.record : ownLive;
  const ownSimTimeMsPreloaded = ownSimTimeMs ?? (snapshotData as any)?.nightClockSnapshot?.simTimeMs ?? null;
  const simTimeMs = feed ? feed.simTimeMs : ownSimTimeMsPreloaded;
  // `current`, not `live` — `live` is subscription-only and stays undefined
  // until the first NightModeChanged event, even though `queried` (the
  // regular GET_NIGHT_MODES query) already has the record. Exposing `live`
  // alone here meant every nested consumer reading via context saw no
  // record at all until something happened to change it, well after the
  // data was actually available.
  const current = live ?? queried;

  // Memoized so a Provider passing this straight through as its context
  // value (DashboardDesigner does) doesn't re-render every nested consumer
  // on every unrelated re-render (this page re-renders at telemetry's own
  // ~60Hz tick rate) — only when the underlying data actually changes.
  const resolvedFeed = useMemo<NightModeLiveFeed>(() => ({ record: current, simTimeMs }), [current, simTimeMs]);

  const effective = current
    ? computeEffectiveNightState(current, simTimeMs)
    : { isNight: false, nightAmount: 0 };

  const save = useCallback((update: Partial<NightModeRecord>) => {
    if (current?.id) {
      updateNightMode({ variables: { id: current.id, update } });
    } else {
      addNightMode({ variables: { values: update } });
    }
  }, [current, updateNightMode, addNightMode]);

  // While simulation is active, the manual toggle doesn't switch back to
  // manual mode — it stays simulated and nudges the simulated clock itself
  // to whichever of midnight/noon is the opposite of what's currently
  // showing, so the button reads as an instant day/night flip either way
  // without the user having to think about which mode is authoritative.
  const toggleNightMode = useCallback(() => {
    if (current?.simEnabled && simTimeMs != null) {
      adjustNightClockTime({ variables: { deltaMinutes: computeToggleDeltaMinutes(simTimeMs, effective.isNight) } });
      return;
    }
    save({ isNight: !effective.isNight });
  }, [save, effective.isNight, current?.simEnabled, simTimeMs, adjustNightClockTime]);

  const setSimActive = useCallback((active: boolean) => {
    save({ simEnabled: active });
  }, [save]);

  return {
    isNight: effective.isNight,
    nightAmount: effective.nightAmount,
    simEnabled: !!current?.simEnabled,
    simTimeMs,
    toggleNightMode,
    setSimActive,
    feed: resolvedFeed,
  };
}
