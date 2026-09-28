import { createContext } from 'react';
import { DocumentNode, FieldNode, OperationDefinitionNode } from 'graphql';

// Lets an app carry these components' change subscriptions on a connection
// it already holds, instead of each Subscriber opening its own.
//
// A browser allows only ~6 concurrent HTTP/1.1 connections per origin, and a
// GraphQL subscription holds one open for as long as it's mounted. An app
// with a shared live-updates stream provides a router here; Subscriber then
// listens on that stream and never opens a connection of its own. Without a
// provider, Subscriber subscribes directly, as it always has.
export interface SubscriptionRouter {
  // Whether the shared stream delivers events of this type at all.
  carries: (typename: string) => boolean;
  // Calls `onEvent` for each event of `typename`, or only those whose
  // `value.id` matches when `id` is given (the subscribe-to-one case).
  // Returns the unsubscribe function.
  listen: (typename: string, id: string | undefined, onEvent: () => void) => () => void;
}

export const SubscriptionRouterContext = createContext<SubscriptionRouter | null>(null);

// The event type a subscription document asks for, by the typiql naming
// convention: root field `carChanged` delivers `CarChanged`.
export function subscriptionTypename(document: DocumentNode): string | null {
  const operation = document.definitions.find(
    (d): d is OperationDefinitionNode =>
      d.kind === 'OperationDefinition' && d.operation === 'subscription',
  );
  const field = operation?.selectionSet.selections.find(
    (s): s is FieldNode => s.kind === 'Field',
  );
  if (!field) return null;
  const name = field.name.value;
  return name.charAt(0).toUpperCase() + name.slice(1);
}
