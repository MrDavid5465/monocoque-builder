import React from 'react';
import { useParams } from 'react-router';
import DashboardDesigner from '../Telemetry/DashboardDesigner';

// Same pattern as DashboardShow, but kioskMode={false} — the full editor,
// matching what the existing #/telemetry/manage/:name route renders.
const DashboardEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  return <DashboardDesigner dashboardName={id ?? ''} kioskMode={false} />;
};

export default DashboardEdit;
