import { useEffect, useRef } from 'react';
import { gql } from '@apollo/client';
import type { ApolloClient } from '@apollo/client';
import { useApolloClient } from '@apollo/client/react';

// A trivial GraphQL request through the app's own Apollo client (so it goes
// to the same endpoint, with the same links and headers), confirming the
// backend stack is answering rather than just that a port is open.
const PING = gql`
  query denimPing {
    __typename
  }
`;

export async function pingServer(client: ApolloClient, timeoutMs = 3000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>(resolve => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const ping = client
    .query({ query: PING, fetchPolicy: 'no-cache' })
    .then(r => !r.error && !!r.data)
    .catch(() => false);
  try {
    return await Promise.race([ping, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Polls pingServer while `active`, calling `onHealthy` the first time it
// succeeds. Recovers from the backend not being up yet when the page loads
// (a desktop webview starting before its bundled server, a dev rebuild): the
// first `my` fetch fails, nothing retries it, and the splash screen would
// stay up forever. The caller flips `active` off once it has acted (e.g. by
// refetching). `onHealthy` is read through a ref, so an inline closure is
// fine.
export function useHealthPoll(active: boolean, onHealthy: () => void, intervalMs = 1500) {
  const client = useApolloClient();
  const onHealthyRef = useRef(onHealthy);
  onHealthyRef.current = onHealthy;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const ok = await pingServer(client);
      if (cancelled) return;
      if (ok) onHealthyRef.current();
      else timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, intervalMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, intervalMs, client]);
}
