import { createContext, useState, useCallback, useContext, useMemo, useRef } from 'react';
import { useQuery, useMutation, useSubscription } from '@apollo/client/react';
import {
  GET_PREVIEW_CARS,
  ADD_PREVIEW_CAR,
  UPDATE_PREVIEW_CAR,
  PREVIEW_CAR_CHANGED,
  PreviewCarRecord,
} from './previewCarQueries';
import { useHealthPoll } from '../../graphql/health';

// Wrapped in an object (rather than passing `PreviewCarRecord | undefined`
// directly) so "a feed is being provided, but no record has arrived over it
// yet" (`{record: undefined}`) is distinguishable from "no feed at all"
// (parameter/context omitted entirely) — same reasoning as
// useGlobalNightMode's NightModeLiveFeed.
export interface PreviewCarLiveFeed {
  record: PreviewCarRecord | undefined;
}

// Lets ONE useGlobalPreviewCar() call on a page (the one nearest the root)
// share the single previewCarChanged subscription it opens with every OTHER
// useGlobalPreviewCar() call nested underneath it — purely on the frontend,
// no backend schema changes involved. Same pattern and same reason as
// useGlobalNightMode's NightModeFeedContext (a second always-on subscription
// on the same page can starve the browser's per-origin HTTP/1.1 connection
// pool and hang unrelated mutations).
const PreviewCarFeedContext = createContext<PreviewCarLiveFeed | null>(null);
export const PreviewCarFeedProvider = PreviewCarFeedContext.Provider;

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
// The FIRST call site on a page (DashboardDesigner/index.tsx) calls this
// with no argument, opens the one real `previewCarChanged` subscription, and
// re-provides its own resolved `feed` (part of this hook's return value) via
// `<PreviewCarFeedProvider>` around its subtree, so nested call sites pick it
// up via context instead of opening a second connection. `externalFeed` is
// there for a caller that already tracks the data some other way. Only when
// neither an explicit feed nor a provider ancestor is present does this fall
// back to opening its own subscription (fine for a lone consumer like
// Cars/CarDetail).
export function useGlobalPreviewCar(externalFeed?: PreviewCarLiveFeed): { previewCarId: string; setPreviewCarId: (carId: string) => void; ready: boolean; feed: PreviewCarLiveFeed } {
  const { data } = useQuery(GET_PREVIEW_CARS, { fetchPolicy: 'cache-and-network' });
  const [addPreviewCar] = useMutation(ADD_PREVIEW_CAR);
  const [updatePreviewCar] = useMutation(UPDATE_PREVIEW_CAR);

  const queried = ((data as any)?.getPreviewCars ?? [])[0] as PreviewCarRecord | undefined;

  const contextFeed = useContext(PreviewCarFeedContext);
  const feed = externalFeed ?? contextFeed ?? undefined;

  const [ownLive, setOwnLive] = useState<PreviewCarRecord | undefined>(undefined);

  // Auto-reconnect on a backend restart — same rationale as
  // useGlobalNightMode's matching subscription.
  const [subscriptionDown, setSubscriptionDown] = useState(false);
  useHealthPoll(subscriptionDown, () => setSubscriptionDown(false));

  useSubscription(PREVIEW_CAR_CHANGED, {
    skip: feed !== undefined || subscriptionDown,
    onData: ({ data }: any) => {
      const value = data.data?.previewCarChanged?.value;
      if (value) setOwnLive(value);
    },
    onError: () => setSubscriptionDown(true),
  });

  const live = feed ? feed.record : ownLive;
  const current = live ?? queried;
  const currentRef = useRef(current);
  currentRef.current = current;

  // Memoized for the same reason as useGlobalNightMode's resolvedFeed — a
  // Provider passing this straight through as its context value shouldn't
  // re-render every nested consumer on every unrelated re-render.
  const resolvedFeed = useMemo<PreviewCarLiveFeed>(() => ({ record: live }), [live]);

  // Guards against a race where setPreviewCarId is called again (e.g. an
  // effect re-firing as a query resolves) before the first `add` — with no
  // record id yet — has come back, which would otherwise create a duplicate.
  const pendingAddRef = useRef<Promise<any> | null>(null);

  const setPreviewCarId = useCallback((carId: string) => {
    const existing = currentRef.current;
    if (existing?.id) {
      updatePreviewCar({ variables: { id: existing.id, update: { carId } } });
      return;
    }
    if (pendingAddRef.current) {
      pendingAddRef.current.then((res: any) => {
        const id = res?.data?.addPreviewCar?.id;
        if (id) updatePreviewCar({ variables: { id, update: { carId } } });
      });
      return;
    }
    const promise = addPreviewCar({ variables: { values: { carId } } });
    pendingAddRef.current = promise;
    promise.then(() => { pendingAddRef.current = null; });
  }, [updatePreviewCar, addPreviewCar]);

  return { previewCarId: current?.carId ?? '', setPreviewCarId, ready: data !== undefined, feed: resolvedFeed };
}
