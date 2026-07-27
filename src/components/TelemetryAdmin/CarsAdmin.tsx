import React from 'react';
import ReactiveAdmin from '../../lib/typical-admin-fabric';
import SwitchableList from '../../lib/typical-admin-fabric/SwitchableList';
import CarShow from './CarShow';
import CarNew from './CarNew';
import { GET_CARS, ADD_CAR, DELETE_CAR } from '../Telemetry/carQueries';

function apiBase() {
  return `http://${window.location.hostname}:9000`;
}

// dispatcher.show/edit/new and schemaDefinition.show/edit/new are structurally
// required by IDispatcher/ITASchema but not actually read here — CarShow/CarNew
// are fully custom components that do their own fetching/mutating, same
// rationale as DashboardsAdmin's show/edit.
const dispatcher = { list: GET_CARS, show: GET_CARS, edit: GET_CARS, new: ADD_CAR, delete: DELETE_CAR };
const name = { singular: 'Car', plural: 'Cars' };
const carSchema = {
  name: { label: 'Name' },
  thumbnail: {
    label: 'Thumbnail',
    onRender: ({ value }: { value?: string }) =>
      value ? `${apiBase()}/thumbnails/${encodeURIComponent(value)}` : undefined,
  },
};
const schemaDefinition = { list: { columns: carSchema, buttons: { add: true } }, show: carSchema, edit: {}, new: {} };

const CarsAdmin: React.FC = () => (
  <ReactiveAdmin
    dispatcher={dispatcher}
    name={name}
    schemaDefinition={schemaDefinition}
    components={{
      list: (props: any) => (
        <SwitchableList {...props} titleField="name" thumbnailField="thumbnail" defaultView="card" />
      ),
      show: CarShow,
      edit: CarShow,
      new: CarNew,
    }}
  />
);

export default CarsAdmin;
