import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart } from '@fluentui/react-charting';
import { Stack, DefaultButton, useMutation } from '../../lib/denim/lib';
import { useSubscription } from '@apollo/client/react';
import { RECORDING_LIVE_TELEMETRY_SUB, STOP_RECORDING } from '../Telemetry/Recordings/queries';
import { buildTimeSeries, collectFieldNames, flattenLiveFrame, ChartPoint } from '../Telemetry/Recordings/chartUtils';

const PALETTE = [
  '#0078d4', '#d13438', '#107c10', '#ffb900', '#5c2d91',
  '#e3008c', '#00b294', '#8764b8', '#ca5010', '#004b1c',
];

const WINDOW_FRAMES = 500;

// Frames aren't persisted (and so not queryable via getRecordingFrames)
// until stop_recording writes them to DuckDB — while `id` is the one
// actively being captured, this accumulates frames client-side straight off
// the live subscription instead, assigning each one a synthetic
// incrementing frameIndex (there's no real one yet). Window position
// auto-advances to keep the most recent WINDOW_FRAMES in view once the
// accumulated count exceeds it — an oscilloscope-style trailing window,
// same shape as RecordingChart's own windowed view but driven by arrival
// order instead of a user-controlled slider.
const RecordingLiveChart: React.FC<{ sampleRateHz: number }> = ({ sampleRateHz }) => {
  const { data } = useSubscription(RECORDING_LIVE_TELEMETRY_SUB);
  const [stopRecording, { loading: stopping }] = useMutation(STOP_RECORDING);

  const framesRef = useRef<any[]>([]);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const frame = (data as any)?.telemetry;
    if (!frame) return;
    // Append every tick, same as the backend's own recorder (telemetry/
    // recording.rs's start()) pushes a frame on every interval tick it gets
    // Some(d) back, with no dedup — a stationary car (0 speed, holding a
    // menu) is a legitimate recording, not noise to be filtered out.
    const flat = flattenLiveFrame(frame);
    flat.frameIndex = framesRef.current.length;
    framesRef.current.push(flat);
    setCount(framesRef.current.length);
  }, [data]);

  const windowPosition = Math.max(count - WINDOW_FRAMES, 0);
  const windowFrames = useMemo(
    () => framesRef.current.slice(windowPosition, windowPosition + WINDOW_FRAMES),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, windowPosition],
  );
  const series = useMemo<ChartPoint[]>(
    () => buildTimeSeries(windowFrames, sampleRateHz || 1),
    [windowFrames, sampleRateHz],
  );
  const allFields = useMemo(() => collectFieldNames(series), [series]);
  const fieldColor = (field: string) => PALETTE[allFields.indexOf(field) % PALETTE.length];

  const lineChartData = allFields.map(field => ({
    legend: field,
    color: fieldColor(field),
    data: series.map(p => ({ x: p.timeS, y: p.values[field] ?? 0 })),
  }));

  return (
    <div>
      <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 12 }} style={{ marginBottom: '0.5em' }}>
        <span style={{ opacity: 0.85 }}>Recording live — {count} frames captured</span>
        <DefaultButton disabled={stopping} onClick={() => stopRecording()}>
          {stopping ? 'Stopping…' : '⏹ Stop Recording'}
        </DefaultButton>
      </Stack>
      {series.length === 0 ? (
        <div style={{ opacity: 0.7, padding: '2em 0' }}>Waiting for the first frame…</div>
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
    </div>
  );
};

export default RecordingLiveChart;
