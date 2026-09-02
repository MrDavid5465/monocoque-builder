import React from 'react';
import { useParams } from 'react-router';
import CarDetail from '../Telemetry/Cars/CarDetail';

// Registered for BOTH ReactiveAdmin's show and edit slots — there's no
// kiosk/edit distinction for cars like there is for dashboards, so one thin
// wrapper serves both, reusing the exact same detail UI the existing
// /telemetry/cars/:id page renders directly.
const CarShow: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  return <CarDetail carRecordId={id ?? ''} />;
};

export default CarShow;
