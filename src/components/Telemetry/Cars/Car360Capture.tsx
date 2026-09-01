import React, { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { Stack, PrimaryButton, Dropdown } from '../../../lib/denim/lib';
import {
  CAPTURE_CAR_PHOTOS_360, CAR_CAPTURE_STATUS, CarCaptureStatus,
  AC_CAPTURE_SUPPORT, AcCaptureSupport, UPDATE_CAR,
} from '../carQueries';

interface Props {
  /** Car record id (not the raw game car id). */
  carId: string;
  /** Raw game car IDs already on this record, used to pick a sensible
   *  default when no AC car has been chosen yet. */
  gameCarIds: string[];
  /** Persisted choice of which installed AC car to photograph. */
  captureCarId?: string | null;
}

/**
 * Runs the automated day/night 360° capture for one car.
 *
 * The backend launches Assetto Corsa, shoots both frames and quits, which
 * takes minutes — so the mutation only starts the run and progress is polled
 * from `carCaptureStatus`. Polling is switched off whenever nothing is
 * running: this app has previously had mutations hang because too many
 * always-open connections exhausted the browser's per-origin limit, and a
 * rarely-used feature shouldn't hold one permanently.
 */
const Car360Capture: React.FC<Props> = ({ carId, gameCarIds, captureCarId }) => {
  const [startCapture] = useMutation(CAPTURE_CAR_PHOTOS_360);
  const [updateCar] = useMutation(UPDATE_CAR);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Skipped entirely when Assetto Corsa isn't installed — there's nothing to
  // offer, and this is also what decides whether the feature appears at all.
  const { data: supportData } = useQuery(AC_CAPTURE_SUPPORT, {
    fetchPolicy: 'cache-first',
  });
  const support: AcCaptureSupport | undefined = (supportData as any)?.acCaptureSupport;
  const installedCars = support?.cars ?? [];

  // Which AC car this record will photograph. An explicit choice wins;
  // otherwise the first game car ID that's actually installed, which is
  // almost always what's wanted and saves choosing by hand.
  const matchingInstalledId = gameCarIds.find(
    id => installedCars.some(car => car.id === id)
  );
  const selectedCarId = captureCarId || matchingInstalledId || '';

  // Persisted rather than held in component state: the choice belongs to the
  // car, and a capture started later (or from another device) needs it too.
  const onSelectCar = (acCarId: string) => {
    if (!acCarId || acCarId === captureCarId) return;
    updateCar({ variables: { id: carId, update: { captureCarId: acCarId } } });
  };

  const { data, startPolling, stopPolling } = useQuery(CAR_CAPTURE_STATUS, {
    fetchPolicy: 'network-only',
  });
  const status: CarCaptureStatus | undefined = (data as any)?.carCaptureStatus;

  // A capture survives a page reload (it runs in the backend, not here), so
  // "active" is driven by the server's own view rather than local state
  // alone — reopening this page mid-run still shows the live progress.
  const active = starting || !!status?.running;

  useEffect(() => {
    if (active) startPolling(2000);
    else stopPolling();
    return () => stopPolling();
  }, [active, startPolling, stopPolling]);

  // Once the backend reports it started, local optimism can be dropped —
  // otherwise a failure that happens before `running` ever flips true would
  // leave the button stuck disabled.
  useEffect(() => {
    if (starting && (status?.running || status?.lastError)) setStarting(false);
  }, [starting, status?.running, status?.lastError]);

  // Nothing here reloads the photos: the page subscribes to `carChanged` and
  // refetches when the capture writes them (see CarDetail). This component
  // only reports progress, so it doesn't need to detect completion at all.

  const onClick = async () => {
    setStartError(null);
    setStarting(true);
    try {
      await startCapture({ variables: { id: carId, trackId: null } });
    } catch (e: any) {
      setStarting(false);
      setStartError(e?.message ?? 'Could not start the capture.');
    }
  };

  // Another car's capture still blocks this one — there's only one game.
  const busyElsewhere = !!status?.running && status.carId !== carId;
  const message = startError ?? (!active ? status?.lastError : null);

  // Nothing to show without the game: the whole feature depends on it being
  // installed, so it's hidden rather than offered in a state that can only
  // fail. The reason is worth surfacing, since it's usually fixable.
  if (support && !support.available) {
    return (
      <span style={{ opacity: 0.6, fontSize: 12, marginTop: 12, display: 'block' }}>
        360° capture needs Assetto Corsa installed.
        {support.reason ? ` ${support.reason}` : ''}
      </span>
    );
  }
  if (!support) return null;

  return (
    <Stack tokens={{ childrenGap: 8 }} style={{ marginTop: 12 }}>
      <Dropdown
        label="Car to capture"
        selectedKey={selectedCarId}
        options={installedCars.map(car => ({
          key: car.id,
          text: car.brand ? `${car.name} — ${car.brand}` : car.name,
        }))}
        onChange={(_e: unknown, option?: { key: string | number }) =>
          onSelectCar(String(option?.key ?? ''))}
      />
      <PrimaryButton
        text={active ? 'Capturing…' : 'Capture from Assetto Corsa'}
        disabled={active || busyElsewhere || !selectedCarId}
        onClick={onClick}
      />
      {!selectedCarId && (
        <span style={{ opacity: 0.7, fontSize: 12 }}>
          Choose which installed car to photograph.
        </span>
      )}
      {busyElsewhere && (
        <span style={{ opacity: 0.7, fontSize: 12 }}>
          A capture is already running for another car.
        </span>
      )}
      {active && (
        <span style={{ opacity: 0.8, fontSize: 12 }}>
          {status?.stage || 'Starting'}… Assetto Corsa will open, take both photos and close
          itself. This takes a few minutes.
        </span>
      )}
      {message && (
        <span style={{ color: '#a4262c', fontSize: 12 }}>{message}</span>
      )}
    </Stack>
  );
};

export default Car360Capture;
