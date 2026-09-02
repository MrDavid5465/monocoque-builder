import { ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import {
  GET_PREVIEW_CARS,
  ADD_PREVIEW_CAR,
  UPDATE_PREVIEW_CAR,
  PreviewCarRecord,
} from './previewCarQueries';
import { LiveUpdatesContext, LiveUpdatesHub, useHubListener, useLiveUpdatesHub } from './liveUpdatesHub';

// Wrapped in an object (rather than passing `PreviewCarRecord | undefined`
// directly) so "a feed is being provided, but no record has arrived over it
// yet" (`{record: undefined}`) is distinguishable from "no feed at all"
// (parameter/context omitted entirely) — same reasoning as
// useGlobalNightMode's NightModeLiveFeed.
export interface PreviewCarLiveFeed {
  record: PreviewCarRecord | undefined;
}

// A global "preview car" — set from a car's config page so kiosks (when the
// sim isn't actually running) can preview that car's 360° photo/pan without
// needing to actually drive it. Single record, live-synced like NightMode.
// `setPreviewCarId` has a stable identity so effects that call it on
// mount/param-change/unmount don't need to worry about it churning deps.
//
// `ready` reports whether the initial getPreviewCars query has resolved at
// least once. A fresh mount's setPreviewCarId shouldn't be called before that
// — otherwise it can't tell an already-existing record (from a previous
// session) apart from "none yet", and would create a duplicate via `add`
// instead of updating the real one.
//
// PreviewCarChanged events arrive via the shared liveUpdatesHub (see its own
// doc comment) instead of a standalone subscription — `externalHub` lets a
// caller that already opened its own hub (DashboardDesigner/index.tsx) pass
// it in directly; everyone else (Cars/CarDetail) omits it and either picks
// up an ancestor's hub via context or gets its own private one (see
// useLiveUpdatesHub's `skip` handling) — a lone consumer with no provider
// ancestor still gets exactly the one connection it always has, no
// regression.
export function useGlobalPreviewCar(externalHub?: LiveUpdatesHub): {
  previewCarId: string;
  setPreviewCarId: (carId: string) => void;
  ready: boolean;
  feed: PreviewCarLiveFeed;
  // Render this somewhere in the caller's own JSX — see
  // LiveUpdatesSubscriber's doc comment in liveUpdatesHub.tsx for why.
  // Harmless no-op if the caller ends up using an external/context hub.
  hubSubscriber: ReactNode;
} {
  const { data } = useQuery(GET_PREVIEW_CARS, { fetchPolicy: 'cache-and-network' });
  const [addPreviewCar] = useMutation(ADD_PREVIEW_CAR);
  const [updatePreviewCar] = useMutation(UPDATE_PREVIEW_CAR);

  const queried = ((data as any)?.getPreviewCars ?? [])[0] as PreviewCarRecord | undefined;

  const contextHub = useContext(LiveUpdatesContext);
  const [ownHub, ownHubSubscriber] = useLiveUpdatesHub({
    includeTelemetry: false,
    includeNightClock: false,
    skip: !!externalHub || !!contextHub,
  });
  const hub = externalHub ?? contextHub ?? ownHub;

  const [ownLive, setOwnLive] = useState<PreviewCarRecord | undefined>(undefined);

  const onPreviewCarChanged = useCallback((event: any) => {
    if (event.value) setOwnLive(event.value);
  }, []);
  useHubListener(hub, 'PreviewCarChanged', onPreviewCarChanged);

  const current = ownLive ?? queried;
  const currentRef = useRef(current);
  currentRef.current = current;

  // Memoized so a caller storing this doesn't see a new reference on every
  // unrelated re-render.
  const resolvedFeed = useMemo<PreviewCarLiveFeed>(() => ({ record: ownLive }), [ownLive]);

  // Guards against a race where setPreviewCarId is called again (e.g. an
  // effect re-firing as a query resolves) before the first `add` — with no
  // record id yet — has come back, which would otherwise create a duplicate.
  const pendingAddRef = useRef<Promise<any> | null>(null);

  // `touchedAt` is what keeps the pin alive: it's a globally-shared,
  // persisted override, and the backend expires one that nothing has
  // re-confirmed (see preview_car.rs). Stamped on every set, including the
  // periodic re-set a viewing page makes to say it's still there. Sent as
  // null when clearing, so an empty pin can't look freshly touched.
  const setPreviewCarId = useCallback((carId: string) => {
    const touchedAt = carId ? Date.now() : null;
    const existing = currentRef.current;
    if (existing?.id) {
      updatePreviewCar({ variables: { id: existing.id, update: { carId, touchedAt } } });
      return;
    }
    if (pendingAddRef.current) {
      pendingAddRef.current.then((res: any) => {
        const id = res?.data?.addPreviewCar?.id;
        if (id) updatePreviewCar({ variables: { id, update: { carId, touchedAt } } });
      });
      return;
    }
    const promise = addPreviewCar({ variables: { values: { carId, touchedAt } } });
    pendingAddRef.current = promise;
    promise.then(() => { pendingAddRef.current = null; });
  }, [updatePreviewCar, addPreviewCar]);

  return { previewCarId: current?.carId ?? '', setPreviewCarId, ready: data !== undefined, feed: resolvedFeed, hubSubscriber: ownHubSubscriber };
}
