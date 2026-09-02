import React from 'react';
import { Stack } from '../../lib/denim/lib';
import CardList from '../../lib/typical-admin-fabric/CardList';
import { GET_DASHBOARDS } from '../Telemetry/DashboardDesigner/queries';
import { GET_CARS } from '../Telemetry/carQueries';
import { dashboardThumbnailUrl } from '../Telemetry/DashboardDesigner/thumbnailUrl';

function apiBase() {
  return `http://${window.location.hostname}:9000`;
}

// dispatcher.show is structurally required by IDispatcher but never read —
// CardList doesn't render a show screen when used standalone like this.
const dashboardsDispatcher = { list: GET_DASHBOARDS, show: GET_DASHBOARDS };
const dashboardsName = { singular: 'Dashboard', plural: 'Dashboards' };
const dashboardsSchema = {
  name: { label: 'Name' },
  thumbnailDay: {
    label: 'Thumbnail',
    onRender: ({ values }: { values: any }) => dashboardThumbnailUrl(values.dashboard?.thumbnailDay),
  },
};

const carsDispatcher = { list: GET_CARS, show: GET_CARS };
const carsName = { singular: 'Car', plural: 'Cars' };
const carsSchema = {
  name: { label: 'Name' },
  thumbnail: {
    label: 'Thumbnail',
    onRender: ({ value }: { value?: string }) =>
      value ? `${apiBase()}/thumbnails/${encodeURIComponent(value)}` : undefined,
  },
};

// Typical SaaS-admin-style home page (not a sim-racing telemetry dashboard) —
// a quick-glance summary, not a full CRUD screen. No sorting/limiting yet;
// deliberately deferred.
const DashboardsHome: React.FC = () => (
  <Stack tokens={{ childrenGap: 16 }} style={{ padding: '2em' }}>
    <h2>Recently edited dashboards</h2>
    <CardList
      dispatcher={dashboardsDispatcher}
      name={dashboardsName}
      schemaDefinition={dashboardsSchema}
      queryResultKey="getDashboardEntries"
      titleField="name"
      thumbnailField="thumbnailDay"
      idField="name"
      // Without this the cards link to /dashboards/:id/show — this
      // page is the admin root, not the dashboards list route, so
      // CardList's pathname default is wrong here.
      basePath="/dashboards/dashboards"
      hideHeader
    />

    <h2>Recently edited cars</h2>
    <CardList
      dispatcher={carsDispatcher}
      name={carsName}
      schemaDefinition={carsSchema}
      titleField="name"
      thumbnailField="thumbnail"
      basePath="/dashboards/cars"
      hideHeader
    />
  </Stack>
);

export default DashboardsHome;
