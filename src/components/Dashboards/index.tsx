import React from 'react';
import { Routes, Route } from 'react-router-dom';
import DashboardsAdmin from './DashboardsAdmin';
import CarsAdmin from './CarsAdmin';
import Default from './Default';
import Show from './Show';
import GroupsAdmin from './GroupsAdmin';
import TemplatesAdmin from './TemplatesAdmin';
import RecordingsAdmin from './RecordingsAdmin';
import TracksAdmin from './TracksAdmin';

// The dashboards list is this app's INDEX, not a child route of it. It used to
// sit at `/dashboards/*` with the app's `defaultRoute` bouncing `/dashboards`
// onto it, which put the name in the URL twice --
// `/dashboards/dashboards/963/show`, and `/kiosk/dashboards/dashboards/...`
// for a kiosk deep link.
//
// The splat is required rather than a bare index: DashboardsAdmin is a
// ReactiveAdmin, which registers its own `/:id/show`, `/:id/edit` and `/new`
// beneath wherever it is mounted. React Router v6 ranks by specificity rather
// than by order, so the static siblings still win over it -- it is last here
// anyway, so the file reads in match order.
const Dashboards: React.FC = () => (
  <Routes>
    <Route path="/cars/*" element={<CarsAdmin />} />
    <Route path="/groups/*" element={<GroupsAdmin />} />
    <Route path="/templates/*" element={<TemplatesAdmin />} />
    <Route path="/recordings/*" element={<RecordingsAdmin />} />
    <Route path="/tracks/*" element={<TracksAdmin />} />
    <Route path="/default" element={<Default />} />
    <Route path="/test" element={<Show />} />
    <Route path="/*" element={<DashboardsAdmin />} />
  </Routes>
);

export default Dashboards;
