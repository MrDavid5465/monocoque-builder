import React, { useContext, useEffect, useRef } from 'react';
import { useSubscription } from '@apollo/client/react';
import { DocumentNode } from 'graphql';
import { SubscriptionRouterContext, subscriptionTypename } from './SubscriptionRouter';
import { MergedSubscriptionContext } from './MergedSubscriptions';

interface Props {
  document: DocumentNode;
  // `onData`, not the old `onSubscriptionData`: Apollo Client 4 removed that
  // option and silently ignores it, which left every Subscriber subscribed
  // but never reacting.
  options: { variables?: any; onData: () => void };
}

// Calls `options.onData` whenever `document`'s subscription fires. In order of
// preference it rides:
//   1. an app-provided SubscriptionRouter that carries this event type (see
//      SubscriptionRouter.tsx);
//   2. the shared MergedSubscriptionService, when a MergedSubscriptionProvider
//      is mounted (see MergedSubscriptions.tsx), so every mounted screen
//      shares one connection;
//   3. otherwise, a subscription (and connection) of its own.
const Subscriber: React.FC<Props> = ({ document, options }) => {
  const router = useContext(SubscriptionRouterContext);
  const onDataRef = useRef(options.onData);
  onDataRef.current = options.onData;

  const typename = subscriptionTypename(document);
  const id: string | undefined = options.variables?.id;
  const routed = !!router && !!typename && router.carries(typename);
  const merged = useContext(MergedSubscriptionContext);
  const viaService = !routed && !!merged;
  const variablesKey = JSON.stringify(options.variables ?? {});

  useEffect(() => {
    if (!viaService) return;
    return merged!.register(document, JSON.parse(variablesKey), () => onDataRef.current());
  }, [viaService, merged, document, variablesKey]);

  useEffect(() => {
    if (!routed) return;
    return router!.listen(typename!, id, () => onDataRef.current());
  }, [routed, router, typename, id]);

  useEffect(() => {
    if (router && !routed && !merged) {
      console.warn(
        `Subscriber: the shared stream doesn't carry ${typename ?? 'this subscription'}; ` +
          'opening a separate connection for it.',
      );
    }
  }, [router, routed, merged, typename]);

  // Always called, for the rules of hooks; `skip` keeps it from connecting
  // when the router or the merged service has it.
  useSubscription(document, {
    variables: options.variables,
    skip: routed || viaService,
    onData: () => onDataRef.current(),
  });
  return null;
};

export default Subscriber;
