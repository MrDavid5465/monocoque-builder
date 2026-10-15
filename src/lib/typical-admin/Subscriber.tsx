import React, { useContext, useEffect, useRef } from 'react';
import { useSubscription } from '@apollo/client/react';
import { DocumentNode } from 'graphql';
import { SubscriptionRouterContext, subscriptionTypename } from './SubscriptionRouter';

interface Props {
  document: DocumentNode;
  // `onData`, not the old `onSubscriptionData`: Apollo Client 4 removed that
  // option and silently ignores it, which left every Subscriber subscribed
  // but never reacting.
  options: { variables?: any; onData: () => void };
}

// Calls `options.onData` whenever `document`'s subscription fires. Rides the
// app's shared stream when a SubscriptionRouter carries this event type (see
// SubscriptionRouter.tsx). An app that provides a router has chosen one
// shared connection, so an event type it doesn't carry is reported as an
// error and left unsubscribed rather than given a connection of its own.
// Only with no router at all does this subscribe directly.
const Subscriber: React.FC<Props> = ({ document, options }) => {
  const router = useContext(SubscriptionRouterContext);
  const onDataRef = useRef(options.onData);
  onDataRef.current = options.onData;

  const typename = subscriptionTypename(document);
  const id: string | undefined = options.variables?.id;
  const routed = !!router && !!typename && router.carries(typename);

  useEffect(() => {
    if (!routed) return;
    return router!.listen(typename!, id, () => onDataRef.current());
  }, [routed, router, typename, id]);

  useEffect(() => {
    if (router && !routed) {
      console.error(
        `Subscriber: the shared stream doesn't carry ${typename ?? 'this subscription'}, ` +
          'so this view gets no live updates. Add it to the app\'s SubscriptionRouter.',
      );
    }
  }, [router, routed, typename]);

  // Always called, for the rules of hooks; `skip` keeps it from connecting
  // whenever the app provides a router.
  useSubscription(document, {
    variables: options.variables,
    skip: !!router,
    onData: () => onDataRef.current(),
  });
  return null;
};

export default Subscriber;
