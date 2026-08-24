import React from 'react';
import { Routes, Route } from 'react-router-dom';
import TelemetryAdminHome from './Home';
import DashboardsAdmin from './DashboardsAdmin';
import CarsAdmin from './CarsAdmin';
import Default from './Default';
import Show from './Show';
import GroupsAdmin from './GroupsAdmin';
import TemplatesAdmin from './TemplatesAdmin';
import RecordingsAdmin from './RecordingsAdmin';
import TracksAdmin from './TracksAdmin';

const TelemetryAdmin: React.FC = () => (
  <Routes>
    <Route path="/" element={<TelemetryAdminHome />} />
    <Route path="/dashboards/*" element={<DashboardsAdmin />} />
    <Route path="/cars/*" element={<CarsAdmin />} />
    <Route path="/groups/*" element={<GroupsAdmin />} />
    <Route path="/templates/*" element={<TemplatesAdmin />} />
    <Route path="/recordings/*" element={<RecordingsAdmin />} />
    <Route path="/tracks/*" element={<TracksAdmin />} />
    <Route path="/default" element={<Default />} />
    <Route path="/test" element={<Show />} />
  </Routes>
);

export default TelemetryAdmin;
