import React from 'react';
import ReactiveAdmin from '../../lib/typical-admin-fabric';
import SwitchableList from '../../lib/typical-admin-fabric/SwitchableList';
import TrackEdit from './TrackEdit';
import { GET_TRACK_LOCATIONS, ADD_TRACK_LOCATION, REMOVE_TRACK_LOCATION } from '../Telemetry/trackLocationQueries';

// dispatcher.show/edit/new are structurally required by IDispatcher/ITASchema
// but not actually read — TrackEdit is a fully custom component (name +
// lat/lon + a geocode search helper + a newline-per-alias raw-track-ids
// list) that does its own fetching/mutating, same rationale as
// GroupsAdmin's/CarsAdmin's show/edit/new.
const dispatcher = { list: GET_TRACK_LOCATIONS, show: GET_TRACK_LOCATIONS, edit: GET_TRACK_LOCATIONS, new: ADD_TRACK_LOCATION, delete: REMOVE_TRACK_LOCATION };
const name = { singular: 'Track', plural: 'Tracks' };
const trackSchema = {
  name: { label: 'Name' },
  latitude: { label: 'Latitude' },
  longitude: { label: 'Longitude' },
};
const schemaDefinition = { list: { columns: trackSchema, buttons: { add: true } }, show: {}, edit: {}, new: {} };

// Table view (no natural thumbnail for a track location), same shape as
// GroupsAdmin.
const TracksAdmin: React.FC = () => (
  <ReactiveAdmin
    dispatcher={dispatcher}
    name={name}
    schemaDefinition={schemaDefinition}
    components={{
      list: (props: any) => (
        <SwitchableList
          {...props}
          // Type name is TrackLocation (query getTrackLocations) but the
          // display name here is "Track"/"Tracks" — SwitchableList defaults
          // to `get${name.plural}` ("getTracks"), which doesn't exist.
          queryResultKey="getTrackLocations"
          titleField="name"
          idField="id"
          defaultView="table"
          columnSelectable
          storageKey="tracks-columns"
        />
      ),
      show: TrackEdit,
      edit: TrackEdit,
      new: TrackEdit,
    }}
  />
);

export default TracksAdmin;
