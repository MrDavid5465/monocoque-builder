---
name: list-schema
description: Reference for writing a list/grid schema in this app (DisplaySchema<T> passed to List/CardList in typical-admin-fabric, and the enclosing ListSchema<T>/ITASchema shape used by ReactiveAdmin's Index router) — every DisplayField property, which of them are actually live vs. dead code today, and the List/CardList component props that sit alongside the schema. Use before writing or reviewing a `list: { columns: {...} }` definition or a List/CardList call site.
license: MIT
---

# Writing a list/grid schema in this app

A "list schema" is a `DisplaySchema<T>` (`src/lib/typical-admin/index.tsx`)
passed as `columns` to `List`/`CardList`
(`src/lib/typical-admin-fabric/{List.tsx,CardList.tsx,lib/List.tsx}`). Same
shape convention as a per-form schema — see the `form-schema` skill — every
entry is `{ [name]: {...config} }`, keyed by field name. That's also the
*only* real overlap between the two: a list column has no `type` (there's no
input to render, only a display), and a form field has no `onRender` (there's
no read-only display, only an input). Keep that distinction in mind — this
is a smaller, display-only surface, not a variant of `form-schema`'s catalog.

## `DisplayField` — every column's properties

| Property | Required | Behavior |
|---|---|---|
| `label` | yes | Column header text in the `DetailsList` grid; also the filter input's label (dead path, see below); also `CardList`'s title/thumbnail source runs through the same field. |
| `onRender` | no | `(row: Row) => any` where `Row = { value, values }` — `value` is this column's raw value, `values` is the whole row object. Used in **every** real column definition found in this app for formatting (opacity styling on empty values, computed counts, wrapping in a `<span>`) — treat a column without `onRender` as the exception, not the default. |
| `options` | no | Free-form bag — see the breakdown below. Only `minWidth`/`maxWidth` are real. |

### `options`: what's actually live

`lib/List.tsx` reads several sub-keys off `options`, but grepping every real
`columns:` definition in the app turns up only one of them in actual use:

| `options.` sub-key | Status | What it would do |
|---|---|---|
| `minWidth`, `maxWidth` | **Live** — used in every real schema that sets `options` at all | Column width bounds, passed straight to Fluent's `IColumn`. |
| `filterable: true` | **Dead** — implemented, zero real usages | Would render a filter input for this column above the grid. |
| `filterType: 'dateRange'` | **Dead** — implemented, zero real usages | Would swap the single filter input for a start/end pair. |
| `options: {text,value}[]` (nested — `DisplayField.options.options`, not to be confused with the outer `options` bag itself) | **Dead** — implemented, zero real usages | Would render the filter as a `select` dropdown instead of freeform text. |

Same situation as `display`/`hint` in per-form's `Field` — real, wired-up
code paths that nothing in this app actually exercises. Don't assume
`filterable: true` does anything just because `lib/List.tsx` has a branch
for it; verify against real usage (or add the first real one) before relying
on it.

## The enclosing shapes

```ts
// typical-admin/index.tsx
interface ListButtons { add?: boolean; }               // real, used everywhere with an "Add" flow
interface ListSchema<T> { buttons?: ListButtons; columns: DisplaySchema<T>; }
interface ITASchema {                                  // the full schemaDefinition passed to the ReactiveAdmin Index router
  list: ListSchema<any>;
  new?: SchemaDefinition<any>;    // a per-form schema — see form-schema
  show: DisplaySchema<any>;
  edit?: SchemaDefinition<any>;   // a per-form schema — see form-schema
}
```

A typical top-level admin screen (`components/TelemetryAdmin/*Admin.tsx`)
looks like:

```ts
const schemaDefinition = {
  list: { columns: carSchema, buttons: { add: true } },
  show: carSchema,
  edit: {},
  new: {},
};
```

`show`/`edit`/`new` mix `DisplaySchema` (read-only) and `SchemaDefinition`
(editable, per-form) — same object keys, genuinely different config shapes
per key. Don't assume they're interchangeable just because they share a
variable in a real schema file.

## `List`/`CardList` component props (not schema, but sit alongside it)

These configure the grid itself, not any one column — real, all confirmed
in use:

- `columnSelectable?: boolean` — opts into a "Columns" picker. Internally
  synthesizes a plain per-form `SchemaDefinition` of checkboxes (one per
  pickable column, `{ type: 'checkbox', label: col.label }`) and renders it
  through the real `Form` component (`ListControls.tsx`) — a genuine, live
  example of a list schema and a form schema composing in the same feature.
- `storageKey?`, `columnVisibilityStore?` — where the hidden-column set
  persists (defaults to `localStorage`, keyed by `storageKey ?? name`).
- `alwaysVisibleColumns?: string[]` — columns the picker can't hide.
- `customButtons?: ListButtonConfig[]` — grid-level toolbar actions:
  `{ key, label, icon, onClick, disabled?, danger? }`.
- `rowButtons?: RowButtonConfig[]` — act on whichever row is currently
  click-selected (not inline per-row buttons): `{ key, label, icon, onClick(item), disabled?(item), danger? }`.
- `pageSize?`, `idField?`, `queryResultKey?`, `hideHeader?` — pagination,
  route-id key override, GraphQL result-field override, header suppression.

`CardList` is a drop-in alternate renderer for the *same*
`dispatcher`/`schemaDefinition` contract (swapped in via
`components={{ list: (props) => <CardList {...props} titleField="name" thumbnailField="thumbnail" /> }}`)
— same `DisplaySchema`, rendered as a card grid instead of a table. It adds
`titleField`/`thumbnailField`/`cardWidth`/`thumbnailHeight`, and both
`title`/`thumbnailUrl` run through that column's `onRender` exactly like the
`DetailsList` grid does, so a schema written for one renders correctly
through either.

## Where this is headed: the `list` field

`DisplayField` (`{ label, onRender?, options? }`) and per-form's `Field`
(`{ type, label, ... }`) overlap in exactly two places: both are keyed by
name, and both carry `label`. That narrow overlap is deliberate context for
a planned change, not just a curiosity: it's specifically what makes merging
the two into one shared field-configuration type feasible — a merged type
could carry `type` (drives input rendering when used in a `Form`, irrelevant
in a `List` column) and `onRender` (drives display in a `List`, irrelevant
in a `Form`) side by side without either shape fighting the other.

That merge is what would let a `list` field type reuse this app's *existing*
`DetailsList`/column-layout machinery as its row-table renderer, instead of
building one from scratch — same column shell, but each cell mounts a live
per-form `Field` bound to that row's own state instead of a static
`onRender` value. Confirmed design so far (from the same discussion this
skill came out of): each row is a **full nested per-row `useForm`** (real
dirty/touched/validate/submit state, not flat value updates), and add/remove
-row UI is **built into the field itself**, not left to the schema author.

This is the planned replacement for `gamepad-select` (see `form-schema`'s
skill for why) — **not started, deferred until back at the real dev
environment.** No code in this app reflects it yet; nothing above in this
skill describes anything other than what exists today.
