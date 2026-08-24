import gql from 'graphql-tag';

export interface NightModeRecord {
  id: string;
  isNight: boolean;
  simEnabled?: boolean | null;
  simSpeedPercent?: number | null;
  simSunrise?: string | null;
  simSunset?: string | null;
  simTransitionMinutes?: number | null;
}

// sim_base_sim_time_ms / sim_base_real_time (the simulated-clock anchor) are
// deliberately NOT in this fragment — they're server-internal bookkeeping
// now (see NightMode's doc comment in typiql_types.rs); the frontend reads
// the live simulated clock via the nightClock subscription below instead,
// and adjusts it via adjustNightClockTime/setNightClockCycleHours rather
// than writing the anchor fields directly.
const NIGHT_MODE_FIELDS = `
  id
  isNight
  simEnabled
  simSpeedPercent
  simSunrise
  simSunset
  simTransitionMinutes
`;

export const GET_NIGHT_MODES = gql`
  query getNightModes {
    getNightModes { ${NIGHT_MODE_FIELDS} }
  }
`;

export const ADD_NIGHT_MODE = gql`
  mutation addNightMode($values: NightModeInput!) {
    addNightMode(values: $values) { ${NIGHT_MODE_FIELDS} }
  }
`;

export const UPDATE_NIGHT_MODE = gql`
  mutation updateNightMode($id: String!, $update: NightModeInput!) {
    updateNightMode(id: $id, update: $update) { ${NIGHT_MODE_FIELDS} }
  }
`;

export interface NightClockTick {
  simTimeMs: number;
  realTimeMs: number;
}

// ONE subscription for both record change events (manual isNight/simEnabled/
// sunrise/sunset/etc, on add/update/remove) and the ~60Hz (16ms, matching
// telemetry's own tick rate) server-authoritative simulated-clock tick
// (graphql/night_clock.rs) —
// deliberately merged into a single GraphQL union rather than two separate
// subscriptions. A browser holds only ~6 concurrent HTTP/1.1 connections per
// origin, and dashboard pages already keep 1-2 long-lived subscriptions
// open; adding a second always-on NightMode subscription on top of that
// starved the pool and hung unrelated mutations mid-request (discovered
// live: an updateNightMode request was sent but its response never arrived
// while a standalone nightClock subscription was also open on the same
// page). See graphql/mod.rs's NightModeUpdateEvent for the server side.
export const NIGHT_MODE_UPDATES = gql`
  subscription nightModeUpdates {
    nightModeUpdates {
      __typename
      ... on NightModeChanged {
        operationName
        value { ${NIGHT_MODE_FIELDS} }
      }
      ... on NightClockTick {
        simTimeMs
        realTimeMs
      }
    }
  }
`;

// One-shot read of the current simulated-clock tick, mirroring the
// subscription's own payload — lets a freshly-mounted consumer (the
// day/night popup) render the real current time immediately on open
// instead of showing a placeholder ("—") until the subscription's first
// push arrives (up to one tick interval later).
export const GET_NIGHT_CLOCK_SNAPSHOT = gql`
  query getNightClockSnapshot {
    nightClockSnapshot {
      simTimeMs
      realTimeMs
    }
  }
`;

export const ADJUST_NIGHT_CLOCK_TIME = gql`
  mutation adjustNightClockTime($deltaMinutes: Float!) {
    adjustNightClockTime(deltaMinutes: $deltaMinutes) { ${NIGHT_MODE_FIELDS} }
  }
`;

export const SET_NIGHT_CLOCK_CYCLE_HOURS = gql`
  mutation setNightClockCycleHours($hours: Float!) {
    setNightClockCycleHours(hours: $hours) { ${NIGHT_MODE_FIELDS} }
  }
`;

// Computes real sunrise/sunset for a picked calendar date at whatever
// TrackLocation the CURRENT live telemetry track resolves to (see
// graphql/night_clock.rs) — errors (no live track, unrecognized track,
// track known but no location set) are meant to be shown to the user
// directly, they're the next action to take (e.g. "add this track on the
// Tracks page").
export const SET_SUNRISE_SUNSET_FROM_DATE = gql`
  mutation setSunriseSunsetFromDate($date: String!) {
    setSunriseSunsetFromDate(date: $date) { ${NIGHT_MODE_FIELDS} }
  }
`;
