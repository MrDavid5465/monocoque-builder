import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { LineChart } from '@fluentui/react-charting';
import { Spinner } from '@fluentui/react';
import { Stack, IconButton, PrimaryButton, DefaultButton, Modal, Form, useMutation } from '../../lib/denim/lib';
import { confirmAsync } from '../../lib/denim/components/ConfirmDialog';
import { useQuery, useApolloClient } from '@apollo/client/react';
import { GET_RECORDING, GET_RECORDING_FRAMES_WINDOW, PLAY_RECORDING, STOP_PLAYBACK, CROP_RECORDING, RECORDING_STATUS } from '../Telemetry/Recordings/queries';
import {
  buildTimeSeries, collectFieldNames, buildFieldSelectSchema, resampleSeries, toCsv, downloadCsv, ChartPoint,
} from '../Telemetry/Recordings/chartUtils';
import RecordingLiveChart from './RecordingLiveChart';

// A fixed color per field index, cycled — react-charting doesn't auto-assign
// distinguishable colors the way some charting libs do.
const PALETTE = [
  '#0078d4', '#d13438', '#107c10', '#ffb900', '#5c2d91',
  '#e3008c', '#00b294', '#8764b8', '#ca5010', '#004b1c',
];

// Export rate select + an in-form 'button' field (Fabric.tsx's 'button'
// case) below it, so the trigger lives in the same schema/Form as the rate
// it applies to instead of a sibling element bolted on beside it. The
// button's onClick is a plain callback (per-form doesn't thread it through
// form values) — `handleExport` already reads current state directly.
function exportFormSchema(sourceHz: number, onExport: () => void, exportDisabled: boolean) {
  const options = [sourceHz, 30, 15, 5, 1]
    .filter((hz, i, arr) => hz <= sourceHz && arr.indexOf(hz) === i)
    .map(hz => ({ text: `${hz} Hz`, value: String(hz) }));
  return {
    exportRateHz: { type: 'select', label: 'Export rate', options },
    exportCsv: { type: 'button', label: 'Export CSV', variant: 'primary', disabled: exportDisabled, onClick: onExport },
  };
}

const DEFAULT_WINDOW_FRAMES = 500;
// Frames per background-prefetch request — large enough to cover the whole
// recording in a handful of requests, small enough that one chunk never
// blocks the UI thread for long or produces an unreasonably large payload.
const BACKGROUND_CHUNK_FRAMES = 2000;

// Position's own max shrinks as size grows, so the window can never be
// dragged/grown past the end of the recording — this is what keeps
// `position + size` in bounds without needing to clamp size itself. Window
// changes commit live (see the Form's onChange below) rather than only on
// drag-release — cheap now that most of the recording is already sitting
// in the background-prefetch cache (see framesCacheRef), so dragging within
// already-loaded territory never touches the network at all.
function timeWindowSchema(totalFrames: number, windowSize: number) {
  const maxPosition = Math.max(totalFrames - windowSize, 0);
  return {
    windowSize: { type: 'slider', label: 'Window size (frames)', min: 0, max: totalFrames, step: 1 },
    windowPosition: { type: 'slider', label: 'Window position (frame)', min: 0, max: maxPosition, step: 1 },
  };
}

const RecordingChart: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const client = useApolloClient();

  // Metadata only — cheap, gives us frameCount up front to size the window
  // slider without ever fetching frame data.
  const { data, loading, refetch: refetchRecording } = useQuery(GET_RECORDING, { variables: { id }, skip: !id });
  const recording = (data as any)?.getRecording;

  const { data: statusData, loading: statusLoading } = useQuery(RECORDING_STATUS, { pollInterval: 1000, fetchPolicy: 'network-only' });
  const status = (statusData as any)?.recordingStatus;
  const isRecording = !!status?.isRecording;
  const isPlaying = !!status?.isPlaying;
  // This id is the one actively being captured right now (as opposed to
  // some *other* recording elsewhere) — only then does the live,
  // still-accumulating chart make sense; otherwise (including "nothing is
  // recording") this page shows the normal persisted-frame view below.
  const isLiveRecordingThis = isRecording && status?.recordingId === id;
  const isPlayingThis = isPlaying && status?.playingId === id;
  const [playRecording, { loading: startingPlayback }] = useMutation(PLAY_RECORDING);
  const [stopPlayback] = useMutation(STOP_PLAYBACK);
  const [cropRecording, { loading: cropping }] = useMutation(CROP_RECORDING);

  // Once this recording's live capture ends, its frameCount/durationMs in
  // JSON metadata are stale (set at start, only corrected by
  // stop_recording's persist step) — refetch so the transition into the
  // normal windowed view below picks up the real final values instead of
  // momentarily rendering "no frames" from the pre-recording snapshot.
  // `pendingRefetch` is flipped *during render* (not inside the effect that
  // fires the actual network call) specifically so the hydrate block below —
  // which also runs during render, not as an effect — sees it on the exact
  // same render where `isLiveRecordingThis` flips false. `data` itself
  // doesn't update until the refetch's promise resolves, so without this the
  // hydrate block would seed windowSize from a stale frameCount: 0 on that
  // render and never revisit it (hydrated only runs once).
  const wasLiveRecordingRef = useRef(false);
  const [pendingRefetch, setPendingRefetch] = useState(false);
  if (wasLiveRecordingRef.current && !isLiveRecordingThis && !pendingRefetch) {
    setPendingRefetch(true);
  }
  wasLiveRecordingRef.current = isLiveRecordingThis;
  useEffect(() => {
    if (pendingRefetch) refetchRecording().finally(() => setPendingRefetch(false));
  }, [pendingRefetch, refetchRecording]);

  // `windowForm` is the slider's live display value, updated (and committed
  // to `committedWindow`, which actually drives the getRecordingFrames
  // fetch/render) on every drag tick — not just on release. This is cheap
  // even during a drag because the background prefetch loop (below) has
  // usually already covered the range by the time the user scrubs there:
  // `isWindowCached` skips the network fetch entirely when so, so a live
  // update within already-loaded territory is a pure re-render, no request.
  // Only genuinely unvisited territory (rare — background loading is fast)
  // falls back to an on-demand per-tick fetch.
  const [windowForm, setWindowForm] = useState({ windowSize: 0, windowPosition: 0 });
  const [committedWindow, setCommittedWindow] = useState({ windowSize: 0, windowPosition: 0 });
  // Bumped only when growing the window forces a position clamp — per-form's
  // Form is uncontrolled after mount (initialValues only apply once), so
  // just updating windowForm's state doesn't make the position slider's own
  // *displayed* number snap back on its own. Changing this key forces a
  // fresh Form/useForm instance (same technique PlaybackPanel's `formKey`
  // uses) so the slider visually reflects the corrected value — done only
  // on an actual clamp, not every drag, so normal dragging within bounds
  // never remounts mid-interaction.
  const [windowFormKey, setWindowFormKey] = useState(0);

  // recording isn't available on first render (still loading) — seed once
  // it arrives, same "hydrate on first data arrival" pattern GroupEdit uses
  // for its own async-loaded initial state. Sized from recording.frameCount
  // (metadata, already known) rather than waiting for any frame data.
  const [exportForm, setExportForm] = useState({ exportRateHz: '' });
  const [hydrated, setHydrated] = useState(false);
  // Held off while this recording is still live-capturing — recording.frameCount
  // is a stale pre-recording snapshot until stop_recording persists it (see
  // the refetch effect above), so hydrating now would seed a bogus
  // windowSize: 0 and never revisit it once `hydrated` flips true.
  // `!statusLoading` additionally closes a *mount-time* race distinct from
  // the transition above: RECORDING_STATUS's first network response hasn't
  // landed yet on first render, so `isRecording`/`isLiveRecordingThis`
  // default to false even when this recording genuinely is live — without
  // this guard, navigating straight into a brand-new live recording (see
  // RecordingNew.tsx) could hydrate from frameCount: 0 before the status
  // query even gets a chance to say otherwise.
  if (!hydrated && recording && !statusLoading && !isLiveRecordingThis && !pendingRefetch) {
    setExportForm({ exportRateHz: String(recording.sampleRateHz) });
    // Default the initial window to a small slice, not the whole recording —
    // with every field checked by default (per spec), a long recording
    // rendered at full width is tens/hundreds of thousands of SVG points and
    // measurably hangs the chart on first load. "All fields shown by
    // default" only ever meant the field picker, not the time window —
    // scrubbing to a wider window is exactly what the window slider is for.
    const initial = { windowSize: Math.min(recording.frameCount, DEFAULT_WINDOW_FRAMES), windowPosition: 0 };
    setWindowForm(initial);
    setCommittedWindow(initial);
    setHydrated(true);
  }

  // Every frame fetched so far — from the windowed query below *and* from
  // the background prefetch loop — keyed by frameIndex. Once a window's
  // full range is present here, scrubbing to it is instant: no network
  // round trip, no loading spinner, just re-slicing already-loaded data.
  // A plain ref (not state) because it can grow to thousands of entries and
  // we don't want a re-render on every single merge — `cacheVersion` is the
  // narrow signal downstream memos actually depend on.
  const framesCacheRef = useRef<Map<number, any>>(new Map());
  const [cacheVersion, setCacheVersion] = useState(0);
  const mergeIntoCache = (frames: any[]): boolean => {
    let added = false;
    for (const f of frames) {
      if (f && !framesCacheRef.current.has(f.frameIndex)) {
        framesCacheRef.current.set(f.frameIndex, f);
        added = true;
      }
    }
    return added;
  };

  const isWindowCached = useMemo(() => {
    if (committedWindow.windowSize === 0) return false;
    const lastIndex = committedWindow.windowPosition + committedWindow.windowSize - 1;
    for (let i = committedWindow.windowPosition; i <= lastIndex; i++) {
      if (!framesCacheRef.current.has(i)) return false;
    }
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedWindow, cacheVersion]);

  const { data: framesData, previousData: framesPreviousData, loading: framesLoading } = useQuery(
    GET_RECORDING_FRAMES_WINDOW,
    {
      variables: {
        recordingId: id,
        lo: committedWindow.windowPosition,
        hi: committedWindow.windowPosition + committedWindow.windowSize - 1,
      },
      // Skip the network round trip entirely once the background prefetch
      // (see the effect below) has already covered this window.
      skip: !id || committedWindow.windowSize === 0 || isWindowCached,
    },
  );
  // Fall back to the previous window's data while a new window is loading —
  // avoids a flash back to "no data" on every drag-release re-fetch (only
  // the true first load, with no previousData yet, shows the spinner).
  const effectiveFramesData = (framesData ?? framesPreviousData) as any;

  // Feed the on-demand windowed query's own results into the shared cache
  // too, so a range the user has already scrubbed to (fetched on demand,
  // ahead of wherever the background loop has reached) doesn't get fetched
  // again later either.
  useEffect(() => {
    const frames = effectiveFramesData?.getRecordingFrames;
    if (frames?.length && mergeIntoCache(frames)) setCacheVersion(v => v + 1);
     
  }, [effectiveFramesData]);

  // Background prefetch: once hydrated, walk the whole recording in fixed
  // chunks and merge each into the shared cache — this is what makes
  // scrubbing to an as-yet-unvisited part of the recording feel instant
  // once the loop has caught up, without ever blocking the initial paint
  // (the first window is already showing via the on-demand query above).
  // Best-effort: a failed chunk just means that range falls back to an
  // on-demand fetch if/when the user scrubs there before this loop retries.
  useEffect(() => {
    if (!hydrated || !recording || !id) return;
    let cancelled = false;

    (async () => {
      const total = recording.frameCount as number;
      for (let lo = 0; lo < total; lo += BACKGROUND_CHUNK_FRAMES) {
        if (cancelled) return;
        const hi = Math.min(lo + BACKGROUND_CHUNK_FRAMES - 1, total - 1);
        let needsFetch = false;
        for (let i = lo; i <= hi; i++) {
          if (!framesCacheRef.current.has(i)) { needsFetch = true; break; }
        }
        if (!needsFetch) continue;
        try {
          const { data: chunkData } = await client.query({
            query: GET_RECORDING_FRAMES_WINDOW,
            variables: { recordingId: id, lo, hi },
            fetchPolicy: 'network-only',
          });
          if (cancelled) return;
          const frames = (chunkData as any)?.getRecordingFrames;
          if (frames?.length && mergeIntoCache(frames)) setCacheVersion(v => v + 1);
        } catch {
          // best-effort — see comment above.
        }
      }
    })();

    return () => { cancelled = true; };
    // Re-runs whenever `recording.frameCount` changes, not just once per
    // mount — normally it's stable after the initial hydrate, but a crop
    // (see handleCrop below) shrinks it and reindexes every kept frame, at
    // which point the cache (already cleared by handleCrop) needs a fresh
    // background pass over the new, smaller range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, id, recording?.frameCount]);

  const series = useMemo<ChartPoint[]>(() => {
    if (committedWindow.windowSize === 0) return [];
    if (isWindowCached) {
      const lastIndex = committedWindow.windowPosition + committedWindow.windowSize - 1;
      const frames: any[] = [];
      for (let i = committedWindow.windowPosition; i <= lastIndex; i++) {
        const f = framesCacheRef.current.get(i);
        if (f) frames.push(f);
      }
      return buildTimeSeries(frames, recording?.sampleRateHz || 1);
    }
    const frames = effectiveFramesData?.getRecordingFrames;
    if (!frames?.length) return [];
    return buildTimeSeries(frames, recording?.sampleRateHz || 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWindowCached, committedWindow, cacheVersion, effectiveFramesData, recording]);

  const allFields = useMemo(() => collectFieldNames(series), [series]);
  const [checkedFields, setCheckedFields] = useState<Set<string> | null>(null);
  const visibleFields = checkedFields ?? new Set(allFields);
  const fieldColor = (field: string) => PALETTE[allFields.indexOf(field) % PALETTE.length];

  const [pickerOpen, setPickerOpen] = useState(false);
  // A border around the checkbox itself (tried first) was reported nearly
  // impossible to distinguish — a small colored dot between the checkbox and
  // its label, matching the chart's own hover-tooltip dots, reads much more
  // clearly. `onRenderLabel` is a real Fluent Checkbox prop (passed through
  // by Fabric's checkbox case via `{...rest}`), so this needs no new field
  // type — just a per-field schema override, same mechanism `styles` used.
  const fieldSelectSchema = useMemo(() => {
    const schema = buildFieldSelectSchema(allFields);
    for (const field of allFields) {
      const color = fieldColor(field);
      schema[field] = {
        ...schema[field],
        onRenderLabel: () => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5em' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <span>{field}</span>
          </span>
        ),
      };
    }
    return schema;
  }, [allFields]);

  if (loading) return <div style={{ padding: '1.2em 1.5em' }}><Spinner label="Loading recording…" /></div>;
  if (!recording) return <div style={{ padding: '1.2em 1.5em' }}>Recording not found.</div>;

  const fieldsToPlot = allFields.filter(f => visibleFields.has(f));
  const windowStartS = committedWindow.windowPosition / (recording.sampleRateHz || 1);
  const windowEndS = (committedWindow.windowPosition + committedWindow.windowSize - 1) / (recording.sampleRateHz || 1);

  const lineChartData = fieldsToPlot.map(field => ({
    legend: field,
    color: fieldColor(field),
    data: series.map(p => ({ x: p.timeS, y: p.values[field] ?? 0 })),
  }));

  const handleExport = () => {
    const targetHz = parseFloat(exportForm.exportRateHz);
    const resampled = resampleSeries(series, recording.sampleRateHz || 1, targetHz);
    // sampleRateHz here is the *export* rate (targetHz), not necessarily
    // recording.sampleRateHz — it's what actually governs this file's
    // time_s deltas, and what a re-imported Recording's own rate should be.
    const csv = toCsv(resampled, fieldsToPlot, { sampleRateHz: targetHz, car: recording.car });
    downloadCsv(`${recording.name.replace(/[^a-z0-9-_]+/gi, '_')}.csv`, csv);
  };

  const cropIsFullRecording = committedWindow.windowPosition === 0 && committedWindow.windowSize === recording.frameCount;

  const handleCrop = async () => {
    const lo = committedWindow.windowPosition;
    const hi = committedWindow.windowPosition + committedWindow.windowSize - 1;
    const ok = await confirmAsync(
      `Permanently delete every frame outside the current window (frames ${lo}–${hi}), keeping only what's shown? This cannot be undone.`,
      { danger: true, confirmText: 'Crop' },
    );
    if (!ok) return;

    await cropRecording({ variables: { id, lo, hi } });

    // Every kept frame was reindexed server-side to start at 0, so the
    // entire client-side cache (keyed by the *old* frameIndex) is stale —
    // clear it rather than try to remap it. Deriving the reset window from
    // the mutation's own refetch result (not the component's `recording`
    // variable, which won't reflect the new frameCount until re-render)
    // avoids the same stale-data race fixed for the live-recording
    // transition above.
    framesCacheRef.current.clear();
    setCacheVersion(v => v + 1);
    const { data: fresh } = await refetchRecording();
    const freshFrameCount = (fresh as any)?.getRecording?.frameCount ?? 0;
    const next = { windowSize: Math.min(freshFrameCount, DEFAULT_WINDOW_FRAMES), windowPosition: 0 };
    setWindowForm(next);
    setCommittedWindow(next);
    setWindowFormKey(k => k + 1);
  };

  return (
    <div style={{ padding: '1.2em 1.5em' }}>
      <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }} style={{ marginBottom: '1em' }}>
        <IconButton iconProps={{ iconName: 'Back' }} title="Back" onClick={() => navigate(pathname.replace(`/${id}/show`, ''))} />
        <span style={{ fontSize: '1.2em', fontWeight: 700 }}>{recording.name}</span>
      </Stack>

      {isLiveRecordingThis ? (
        <RecordingLiveChart sampleRateHz={recording.sampleRateHz || 60} />
      ) : recording.frameCount === 0 ? (
        <div style={{ opacity: 0.7 }}>This recording has no frames.</div>
      ) : (
        <>
          {framesLoading && !effectiveFramesData ? (
            <div style={{ padding: '2em 0' }}><Spinner label="Loading frames…" /></div>
          ) : (
            <LineChart
              data={{ lineChartData }}
              height={420}
              width={900}
              hideLegend
              yAxisTickFormat={(v: number) => String(v)}
              optimizeLargeData
              enablePerfOptimization
            />
          )}

          <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 12 }} style={{ margin: '0.5em 0' }}>
            <span style={{ opacity: 0.75, fontSize: '0.85em' }}>
              Time window: {windowStartS.toFixed(1)}s – {windowEndS.toFixed(1)}s
            </span>
            <DefaultButton onClick={() => setPickerOpen(true)}>Legend ({fieldsToPlot.length}/{allFields.length})</DefaultButton>
          </Stack>

          <div style={{ maxWidth: 900, marginBottom: '1em' }}>
            <Form
              key={windowFormKey}
              form={timeWindowSchema(recording.frameCount, windowForm.windowSize)}
              name="timeWindow"
              initialValues={windowForm}
              onChange={(_, { raw }) => {
                const nextSize = raw.windowSize ?? windowForm.windowSize;
                // If growing the window would read past the recording's end,
                // pull the position back rather than let the read overflow —
                // and force the Form to remount so the position slider's own
                // displayed number visually snaps back too, not just the
                // internal state used for the chart/export read.
                const nextMaxPosition = Math.max(recording.frameCount - nextSize, 0);
                const rawPosition = raw.windowPosition ?? windowForm.windowPosition;
                const clampedPosition = Math.min(rawPosition, nextMaxPosition);
                if (clampedPosition !== rawPosition) setWindowFormKey(k => k + 1);
                const next = { windowSize: nextSize, windowPosition: clampedPosition };
                setWindowForm(next);
                setCommittedWindow(next);
              }}
            />
          </div>

          {/* Playback controls now live down here with the window/crop/export
              controls they act alongside, instead of the header — this is
              also what turns the page from pure viewing into editing (crop
              permanently deletes frames), so it reads better as one "controls"
              section than a header action plus a separate section below. */}
          <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }} style={{ margin: '0.5em 0 1em' }}>
            {isPlayingThis ? (
              <DefaultButton onClick={() => stopPlayback()}>⏹ Stop Playback</DefaultButton>
            ) : (
              <PrimaryButton
                disabled={startingPlayback || isRecording || recording.frameCount === 0}
                onClick={() => playRecording({ variables: { id } })}
              >
                {startingPlayback
                  ? 'Starting…'
                  : isPlaying
                    ? '▶ Play this recording (stops other playback)'
                    : '▶ Play this recording'}
              </PrimaryButton>
            )}
            <DefaultButton
              disabled={cropping || cropIsFullRecording || committedWindow.windowSize === 0}
              onClick={handleCrop}
              title={cropIsFullRecording ? 'Window already covers the whole recording — nothing to crop' : 'Delete every frame outside the current window'}
            >
              {cropping ? 'Cropping…' : '✂ Crop to window'}
            </DefaultButton>
          </Stack>

          <div style={{ maxWidth: 220 }}>
            <Form
              form={exportFormSchema(recording.sampleRateHz || 60, handleExport, fieldsToPlot.length === 0)}
              name="exportRate"
              initialValues={exportForm}
              onChange={(_, { raw }) => setExportForm({ exportRateHz: raw.exportRateHz ?? exportForm.exportRateHz })}
            />
          </div>

          {pickerOpen && (
            <Modal isOpen onDismiss={() => setPickerOpen(false)} styles={{ main: { maxWidth: 640, width: '90vw' } }}>
              <Stack style={{ padding: '1em 1.5em', maxHeight: '80vh', overflowY: 'auto' }}>
                <Stack horizontal horizontalAlign="space-between" verticalAlign="center" style={{ marginBottom: '0.5em' }}>
                  <span style={{ fontWeight: 700, fontSize: '1.1em' }}>Chart fields</span>
                  <IconButton iconProps={{ iconName: 'Cancel' }} title="Close" onClick={() => setPickerOpen(false)} />
                </Stack>
                <Form
                  form={fieldSelectSchema}
                  name="fieldSelect"
                  initialValues={Object.fromEntries(allFields.map(f => [f, visibleFields.has(f)]))}
                  onChange={(_, { raw }) => {
                    const next = new Set<string>();
                    for (const [k, v] of Object.entries(raw)) if (v) next.add(k);
                    setCheckedFields(next);
                  }}
                />
              </Stack>
            </Modal>
          )}
        </>
      )}
    </div>
  );
};

export default RecordingChart;
