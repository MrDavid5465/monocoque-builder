import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useMatch } from 'react-router-dom';
import { useMutation, useQuery } from '@apollo/client/react';
import { mergeStyles, keyframes } from '@fluentui/react';
import { useLiveTelemetry } from './useLiveTelemetry';
import { REGISTER_CAR, REGISTER_TRACK } from './clientsQueries';
import { GET_KNOWN_CARS } from './Groups/queries';
import { GET_KNOWN_TRACKS } from './trackLocationQueries';
import { RECORDING_STATUS } from './Recordings/queries';
import { LiveUpdatesContext, useHubListener, useLiveUpdatesHub } from './liveUpdatesHub';

const blink = keyframes({
  '0%, 100%': { opacity: 1 },
  '50%': { opacity: 0.2 },
});

const blinkClass = mergeStyles({
  animation: `${blink} 1s ease-in-out infinite`,
});

type DotMode = 'recording' | 'playing' | 'active' | 'idle';

// Priority order when more than one is true at once: an in-progress
// recording is the most consequential state to surface globally (it's
// running in the background regardless of which page the user is on), then
// playback, then plain live-telemetry presence, then idle.
const MODE_COLOR: Record<DotMode, string> = {
  recording: '#d13438',
  playing: '#0078d4',
  active: '#4caf50',
  idle: '#666',
};

const MODE_TITLE: Record<DotMode, string> = {
  recording: 'Recording in progress',
  playing: 'Playing back a recording',
  active: 'Telemetry active',
  idle: 'No telemetry',
};

const StatusDot: React.FC<{ mode: DotMode }> = ({ mode }) => (
  <div
    title={MODE_TITLE[mode]}
    style={{
      display: 'flex',
      alignItems: 'center',
      height: '3.85em',
      paddingRight: '0.924em',
      paddingLeft: '0.385em',
      flexShrink: 0,
    }}
  >
    <div
      className={mode === 'recording' ? blinkClass : undefined}
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: MODE_COLOR[mode],
      }}
    />
  </div>
);

const TelemetryControls: React.FC = () => {
  const onDashRoute = !!useMatch('/telemetryadmin/dashboards/:name/show');
  const { car, track, simStatus } = useLiveTelemetry(onDashRoute);
  const isActive = simStatus === 'Active';

  // Global (not per-recording) status — this control lives in the nav bar
  // on every page, so it just needs to know *whether* something is
  // recording/playing anywhere, not which one; per-recording pages use
  // recordingId/playingId themselves (RecordingChart) to tell "this one" vs
  // "some other one" apart.
  //
  // One-shot preload (so the dot shows the real state immediately instead
  // of "idle" until the hub's first push) plus live updates via the shared
  // hub below — replaces the old 1s poll, which used to fire from every
  // mounted window's nav bar simultaneously and was enough to noticeably
  // lag a second window (each poll competing for the same ~6-connection
  // per-origin budget the hub exists to protect).
  const { data: statusData } = useQuery(RECORDING_STATUS, { fetchPolicy: 'cache-and-network' });
  const [liveStatus, setLiveStatus] = useState<{ isRecording: boolean; isPlaying: boolean } | undefined>(undefined);

  const contextHub = useContext(LiveUpdatesContext);
  // Controls is rendered on the nav bar for every route, never nested
  // inside DashboardDesigner's own <LiveUpdatesContext.Provider> (that's
  // scoped to the dashboard-show route's tree) — so there's normally no
  // ambient hub to pick up and this opens its own. `skip` still checks
  // context first in case that ever changes.
  const [ownHub, ownHubSubscriber] = useLiveUpdatesHub({ includeTelemetry: false, includeNightClock: false, skip: !!contextHub });
  const hub = contextHub ?? ownHub;

  const onRecordingChanged = useCallback((event: any) => {
    setLiveStatus({ isRecording: !!event.isRecording, isPlaying: !!event.isPlaying });
  }, []);
  useHubListener(hub, 'RecordingStatus', onRecordingChanged);

  const isRecording = liveStatus?.isRecording ?? !!(statusData as any)?.recordingStatus?.isRecording;
  const isPlaying = liveStatus?.isPlaying ?? !!(statusData as any)?.recordingStatus?.isPlaying;
  const mode: DotMode = isRecording ? 'recording' : isPlaying ? 'playing' : isActive ? 'active' : 'idle';

  const [registerCar] = useMutation(REGISTER_CAR, {
    refetchQueries: [{ query: GET_KNOWN_CARS }],
  });
  const lastCarRef = useRef('');
  useEffect(() => {
    if (onDashRoute || !car || simStatus !== 'Active') return;
    if (car !== lastCarRef.current) {
      lastCarRef.current = car;
      registerCar({ variables: { name: car } });
    }
  }, [car, simStatus, onDashRoute, registerCar]);

  const [registerTrack] = useMutation(REGISTER_TRACK, {
    refetchQueries: [{ query: GET_KNOWN_TRACKS }],
  });
  const lastTrackRef = useRef('');
  useEffect(() => {
    if (onDashRoute || !track || simStatus !== 'Active') return;
    if (track !== lastTrackRef.current) {
      lastTrackRef.current = track;
      registerTrack({ variables: { name: track } });
    }
  }, [track, simStatus, onDashRoute, registerTrack]);

  return <>{ownHubSubscriber}<StatusDot mode={mode} /></>;
};

export default TelemetryControls;
