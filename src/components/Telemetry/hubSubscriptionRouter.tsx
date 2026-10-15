import React, { useContext, useMemo } from 'react';
import {
  SubscriptionRouter,
  SubscriptionRouterContext,
} from '../../lib/typical-admin/SubscriptionRouter';
import { LiveUpdatesContext, LiveUpdateTypename } from './liveUpdatesHub';

// The change events the admin pages subscribe to, all carried by the hub.
// Adding an admin page for a new type means adding its `<Type>Changed` here,
// to the backend's DashboardUpdateEvent, and to DASHBOARD_UPDATES_SUB —
// otherwise its Subscriber logs an error and the page gets no live updates
// (it never opens a connection of its own under this router).
export const HUB_ROUTED_TYPENAMES: ReadonlySet<string> = new Set<LiveUpdateTypename>([
  'CarChanged',
  'DashboardEntryChanged',
  'MonocoqueSoundDeviceChanged',
  'SoundDeviceProfileChanged',
  'LedsDeviceProfileChanged',
  'ShiftLightProfileChanged',
  'SimWindDeviceProfileChanged',
]);

// Points typical-admin's Subscribers at the app's one live-updates connection
// (LiveUpdatesProvider), so list/show/edit pages add no connections of their
// own. Must sit inside LiveUpdatesProvider.
export const HubSubscriptionRouter: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const hub = useContext(LiveUpdatesContext);
  const router = useMemo<SubscriptionRouter | null>(
    () =>
      hub && {
        carries: (typename) => HUB_ROUTED_TYPENAMES.has(typename),
        listen: (typename, id, onEvent) =>
          hub.subscribe(typename as LiveUpdateTypename, (event) => {
            if (id === undefined || event?.value?.id === id) onEvent();
          }),
      },
    [hub],
  );
  return (
    <SubscriptionRouterContext.Provider value={router}>{children}</SubscriptionRouterContext.Provider>
  );
};
