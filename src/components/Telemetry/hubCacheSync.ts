import { useContext, useEffect } from 'react';
import { DocumentNode } from 'graphql';
import { useApolloClient } from '@apollo/client/react';
import { LiveUpdatesContext, LiveUpdatesHub, LiveUpdateTypename } from './liveUpdatesHub';
import { cacheSyncSpecs, HUB_CACHE_SYNCED_TYPENAMES } from './hubCacheSpecs';

// Writes each hub event's `value` into Apollo's normalised cache, as
// Apollo itself does for the result of a plain `useSubscription(document)`
// (its default fetch policy writes subscription results to the cache).
// Queries holding the same records — by __typename and id — re-render with
// it. Like that subscription, this updates records already in the cache and
// leaves lists alone: an add or a remove still needs the page's own
// refetchQueries.
//
// `document` must be one of HUB_CACHE_SYNCED_DOCS, since those are the ones
// whose fields the hub actually selects.
export function useHubCacheSync(document: DocumentNode, hub?: LiveUpdatesHub | null) {
  const contextHub = useContext(LiveUpdatesContext);
  const activeHub = hub ?? contextHub;
  const client = useApolloClient();

  useEffect(() => {
    if (!activeHub) return;
    const specs = cacheSyncSpecs(document);
    const unsubscribes = specs.map((s) => {
      if (!HUB_CACHE_SYNCED_TYPENAMES.has(s.typename)) {
        console.error(
          `useHubCacheSync: ${s.typename} isn't in HUB_CACHE_SYNCED_DOCS, so the hub doesn't select its fields.`,
        );
      }
      return activeHub.subscribe(s.typename as LiveUpdateTypename, (event: any) => {
        const value = event?.value;
        if (!value || value.id == null) return;
        const data = { ...value, __typename: s.valueTypename };
        client.cache.writeFragment({ id: client.cache.identify(data), fragment: s.fragment, data });
      });
    });
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [activeHub, client, document]);
}
