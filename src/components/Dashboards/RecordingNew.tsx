import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Stack, PrimaryButton, IconButton, Form, useMutation, useQuery } from '../../lib/denim/lib';
import { GET_RECORDINGS, START_RECORDING, RECORDING_STATUS } from '../Telemetry/Recordings/queries';

const START_RECORDING_SCHEMA = {
  name: { type: 'text', label: 'Session name' },
  sampleRateHz: {
    type: 'select',
    label: 'Sample rate',
    options: [
      { text: '60 Hz (full rate — driving/replay)', value: '60' },
      { text: '30 Hz', value: '30' },
      { text: '15 Hz', value: '15' },
      { text: '5 Hz (long-session analysis)', value: '5' },
      { text: '1 Hz', value: '1' },
    ],
  },
};

// ReactiveAdmin's `new` slot — bypasses the generic schema-form Create.tsx,
// same rationale as CarNew.tsx: starting a recording is a side-effecting
// action (arms the backend poller), not a plain field-mapped `addX`
// mutation, so this drives its own `startRecording` call directly rather
// than going through `dispatcher.new`.
const RecordingNew: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [startForm, setStartForm] = useState({ name: '', sampleRateHz: '60' });

  const { data: statusData } = useQuery(RECORDING_STATUS, { fetchPolicy: 'network-only' });
  const isRecording = !!(statusData as any)?.recordingStatus?.isRecording;
  const [startRecording, { loading }] = useMutation(START_RECORDING, { refetchQueries: [{ query: GET_RECORDINGS }] });

  const handleStart = async () => {
    const sessionName = startForm.name.trim() || `Recording ${new Date().toLocaleString()}`;
    const result = await startRecording({ variables: { name: sessionName, sampleRateHz: parseFloat(startForm.sampleRateHz) } });
    const newId = (result.data as any)?.startRecording?.id;
    // Go straight to the new recording's own show page (now live, per
    // RecordingChart's isLiveRecordingThis branch) rather than back to the
    // list — that's the whole point of the live chart, seeing it draw as it
    // records. Falls back to the list only if the mutation didn't return an
    // id for some reason.
    navigate(newId ? `${pathname.replace('/new', '')}/${newId}/show` : pathname.replace('/new', ''));
  };

  return (
    <div style={{ padding: '1.2em 1.5em', maxWidth: 360 }}>
      <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }} style={{ marginBottom: '1em' }}>
        <IconButton iconProps={{ iconName: 'Back' }} onClick={() => navigate(pathname.replace('/new', ''))} title="Back" />
        <span style={{ fontSize: '1.2em', fontWeight: 700 }}>New Recording</span>
      </Stack>

      {isRecording && (
        <div style={{ opacity: 0.75, marginBottom: '1em' }}>
          A recording is already in progress — stop it from the list before starting another.
        </div>
      )}

      <Form
        form={START_RECORDING_SCHEMA}
        name="startRecording"
        initialValues={startForm}
        onChange={(_, { raw }) => setStartForm({
          name: raw.name ?? '',
          sampleRateHz: raw.sampleRateHz ?? '60',
        })}
      />

      <PrimaryButton disabled={loading || isRecording} style={{ marginTop: '1em' }} onClick={handleStart}>
        {loading ? 'Starting…' : '⏺ Start Recording'}
      </PrimaryButton>
    </div>
  );
};

export default RecordingNew;
