import React, { useEffect, useContext } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { Stack, IconButton, Form, FormCard } from '../../../lib/denim/lib';
import { GET_KNOWN_CARS } from '../Groups/queries';
import {
  GET_CARS, UPDATE_CAR, DELETE_CAR, UPLOAD_CAR_PHOTO, UPLOAD_CAR_PHOTO_NIGHT, DELETE_CAR_PHOTO_NIGHT,
  SYNC_CAR_PHOTOS, CAR_CHANGED, SET_FAVORITE_CAR, CarRecord, CarPhotoRef, parseCarIds,
} from '../carQueries';
import Subscriber from '../../../lib/typical-admin/Subscriber';
import { useGlobalPreviewCar } from '../useGlobalPreviewCar';
import { LiveUpdatesContext, useLiveUpdatesDemand, useLiveUpdatesHub } from '../liveUpdatesHub';
import DashPanEditor from './DashPanEditor';
import Car360Capture from './Car360Capture';
import { confirmAsync } from '../../../lib/denim/components/ConfirmDialog';
import { GET_PROFILES as GET_SHAKER_PROFILES, UPDATE_PROFILE as UPDATE_SHAKER_PROFILE } from '../../Shakers/Profiles/queries';
import { GET_PROFILES as GET_LEDS_PROFILES, UPDATE_PROFILE as UPDATE_LEDS_PROFILE, profileResultKey as ledsProfileResultKey } from '../../LedsDevices/Profiles/queries';
import { GET_PROFILES as GET_SHIFT_LIGHT_PROFILES, UPDATE_PROFILE as UPDATE_SHIFT_LIGHT_PROFILE, profileResultKey as shiftLightProfileResultKey } from '../../ShiftLights/Profiles/queries';
import { GET_PROFILES as GET_SIM_WIND_PROFILES, UPDATE_PROFILE as UPDATE_SIM_WIND_PROFILE, profileResultKey as simWindProfileResultKey } from '../../SimWindDevices/Profiles/queries';

function apiBase() {
  return `http://${window.location.hostname}:9000`;
}

interface Props {
  carRecordId: string;
  onBack?: () => void;
}

type ProfileRef = { id: string; name: string; carId?: string | null };

// The one shared detail/edit UI for a Car record — mounted both from the
// existing #/telemetry/cars/:id page and from #/telemetryadmin/cars's show
// and edit slots. Does its own data-fetching (fetch-whole-list-and-find-by-id,
// same convention useDashboard.ts already uses) so both hosts can just pass
// the record id and nothing else.
const CarDetail: React.FC<Props> = ({ carRecordId, onBack }) => {
  const { data: carsData, refetch } = useQuery(GET_CARS, { fetchPolicy: 'cache-and-network' });
  const { data: knownCarsData } = useQuery(GET_KNOWN_CARS, { fetchPolicy: 'cache-and-network' });
  // Recomputes content-hash ids from whatever's actually on disk right now,
  // so a photo file replaced outside the app is picked up on load instead of
  // silently staying stale.
  useQuery(SYNC_CAR_PHOTOS, { variables: { id: carRecordId }, fetchPolicy: 'network-only' });

  const [updateCar] = useMutation(UPDATE_CAR);
  const [deleteCar] = useMutation(DELETE_CAR);
  const [uploadCarPhoto] = useMutation(UPLOAD_CAR_PHOTO);
  const [uploadCarPhotoNight] = useMutation(UPLOAD_CAR_PHOTO_NIGHT);
  const [deleteCarPhotoNight] = useMutation(DELETE_CAR_PHOTO_NIGHT);
  // Refetches because promoting one car clears the flag on every other,
  // which the mutation's own response doesn't describe.
  const [setFavoriteCar] = useMutation(SET_FAVORITE_CAR, { refetchQueries: [{ query: GET_CARS }] });

  // Wires this Car to a Shaker/LED/Shift Light/SimWind device profile for
  // per-car fine-tuning (see SoundDeviceProfile.carId's backend doc comment)
  // — the link lives on each profile's own carId, set/cleared from here.
  // All 4 selects live in one Form (see the profile FormCard below), so the
  // 4 profile lists/mutations are fetched here rather than behind a separate
  // per-type component. No live subscriptions — refetchQueries keeps each
  // list fresh, and stacking up subscriptions on one page risks starving
  // other requests (see ShakerMatrix's own profile card, which hit exactly
  // this: the browser's 6-connections-per-host HTTP/1.1 ceiling).
  const { data: shakerProfilesData } = useQuery(GET_SHAKER_PROFILES);
  const { data: ledsProfilesData } = useQuery(GET_LEDS_PROFILES);
  const { data: shiftLightProfilesData } = useQuery(GET_SHIFT_LIGHT_PROFILES);
  const { data: simWindProfilesData } = useQuery(GET_SIM_WIND_PROFILES);
  const [updateShakerProfile] = useMutation(UPDATE_SHAKER_PROFILE, { refetchQueries: [{ query: GET_SHAKER_PROFILES }] });
  const [updateLedsProfile] = useMutation(UPDATE_LEDS_PROFILE, { refetchQueries: [{ query: GET_LEDS_PROFILES }] });
  const [updateShiftLightProfile] = useMutation(UPDATE_SHIFT_LIGHT_PROFILE, { refetchQueries: [{ query: GET_SHIFT_LIGHT_PROFILES }] });
  const [updateSimWindProfile] = useMutation(UPDATE_SIM_WIND_PROFILE, { refetchQueries: [{ query: GET_SIM_WIND_PROFILES }] });

  const cars: CarRecord[] = (carsData as any)?.getCars ?? [];
  const car = cars.find(c => c.id === carRecordId);
  const knownCarIds: string[] = ((knownCarsData as any)?.getKnownCars ?? []).map((c: any) => c.id);

  const shakerProfiles: ProfileRef[] = (shakerProfilesData as any)?.getSoundDeviceProfiles ?? [];
  const ledsProfiles: ProfileRef[] = (ledsProfilesData as any)?.[ledsProfileResultKey] ?? [];
  const shiftLightProfiles: ProfileRef[] = (shiftLightProfilesData as any)?.[shiftLightProfileResultKey] ?? [];
  const simWindProfiles: ProfileRef[] = (simWindProfilesData as any)?.[simWindProfileResultKey] ?? [];
  const linkedShakerProfile = shakerProfiles.find(p => p.carId === carRecordId) ?? null;
  const linkedLedsProfile = ledsProfiles.find(p => p.carId === carRecordId) ?? null;
  const linkedShiftLightProfile = shiftLightProfiles.find(p => p.carId === carRecordId) ?? null;
  const linkedSimWindProfile = simWindProfiles.find(p => p.carId === carRecordId) ?? null;

  const claimedByOthers = new Set(
    cars.filter(c => c.id !== carRecordId).flatMap(parseCarIds)
  );

  const rawIds = car ? parseCarIds(car) : [];
  const dayPhoto = car?.dayPhoto;
  const nightPhoto = car?.nightPhoto;

  // While viewing a car that has a 360° photo uploaded, kiosks (when the sim
  // isn't actually running) preview this car live so pan edits show up
  // immediately without needing to actually drive it. Uses the FIRST raw
  // car_id — PreviewCar.carId must stay in the raw-id domain to blend with
  // live telemetry's own raw car_id in DashboardDesigner, never the Car
  // record's own id. Clears on navigating away.
  const primaryRawId = rawIds[0];
  // Opened once here and provided to the nested DashPanEditor (which calls
  // useGlobalNightMode() with no explicit hub) via context, so this page
  // needs only ONE dashboardUpdates connection instead of two separate
  // ones — see liveUpdatesHub.tsx's own doc comment. includeNightClock:true
  // for DashPanEditor's day/night preview toggle; includeTelemetry stays
  // false, neither this page nor DashPanEditor renders live telemetry.
  // Prefers the app-root provider; the own hub is the fallback for being
  // rendered outside it (same pattern as useGlobalNightMode/Controls).
  const ambientHub = useContext(LiveUpdatesContext);
  const [ownHub, liveUpdatesHubSubscriber] = useLiveUpdatesHub({
    includeNightClock: false,
    skip: !!ambientHub,
  });
  const liveUpdatesHub = ambientHub ?? ownHub;
  // The night clock drives this page's 360 preview, so ask for it explicitly
  // rather than relying on a private hub's defaults.
  useLiveUpdatesDemand(liveUpdatesHub, { includeNightClock: true });
  const { setPreviewCarId, ready: previewCarReady } = useGlobalPreviewCar(liveUpdatesHub);
  useEffect(() => {
    if (primaryRawId && car?.dayPhoto && previewCarReady) {
      setPreviewCarId(primaryRawId);
      // Keeps saying it. The unmount cleanup below is still the normal way
      // this ends, but it only runs on a clean React unmount — closing the
      // tab, killing the app or a crash all skip it, and this pin is global
      // and persisted, so skipping it used to leave every dashboard in the
      // house showing this car indefinitely. Re-confirming lets the backend
      // expire an abandoned pin without ever dropping one still in use
      // (PIN_TTL is 15 minutes against this 60s interval — see
      // preview_car.rs).
      const keepAlive = setInterval(() => setPreviewCarId(primaryRawId), 60_000);
      return () => {
        clearInterval(keepAlive);
        setPreviewCarId('');
      };
    }
    // Depend on dayPhoto's id (a primitive), not the dayPhoto object itself —
    // a fresh object reference on every render would otherwise risk an
    // infinite effect/setState loop.
  }, [primaryRawId, car?.dayPhoto?.id, previewCarReady, setPreviewCarId]);

  if (!car) {
    return <span style={{ opacity: 0.6, padding: '1em' }}>Car not found.</span>;
  }

  const identitySchema = {
    name: { label: 'Friendly name' },
    carIds: {
      type: 'multi-select' as const,
      label: 'Game car IDs',
      options: knownCarIds.map(id => ({ text: id, value: id, disabled: claimedByOthers.has(id) })),
    },
  };

  const profileSchema = {
    shakerProfileId: {
      type: 'select' as const,
      label: 'Shaker Profile',
      options: [{ text: '— None —', value: '' }, ...shakerProfiles.map(p => ({ text: p.name, value: p.id }))],
    },
    ledProfileId: {
      type: 'select' as const,
      label: 'LED Profile',
      options: [{ text: '— None —', value: '' }, ...ledsProfiles.map(p => ({ text: p.name, value: p.id }))],
    },
    shiftLightProfileId: {
      type: 'select' as const,
      label: 'Shift Light Profile',
      options: [{ text: '— None —', value: '' }, ...shiftLightProfiles.map(p => ({ text: p.name, value: p.id }))],
    },
    simWindProfileId: {
      type: 'select' as const,
      label: 'SimWind Profile',
      options: [{ text: '— None —', value: '' }, ...simWindProfiles.map(p => ({ text: p.name, value: p.id }))],
    },
  };

  const photoSchema = {
    dayPhoto: {
      type: 'image-upload' as const,
      label: '360° Day Photo',
      placeholderText: 'No 360° photo yet. Upload one below.',
      uploadLabel: 'Upload Photo',
      resolveUrl: (v: CarPhotoRef) => `${apiBase()}${v.url}`,
      uploadFn: async (dataUrl: string, filename: string) => {
        const result = await uploadCarPhoto({ variables: { id: car.id, filename, data: dataUrl } });
        return (result.data as any)?.uploadCarPhoto?.dayPhoto;
      },
    },
    nightPhoto: {
      type: 'image-upload' as const,
      label: '360° Night Photo',
      uploadLabel: 'Add Night Photo',
      placeholderText: 'No night photo — falls back to day.',
      allowClear: true,
      resolveUrl: (v: CarPhotoRef) => `${apiBase()}${v.url}`,
      uploadFn: async (dataUrl: string, filename: string) => {
        const result = await uploadCarPhotoNight({ variables: { id: car.id, filename, data: dataUrl } });
        return (result.data as any)?.uploadCarPhotoNight?.nightPhoto;
      },
    },
  };

  // per-form's onChange fires on ANY field change, always passing the whole
  // form's own name (not the field that changed) plus the full current raw
  // values — so every change is handled here by comparing each tracked field
  // against the car's current known value, not by branching on the first arg.
  const handleIdentityChange = (_formName: string, { raw }: any) => {
    if (raw.name && raw.name !== car.name) {
      updateCar({ variables: { id: car.id, update: { name: raw.name } } });
    }
    const rawCarIdsJson = JSON.stringify(raw.carIds ?? []);
    if (rawCarIdsJson !== car.carIds) {
      updateCar({ variables: { id: car.id, update: { carIds: rawCarIdsJson } } });
    }
  };

  // The link lives on each profile (carId), not the car — so reassigning it
  // means clearing the old profile's carId (if any, and if it's actually
  // changing) before setting the new one, keeping it 1:1.
  const handleProfileChange = (_formName: string, { raw }: any) => {
    const newShakerId = raw.shakerProfileId || null;
    if (newShakerId !== (linkedShakerProfile?.id ?? null)) {
      if (linkedShakerProfile) updateShakerProfile({ variables: { id: linkedShakerProfile.id, update: { carId: null } } });
      if (newShakerId) updateShakerProfile({ variables: { id: newShakerId, update: { carId: car.id } } });
    }
    const newLedsId = raw.ledProfileId || null;
    if (newLedsId !== (linkedLedsProfile?.id ?? null)) {
      if (linkedLedsProfile) updateLedsProfile({ variables: { id: linkedLedsProfile.id, update: { carId: null } } });
      if (newLedsId) updateLedsProfile({ variables: { id: newLedsId, update: { carId: car.id } } });
    }
    const newShiftLightId = raw.shiftLightProfileId || null;
    if (newShiftLightId !== (linkedShiftLightProfile?.id ?? null)) {
      if (linkedShiftLightProfile) updateShiftLightProfile({ variables: { id: linkedShiftLightProfile.id, update: { carId: null } } });
      if (newShiftLightId) updateShiftLightProfile({ variables: { id: newShiftLightId, update: { carId: car.id } } });
    }
    const newSimWindId = raw.simWindProfileId || null;
    if (newSimWindId !== (linkedSimWindProfile?.id ?? null)) {
      if (linkedSimWindProfile) updateSimWindProfile({ variables: { id: linkedSimWindProfile.id, update: { carId: null } } });
      if (newSimWindId) updateSimWindProfile({ variables: { id: newSimWindId, update: { carId: car.id } } });
    }
  };

  const handlePhotoChange = (_formName: string, { raw }: any) => {
    if (!raw.nightPhoto && nightPhoto) {
      deleteCarPhotoNight({ variables: { id: car.id } });
    }
    // dayPhoto set / nightPhoto set: already persisted by their own uploadFn
    // (uploadCarPhoto/uploadCarPhotoNight) — nothing more to do here.
  };

  const handleDeleteCar = async () => {
    if (!(await confirmAsync(`Delete "${car.name}"? This removes its photos and cannot be undone.`, { danger: true }))) return;
    await deleteCar({ variables: { id: car.id } });
    onBack?.();
  };

  // Same row-of-cards convention as ShakerMatrix's own DSP/LFE cards.
  const cardStyle: React.CSSProperties = { flex: '1 1 260px', minWidth: 260 };

  return (
    <LiveUpdatesContext.Provider value={liveUpdatesHub}>
    {liveUpdatesHubSubscriber}
    {/* subscribeToOne, as typical-admin-fabric's Update.tsx does it: react to
        writes this page didn't make. An automated 360° capture runs detached
        from any request, so there's no mutation response to update the cache
        from — without this its photos only appear on a manual refresh. */}
    <Subscriber
      document={CAR_CHANGED}
      options={{ variables: { id: carRecordId }, onSubscriptionData: () => refetch() }}
    />
    <div style={{ padding: '1.2em 1.5em' }}>
      <Stack horizontal verticalAlign="center" horizontalAlign="space-between" style={{ marginBottom: '1em' }}>
        <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }}>
          {onBack && <IconButton iconProps={{ iconName: 'Back' }} onClick={onBack} title="Back" />}
          <span style={{ fontSize: '1.2em', fontWeight: 700 }}>Car Configuration</span>
        </Stack>
        <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 4 }}>
          {/* The default car dashboards fall back to when they have no car of
              their own — replaces the per-dashboard photo360File sprite. */}
          <IconButton
            iconProps={{ iconName: car.favorite ? 'FavoriteStarFill' : 'FavoriteStar' }}
            title={car.favorite
              ? 'This is the default car — click to clear'
              : 'Set as the default car'}
            onClick={() => setFavoriteCar({
              variables: { id: car.id, favorite: !car.favorite },
            })}
          />
          <IconButton iconProps={{ iconName: 'Delete' }} title="Delete car" onClick={handleDeleteCar} />
        </Stack>
      </Stack>

      <Stack tokens={{ childrenGap: 16 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <FormCard style={cardStyle}>
            <Form
              key={car.id}
              form={identitySchema}
              name={`car-identity-${car.id}`}
              initialValues={{ name: car.name, carIds: rawIds }}
              onChange={handleIdentityChange}
            />
          </FormCard>

          <FormCard style={cardStyle}>
            <Form
              // Keyed on all 4 linked profile ids too, not just car.id —
              // profiles load via their own queries that can resolve after
              // this Form's first mount, and per-form only reads
              // initialValues once at mount (see the per-form gotchas this
              // app has hit before), so without this the selects could seed
              // blank on a slow/cold profiles fetch.
              key={`${car.id}-${linkedShakerProfile?.id ?? 'none'}-${linkedLedsProfile?.id ?? 'none'}-${linkedShiftLightProfile?.id ?? 'none'}-${linkedSimWindProfile?.id ?? 'none'}`}
              form={profileSchema}
              name={`car-profiles-${car.id}`}
              initialValues={{
                shakerProfileId: linkedShakerProfile?.id ?? '',
                ledProfileId: linkedLedsProfile?.id ?? '',
                shiftLightProfileId: linkedShiftLightProfile?.id ?? '',
                simWindProfileId: linkedSimWindProfile?.id ?? '',
              }}
              onChange={handleProfileChange}
            />
          </FormCard>

          <FormCard style={cardStyle}>
            <Form
              key={car.id}
              form={photoSchema}
              name={`car-photos-${car.id}`}
              initialValues={{ dayPhoto, nightPhoto }}
              onChange={handlePhotoChange}
            />
            {/* Sits with the manual upload fields deliberately: capturing
                from the game and uploading a file by hand fill the same two
                slots, so they belong in the same card. */}
            <Car360Capture
              carId={car.id}
              gameCarIds={rawIds}
              captureCarId={car.captureCarId}
            />
          </FormCard>
        </div>

        <FormCard>
          <DashPanEditor
            carId={car.id}
            carIds={parseCarIds(car)}
            photoId={car.id}
            photoUrl={dayPhoto ? `${apiBase()}${dayPhoto.url}` : undefined}
            nightPhotoUrl={nightPhoto ? `${apiBase()}${nightPhoto.url}` : undefined}
            hasThumbnail={!!car.thumbnail}
            onThumbnailChanged={refetch}
          />
        </FormCard>
      </Stack>
    </div>
    </LiveUpdatesContext.Provider>
  );
};

export default CarDetail;
