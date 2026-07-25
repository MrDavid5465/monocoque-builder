import React from 'react';
import ReactiveAdmin from '../../lib/typical-admin-fabric';
import SwitchableList from '../../lib/typical-admin-fabric/SwitchableList';
import Links from '../../lib/typical-admin-fabric/Links';
import RecordingStatusBar from './RecordingStatusBar';
import RecordingImport from './RecordingImport';
import RecordingNew from './RecordingNew';
import RecordingChart from './RecordingChart';
import { GET_RECORDINGS, GET_RECORDING, START_RECORDING, REMOVE_RECORDING } from '../Telemetry/Recordings/queries';

// SwitchableList renders `components.links` (falling back to the shared
// `Links`) inside its own header's icon row, alongside the list/card view
// toggle — the "controls" row for this admin page. Prepending Import there
// (rather than modifying the shared Links.tsx every other admin page also
// uses) puts it in that row without affecting anything else.
const RecordingsLinks: React.FC<any> = props => (
  <>
    <RecordingImport />
    <Links {...props} />
  </>
);

function formatDuration(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rem = (s % 60).toFixed(1);
  return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
}

// dispatcher.show is structurally required but not actually read — RecordingChart
// is a fully custom component that does its own fetching, same rationale as
// CarsAdmin's show/edit. dispatcher.new (startRecording) is likewise unused
// by RecordingNew's own direct mutation call — its presence just makes
// ReactiveAdmin's generic Links header show the "+" button and register the
// /new route (see typical-admin/index.tsx). No `edit` — nothing on a
// Recording is user-editable after creation, so that slot/route is
// deliberately omitted (CardList only shows its edit icon when
// dispatcher.edit is set).
const dispatcher = { list: GET_RECORDINGS, show: GET_RECORDING, new: START_RECORDING, delete: REMOVE_RECORDING };
const name = { singular: 'Recording', plural: 'Recordings' };
const recordingSchema = {
  name: { label: 'Name' },
  frameCount: { label: 'Frames' },
  durationMs: { label: 'Duration', onRender: ({ value }: { value: number }) => formatDuration(value ?? 0) },
  sampleRateHz: { label: 'Rate (Hz)' },
  car: { label: 'Car' },
};
const schemaDefinition = { list: recordingSchema, show: {}, new: {} };

const RecordingsAdmin: React.FC = () => (
  <ReactiveAdmin
    dispatcher={dispatcher}
    name={name}
    schemaDefinition={schemaDefinition}
    components={{
      list: (props: any) => (
        <>
          <RecordingStatusBar />
          <SwitchableList
            {...props}
            titleField="name"
            idField="id"
            defaultView="list"
            components={{ ...props.components, links: RecordingsLinks }}
          />
        </>
      ),
      show: RecordingChart,
      new: RecordingNew,
    }}
  />
);

export default RecordingsAdmin;
