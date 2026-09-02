import React, { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@apollo/client/react';
import dispatcher from '../../lib/denim/lib/queries';
import { getAppId } from '../../graphql/client';
import { GET_DASH_GROUPS } from '../Telemetry/Groups/queries';
import { TELEMETRY_SNAPSHOT } from '../Telemetry/queries';
import { GET_DEVICE_DEFAULTS } from '../Telemetry/deviceDefaultsQueries';

// Device/group-driven auto-launch — ported from the old #/telemetry app's
// Default.tsx verbatim except for the two navigate targets, which now point
// at dashboards's own dashboard show (kiosk) route and its dashboards
// list instead of the old app's /telemetry/dash/* and /telemetry/manage.
const Default: React.FC = () => {
  const navigate = useNavigate();
  const { data: myData, loading: myLoading } = useQuery(dispatcher.my);
  const settings = (myData as any)?.my?.settings;
  const appId = getAppId();

  const deviceName: string | undefined = settings?.deviceMap?.[appId];

  const { data: defaultsData, loading: defaultsLoading } = useQuery(GET_DEVICE_DEFAULTS);
  const deviceDefaults: Array<{ deviceName: string; dash?: string; group?: string }> =
    (defaultsData as any)?.getDeviceDefaults ?? [];

  const deviceRec = deviceName ? deviceDefaults.find(d => d.deviceName === deviceName) : undefined;
  const globalRec = deviceDefaults.find(d => d.deviceName === 'default');

  const groupName: string | undefined = deviceRec?.group;
  const deviceDash: string | undefined = deviceRec?.dash;

  const { data: groupsData, loading: groupsLoading } = useQuery(GET_DASH_GROUPS, {
    skip: !groupName,
  });

  const { data: snapData } = useQuery(TELEMETRY_SNAPSHOT, {
    pollInterval: 1000,
    fetchPolicy: 'network-only',
  });
  const car: string | undefined = (snapData as any)?.telemetrySnapshot?.car;

  const group = groupName
    ? ((groupsData as any)?.getDashGroups ?? []).find((g: any) => g.name === groupName)
    : null;

  useEffect(() => {
    const loading = myLoading || defaultsLoading || (!!groupName && groupsLoading);
    if (loading || !myData || !defaultsData) return;

    if (groupName && group) {
      const carDashMap: Record<string, string> = (() => {
        try { return JSON.parse(group.carDashMap ?? '{}'); } catch { return {}; }
      })();
      const targetDash = (car && carDashMap[car]) || group.defaultDash;
      if (targetDash) {
        navigate(`/dashboards/dashboards/${encodeURIComponent(targetDash)}/show`, { replace: true });
        return;
      }
    }

    if (deviceDash) {
      navigate(`/dashboards/dashboards/${encodeURIComponent(deviceDash)}/show`, { replace: true });
      return;
    }

    const globalDash = globalRec?.dash;
    if (globalDash) {
      navigate(`/dashboards/dashboards/${encodeURIComponent(globalDash)}/show`, { replace: true });
      return;
    }

    navigate('/dashboards/dashboards', { replace: true });
  }, [myData, myLoading, defaultsData, defaultsLoading, group, groupsLoading, car, groupName, deviceDash, globalRec, navigate]);

  return <div style={{ padding: '2em' }}>Loading…</div>;
};

export default Default;
