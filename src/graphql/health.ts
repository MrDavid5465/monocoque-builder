import { useEffect, useRef } from 'react';

const GQL_URL = import.meta.env.VITE_GQL_URL
  ?? `http://${window.location.hostname}:9000/typiql/graphql`;

// A trivial GraphQL request (not just a TCP/HTTP reachability check) — this
// confirms the actual backend stack is answering, not just that something is
// listening on the port. Used to recover from two related failure modes: the
// native app's frontend webview loading before the Tauri-managed axum server
// has finished starting (initial `my` query fails outright, splash screen
// never clears), and any client's connection dropping mid-session — a
// subscription's underlying multipart HTTP stream errors out and Apollo
// doesn't auto-retry it — most commonly seen when the backend restarts
// (e.g. a dev-mode rebuild), confirmed via user report.
export async function pingServer(timeoutMs = 3000): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(GQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// Polls pingServer while `active`, calling `onHealthy` (once per poll run)
// the first time it succeeds. Stops polling as soon as either the server
// answers or `active` goes false — the caller is expected to flip `active`
// back off once it's acted on `onHealthy` (e.g. by refetching a query or
// un-skipping a subscription), not this hook's job to track that state.
// `onHealthy` is read via a ref so callers can pass an inline closure
// without it needing to be memoized — only `active`/`intervalMs` restart
// the poll loop.
export function useHealthPoll(active: boolean, onHealthy: () => void, intervalMs = 1500) {
  const onHealthyRef = useRef(onHealthy);
  onHealthyRef.current = onHealthy;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const ok = await pingServer();
      if (cancelled) return;
      if (ok) onHealthyRef.current();
      else timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, intervalMs);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, intervalMs]);
}
