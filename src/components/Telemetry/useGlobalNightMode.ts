import { ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import {
  ADD_NIGHT_MODE,
  ADJUST_NIGHT_CLOCK_TIME,
  GET_NIGHT_CLOCK_SNAPSHOT,
  GET_NIGHT_MODES,
  NightModeRecord,
  UPDATE_NIGHT_MODE,
} from './nightModeQueries';
import { computeEffectiveNightState, computeToggleDeltaMinutes } from './dayNightSim';
import { LiveUpdatesContext, LiveUpdatesHub, useHubListener, useLiveUpdatesDemand, useLiveUpdatesHub } from './liveUpdatesHub';

export interface NightModeLiveFeed {
  record: NightModeRecord | undefined;
  simTimeMs: number | null;
}

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
// NightModeChanged/NightClockTick events arrive via the shared
// liveUpdatesHub (see its own doc comment for why: a browser's per-origin
// HTTP/1.1 connection cap, ~6, is shared across every window of the same
// browser — several dashboard kiosk windows each opening their own
// standalone subscription for this exhausted it). `externalHub` lets a
// caller that already opened its own hub (DashboardDesigner/index.tsx —
// it can't consume its own not-yet-rendered <LiveUpdatesProvider> via
// context, same reasoning as before) pass it in directly; everyone else
// (DayNightSimPanel, Cars/DashPanEditor, Cars/CarDetail) omits it and
// either picks up an ancestor's hub via context or gets its own
// private one (see useLiveUpdatesHub's `skip` handling) — a lone
// consumer with no provider ancestor still gets exactly the one
// connection it always has, no regression.
export function useGlobalNightMode(externalHub?: LiveUpdatesHub, opts?: { liveClock?: boolean; tickThrottleMs?: number }): {
  isNight: boolean;
  nightAmount: number;
  simEnabled: boolean;
  simTimeMs: number | null;
  /** True when `simTimeMs` is Assetto Corsa's own clock rather than the
   *  server's simulated one — so its calendar date is the in-game date. */
  fromGame: boolean;
  toggleNightMode: () => void;
  setSimActive: (active: boolean) => void;
  feed: NightModeLiveFeed;
  // Render this somewhere in the caller's own JSX (harmless if the caller
  // ends up using an external/context hub instead — see
  // LiveUpdatesSubscriber's own doc comment in liveUpdatesHub.tsx for why
  // this can't just be handled internally).
  hubSubscriber: ReactNode;
} {
  // Defaults to true (unthrottled) for every existing caller (DayNightSimPanel,
  // Cars/DashPanEditor) — DashboardDesigner/index.tsx is the one caller that
  // passes false while editing (kioskMode === false). See NightClockTick's
  // handling below for why: at the root of the page, ~60Hz simTimeMs churn
  // cascades into a re-render of the ENTIRE editor tree (ObjectExplorer
  // included) on every tick, since simTimeMs lives in this hook's own React
  // state, not a context only actual consumers subscribe to. That's
  // harmless in kiosk/live view (nothing else is competing for renders),
  // but combined with the many simultaneous <Form> instances the
  // dashboard-root properties panel mounts, it was enough nested-update
  // volume within one synchronous batch to trip React's "Maximum update
  // depth exceeded" heuristic — reproduced live by just opening that panel,
  // with or without any clock component present. Nothing in edit mode
  // actually needs a live-ticking value: clock nodes show a static "00:00"
  // placeholder while !kioskMode (see ClockTextNode/ClockSpriteNode), and
  // the gear-icon popup only ever renders in kiosk mode (Canvas.tsx's
  // nightModeButton gate) — so simply not updating simTimeMs more than once
  // (via the snapshot query below) is both sufficient and correct here, not
  // just a workaround.
  //
  // `tickThrottleMs` covers the other place this same class of problem
  // shows up: DayNightSimPanel (the gear-icon popup / Settings Day-Night
  // tab) genuinely wants a periodically-updating simTimeMs (unlike the
  // editor, which wants it fully frozen) but only ever displays it as a
  // "HH:MM" label — sub-second precision is thrown away anyway. Left
  // ungated (its default), that popup's own two per-form <Form>s + Fluent
  // ComboBoxes re-rendering 60x/sec reproduced the identical "Maximum
  // update depth exceeded" warning this comment already describes for
  // ObjectExplorer, live (via playwright-verify) after opening the popup
  // and interacting with the Sunrise/Sunset dropdowns — the "harmless in
  // kiosk/live view, nothing else is competing for renders" assumption
  // above turned out not to hold once a Form-heavy popup is what's mounted
  // in that tree. DashboardDesigner/index.tsx's own kiosk-view call
  // deliberately leaves this at 0 (unthrottled) — nightAmount's continuous
  // dawn/dusk crossfade DOES need every tick, unlike a text label.
  const liveClock = opts?.liveClock ?? true;
  const tickThrottleMs = opts?.tickThrottleMs ?? 0;
  const lastTickAtRef = useRef(0);

  const { data } = useQuery(GET_NIGHT_MODES, { fetchPolicy: 'cache-and-network' });
  const [addNightMode] = useMutation(ADD_NIGHT_MODE);
  const [updateNightMode] = useMutation(UPDATE_NIGHT_MODE);
  const [adjustNightClockTime] = useMutation(ADJUST_NIGHT_CLOCK_TIME);

  const queried = ((data as any)?.getNightModes ?? [])[0] as NightModeRecord | undefined;

  const contextHub = useContext(LiveUpdatesContext);
  // Rules of hooks — always called; skipped (no real connection opened)
  // whenever an ambient hub (explicit or context) is already available.
  const [ownHub, ownHubSubscriber] = useLiveUpdatesHub({
    includeTelemetry: false,
    includeNightClock: false,
    skip: !!externalHub || !!contextHub,
  });
  const hub = externalHub ?? contextHub ?? ownHub;
  // Asked for as a demand rather than as an option on the private hub above,
  // so it reaches whichever hub is actually in use — including a shared one
  // this hook didn't open. Withdrawn when this consumer unmounts, so the
  // clock stops being streamed once nothing is displaying it.
  useLiveUpdatesDemand(hub, { includeNightClock: liveClock });

  const [ownLive, setOwnLive] = useState<NightModeRecord | undefined>(undefined);
  const [ownSimTimeMs, setOwnSimTimeMs] = useState<number | null>(null);
  // Whether `simTimeMs` is the game's own clock rather than the server's
  // simulated one — which also makes it the game's own calendar DATE, the
  // part DayNightSimPanel needs for its compute-from-date field.
  const [ownFromGame, setOwnFromGame] = useState<boolean | null>(null);
  // Sun elevation rides the same tick as the clock for the same reason
  // fromGame does: no extra subscription, and it can never disagree with the
  // instant it arrived beside.
  const [ownSunElevationDeg, setOwnSunElevationDeg] = useState<number | null>(null);

  // One-shot preload so a freshly-mounted popup shows the real current time
  // immediately instead of "—" until the subscription's first push arrives.
  // Always fetched (cheap, one-shot, not a persistent connection) — unlike
  // the old externalFeed design, there's no "root already preloaded it"
  // shortcut to rely on since every hook instance now resolves its own
  // simTimeMs independently off the shared hub.
  const { data: snapshotData } = useQuery(GET_NIGHT_CLOCK_SNAPSHOT, { fetchPolicy: 'cache-and-network' });

  const onNightModeChanged = useCallback((event: any) => {
    if (event.value) setOwnLive(event.value);
  }, []);
  useHubListener(hub, 'NightModeChanged', onNightModeChanged);

  // useCallback itself is always called (rules of hooks) — only the value
  // handed to useHubListener as `onEvent` is conditional on liveClock (see
  // this hook's own doc comment for why: Maximum update depth exceeded
  // while editing), which useHubListener treats as "don't listen at all",
  // not touching state at ~60Hz when nothing needs it.
  const onNightClockTick = useCallback((event: any) => {
    if (tickThrottleMs > 0) {
      const now = performance.now();
      if (now - lastTickAtRef.current < tickThrottleMs) return;
      lastTickAtRef.current = now;
    }
    setOwnSimTimeMs(event.simTimeMs);
    // Carried on the same tick as the clock, so it needs no separate
    // subscription and can never disagree with the time it arrived beside.
    setOwnFromGame(!!event.fromGame);
    setOwnSunElevationDeg(
      typeof event.sunElevationDeg === 'number' ? event.sunElevationDeg : null,
    );
  }, [tickThrottleMs]);
  useHubListener(hub, 'NightClockTick', liveClock ? onNightClockTick : undefined);

  const ownSimTimeMsPreloaded = ownSimTimeMs ?? (snapshotData as any)?.nightClockSnapshot?.simTimeMs ?? null;
  const fromGame = ownFromGame ?? !!(snapshotData as any)?.nightClockSnapshot?.fromGame;
  const sunElevationDeg =
    ownSunElevationDeg ?? (snapshotData as any)?.nightClockSnapshot?.sunElevationDeg ?? null;
  // `ownLive`, not `queried` — mirrors the old `live`/`current` split: stays
  // undefined until the first NightModeChanged event even though `queried`
  // (GET_NIGHT_MODES) already has the record, but every consumer of this
  // hook resolves its own state off the same shared hub now (no more
  // "root's already-live value flows down for free via feed" shortcut), so
  // falling back to `queried` below covers the gap the same way it always
  // did for a lone consumer.
  const current = ownLive ?? queried;
  const simTimeMs = ownSimTimeMsPreloaded;

  // Memoized so a caller storing this (e.g. to hand to a Photo360-style
  // consumer expecting a stable value) doesn't see a new reference on every
  // unrelated re-render.
  const resolvedFeed = useMemo<NightModeLiveFeed>(() => ({ record: current, simTimeMs }), [current, simTimeMs]);

  const effective = current
    ? computeEffectiveNightState(current, simTimeMs, sunElevationDeg)
    : { isNight: false, nightAmount: 0 };

  const save = useCallback((update: Partial<NightModeRecord>) => {
    if (current?.id) {
      updateNightMode({ variables: { id: current.id, update } });
    } else {
      addNightMode({ variables: { values: update } });
    }
  }, [current, updateNightMode, addNightMode]);

  // Read via refs (not closed-over directly) so this callback's identity
  // stays stable across the ~60Hz simTimeMs tick instead of being
  // regenerated on every one — callers that pass this down as a prop
  // (DashboardDesigner/index.tsx -> Canvas, now React.memo'd) would
  // otherwise see a "changed" prop every tick and re-render regardless of
  // memoization, defeating its whole purpose. No behavior change: still
  // reads the latest simTimeMs/isNight at click-time, just without being a
  // useCallback dependency.
  const simTimeMsRef = useRef(simTimeMs);
  simTimeMsRef.current = simTimeMs;
  const effectiveRef = useRef(effective);
  effectiveRef.current = effective;

  // While simulation is active, the manual toggle doesn't switch back to
  // manual mode — it stays simulated and nudges the simulated clock itself
  // to whichever of midnight/noon is the opposite of what's currently
  // showing, so the button reads as an instant day/night flip either way
  // without the user having to think about which mode is authoritative.
  const toggleNightMode = useCallback(() => {
    const simTimeMs = simTimeMsRef.current;
    const effective = effectiveRef.current;
    if (current?.simEnabled && simTimeMs != null) {
      adjustNightClockTime({ variables: { deltaMinutes: computeToggleDeltaMinutes(simTimeMs, effective.isNight) } });
      return;
    }
    save({ isNight: !effective.isNight });
  }, [save, current?.simEnabled, adjustNightClockTime]);

  const setSimActive = useCallback((active: boolean) => {
    save({ simEnabled: active });
  }, [save]);

  return {
    isNight: effective.isNight,
    nightAmount: effective.nightAmount,
    simEnabled: !!current?.simEnabled,
    simTimeMs,
    fromGame,
    toggleNightMode,
    setSimActive,
    feed: resolvedFeed,
    hubSubscriber: ownHubSubscriber,
  };
}
