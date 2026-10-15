// Tests for mergeSubscriptions.ts. Dependency-free (node:test), named
// *.check.mjs so app test runners (vitest/jest globs) and tsc ignore it.
// Needs Node >= 22.18 (built-in TypeScript type stripping) and `graphql`
// resolvable from here (it is, inside an app that uses typical-admin):
//   node --test src/lib/typical-admin/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parse, print, validate, buildSchema, specifiedRules, SingleFieldSubscriptionsRule,
} from 'graphql';
import { mergeSubscriptions, splitMergedEvent } from '../mergeSubscriptions.ts';

const schema = buildSchema(`
  type Task { id: String! title: String projectId: String }
  type Project { id: String! name: String }
  type TaskChanged { operationName: String! value: Task! }
  type ProjectChanged { operationName: String! value: Project! }
  type Query { ok: Boolean }
  type Subscription {
    taskChanged(id: String): TaskChanged!
    projectChanged(id: String): ProjectChanged!
  }
`);

// The merged operation deliberately has several root fields. The GraphQL spec
// (and graphql-js) forbid that for subscriptions; async-graphql does not, and
// streams each root field separately. So validate with every other spec rule.
const rules = specifiedRules.filter((r) => r !== SingleFieldSubscriptionsRule);
const check = (doc) => validate(schema, doc, rules);

const TASK = parse(`subscription taskChanged($id: String) { taskChanged(id: $id) { operationName value { id title } } }`);
const PROJECT = parse(`subscription projectChanged { changed: projectChanged { ...P } } fragment P on ProjectChanged { operationName value { id } }`);
const PROJECT_OTHER_P = parse(`subscription p2($id: String) { projectChanged(id: $id) { ...P } } fragment P on ProjectChanged { value { id name } }`);
const ROOT_FRAGMENT = parse(`subscription rf { ...Root } fragment Root on Subscription { taskChanged { operationName } }`);

test('aliases each root field and namespaces variables', () => {
  const m = mergeSubscriptions([
    { document: TASK, variables: { id: 't1' } },
    { document: TASK, variables: { id: 't2' } },
  ]);
  const text = print(m.document);
  assert.match(text, /s0_taskChanged: taskChanged\(id: \$s0_id\)/);
  assert.match(text, /s1_taskChanged: taskChanged\(id: \$s1_id\)/);
  assert.deepEqual(m.variables, { s0_id: 't1', s1_id: 't2' });
  assert.deepEqual(check(m.document), []);
});

test('identical document + variables share one alias', () => {
  const m = mergeSubscriptions([
    { document: TASK, variables: { id: 't1' } },
    { document: TASK, variables: { id: 't1' } },
    { document: PROJECT },
  ]);
  assert.deepEqual(m.groupOf, [0, 0, 2]);
  assert.deepEqual(Object.keys(m.fields).sort(), ['s0_taskChanged', 's2_changed']);
});

test('carries fragments, sharing identical ones and renaming collisions', () => {
  const m = mergeSubscriptions([
    { document: PROJECT },
    { document: PROJECT },              // same group, not repeated
    { document: PROJECT_OTHER_P, variables: { id: 'p1' } }, // different fragment named P
  ]);
  const text = print(m.document);
  assert.match(text, /fragment P on ProjectChanged/);
  assert.match(text, /fragment s2_P on ProjectChanged/);
  assert.match(text, /s2_projectChanged: projectChanged\(id: \$s2_id\) \{\s+\.\.\.s2_P/);
  assert.deepEqual(check(m.document), []);
});

test('inlines root-level fragments (the server ignores them)', () => {
  const m = mergeSubscriptions([{ document: ROOT_FRAGMENT }]);
  const text = print(m.document);
  assert.match(text, /s0_taskChanged: taskChanged/);
  assert.doesNotMatch(text, /\.\.\.Root/);
  assert.deepEqual(check(m.document), []);
});

test('rejects root fragments with directives', () => {
  const doc = parse(`subscription x($on: Boolean!) { ... @include(if: $on) { taskChanged { operationName } } }`);
  assert.throws(() => mergeSubscriptions([{ document: doc }]), /directives/);
});

test('dispatch strips the alias back to each registration\'s own response key', () => {
  const m = mergeSubscriptions([
    { document: TASK, variables: { id: 't1' } },
    { document: PROJECT },
  ]);
  const event = { s1_changed: { operationName: 'update', value: { id: 'p1' } } };
  const out = splitMergedEvent(m, event);
  assert.deepEqual([...out.keys()], [1]);
  assert.deepEqual(out.get(1), { changed: { operationName: 'update', value: { id: 'p1' } } });
  const out2 = splitMergedEvent(m, { s0_taskChanged: { operationName: 'add', value: { id: 't1', title: 'x' } } });
  assert.deepEqual(out2.get(0), { taskChanged: { operationName: 'add', value: { id: 't1', title: 'x' } } });
});
