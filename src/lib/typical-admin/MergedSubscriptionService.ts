import type { ApolloClient } from '@apollo/client';
import type { DocumentNode } from 'graphql';
import {
  mergeSubscriptions,
  registrationKey,
  splitMergedEvent,
  stableStringify,
  type MergedSubscription,
} from './mergeSubscriptions';

// One connection for every live subscription in the app.
//
// typiql serves subscriptions as long-lived multipart HTTP responses: each
// active subscription holds one HTTP connection open. Browsers allow only ~6
// concurrent HTTP/1.1 connections per origin, shared by every tab of that
// browser, so a page with a few live lists/forms (or a few tabs) exhausts the
// pool and later requests, mutations included, queue behind them and appear to
// hang.
//
// Components register their own subscription (document, variables, handler);
// the service merges every current registration into ONE subscription
// operation (see mergeSubscriptions.ts) and routes each event back to the
// handlers of the registration it belongs to, shaped exactly as if that
// registration had subscribed alone.
//
// Lifecycle:
// - Changes to the registration set are debounced (`debounceMs`), so a page
//   mounting ten components resubscribes once. Removals wait longer
//   (`releaseDelayMs`), so a component that unmounts and remounts quickly
//   (a list re-rendering through "loading...") causes no resubscribe at all.
// - With no registrations, nothing is subscribed.
// - Resubscribing OVERLAPS old and new: the new merged subscription opens
//   first and the old one is closed `overlapMs` later. During the overlap the
//   same event can arrive on both; it is delivered once (matched by
//   registration + payload). Events published before the new subscription is
//   live are still caught by the old one, so a resubscribe loses nothing
//   unless it takes longer than `overlapMs` for the server to start the new
//   stream.
// - A dropped stream (backend restart, network error, or the server ending
//   it) is reopened after `reconnectDelayMs`. Events during the outage are
//   lost; handlers that must not miss anything should refetch in `onError`.

export type MergedSubscriptionHandler = (data: Record<string, any>) => void;

export interface RegisterOptions {
  onError?: (error: unknown) => void;
}

export interface MergedSubscriptionServiceOptions {
  debounceMs?: number; // default 30
  // How long a removed registration's field stays in the merged subscription
  // before it is rebuilt without it (default 1000). Absorbs the unmount/remount
  // a component goes through when, e.g., a list shows "loading..." during a
  // refetch: if it registers again in time, nothing is resubscribed.
  releaseDelayMs?: number;
  overlapMs?: number; // default 1500
  reconnectDelayMs?: number; // default 2000; <= 0 disables reconnecting
  // Called with every merged document/variables actually subscribed (debugging).
  onSubscribe?: (merged: MergedSubscription) => void;
}

interface Registration {
  id: number;
  key: string;
  document: DocumentNode;
  variables: Record<string, any>;
  handler: MergedSubscriptionHandler;
  onError?: (error: unknown) => void;
}

interface Generation {
  id: number;
  merged: MergedSubscription;
  groupKeys: Map<number, string>; // merged group -> registration key
  unsubscribe: () => void;
}

interface Seen {
  generation: number;
  at: number;
}

export class MergedSubscriptionService {
  private registrations = new Map<number, Registration>();
  private nextId = 1;
  private nextGeneration = 1;
  private current: Generation | null = null;
  private retiring = new Set<Generation>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentKey = '';
  // Unmatched deliveries during an overlap: `${regKey}\u0000${payload}` -> deliveries.
  private seen = new Map<string, Seen[]>();
  private disposed = false;

  constructor(
    private client: ApolloClient,
    private options: MergedSubscriptionServiceOptions = {},
  ) {}

  register(
    document: DocumentNode,
    variables: Record<string, any> | undefined,
    handler: MergedSubscriptionHandler,
    opts: RegisterOptions = {},
  ): () => void {
    const id = this.nextId++;
    const vars = variables ?? {};
    this.registrations.set(id, {
      id,
      key: registrationKey({ document, variables: vars }),
      document,
      variables: vars,
      handler,
      onError: opts.onError,
    });
    this.schedule(this.options.debounceMs ?? 30);
    return () => {
      if (this.registrations.delete(id)) this.schedule(this.options.releaseDelayMs ?? 1000);
    };
  }

  // Number of registrations / distinct merged groups (for tests and debugging).
  get size(): number {
    return this.registrations.size;
  }

  // Closes every connection and stops all timers. Registrations are kept, so
  // start() resumes where it left off (this is what lets the React provider
  // survive StrictMode's mount/unmount/mount).
  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.timer = null;
    this.reconnectTimer = null;
    this.current?.unsubscribe();
    this.retiring.forEach((g) => g.unsubscribe());
    this.current = null;
    this.currentKey = '';
    this.retiring.clear();
    this.seen.clear();
  }

  // Resumes a disposed service. A new service is already started.
  start(): void {
    if (!this.disposed) return;
    this.disposed = false;
    this.schedule(this.options.debounceMs ?? 30);
  }

  private schedule(delayMs: number): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.rebuild(false);
    }, delayMs);
  }

  private rebuild(force: boolean): void {
    if (this.disposed) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const regs = [...this.registrations.values()];
    // Distinct registrations, in a stable order, decide the merged operation.
    const distinct = new Map<string, Registration>();
    regs.forEach((r) => {
      if (!distinct.has(r.key)) distinct.set(r.key, r);
    });
    const ordered = [...distinct.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const setKey = ordered.map((r) => r.key).join('\u0001');
    if (!force && setKey === this.currentKey && (this.current || ordered.length === 0)) return;
    this.currentKey = setKey;

    const previous = this.current;
    this.current = null;
    if (ordered.length > 0) {
      this.current = this.open(ordered);
    }
    if (previous) this.retire(previous, this.current ? (this.options.overlapMs ?? 1500) : 0);
  }

  private open(ordered: Registration[]): Generation {
    const merged = mergeSubscriptions(ordered.map((r) => ({ document: r.document, variables: r.variables })));
    const groupKeys = new Map<number, string>();
    ordered.forEach((r, i) => groupKeys.set(merged.groupOf[i], r.key));
    const id = this.nextGeneration++;
    this.options.onSubscribe?.(merged);

    const subscription = this.client
      .subscribe({ query: merged.document, variables: merged.variables, fetchPolicy: 'no-cache' })
      .subscribe({
        next: (result: any) => {
          if (result?.error) {
            this.notifyError(groupKeys, result.error);
          }
          splitMergedEvent(merged, result?.data).forEach((payload, group) => {
            const key = groupKeys.get(group);
            if (key !== undefined) this.deliver(id, key, payload);
          });
        },
        error: (error: unknown) => this.dropped(id, groupKeys, error),
        complete: () => this.dropped(id, groupKeys, new Error('subscription ended by server')),
      });

    return { id, merged, groupKeys, unsubscribe: () => subscription.unsubscribe() };
  }

  private retire(generation: Generation, afterMs: number): void {
    this.retiring.add(generation);
    const close = () => {
      generation.unsubscribe();
      this.retiring.delete(generation);
      // Keep overlap bookkeeping a little longer for late duplicates from the
      // new generation, then drop it.
      setTimeout(() => {
        if (this.retiring.size === 0) this.seen.clear();
      }, this.options.overlapMs ?? 1500);
    };
    if (afterMs <= 0) close();
    else setTimeout(close, afterMs);
  }

  private dropped(generationId: number, groupKeys: Map<number, string>, error: unknown): void {
    this.retiring.forEach((g) => {
      if (g.id === generationId) this.retiring.delete(g);
    });
    if (this.current?.id !== generationId || this.disposed) return;
    this.current = null;
    this.currentKey = '';
    this.notifyError(groupKeys, error);
    const delay = this.options.reconnectDelayMs ?? 2000;
    if (delay <= 0) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.rebuild(true);
    }, delay);
  }

  private notifyError(groupKeys: Map<number, string>, error: unknown): void {
    const keys = new Set(groupKeys.values());
    this.registrations.forEach((r) => {
      if (keys.has(r.key)) r.onError?.(error);
    });
  }

  // Delivers once per event even while two generations overlap: a delivery is
  // dropped if a different live generation already delivered the same payload
  // for the same registration within the overlap window.
  private deliver(generation: number, regKey: string, payload: Record<string, any>): void {
    const overlapping = this.retiring.size > 0;
    if (overlapping || this.seen.size > 0) {
      const now = Date.now();
      const windowMs = (this.options.overlapMs ?? 1500) * 2;
      const k = `${regKey}\u0000${stableStringify(payload)}`;
      const list = (this.seen.get(k) ?? []).filter((s) => now - s.at < windowMs);
      const match = list.findIndex((s) => s.generation !== generation);
      if (match >= 0) {
        list.splice(match, 1);
        if (list.length) this.seen.set(k, list);
        else this.seen.delete(k);
        return; // the other generation already delivered this one
      }
      if (overlapping) {
        list.push({ generation, at: now });
        this.seen.set(k, list);
      } else if (list.length) {
        this.seen.set(k, list);
      } else {
        this.seen.delete(k);
      }
    }
    this.registrations.forEach((r) => {
      if (r.key === regKey) r.handler(payload);
    });
  }
}

export function createMergedSubscriptionService(
  client: ApolloClient,
  options?: MergedSubscriptionServiceOptions,
): MergedSubscriptionService {
  return new MergedSubscriptionService(client, options);
}
