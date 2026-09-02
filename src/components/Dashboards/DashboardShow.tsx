import React from 'react';
import { useParams } from 'react-router';
import DashboardDesigner from '../Telemetry/DashboardDesigner';

// Adapts the existing kiosk-mode designer to ReactiveAdmin's `show` slot.
// The Dashboards CardList uses idField="name" so :id here is actually the
// dashboard's name — DashboardDesigner already does its own data-fetching by
// name (same as the existing #/telemetry/dash/:name route), so no separate
// lookup query is needed. No extra back/nav chrome: kiosk mode's own exit
// button already calls navigate(-1), which correctly returns here regardless
// of which app hosts this route.
const DashboardShow: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  return <DashboardDesigner dashboardName={id ?? ''} kioskMode={true} />;
};

export default DashboardShow;
