import React from 'react';
import { AdminMasterDetail } from '../../lib/denim-fabric';
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

// Module level: AdminMasterDetail memoizes on them.
const labels = { singular: 'Track', plural: 'Tracks' };
const listColumns = ['name'];
const listProps = { queryResultKey: 'getTrackLocations', idField: 'id', columnSelectable: true, storageKey: 'tracks-columns' };

// List | detail (denim-fabric's AdminMasterDetail): the list stays on screen
// beside the open record, and TrackEdit renders show/edit/new in the detail
// pane (a phone shows one pane at a time, with a back bar). Selection is the
// URL, so deep links (/dashboards/tracks/<id>/show) keep working.
// queryResultKey: List defaults it to `get${name.plural}`, which is not the
// resolver's name here (it rendered an empty table once for that reason).
const TracksAdmin: React.FC = () => (
  <AdminMasterDetail
    dispatcher={dispatcher}
    name={name}
    labels={labels}
    schemaDefinition={schemaDefinition}
    listColumns={listColumns}
    listProps={listProps}
    components={{
      show: TrackEdit,
      edit: TrackEdit,
      new: TrackEdit,
    }}
  />
);

export default TracksAdmin;
