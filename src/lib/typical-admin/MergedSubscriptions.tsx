import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useApolloClient, useSubscription } from '@apollo/client/react';
import type { ApolloClient } from '@apollo/client';
import type { DocumentNode } from 'graphql';
import { stableStringify } from './mergeSubscriptions';
import {
  MergedSubscriptionService,
  type MergedSubscriptionServiceOptions,
} from './MergedSubscriptionService';

// React side of MergedSubscriptionService: mount <MergedSubscriptionProvider>
// once (inside ApolloProvider) and every useMergedSubscription below it, and
// every typical-admin Subscriber (ReactiveAdmin's dispatcher.subscribe /
// subscribeToOne), shares ONE subscription connection.

export const MergedSubscriptionContext = createContext<MergedSubscriptionService | null>(null);

export const MergedSubscriptionProvider: React.FC<
  MergedSubscriptionServiceOptions & {
    // Defaults to the client from the surrounding ApolloProvider.
    client?: ApolloClient;
    // Or pass a service you created yourself (e.g. a module singleton that
    // non-React code also registers with).
    service?: MergedSubscriptionService;
    children?: React.ReactNode;
  }
> = ({ client, service, children, ...options }) => {
  const contextClient = useApolloClient();
  const [own] = useState(() =>
    service ? null : new MergedSubscriptionService(client ?? contextClient, options),
  );
  useEffect(() => {
    own?.start();
    return () => own?.dispose();
  }, [own]);
  return (
    <MergedSubscriptionContext.Provider value={service ?? own}>{children}</MergedSubscriptionContext.Provider>
  );
};

export interface UseMergedSubscriptionOptions {
  variables?: Record<string, any>;
  // Receives the event shaped exactly as for a standalone subscription of
  // `document`, e.g. `{ taskChanged: { operationName, value } }`.
  onData?: (data: Record<string, any>) => void;
  onError?: (error: unknown) => void;
  skip?: boolean;
}

// Subscribes to `document` through the shared service when a
// MergedSubscriptionProvider is mounted, or with its own connection otherwise.
// Handlers needn't be memoized. Renders nothing and never re-renders the
// calling component on events.
export function useMergedSubscription(document: DocumentNode, options: UseMergedSubscriptionOptions = {}) {
  const service = useContext(MergedSubscriptionContext);
  const { variables, skip = false } = options;
  const onDataRef = useRef(options.onData);
  onDataRef.current = options.onData;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;
  const variablesKey = stableStringify(variables ?? {});

  useEffect(() => {
    if (!service || skip) return;
    return service.register(
      document,
      JSON.parse(variablesKey),
      (data) => onDataRef.current?.(data),
      { onError: (e) => onErrorRef.current?.(e) },
    );
  }, [service, skip, document, variablesKey]);

  // Standalone fallback. Always called (rules of hooks); skipped when the
  // service carries it.
  useSubscription(document, {
    variables,
    skip: skip || !!service,
    fetchPolicy: 'no-cache',
    ignoreResults: true,
    onData: ({ data }: any) => {
      if (data?.data) onDataRef.current?.(data.data);
    },
    onError: (e: unknown) => onErrorRef.current?.(e),
  });
}
