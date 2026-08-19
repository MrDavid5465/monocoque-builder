import React, { useMemo, useRef, useState } from 'react';
import { DefaultButton, Stack, TextField, Toggle, Separator, getTheme, useQuery, useMutation, Form } from '../../lib/denim/lib';
import {
  GET_NIGHT_MODES,
  ADD_NIGHT_MODE,
  UPDATE_NIGHT_MODE,
  ADJUST_NIGHT_CLOCK_TIME,
  SET_NIGHT_CLOCK_CYCLE_HOURS,
  SET_SUNRISE_SUNSET_FROM_DATE,
  NightModeRecord,
} from './nightModeQueries';
import { useGlobalNightMode } from './useGlobalNightMode';
import { computeSimulatedNightState, formatTimeOfDay, parseTimeOfDay } from './dayNightSim';

// Converts between the two ways of expressing simulated clock speed:
// "a full 24h in-game day takes N real hours" <-> "N% of real-time speed".
// Only the hours form is shown in the UI now (the old duration/percent dual
// field was reported hard to use) — percent is purely an internal storage
// detail on NightMode.simSpeedPercent.
const HOURS_PER_DAY = 24;
function hoursFromSpeedPercent(speedPercent: number | null | undefined): number {
  const percent = speedPercent ?? 100;
  return percent > 0 ? (HOURS_PER_DAY * 100) / percent : HOURS_PER_DAY;
}

// per-form's `timetoday` field reads/writes a Date's *local* hour/minute
// components directly (Fabric.tsx's handleTimeChange), and dayNightSim.ts's
// parseTimeOfDay/formatTimeOfDay treat "HH:MM" as a plain, timezone-agnostic
// label — so no UTC conversion is needed here, just a direct round-trip
// through today's date + the parsed/formatted hour and minute.
function hhmmToDisplayDate(hhmm: string | null | undefined): Date {
  const parsed = parseTimeOfDay(hhmm) ?? 0;
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(parsed / 60), parsed % 60, 0);
}
function displayDateToHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Discrete nudges for the server-authoritative simulated clock (see
// graphql/night_clock.rs's adjustNightClockTime) — replaces free-typing an
// absolute date/time, which is both what a person actually does at the rig
// (dial the clock in to match what's on the in-game display) and what
// removed the render-loop trigger reported against the old datetime field.
const ADJUST_STEPS_MIN = [-720, -360, -60, -30, -15, -5, -1, 1, 5, 15, 30, 60, 360, 720];
function labelForMinutes(m: number): string {
  const sign = m < 0 ? '-' : '+';
  const abs = Math.abs(m);
  return abs % 60 === 0 ? `${sign}${abs / 60}h` : `${sign}${abs}m`;
}

// Fields that ARE persisted form state (edited via a value, not a momentary
// action) — kept in per-form's closed catalog. `simEnabled` has no native
// toggle-switch type, so it uses the `custom` escape hatch; everything else
// maps directly. Module-level so this object's identity is stable across
// renders (per-form always rebuilds its own internal `fullSchema` from this
// regardless, but there's no reason to hand it a fresh object every render).
// Split into two schemas (rendered as two separate <Form>s below) so the
// live simulated-time display + nudge buttons can sit between the toggle
// and the rest of the config fields — a single <Form> always renders its
// whole field list as one flat block, with no slot to inject other content
// partway through.
const toggleSchema = {
  simEnabled: {
    type: 'custom' as const,
    label: 'Day/night source',
    onRender: ({ value, onChange, name }: any) => (
      <Toggle
        label="Day/night source"
        checked={!!value}
        onText="Simulated clock"
        offText="Manual toggle"
        onChange={(_e: any, checked?: boolean) => onChange(name, !!checked)}
      />
    ),
  },
};
const configSchema = {
  cycleHours: {
    type: 'text' as const,
    label: 'Day/night cycle length (hours)',
  },
  simSunrise: { type: 'timetoday' as const, label: 'Sunrise' },
  simSunset: { type: 'timetoday' as const, label: 'Sunset' },
  simTransitionMinutes: { type: 'slider' as const, label: 'Dawn/dusk transition (minutes)', min: 0, max: 240, step: 5 },
};

// Shared by the gear-icon popup (Canvas.tsx) and the Settings modal's
// Day/Night tab — one form, one query/mutation pair, mounted in two places.
// Manages its own NightMode record independently of useGlobalNightMode
// (which is read-focused for rendering consumers, not editing).
//
// Wrapped in React.memo (below, at the export) because Canvas.tsx renders
// `<DayNightSimPanel />` inline with zero props, directly inside a
// component tree that re-renders at telemetry's own ~60Hz tick rate.
// Without memoization, every one of those Canvas re-renders was also
// re-rendering this entire panel — including its two per-form <Form>s and
// their Fluent ComboBoxes (the Sunrise/Sunset `timetoday` fields) — 60
// times a second whenever the gear popup was open. That churn was the
// actual cause of a real "Maximum update depth exceeded" warning observed
// live after a few rapid nudge-button clicks (reproduced with the
// playwright-verify skill against the live kiosk view, not just inferred).
// Since this component takes no props, React.memo is unconditionally safe
// here — it still re-renders normally from its own query/mutation/context
// changes, it just stops re-rendering purely because its parent did.
const DayNightSimPanel: React.FC = () => {
  const theme = getTheme();
  const { data } = useQuery(GET_NIGHT_MODES, { fetchPolicy: 'cache-and-network' });
  const [addNightMode] = useMutation(ADD_NIGHT_MODE);
  const [updateNightMode] = useMutation(UPDATE_NIGHT_MODE);
  const [adjustNightClockTime] = useMutation(ADJUST_NIGHT_CLOCK_TIME);
  const [setNightClockCycleHours] = useMutation(SET_NIGHT_CLOCK_CYCLE_HOURS);
  const [setSunriseSunsetFromDate, { loading: computingSunTimes }] = useMutation(SET_SUNRISE_SUNSET_FROM_DATE);
  const current = ((data as any)?.getNightModes ?? [])[0] as NightModeRecord | undefined;

  // Defaults to today — pick a different date to get that day's real
  // sunrise/sunset instead (e.g. simulating a summer day while actually
  // playing in winter). Uses whatever track live telemetry currently
  // reports (see graphql/night_clock.rs); errors (no live track, track not
  // linked to a Track Location yet) are shown here directly.
  const [computeDate, setComputeDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [computeError, setComputeError] = useState<string | null>(null);
  const handleComputeFromDate = () => {
    setComputeError(null);
    setSunriseSunsetFromDate({ variables: { date: computeDate } }).catch((err: any) => {
      setComputeError(err?.message ?? 'Failed to compute sunrise/sunset');
    });
  };

  // Reuses useGlobalNightMode's subscription for the live clock tick rather
  // than opening a second one — see NIGHT_MODE_UPDATES's doc comment for why
  // that's not just a style preference (a second always-on subscription on
  // top of this one starved the browser's connection pool and hung
  // unrelated mutations).
  const { simTimeMs } = useGlobalNightMode();

  const save = (update: Partial<NightModeRecord>) => {
    if (current?.id) {
      updateNightMode({ variables: { id: current.id, update } });
    } else {
      addNightMode({ variables: { values: update } });
    }
  };

  // Config fields (toggle/sunrise/sunset/transition) and the cycle-hours
  // field hit different mutations, so each gets its own debounce timer —
  // editing both around the same time shouldn't let one cancel the other's
  // pending call.
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const debouncedSave = (update: Partial<NightModeRecord>) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => save(update), 500);
  };
  const hoursTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const debouncedSetCycleHours = (hours: number) => {
    if (hoursTimeoutRef.current) clearTimeout(hoursTimeoutRef.current);
    hoursTimeoutRef.current = setTimeout(() => {
      setNightClockCycleHours({ variables: { hours } });
    }, 500);
  };

  // Memoized so per-form's useForm doesn't see a new `initialValues`
  // reference on every re-render and re-trigger its onChange useEffect —
  // see DashboardDesigner/ObjectExplorer.tsx's established convention for
  // every one of its own Form usages (and the render-loop this app hit when
  // a per-form usage skipped it).
  const currentHours = hoursFromSpeedPercent(current?.simSpeedPercent);
  const toggleInitialValues = useMemo(() => ({
    simEnabled: !!current?.simEnabled,
  }), [current?.simEnabled]);
  const configInitialValues = useMemo(() => ({
    cycleHours: currentHours.toFixed(2),
    simSunrise: hhmmToDisplayDate(current?.simSunrise ?? '06:00'),
    simSunset: hhmmToDisplayDate(current?.simSunset ?? '20:00'),
    simTransitionMinutes: current?.simTransitionMinutes ?? 40,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [currentHours, current?.simSunrise, current?.simSunset, current?.simTransitionMinutes]);

  // Multi-field onChange convention (per DashPanEditor's
  // handleDashPanFormChange): fires on ANY field change with the full raw
  // values for THAT Form, so branch by diffing each tracked field against
  // its last-known (server) value rather than the form/field name.
  //
  // Deliberately TWO separate handlers, one per <Form> below — NOT one
  // shared handler branching on field presence. A single shared handler
  // here was a real bug: it unconditionally checked `raw.simEnabled`, but
  // the config Form's `raw` (sunrise/sunset/cycleHours/transition) never
  // has a `simEnabled` key at all, so `!!raw.simEnabled` was always `false`
  // whenever the config Form's onChange fired — including on every mount,
  // i.e. every time the popup opened — and got diffed against the REAL
  // current value, spuriously flipping simulated mode to manual on every
  // popup open with no user interaction at all. Scoping each handler to
  // only the fields its own Form actually declares makes that class of bug
  // impossible instead of just fixing this one instance of it.
  const handleToggleFormChange = (_n: string, { raw }: any) => {
    const newSimEnabled = !!raw.simEnabled;
    if (newSimEnabled !== !!current?.simEnabled) {
      debouncedSave({ simEnabled: newSimEnabled });
    }
  };

  const handleConfigFormChange = (_n: string, { raw }: any) => {
    const patch: Partial<NightModeRecord> = {};
    let changed = false;

    const newSunrise = raw.simSunrise instanceof Date ? displayDateToHHMM(raw.simSunrise) : undefined;
    if (newSunrise && newSunrise !== current?.simSunrise) {
      patch.simSunrise = newSunrise;
      changed = true;
    }
    const newSunset = raw.simSunset instanceof Date ? displayDateToHHMM(raw.simSunset) : undefined;
    if (newSunset && newSunset !== current?.simSunset) {
      patch.simSunset = newSunset;
      changed = true;
    }
    if (raw.simTransitionMinutes != null && raw.simTransitionMinutes !== current?.simTransitionMinutes) {
      patch.simTransitionMinutes = raw.simTransitionMinutes;
      changed = true;
    }
    if (changed) debouncedSave(patch);

    const hours = parseFloat(raw.cycleHours);
    if (Number.isFinite(hours) && hours > 0 && Math.abs(hours - currentHours) > 0.005) {
      debouncedSetCycleHours(hours);
    }
  };

  const preview = simTimeMs != null && current ? computeSimulatedNightState(simTimeMs, current) : null;

  return (
    <Stack tokens={{ childrenGap: '0.77em' }} style={{ minWidth: 320 }}>
      <span style={{ fontSize: '0.78em', opacity: 0.65 }}>
        Since telemetry doesn't report the sim's own clock, the server tracks it for you — nudge it to match what's
        currently shown in-game, and every dashboard follows the same clock through a gradual dawn/dusk.
      </span>

      {/* Remounts once, when the record first loads from the network — per-form's
          <Form> is uncontrolled and snapshots initialValues only at mount. */}
      <Form
        key={current ? `loaded-toggle-${current.id}` : 'loading-toggle'}
        form={toggleSchema}
        name="dayNightSimToggle"
        initialValues={toggleInitialValues}
        onChange={handleToggleFormChange}
      />

      <Stack tokens={{ childrenGap: 2 }}>
        <span style={{ fontSize: '0.85em', fontWeight: 600 }}>
          {simTimeMs != null
            ? `Simulated time: ${formatTimeOfDay(new Date(simTimeMs).getUTCHours() * 60 + new Date(simTimeMs).getUTCMinutes())}`
            : 'Simulated time: —'}
        </span>
        <span style={{ fontSize: '0.78em', color: theme.palette.neutralSecondary }}>
          {preview
            ? `Currently ${preview.nightAmount >= 0.5 ? 'night' : 'day'} (${Math.round(preview.nightAmount * 100)}% night)`
            : 'Set sunrise/sunset below to preview'}
        </span>
      </Stack>

      <Stack tokens={{ childrenGap: 4 }}>
        <span style={{ fontSize: '0.78em', opacity: 0.65 }}>Nudge simulated time</span>
        <Stack horizontal wrap tokens={{ childrenGap: 4 }}>
          {ADJUST_STEPS_MIN.map(m => (
            <DefaultButton
              key={m}
              text={labelForMinutes(m)}
              onClick={() => adjustNightClockTime({ variables: { deltaMinutes: m } })}
              styles={{ root: { minWidth: 0, padding: '0 0.6em' } }}
            />
          ))}
        </Stack>
      </Stack>

      <Separator />

      <Form
        key={current ? `loaded-config-${current.id}` : 'loading-config'}
        form={configSchema}
        name="dayNightSimConfig"
        initialValues={configInitialValues}
        onChange={handleConfigFormChange}
      />

      <Stack tokens={{ childrenGap: 4 }}>
        <span style={{ fontSize: '0.78em', opacity: 0.65 }}>
          Or compute real sunrise/sunset for a date, at whatever track is currently live
        </span>
        <Stack horizontal verticalAlign="end" tokens={{ childrenGap: 8 }}>
          <TextField
            type="date"
            value={computeDate}
            onChange={(_e, v) => setComputeDate(v ?? '')}
            styles={{ root: { flex: 1 } }}
          />
          <DefaultButton
            text={computingSunTimes ? 'Computing…' : 'Compute from date'}
            disabled={computingSunTimes || !computeDate}
            onClick={handleComputeFromDate}
          />
        </Stack>
        {computeError && (
          <span style={{ fontSize: '0.78em', color: theme.semanticColors.errorText }}>{computeError}</span>
        )}
      </Stack>
    </Stack>
  );
};

export default React.memo(DayNightSimPanel);
