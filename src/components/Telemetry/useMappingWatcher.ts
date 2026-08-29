import { useRef, useEffect, useCallback } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import dispatcher from '../../lib/denim/lib/queries';
import { getAppId } from '../../graphql/client';
import { GET_DEVICE_DEFAULTS } from './deviceDefaultsQueries';
import { GET_DASH_GROUPS } from './Groups/queries';
import { REGISTER_CAR, REGISTER_TRACK } from './clientsQueries';

export function useMappingWatcher(
  onChanged: () => void,
  skip = false,
  car = '',
  simStatus = '',
  track = '',
): { handleDeviceDefaultEvent: (event: any) => void } {
  const appId = getAppId();
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const [registerCar] = useMutation(REGISTER_CAR);
  const registerCarRef = useRef(registerCar);
  registerCarRef.current = registerCar;

  const [registerTrack] = useMutation(REGISTER_TRACK);
  const registerTrackRef = useRef(registerTrack);
  registerTrackRef.current = registerTrack;

  // ── device name for this app instance ──────────────────────────────────────
  const { data: myData } = useQuery(dispatcher.my, { skip });
  const deviceName: string | undefined = (myData as any)?.my?.settings?.deviceMap?.[appId];
  const deviceNameRef = useRef<string | undefined>(undefined);
  deviceNameRef.current = deviceName;

  // ── redirect when this device's default dash changes ───────────────────────
  const handleDeviceDefaultEvent = useCallback((event: any) => {
    if (!event) return;
    if (event.operationName === 'add') return;
    const changedName: string | undefined = event.value?.deviceName;
    if (changedName === deviceNameRef.current || changedName === 'default') {
      onChangedRef.current();
    }
  }, []);

  // ── car-specific dash group data ───────────────────────────────────────────
  const { data: defaultsData } = useQuery(GET_DEVICE_DEFAULTS, { skip });
  const deviceDefaults: any[] = (defaultsData as any)?.getDeviceDefaults ?? [];
  const groupName: string | undefined = deviceName
    ? deviceDefaults.find(d => d.deviceName === deviceName)?.group
    : undefined;

  const { data: groupsData } = useQuery(GET_DASH_GROUPS, { skip: skip || !groupName });
  const group = groupName
    ? ((groupsData as any)?.getDashGroups ?? []).find((g: any) => g.name === groupName)
    : undefined;

  const carDashMap: Record<string, string> = (() => {
    try { return group ? JSON.parse(group.carDashMap ?? '{}') : {}; } catch { return {}; }
  })();

  const carSpecificEnabled = Object.keys(carDashMap).length > 0;

  // ── car registration — fires whenever the active car or sim status changes ─
  const lastCarRef = useRef('');
  useEffect(() => {
    if (skip || !car) return;
    if (simStatus === 'Active' && car !== lastCarRef.current) {
      lastCarRef.current = car;
      registerCarRef.current({ variables: { name: car } });
    }
  }, [car, simStatus, skip]);

  // ── track registration — fires whenever the active track or sim status changes ─
  const lastTrackRef = useRef('');
  useEffect(() => {
    if (skip || !track) return;
    if (simStatus === 'Active' && track !== lastTrackRef.current) {
      lastTrackRef.current = track;
      registerTrackRef.current({ variables: { name: track } });
    }
  }, [track, simStatus, skip]);

  // ── car-specific dash routing — navigates when car changes mid-session ─────
  const currentCarRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (skip || !carSpecificEnabled) return;
    const prev = currentCarRef.current;
    currentCarRef.current = car;
    if (prev !== undefined && car !== prev) onChangedRef.current();
  }, [car, skip, carSpecificEnabled]);

  return { handleDeviceDefaultEvent };
}
