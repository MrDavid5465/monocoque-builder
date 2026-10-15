import {
  Kind,
  parse,
  print,
  visit,
  type DefinitionNode,
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type OperationDefinitionNode,
  type SelectionNode,
  type SelectionSetNode,
  type VariableDefinitionNode,
} from 'graphql';

// Pure merge step of the merged-subscription service (see
// MergedSubscriptionService.ts). Takes any number of independent subscription
// documents + variables and builds ONE subscription operation whose root
// fields are all of theirs, so they can share a single connection.
//
// Why this works: async-graphql (typiql's GraphQL server) turns every root
// FIELD of a subscription operation into its own stream and merges them, and
// each event it sends contains just the field that fired, keyed by its
// response key (alias). Only plain fields at the root are collected; root-level
// fragments are not, so they are inlined here.

export interface SubscriptionRegistration {
  document: DocumentNode | string;
  variables?: Record<string, any>;
}

export interface MergedField {
  // Index into the registrations array of the FIRST registration of this
  // group. Registrations with identical document + variables share a group.
  group: number;
  // Response key the registration's own document uses for this field (its
  // alias if it had one, else the field name) — what handlers expect.
  responseKey: string;
}

export interface MergedSubscription {
  document: DocumentNode;
  variables: Record<string, any>;
  // Merged alias -> where its events go.
  fields: Record<string, MergedField>;
  // registration index -> group index (identical registrations share one).
  groupOf: number[];
}

// Stable JSON for variables (key order independent).
export function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(',')}}`;
}

export function toDocument(document: DocumentNode | string): DocumentNode {
  return typeof document === 'string' ? parse(document) : document;
}

// Identity of a registration: same document text + same variables.
export function registrationKey(reg: SubscriptionRegistration): string {
  return `${print(toDocument(reg.document))}\u0000${stableStringify(reg.variables ?? {})}`;
}

function subscriptionOperation(doc: DocumentNode): OperationDefinitionNode {
  const ops = doc.definitions.filter(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
  );
  if (ops.length !== 1 || ops[0].operation !== 'subscription') {
    throw new Error('mergeSubscriptions: each document must contain exactly one subscription operation');
  }
  return ops[0];
}

// Root selections flattened to plain fields. Root-level inline fragments and
// fragment spreads are inlined (the server would otherwise ignore them); ones
// carrying directives can't be inlined faithfully and are rejected.
function rootFields(
  selectionSet: SelectionSetNode,
  fragments: Map<string, FragmentDefinitionNode>,
  seen: Set<string> = new Set(),
): FieldNode[] {
  const out: FieldNode[] = [];
  selectionSet.selections.forEach((s: SelectionNode) => {
    if (s.kind === Kind.FIELD) {
      out.push(s);
      return;
    }
    if (s.directives?.length) {
      throw new Error('mergeSubscriptions: root-level fragments with directives are not supported');
    }
    if (s.kind === Kind.INLINE_FRAGMENT) {
      out.push(...rootFields(s.selectionSet, fragments, seen));
      return;
    }
    const name = s.name.value;
    const fragment = fragments.get(name);
    if (!fragment) throw new Error(`mergeSubscriptions: unknown fragment ${name}`);
    if (seen.has(name)) return;
    out.push(...rootFields(fragment.selectionSet, fragments, new Set([...seen, name])));
  });
  return out;
}

// Fragment names a node uses, transitively.
function usedFragments(
  node: any,
  fragments: Map<string, FragmentDefinitionNode>,
  out: Set<string> = new Set(),
): Set<string> {
  visit(node, {
    FragmentSpread(spread) {
      const name = spread.name.value;
      if (out.has(name)) return;
      out.add(name);
      const fragment = fragments.get(name);
      if (fragment) usedFragments(fragment.selectionSet, fragments, out);
    },
  });
  return out;
}

export function mergeSubscriptions(registrations: SubscriptionRegistration[]): MergedSubscription {
  const groupOf: number[] = [];
  const groupByKey = new Map<string, number>();
  const variableDefinitions: VariableDefinitionNode[] = [];
  const selections: FieldNode[] = [];
  const fragmentDefs: FragmentDefinitionNode[] = [];
  const fragmentByName = new Map<string, string>(); // merged name -> printed body
  const variables: Record<string, any> = {};
  const fields: Record<string, MergedField> = {};

  registrations.forEach((reg, index) => {
    const key = registrationKey(reg);
    const existing = groupByKey.get(key);
    if (existing !== undefined) {
      groupOf.push(existing);
      return;
    }
    groupByKey.set(key, index);
    groupOf.push(index);

    const prefix = `s${index}_`;
    const doc = toDocument(reg.document);
    const op = subscriptionOperation(doc);
    const fragments = new Map<string, FragmentDefinitionNode>(
      doc.definitions
        .filter((d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION)
        .map((f) => [f.name.value, f]),
    );

    // 1. Namespace variables: $id -> $s3_id, everywhere (operation and the
    //    fragments it uses, which can reference operation variables).
    const renameVars = <T,>(node: T): T =>
      visit(node as any, {
        Variable(v) {
          return { ...v, name: { ...v.name, value: prefix + v.name.value } };
        },
      }) as T;

    (op.variableDefinitions ?? []).forEach((def) => {
      variableDefinitions.push(renameVars(def));
      const name = def.variable.name.value;
      if (reg.variables && reg.variables[name] !== undefined) {
        variables[prefix + name] = reg.variables[name];
      }
    });

    // 2. Flatten root fragments, alias every root field uniquely.
    const roots = rootFields(op.selectionSet, fragments).map((field) => {
      const responseKey = (field.alias ?? field.name).value;
      const alias = prefix + responseKey;
      fields[alias] = { group: index, responseKey };
      return renameVars({ ...field, alias: { kind: Kind.NAME, value: alias } } as FieldNode);
    });

    // 3. Carry over the fragments those fields use. Identical fragments are
    //    shared; a same-named but different one is renamed for this
    //    registration (and its spreads rewritten).
    const used = new Set<string>();
    roots.forEach((f) => usedFragments(f, fragments, used));
    const renames = new Map<string, string>();
    const prepared = [...used].map((name) => renameVars(fragments.get(name)!));
    const bodies = new Map(prepared.map((f) => [f.name.value, print(f)]));
    prepared.forEach((f) => {
      const name = f.name.value;
      const prior = fragmentByName.get(name);
      if (prior !== undefined && prior !== bodies.get(name)) renames.set(name, prefix + name);
    });
    const renameSpreads = <T,>(node: T): T =>
      renames.size === 0
        ? node
        : (visit(node as any, {
            FragmentSpread(s) {
              const to = renames.get(s.name.value);
              return to ? { ...s, name: { ...s.name, value: to } } : undefined;
            },
            FragmentDefinition(d) {
              const to = renames.get(d.name.value);
              return to ? { ...d, name: { ...d.name, value: to } } : undefined;
            },
          }) as T);

    prepared.map(renameSpreads).forEach((f) => {
      const printed = print(f);
      const prior = fragmentByName.get(f.name.value);
      if (prior === printed) return; // already carried by an earlier registration
      fragmentByName.set(f.name.value, printed);
      fragmentDefs.push(f);
    });
    selections.push(...roots.map(renameSpreads));
  });

  const operation: OperationDefinitionNode = {
    kind: Kind.OPERATION_DEFINITION,
    operation: 'subscription' as OperationDefinitionNode['operation'],
    name: { kind: Kind.NAME, value: 'mergedSubscription' },
    variableDefinitions,
    directives: [],
    selectionSet: { kind: Kind.SELECTION_SET, selections },
  };
  const definitions: DefinitionNode[] = [operation, ...fragmentDefs];
  return { document: { kind: Kind.DOCUMENT, definitions }, variables, fields, groupOf };
}

// Splits one event of the merged subscription into per-group payloads, shaped
// exactly as each registration's own document would have received it, e.g.
// `{ s2_taskChanged: {...} }` -> group 2 gets `{ taskChanged: {...} }`.
export function splitMergedEvent(
  merged: Pick<MergedSubscription, 'fields'>,
  data: Record<string, any> | null | undefined,
): Map<number, Record<string, any>> {
  const out = new Map<number, Record<string, any>>();
  if (!data) return out;
  Object.entries(data).forEach(([alias, value]) => {
    const route = merged.fields[alias];
    if (!route) return;
    const payload = out.get(route.group) ?? {};
    payload[route.responseKey] = value;
    out.set(route.group, payload);
  });
  return out;
}
