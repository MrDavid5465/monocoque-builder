---
name: reactive-admin
description: How this app builds a CRUD screen without hand-writing CRUD — ReactiveAdmin (typical-admin/typical-admin-fabric), its dispatcher slots, the nested show/edit/new/list router, and the components override contract that lets one slot go fully custom while the rest stay generated. Composes form-schema and list-schema directly. Use before building any new admin/CRUD screen, and before deciding a slot needs a fully custom component.
license: MIT
user-invocable: false
---

# ReactiveAdmin: the base of every CRUD screen in this app

The goal of ReactiveAdmin, `form-schema`, `list-schema`, and typiql's backend
codegen together is **never write basic CRUD by hand again.** A new record
type should cost a typiql struct, a `dispatcher`, and a `schemaDefinition` —
not a hand-rolled page. Reach for full customization only when something
genuinely can't be expressed that way, and prefer generalizing the schema
pattern over a one-off component whenever the need is real, not just
convenient once.

## The two layers

`typical-admin/index.tsx`'s `Index` (its own internal name — imported
elsewhere under the alias `ReactiveAdmin`) is the routing core: a nested
`<Routes>` with no styling opinion, using `typical-admin`'s own bare
`List`/`Create`/`Show`/`Update` as defaults.

`typical-admin-fabric/index.tsx`'s `Index` is what every real screen in this
app actually imports (`import ReactiveAdmin from '.../typical-admin-fabric'`).
It wraps the core, supplying this app's real (Fluent-styled) defaults. **This
construction happens once, inside the library — an app screen never writes
it.** A screen's own `components` prop only needs to name the slots it's
actually overriding; anything it omits falls through this same spread to
the Fluent default:

```tsx
<ReactiveAdmin  {/* = typical-admin's core Index */}
  components={{
    list: (props) => <List {...props} pageSize={pageSize} />,   // typical-admin-fabric's List
    new:  (props) => <Create {...props} />,
    show: (props) => <Show {...props} />,
    edit: (props) => <Update {...props} />,
    ...components,   // caller's own overrides always win, spread last
  }}
  {...rest}
/>
```

You always build against the `typical-admin-fabric` layer. The core layer
matters only because it's what defines the actual prop contract every slot
(default or overridden) receives — see below.

## The dispatcher slots

```ts
interface IDispatcher {
  list: any; new?: any; show: any; edit?: any; delete?: any;
  subscribe?: any; subscribeToOne?: any;   // gql documents
}
```

Each slot's presence gates real behavior, not just which mutation fires:

| Slot | Route | Rendered when |
|---|---|---|
| `list` | `/*` (wildcard — deliberately not exact `/`, so a custom list can nest its own sub-`<Routes>`) | always |
| `show` | `/:id/show` | always |
| `new` | `/new` | only if **both** `dispatcher.new` and `schemaDefinition.new` are set |
| `edit` | `/:id/edit` | only if **both** `dispatcher.edit` and `schemaDefinition.edit` are set |
| — | (no route) | `delete` isn't a route — it's a button+confirm rendered inside `Show`, shown only when `dispatcher.delete` is set |

**Real example of omitting a slot entirely**: `RecordingsAdmin.tsx`'s
`dispatcher` has no `edit` key, its `schemaDefinition` has no `edit` key
(not even a placeholder `edit: {}`, unlike every other admin screen), and
its `components` has no `edit` key either — because nothing on a Recording
is user-editable after creation, so there's deliberately no `/:id/edit`
route at all, per the gate above. This is the real proof that a screen only
declares what it actually has, not a template every screen fills in.

**One honest caveat**: that same gate means the reverse case — omitting a
slot from `components` while its route *does* exist, so the plain generated
Fluent default actually renders — is real and mechanically works (verified
directly in `typical-admin-fabric/index.tsx`'s spread), but no screen in
this app currently does it. All five real admin screens
(`Cars`/`Dashboards`/`Templates`/`Groups`/`Recordings`) override every
active slot — `list` for thumbnails, `show`/`edit`/`new` for custom
behavior. Don't take that as evidence the fallback doesn't work; take it as
this app not having needed a plain generic show/edit/new page yet. A new
screen that's genuinely fine with the generated default for one slot should
just... not mention that slot in `components`, the same way `RecordingsAdmin`
doesn't mention `edit`.

The sibling `davidallanscott.ca` repo (this app's `denim`/`typical-admin-fabric`
scaffolding was ported from it — see `hand-rolled-components`) reportedly
*does* rely on the plain generated defaults in some of its own screens. Not
verifiable from this remote session (its path is local to the real dev
machine, not this container) — worth checking there first for a concrete
"un-overridden slot" example next time this comes up at the real dev env,
rather than this app's admin screens, which don't have one.

These routes are relative to wherever `<ReactiveAdmin>` itself is mounted in
the app's own route tree — it's a self-contained nested router, not
something that needs its own top-level route wiring beyond one mount point.

## `schemaDefinition: ITASchema` — composes the other two skills directly

```ts
interface ITASchema {
  list: ListSchema<any>;          // { buttons?: {add?: boolean}, columns: DisplaySchema<T> } — see list-schema
  new?: SchemaDefinition<any>;    // per-form schema — see form-schema
  show: DisplaySchema<any>;       // list-schema's DisplayField map, reused for a read-only field-by-field view
  edit?: SchemaDefinition<any>;   // per-form schema — see form-schema
}
```

This isn't three unrelated things — `list`/`show` are `list-schema`'s
`DisplaySchema`, `new`/`edit` are `form-schema`'s `SchemaDefinition`. Author
each with those skills' rules, not ad hoc.

## The override contract — why "start from the default" works

Every slot — default or overridden — receives **exactly the same props**,
whether `typical-admin`'s core `Index` renders its own default or your
override via `components.<slot>`:

```tsx
// core Index, for the `show` route — identical prop set either branch:
element={components.show
  ? React.createElement(components.show, { dispatcher, name, schemaDefinition: schemaDefinition.show, callBacks, components })
  : <Show dispatcher={dispatcher} name={name} schemaDefinition={schemaDefinition.show} callBacks={callBacks} components={components} />
}
```

This is exactly why building a custom slot **from a copy of the default
component it replaces** works cleanly: same `Props` interface, same
call site, zero wiring changes anywhere else. `SwitchableList`
(`typical-admin-fabric/SwitchableList.tsx`) is the clean version of this —
it doesn't rebuild grid rendering, it *composes* the standard `List` and
`CardList` underneath its own header+toggle, so it's still a thin wrapper
around the generated pieces, not a rewrite.

`components: IComponents` recognizes `list`, `new`, `show`, `edit`,
`delete`, `links` — `links` overrides the back/edit/add nav row every
default slot renders in its own header (`Links.tsx`), `delete` overrides
the delete button+confirm `Show` renders inline.

## Worked example: the real Cars page

`CarsAdmin.tsx` is exactly the shape you'd build for "a CRUD page with a
photo thumbnail" — it already exists, not a hypothetical:

```tsx
const dispatcher = { list: GET_CARS, show: GET_CARS, edit: GET_CARS, new: ADD_CAR, delete: DELETE_CAR };
const carSchema = {
  name: { label: 'Name' },
  thumbnail: { label: 'Thumbnail', onRender: ({ value }) => value ? `${apiBase()}/thumbnails/${encodeURIComponent(value)}` : undefined },
};
const schemaDefinition = { list: { columns: carSchema, buttons: { add: true } }, show: carSchema, edit: {}, new: {} };

<ReactiveAdmin
  dispatcher={dispatcher} name={name} schemaDefinition={schemaDefinition}
  components={{
    list: (props) => <SwitchableList {...props} titleField="name" thumbnailField="thumbnail" defaultView="card" />,
    show: CarShow,
    edit: CarShow,
    new: CarNew,
  }}
/>
```

**List → thumbnail (mostly generated):** `SwitchableList` with
`thumbnailField="thumbnail"` and `defaultView="card"` — the `thumbnail`
column's `onRender` (list-schema's mechanism, nothing new) resolves a
stored filename to a full thumbnail URL, and `CardList` (default card view)
turns that into a real `<img>`. **Note the actual current gap**: only card
view renders an `<img>` — if you switch to table/row view, that same
`onRender` still returns a bare URL string, which a `DetailsList` cell
prints as text, not an image. Generalizing that `onRender` to return a
small `<img>` element (or a `type: 'custom'`-flavored cell renderer, if
list-schema grows one) would fix table view too — that's exactly the
"extend the schema pattern, not build a new component" move this skill
argues for, and hasn't been done here yet.

**Show/Edit → fully custom (`CarShow` → `CarDetail`):** genuinely justified,
not a shortcut. `CarDetail` is one page composing **four separate `Form`
instances** (identity, four cross-entity device-profile links, day/night
photo uploads) plus a bespoke `DashPanEditor` widget and live-preview
wiring — no single `DisplaySchema`/`SchemaDefinition` could express "manage
three unrelated concerns with their own mutations on one screen." This is
the kind of case worth confirming with the user before building, per the
escalation rule below — it was.

**New → fully custom (`CarNew`):** also justified, but instructively
*partially* — its actual input UI is a completely ordinary schema-driven
`Form` (`{ name: {...}, carIds: { type: 'multi-select', options: knownCarIds.map(...) } }`).
What forced a custom slot wasn't the fields, it was the *page*: dynamic
`options` sourced from a separate `KnownCar` query, and a create-then-
navigate flow the generic `Create.tsx` doesn't parametrize. Recognize this
shape — schema-driven fields inside a custom page shell — as the middle
ground between "fully generated" and "fully custom," and default to it
before reaching for a from-scratch component.

## Two rules, non-negotiable

1. **Extend `form-schema`/`list-schema` before adding a component**, and
   only when the need is genuinely generalizable — `image-upload` earned
   its place as a real field type because upload-a-photo-into-a-field is a
   repeatable shape; a one-off widget for one screen's one quirk isn't a
   field type, it's a custom component (or a custom page shell around
   otherwise-normal fields, per `CarNew` above).
2. **If a fully custom component looks necessary, that's a call for the
   user, not something to decide and build.** Say what the generic
   slot can't express and why, the way this skill just did for
   `CarDetail`/`CarNew`, and let them confirm before writing it.
