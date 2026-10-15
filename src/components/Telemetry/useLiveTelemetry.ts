import { useCallback, useRef, useState } from 'react';
import { LiveUpdatesHub, useHubListener, useLiveUpdatesDemand } from './liveUpdatesHub';

const COURSE_FLAG_MAP: Record<string, number> = {
  GREEN: 0, YELLOW: 1, RED: 2, CHEQUERED: 3,
  BLUE: 4, WHITE: 5, BLACK: 6, BLACK_WHITE: 7,
  BLACK_ORANGE: 8, ORANGE: 9,
};

// GraphQL's SimStatus enum serializes as SCREAMING_SNAKE_CASE (OFF/MENU/ACTIVE) —
// normalize to the casing the rest of the app compares against.
const SIM_STATUS_MAP: Record<string, string> = { OFF: 'Off', MENU: 'Menu', ACTIVE: 'Active' };

export interface LiveTelemetryData {
  values: Record<string, number>;
  car: string;
  track: string;
  simStatus: string;
}

// Corner order for the `tyres` array, per src-tauri/src/telemetry/types.rs: [FL, FR, RL, RR].
const TYRE_CORNERS = ['Fl', 'Fr', 'Rl', 'Rr'] as const;

export function computeTelemetryValues(t: any): LiveTelemetryData {
  const values: Record<string, number> = {};
  if (t) {
    for (const [key, val] of Object.entries(t as object)) {
      if (typeof val === 'number') values[key] = val;
    }
    if (typeof t.courseFlag === 'string') values['courseFlag'] = COURSE_FLAG_MAP[t.courseFlag] ?? 0;
    if (typeof t.inPit === 'boolean') values['inPit'] = t.inPit ? 1 : 0;
    if (typeof t.lapIsValid === 'boolean') values['lapIsValid'] = t.lapIsValid ? 1 : 0;
    if (Array.isArray(t.tyres)) {
      t.tyres.forEach((tyre: any, i: number) => {
        const corner = TYRE_CORNERS[i];
        if (!corner || !tyre) return;
        if (typeof tyre.temp === 'number') values[`tyreTemp${corner}`] = tyre.temp;
        if (typeof tyre.wear === 'number') values[`tyreWear${corner}`] = tyre.wear;
      });
    }
  }
  const simStatus = t?.simStatus ?? '';
  return { values, car: t?.car ?? '', track: t?.track ?? '', simStatus: SIM_STATUS_MAP[simStatus] ?? simStatus };
}

// The latest TelemetryEvent frame from the shared hub, demanding the
// telemetry stream for as long as the caller is mounted (and not skipped).
// `received` tells "no event yet" apart from an event whose frame is null
// (no sim running). `full` asks for every TelemetryFrame field instead of the
// dashboard subset. `rateHz` is the frame rate wanted: the dashboards drive
// gauges at 60; the pages that used to hold the standalone `telemetry`
// subscription keep the 30 it ran at. `onFrame`, when given, sees every
// frame as it arrives — several can land within one render, and the
// returned state only holds the last of them.
export function useLiveTelemetryFrame(
  opts: { skip?: boolean; full?: boolean; rateHz?: number; onFrame?: (frame: any) => void } = {},
): { frame: any; received: boolean } {
  const { skip = false, full = false, rateHz, onFrame } = opts;
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  useLiveUpdatesDemand(null, {
    includeTelemetry: !skip && !full,
    includeFullTelemetryFrame: !skip && full,
    telemetryHz: rateHz,
  });
  const [state, setState] = useState<{ frame: any; received: boolean }>({ frame: undefined, received: false });
  const onTelemetry = useCallback((event: any) => {
    const frame = event?.frame ?? null;
    onFrameRef.current?.(frame);
    setState({ frame, received: true });
  }, []);
  useHubListener(null, 'TelemetryEvent', skip ? undefined : onTelemetry);
  return state;
}

export function useLiveTelemetry(skip = false): LiveTelemetryData {
  const { frame } = useLiveTelemetryFrame({ skip, rateHz: 30 });
  return computeTelemetryValues(frame);
}

export interface TelemetryStatusData {
  car: string;
  track: string;
  simStatus: string;
}

// Whether a sim is running, and its car and track — from the hub's slim
// TelemetryStatus event, which the backend sends only when one of them
// changes. Costs nothing on top of the hub connection every page already
// has, unlike useLiveTelemetry, which turns the full telemetry stream on.
export function useTelemetryStatus(skip = false, hub?: LiveUpdatesHub | null): TelemetryStatusData {
  const [status, setStatus] = useState<TelemetryStatusData>({ car: '', track: '', simStatus: '' });
  const onStatus = useCallback((event: any) => {
    const simStatus = event?.simStatus ?? '';
    setStatus({
      car: event?.car ?? '',
      track: event?.track ?? '',
      simStatus: SIM_STATUS_MAP[simStatus] ?? simStatus,
    });
  }, []);
  useHubListener(hub, 'TelemetryStatus', skip ? undefined : onStatus);
  return skip ? EMPTY_STATUS : status;
}

const EMPTY_STATUS: TelemetryStatusData = { car: '', track: '', simStatus: '' };

export function useTelemetryActive(skip = false): boolean {
  return useTelemetryStatus(skip).simStatus === 'Active';
}
