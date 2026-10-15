import {
  DocumentNode,
  FieldNode,
  InlineFragmentNode,
  Kind,
  OperationDefinitionNode,
  SelectionSetNode,
  print,
} from 'graphql';
import { subscriptionTypename } from '../../lib/typical-admin/SubscriptionRouter';
import { ITEM_CHANGED } from '../Shakers/queries';
import { SHAKER_CHANNEL_CHANGED } from '../Shakers/channelQueries';
import { DSP_CHANNEL_CHANGED } from '../Shakers/dspQueries';
import { LFE_CHANNEL_CHANGED } from '../Shakers/lfeQueries';
import { LEDS_CHANGED } from '../Shakers/LedsDevices/queries';
import { SHIFT_LIGHT_CHANGED } from '../Shakers/ShiftLights/queries';
import { SIM_WIND_CHANGED } from '../Shakers/SimWindDevices/queries';
import { PROFILE_CHANGED as SOUND_DEVICE_PROFILE_CHANGED } from '../Shakers/Profiles/queries';
import { PROFILE_CHANGED as LEDS_DEVICE_PROFILE_CHANGED } from '../LedsDevices/Profiles/queries';
import { PROFILE_CHANGED as SHIFT_LIGHT_PROFILE_CHANGED } from '../ShiftLights/Profiles/queries';
import { PROFILE_CHANGED as SIM_WIND_DEVICE_PROFILE_CHANGED } from '../SimWindDevices/Profiles/queries';

// A typiql `<Type>Changed` event as the hub delivers it, described by one of
// the app's per-type subscription documents (e.g. LEDS_CHANGED). Those
// documents are no longer executed: they say which fields of `value` a page
// keeps in Apollo's cache, and the hub's dashboardUpdates document is built
// from the same selections (see hubSelectionFor), so the two can't drift.
export interface CacheSyncSpec {
  // The event, e.g. MonocoqueLedsDeviceChanged.
  typename: string;
  // The record it carries, e.g. MonocoqueLedsDevice — what Apollo normalises.
  valueTypename: string;
  // `value`'s selection, printed.
  valueSelection: string;
  // A fragment on valueTypename with that selection, for writeFragment.
  fragment: DocumentNode;
}

function valueSelectionOf(selectionSet: SelectionSetNode | undefined): SelectionSetNode | undefined {
  const value = selectionSet?.selections.find(
    (s): s is FieldNode => s.kind === Kind.FIELD && s.name.value === 'value',
  );
  return value?.selectionSet;
}

function spec(typename: string, valueSet: SelectionSetNode): CacheSyncSpec {
  const valueTypename = typename.replace(/Changed$/, '');
  const valueSelection = print(valueSet);
  return {
    typename,
    valueTypename,
    valueSelection,
    fragment: {
      kind: Kind.DOCUMENT,
      definitions: [
        {
          kind: Kind.FRAGMENT_DEFINITION,
          name: { kind: Kind.NAME, value: `HubCacheSync${valueTypename}` },
          typeCondition: {
            kind: Kind.NAMED_TYPE,
            name: { kind: Kind.NAME, value: valueTypename },
          },
          selectionSet: valueSet,
        },
      ],
    },
  };
}

// The `<Type>Changed` events a subscription document describes. A plain
// typiql subscription (`ledsDeviceProfileChanged { operationName value {…} }`)
// describes one; a merged one with inline fragments on each member describes
// one per member.
export function cacheSyncSpecs(document: DocumentNode): CacheSyncSpec[] {
  const operation = document.definitions.find(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
  );
  const root = operation?.selectionSet.selections.find(
    (s): s is FieldNode => s.kind === Kind.FIELD,
  );
  if (!root) return [];

  const fragments = (root.selectionSet?.selections ?? []).filter(
    (s): s is InlineFragmentNode => s.kind === Kind.INLINE_FRAGMENT && !!s.typeCondition,
  );
  if (fragments.length > 0) {
    return fragments.flatMap((f) => {
      const valueSet = valueSelectionOf(f.selectionSet);
      return valueSet ? [spec(f.typeCondition!.name.value, valueSet)] : [];
    });
  }

  const typename = subscriptionTypename(document);
  const valueSet = valueSelectionOf(root.selectionSet);
  return typename && valueSet ? [spec(typename, valueSet)] : [];
}

// The inline fragments the hub's dashboardUpdates document selects for these
// events — the same `value` fields each document asks for. Two documents for
// one event type merge, as GraphQL merges any repeated fragment.
export function hubSelectionFor(documents: readonly DocumentNode[]): string {
  return documents
    .flatMap(cacheSyncSpecs)
    .map((s) => `... on ${s.typename} { operationName value ${s.valueSelection} }`)
    .join('\n');
}

// Every subscription document a page keeps Apollo's cache in step with
// through the hub (useHubCacheSync). The hub's dashboardUpdates document
// selects each one's `value` fields, so adding a page that needs another
// `<Type>Changed` means adding its document here — plus, if the backend's
// DashboardUpdateEvent doesn't carry that event yet, a variant there and its
// typename in LiveUpdateTypename.
export const HUB_CACHE_SYNCED_DOCS: readonly DocumentNode[] = [
  ITEM_CHANGED,
  SHAKER_CHANNEL_CHANGED,
  DSP_CHANNEL_CHANGED,
  LFE_CHANNEL_CHANGED,
  LEDS_CHANGED,
  SHIFT_LIGHT_CHANGED,
  SIM_WIND_CHANGED,
  SOUND_DEVICE_PROFILE_CHANGED,
  LEDS_DEVICE_PROFILE_CHANGED,
  SHIFT_LIGHT_PROFILE_CHANGED,
  SIM_WIND_DEVICE_PROFILE_CHANGED,
];

export const HUB_CACHE_SYNCED_TYPENAMES: ReadonlySet<string> = new Set(
  HUB_CACHE_SYNCED_DOCS.flatMap(cacheSyncSpecs).map((s) => s.typename),
);
