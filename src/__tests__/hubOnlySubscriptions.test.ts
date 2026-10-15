import { describe, it, expect } from 'vitest';
import { DocumentNode, parse } from 'graphql';
import { subscriptionTypename } from '../lib/typical-admin/SubscriptionRouter';
import { HUB_ROUTED_TYPENAMES } from '../components/Telemetry/hubSubscriptionRouter';
import {
  cacheSyncSpecs,
  HUB_CACHE_SYNCED_DOCS,
  hubSelectionFor,
} from '../components/Telemetry/hubCacheSpecs';
import { ITEM_CHANGED } from '../components/Shakers/queries';
import { PROFILE_CHANGED as SOUND_DEVICE_PROFILE_CHANGED } from '../components/Shakers/Profiles/queries';
import { PROFILE_CHANGED as LEDS_DEVICE_PROFILE_CHANGED } from '../components/LedsDevices/Profiles/queries';
import { PROFILE_CHANGED as SHIFT_LIGHT_PROFILE_CHANGED } from '../components/ShiftLights/Profiles/queries';
import { PROFILE_CHANGED as SIM_WIND_DEVICE_PROFILE_CHANGED } from '../components/SimWindDevices/Profiles/queries';
import { CAR_CHANGED } from '../components/Telemetry/carQueries';
import { DASHBOARD_CHANGED_SUB, DASHBOARD_UPDATES_SUB } from '../components/Telemetry/DashboardDesigner/queries';

// Every GraphQL subscription goes through the live-updates hub — see the
// matching rule in eslint.config.js. This is the same check for a run that
// skips lint.

// Every source file under src/ except the tests, as text, keyed by its path
// relative to src/. Vite resolves the glob, so this needs no Node APIs.
const SOURCES = import.meta.glob(['../**/*.{ts,tsx}', '!../**/__tests__/**', '!../**/node_modules/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// The hub's own subscription, and typical-admin's fallback for apps with no
// hub (this app always provides HubSubscriptionRouter, which skips it).
const ALLOWED = new Set([
  'components/Telemetry/liveUpdatesHub.tsx',
  'lib/typical-admin/Subscriber.tsx',
  // The library's own merged-subscription service; this app never mounts it
  // (see the next test).
  'lib/typical-admin/MergedSubscriptionService.ts',
  'lib/typical-admin/MergedSubscriptions.tsx',
]);

// Comments are stripped first so prose about subscriptions doesn't count.
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const DIRECT_SUBSCRIPTION = [
  /\buseSubscription\b/,
  /\.subscribe\(\s*\{\s*query\b/,
  /\bsubscribeToMore\b/,
  /<Subscription[\s>]/,
];

describe('subscriptions go through the live-updates hub', () => {
  it('nothing outside the hub opens a subscription of its own', () => {
    const files = Object.keys(SOURCES);
    // The glob really did pick up the app's sources.
    expect(files).toContain('../components/Telemetry/liveUpdatesHub.tsx');
    const offenders = files
      .map((path) => path.replace(/^\.\.\//, ''))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => DIRECT_SUBSCRIPTION.some((re) => re.test(code(SOURCES[`../${rel}`]))));
    expect(offenders).toEqual([]);
  });

  it('the app never mounts typical-admin\'s MergedSubscriptionProvider', () => {
    // It would open a second shared stream next to the live-updates hub.
    const users = Object.keys(SOURCES)
      .map((path) => path.replace(/^\.\.\//, ''))
      .filter((rel) => !rel.startsWith('lib/'))
      .filter((rel) => /MergedSubscriptionProvider|MergedSubscriptionService/.test(code(SOURCES[`../${rel}`])));
    expect(users).toEqual([]);
  });

  it('the hub router carries every ReactiveAdmin dispatcher.subscribe event', () => {
    // The dispatchers' `subscribe` documents (Shakers, the three device
    // profile apps, Cars, Dashboards). An uncarried one would leave its
    // screen with no live updates (Subscriber no longer opens its own).
    const docs: DocumentNode[] = [
      ITEM_CHANGED,
      SOUND_DEVICE_PROFILE_CHANGED,
      LEDS_DEVICE_PROFILE_CHANGED,
      SHIFT_LIGHT_PROFILE_CHANGED,
      SIM_WIND_DEVICE_PROFILE_CHANGED,
      CAR_CHANGED,
      DASHBOARD_CHANGED_SUB,
    ];
    for (const doc of docs) {
      expect(HUB_ROUTED_TYPENAMES.has(subscriptionTypename(doc)!)).toBe(true);
    }
  });
});

describe('hub cache sync', () => {
  it('derives each event type and its record type from a subscription document', () => {
    const [spec] = cacheSyncSpecs(LEDS_DEVICE_PROFILE_CHANGED);
    expect(spec.typename).toBe('LedsDeviceProfileChanged');
    expect(spec.valueTypename).toBe('LedsDeviceProfile');
    expect(spec.valueSelection.replace(/\s+/g, ' ')).toBe('{ id name car game carId }');
  });

  it("selects every synced document's value fields on the hub subscription", () => {
    const hubText = DASHBOARD_UPDATES_SUB.loc!.source.body;
    // Parses as a whole, and contains each synced type's selection.
    expect(() => parse(hubText)).not.toThrow();
    for (const spec of HUB_CACHE_SYNCED_DOCS.flatMap(cacheSyncSpecs)) {
      expect(hubText).toContain(`... on ${spec.typename} { operationName value ${spec.valueSelection} }`);
    }
    expect(hubSelectionFor(HUB_CACHE_SYNCED_DOCS)).not.toBe('');
  });
});
