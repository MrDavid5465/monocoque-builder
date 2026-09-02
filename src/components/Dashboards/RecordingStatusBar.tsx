import React from 'react';
import { Stack, DefaultButton, useMutation, useQuery } from '../../lib/denim/lib';
import { GET_RECORDINGS, STOP_RECORDING, STOP_PLAYBACK, RECORDING_STATUS } from '../Telemetry/Recordings/queries';

// Global daemon-control status, prepended above the plain SwitchableList in
// RecordingsAdmin's `list` slot — recording/playback are singleton,
// server-wide state (not a property of any one row), so they don't fit
// CardList/List's per-record action buttons and live here instead, as the
// one deliberately-custom addition to an otherwise-default list view.
const RecordingStatusBar: React.FC = () => {
  const { data } = useQuery(RECORDING_STATUS, { pollInterval: 1000, fetchPolicy: 'network-only' });
  const isRecording = !!(data as any)?.recordingStatus?.isRecording;
  const isPlaying = !!(data as any)?.recordingStatus?.isPlaying;

  const [stopRecording, { loading: stopping }] = useMutation(STOP_RECORDING, { refetchQueries: [{ query: GET_RECORDINGS }] });
  const [stopPlayback] = useMutation(STOP_PLAYBACK);

  if (!isRecording && !isPlaying) return null;

  return (
    <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }} style={{ margin: '0 0 1em' }}>
      {isRecording && (
        <DefaultButton disabled={stopping} onClick={() => stopRecording()}>
          {stopping ? 'Stopping…' : '⏹ Stop Recording (in progress)'}
        </DefaultButton>
      )}
      {isPlaying && (
        <DefaultButton onClick={() => stopPlayback()}>⏹ Stop Playback</DefaultButton>
      )}
    </Stack>
  );
};

export default RecordingStatusBar;
