import React from 'react';
import ReactiveAdmin from '../../lib/typical-admin-fabric';
import SwitchableList from '../../lib/typical-admin-fabric/SwitchableList';
import DashboardShow from './DashboardShow';
import DashboardEdit from './DashboardEdit';
import DashboardNew from './DashboardNew';
import { GET_DASHBOARDS, ADD_DASHBOARD, REMOVE_DASHBOARD } from '../Telemetry/DashboardDesigner/queries';
import { dashboardThumbnailUrl } from '../Telemetry/DashboardDesigner/thumbnailUrl';

// dispatcher.show/edit/new and schemaDefinition.show/edit/new are structurally
// required by IDispatcher/ITASchema (dispatcher.edit && schemaDefinition.edit
// both being truthy is what makes typical-admin/index.tsx register the
// /:id/edit route at all) but neither is actually read — DashboardShow /
// DashboardEdit / DashboardNew don't query through them, they just forward
// the route param to the designer or do their own create call, same
// rationale as CarsAdmin's show/edit/new. dispatcher.delete IS read directly
// (typical-admin-fabric/Show.tsx and CardList.tsx invoke it as the delete
// mutation) — no companion schemaDefinition.delete key exists or is needed.
const dispatcher = { list: GET_DASHBOARDS, show: GET_DASHBOARDS, edit: GET_DASHBOARDS, new: ADD_DASHBOARD, delete: REMOVE_DASHBOARD };
const name = { singular: 'Dashboard', plural: 'Dashboards' };
const dashboardSchema = {
  name: { label: 'Name' },
  thumbnailDay: {
    label: 'Thumbnail',
    onRender: ({ values }: { values: any }) => dashboardThumbnailUrl(values.dashboard?.thumbnailDay),
  },
};
const schemaDefinition = { list: { columns: dashboardSchema, buttons: { add: true } }, show: dashboardSchema, edit: {}, new: {} };

const DashboardsAdmin: React.FC = () => (
  <ReactiveAdmin
    dispatcher={dispatcher}
    name={name}
    schemaDefinition={schemaDefinition}
    components={{
      list: (props: any) => (
        <SwitchableList {...props} queryResultKey="getDashboardEntries" titleField="name" thumbnailField="thumbnailDay" idField="name" defaultView="card" thumbnailFit="contain" />
      ),
      show: DashboardShow,
      edit: DashboardEdit,
      new: DashboardNew,
    }}
  />
);

export default DashboardsAdmin;
