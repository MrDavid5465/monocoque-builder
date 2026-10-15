# typical-admin

The base CRUD admin pattern for React apps on a [typiql](https://github.com/MrDavid5465/typiql-rs)
GraphQL backend. One component, `ReactiveAdmin` (this folder's `index.tsx`,
exported as `Index`), turns a set of GraphQL documents plus a schema object
into a full list / show / create / edit / delete screen with its own nested
router. It is deliberately **unstyled**: it defines the pattern and the
contract. Styled implementations sit on top of it, such as
[typical-admin-fabric](../typical-admin-fabric) (Fluent UI), which is what an
app normally imports.

Consumed as source (no build step, no npm package).

## Using with an AI coding agent

Before writing any code with these libraries, read the skills in
`typical-admin-fabric/.claude/skills/` (`reactive-admin`, `form-schema`,
`list-schema`, `hand-rolled-components`, `playwright-verify`). Skills in a
cloned repository are not loaded automatically unless the agent was started
inside that repository, so open the `SKILL.md` files directly. For the
backend, read typiql-rs's `.claude/skills/typiql-api`.

## Layout: clone the three libraries side by side

Get them from:

- https://github.com/MrDavid5465/typical-admin
- https://github.com/MrDavid5465/typical-admin-fabric
- https://github.com/MrDavid5465/per-form

```sh
cd your-app/src/lib
git clone https://github.com/MrDavid5465/typical-admin
git clone https://github.com/MrDavid5465/typical-admin-fabric
git clone https://github.com/MrDavid5465/per-form
```

typical-admin, [typical-admin-fabric](../typical-admin-fabric) and
[per-form](../per-form) import each other through relative paths
(`../per-form`, `../typical-admin`, `../../../per-form`), so they must be
sibling folders, e.g.:

```
src/lib/typical-admin/
src/lib/typical-admin-fabric/
src/lib/per-form/
```

Peer npm packages for this folder alone: `react`, `react-router` and
`react-router-dom` (v7), `@apollo/client` (v4, plus its peer `rxjs`) and
`graphql`. See typical-admin-fabric's README for versions and the full app
setup.

## The contract

```tsx
<ReactiveAdmin
  dispatcher={dispatcher}          // GraphQL documents, one per operation
  name={{ singular: 'Project', plural: 'Projects' }}
  schemaDefinition={schemaDefinition}
  components={{ /* optional per-slot overrides */ }}
  callBacks={{ /* optional new/edit/delete result callbacks */ }}
  labels={{ /* optional display text, see below */ }}
/>
```

Mount it under a route ending in `/*`; it renders its own nested `<Routes>`:

| Route (relative) | Slot | Rendered when |
|---|---|---|
| `/*` | `list` | always (wildcard so a custom list can nest its own routes) |
| `/new` | `new` | `dispatcher.new` **and** `schemaDefinition.new` are both set |
| `/:id/show` | `show` | always |
| `/:id/edit` | `edit` | `dispatcher.edit` **and** `schemaDefinition.edit` are both set |
| (none) | `delete` | a button inside `show`, when `dispatcher.delete` is set |

### Naming: `name` is both the GraphQL stem and the heading

The default components read results by name, built from `name`:

| Operation | Result field read | Variables sent |
|---|---|---|
| `dispatcher.list` | `get${name.plural}` (typical-admin-fabric's lists accept `queryResultKey` to override) | none |
| `dispatcher.show` | `get${name.singular}` | `{ id }` |
| `dispatcher.new` | `add${name.singular}` (its `.id` is used to navigate) | `{ values }` |
| `dispatcher.edit` | (navigates to show on completion) | `{ id, update }` |
| `dispatcher.delete` | `remove${name.singular}` | `{ id }` |

typiql generates exactly these names: for `struct Project` it generates
`getProject`, `getProjects`, `addProject(values:)`, `updateProject(id:, update:)`,
`removeProject(id:)` and `projectChanged(id:)`. Its plural is the snake_case
type name plus `s`/`es`/`ies` (`Category` -> `getCategories`,
`Box` -> `getBoxes`, `Person` -> `getPersons`), so `name.plural` must be
**that** stem, not the English plural. Without `labels`,
`name.singular`/`name.plural` are also printed as page headings ("Showing
Project", "Listing Projects").

### `labels`: display text apart from the GraphQL names

`labels` (`labels.ts`) holds what people read. Passing it, even `{}`,
switches to defaults that read like English: `{plural}`, `{singular}`, `New
{singularLower}`, `Edit {singularLower}` ("Devices", "Device", "New device",
"Edit device"); without it the old text stays, so existing screens don't
change. Override any entry (`singular`, `plural`, `listHeading`,
`showHeading`, `newHeading`, `editHeading`, `deleteTitle`, `deleteConfirm`,
`deletePrompt`, `back`, `edit`, `add`), e.g. `labels={{ singular: 'Rig
device', plural: 'Rig devices' }}` when the type name reads badly. Every slot
receives `labels`; a custom slot fills them with
`label(resolveLabels(name, labels), 'showHeading')`.

### `schemaDefinition`

```ts
interface ITASchema {
  list: { columns: DisplaySchema<T>; buttons?: { add?: boolean } };
  show: DisplaySchema<T>;          // read-only fields: { label, onRender?, options? }
  new?: SchemaDefinition<T>;       // a per-form schema
  edit?: SchemaDefinition<T>;      // a per-form schema
}
```

### Slot overrides

Every slot, default or overridden, receives the same props:
`{ dispatcher, name, schemaDefinition: <that slot's part>, callBacks, components, labels }`.
`components` recognises `list`, `new`, `show`, `edit`, `delete` and `links`
(the back/edit/add navigation row). A slot you don't name keeps its default,
so a custom slot is best written by copying the default component it
replaces and changing only what you need.

## Live updates: share one connection

Set `dispatcher.subscribe` (all changes, used by list/show/edit) and
optionally `dispatcher.subscribeToOne` (one record, used by show/edit with
`{ id }`) to typiql's `<type>Changed` subscription, and those pages refetch
when the data changes elsewhere.

**The connection-limit problem.** typiql serves subscriptions as long-lived
multipart HTTP responses: every active subscription holds one HTTP connection
open. Browsers allow about 6 concurrent HTTP/1.1 connections per origin,
shared by every tab of that browser. If each mounted list/show/edit (or
widget) subscribes on its own, a page with a few of them, or a few tabs,
uses up the pool, and further requests, mutations included, queue behind the
open streams and look like they hang.

**The recommended setup is the merged-subscription service**
(`MergedSubscriptions.tsx`, `MergedSubscriptionService.ts`,
`mergeSubscriptions.ts`). Mount its provider once, inside `ApolloProvider`:

```tsx
import { MergedSubscriptionProvider } from './lib/typical-admin/MergedSubscriptions';

<ApolloProvider client={client}>
  <MergedSubscriptionProvider>
    <App />
  </MergedSubscriptionProvider>
</ApolloProvider>
```

Then every registered subscription is merged into ONE subscription operation
over one connection:

- typical-admin's `Subscriber` (behind `dispatcher.subscribe` /
  `subscribeToOne`) registers through the service automatically, so N
  mounted admin screens share one connection.
- Any other component declares its own subscription, scoped to its own
  concern, with the hook:

  ```tsx
  import { useMergedSubscription } from './lib/typical-admin/MergedSubscriptions';

  const TASK_CHANGED = gql`
    subscription taskChanged($id: String) { taskChanged(id: $id) { operationName value { id title } } }
  `;
  useMergedSubscription(TASK_CHANGED, {
    variables: { id: taskId },
    onData: (data) => console.log(data.taskChanged), // shaped as if subscribed alone
    // onError, skip
  });
  ```

  Without a provider the same hook subscribes on its own connection, so
  components work either way.
- Non-React code can use `MergedSubscriptionService` directly:
  `service.register(document, variables, handler) => unregister`. Pass your own
  instance to the provider (`<MergedSubscriptionProvider service={service}>`)
  to share it with React.

**How merging works.** Each registered document's root fields get a unique
alias (`s3_taskChanged`), its variables are namespaced (`$id` -> `$s3_id`) and
their definitions merged, and the fragments it uses are carried over (an
identical fragment is shared, a same-named different one is renamed).
Registrations with an identical document and variables share one alias. Each
event is split by alias and handed to its handlers as
`{ taskChanged: {...} }`, exactly as if the document had been subscribed on
its own.

**Root fields only.** This relies on async-graphql (typiql's server), which
runs every root field of a subscription operation as its own stream and sends
each event keyed by that field's alias. It needs no backend change. Two
consequences:

- Only plain fields at the subscription root are streamed; root-level
  fragments are ignored by the server. The merger inlines root-level inline
  fragments and fragment spreads, and rejects ones that carry directives
  (`@include`/`@skip`).
- A multi-root-field subscription is not valid per the GraphQL spec (which
  allows one root field). async-graphql accepts it; a spec-strict server
  (graphql-js, Apollo Server) would reject the merged operation.

**Lifecycle.** Changes to the set of registrations are debounced
(`debounceMs`, 30 ms), so a page mounting ten components resubscribes once.
Removals wait `releaseDelayMs` (1 s), so a component that unmounts and
remounts quickly (a list re-rendering through "loading..." during a refetch)
causes no resubscribe. With nothing registered there is no connection.
A resubscribe **overlaps** the old and new subscriptions: the new one opens
first and the old one closes `overlapMs` (1.5 s) later, and an event that
arrives on both is delivered once (matched by registration and payload). So
a resubscribe loses no events unless the server takes longer than `overlapMs`
to start the new stream; the cost is a second connection for that window.
A dropped stream (backend restart, network error) is reopened after
`reconnectDelayMs` (2 s); events during the outage are lost, so use `onError`
to refetch if that matters.

The merge function has tests: `node --test src/lib/typical-admin/test/mergeSubscriptions.check.mjs`
(Node 22.18 or newer; uses the app's `graphql`).

`SubscriptionRouter.tsx` is an older, lower-level hook-in: an app that already
runs its own merged stream can provide a `SubscriptionRouterContext` to route
`Subscriber` events from it. It takes precedence over the service for the
event types it says it carries.

## Building your own styled variant

typical-admin-fabric is one implementation; you can write another (a
different component library, a different design) the same way:

1. Create a sibling folder, e.g. `src/lib/typical-admin-mylib`.
2. Write your own `List`, `Create`, `Show`, `Update` (and usually `Delete`,
   `Links`) with the same props as this folder's defaults. Start each one
   from a copy of the corresponding file here (or in typical-admin-fabric)
   so the data flow (query names, variables, navigation, `Subscriber`) stays
   identical.
3. Write a form template for per-form: a component that receives per-form's
   `IField` props (`name`, `type`, `label`, `value`, `onChange`, `errors`,
   ...) and renders the right input per `type`. `lib/templates/Raw.tsx` here
   is a minimal one; typical-admin-fabric's `lib/templates/Fabric.tsx` is a
   full one. Wrap it in a `Form` like `lib/templates/Form.tsx`.
4. Export an `Index` that wraps this one and supplies your defaults, letting
   the caller's overrides win:

   ```tsx
   import ReactiveAdmin, { IDispatcher, ITACallBacks, ITASchema, IComponents } from '../typical-admin';

   const Index: React.FC<Props> = ({ components, ...rest }) => (
     <ReactiveAdmin
       {...rest}
       components={{
         list: (p: any) => <List {...p} />,
         new: (p: any) => <Create {...p} />,
         show: (p: any) => <Show {...p} />,
         edit: (p: any) => <Update {...p} />,
         ...components,
       }}
     />
   );
   ```

The unstyled defaults here are a reference, not production screens: they
render bare HTML and have known defects (see below). The core's `Delete`
uses the browser's native `confirm()`.

## Known issues in the unstyled defaults

These affect only this folder's own default components, which
typical-admin-fabric replaces:

- `Update.tsx` reads `match.params.id` and calls `history.push`, react-router
  v5 props that ReactiveAdmin never passes; the default edit page throws.
- `List.tsx` checks `item[k].onRender` (the row value) instead of the column's
  `onRender`, so column `onRender` is ignored.
- `Links.tsx` reads `location.state.params.id` on show pages, which is
  normally undefined, and logs `location.state` to the console.
- They print the legacy headings and ignore `labels` (typical-admin-fabric's
  slots use it).

