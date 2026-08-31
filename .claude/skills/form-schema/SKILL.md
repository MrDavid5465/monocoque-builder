---
name: form-schema
description: Reference for writing a per-form/Fabric.tsx schema in this app (the SchemaDefinition<T> passed to Form/FormWrapper) — every universal Field property, the fixed catalog of type-specific extras Fabric.tsx actually implements, which properties are silently dead, and the runtime-injection pattern for extras a static schema can't know (options, gamepad mappings). Use before writing or reviewing any schema.ts / inline SchemaDefinition object, and run the bundled validator on it before calling it done.
license: MIT
---

# Writing a per-form schema in this app

A "schema" here is a `SchemaDefinition<T>` (per-form's `src/lib/per-form/types.ts`)
passed to `Form`/`FormWrapper` (`src/lib/typical-admin-fabric/lib/templates/`).
Every field in it is a plain object: `{ type: '...', label: '...', ...extras }`.
This property surface is a **fixed, closed catalog** — Fabric.tsx's `Raw`
component is one ~870-line `switch (type)` with exactly 18 special cases plus
a default TextField fallback. Don't re-derive this from memory or by
re-reading that file each time — check this table, and run the validator
script below on anything non-trivial.

## Universal properties (every field, any type)

| Property | Default | Behavior |
|---|---|---|
| `type` | *(required)* | Picks the Fabric.tsx render case **and** the submit-time converter (only `date`/`number`/`text` have a built-in one; anything else passes through raw). |
| `label` | *(required)* | Rendered as the field's label — except `datetime`, which has a real bug: it renders the literal word `label`, not the prop value. Don't rely on `datetime`'s label rendering. |
| `section` | — | Groups same-valued fields into a collapsible accordion (handled by `FormWrapper`, never reaches the Template). |
| `sectionCollapsed` | — | Set on any one field in a section to start that section closed. |
| `required` | `false` | Adds per-form's built-in "this field is required" validation. **The only validation mechanism used anywhere in this codebase today** — no `schema.ts` file has ever populated `validations` with a real entry. |
| `validations` | `[]` | `{ test(form): boolean, message: string }[]`. Fully wired (merged with the built-in required/no-leading-space checks in `useValidator`) but unused. Reach for this the first time this app needs a real cross-field or format validation, rather than working around the lack of one. |
| `defaultValue` | `''` | Seeds `useForm`'s initial value when no `initialValues` is passed. |
| `defaultNull` | — | Substituted at submit time when the raw value is `''`. Used today only in `Shakers/schema.ts`. |
| `converter` | — | Not in the `Field` TS interface (falls under its `[key: string]: any`) but *is* read by `converter.ts`: a per-field function overriding the type-keyed default at submit. Used today only in `denim/components/Header/Settings/schema.ts`. |
| `display` | `true` | **Dead.** Defaulted by `useSchema`, stripped by `FormWrapper` before reaching the Template — nothing reads it to actually skip rendering. Setting `display: false` does nothing today. |
| `hint` | — | **Also dead.** Declared in `IField`, but Fabric.tsx destructures it straight into a discarded `_hint`. |

## Type-specific extras (the closed catalog)

Everything not consumed above is spread via `...rest` onto the underlying
Fluent control — so any native prop of that control also works, not just
what's listed. That's the main source of "what else can I pass" ambiguity;
when in doubt, check what Fluent component the type wraps (see Fabric.tsx).

| `type` | Required extra | Notable optional extras |
|---|---|---|
| `checkbox` | — | anything `Checkbox` accepts |
| `multicheckbox` | `fields: {[key]: Field}` | — |
| `radio` | `options: {text,value}[]` | anything `ChoiceGroup` accepts |
| `select` | `options: {text,value,disabled?}[]` | see "deferred options" below |
| `multi-select` | `options: {text,value,disabled?}[]` | value is an array |
| `gamepad-select` | `gamepadMappings: GamepadMapping[]` | `gamepadFilter?: 'button'\|'axis'` — **being replaced**, see below |
| `image-upload` | `uploadFn(dataUrl, filename) => Promise<{id,filename,url}>` | `resolveUrl?`, `allowClear?`, `uploadLabel?`, `placeholderText?` |
| `picker` | `options: {text,value}[]` | — |
| `date` | — | anything `DatePicker` accepts, `placeholder` |
| `datetime` | — | `hourOptions?`, `minuteOptions?` (has the label bug above) |
| `combobox` | `options: {text,value}[]` | — |
| `timetoday` | — | `hourOptions?`, `minuteOptions?` |
| `range` / `slider` | — | `min?`(0), `max?`(100), `step?`(1), `onActivate?`, `onDeactivate?` |
| `button` | — | `variant?: 'primary'\|'danger'\|'default'`, `onClick`, `buttonStyle?` |
| `signature` | — | reads `signature` off the field def itself |
| `tyre-position` | — | app-specific, wraps `TyreGrid`, no extras |
| `custom` | `onRender({value,onChange,name}) => ReactElement` | escape hatch, bypasses everything else |
| `list` | `itemSchema` | repeating rows; see the section below |
| *(unmatched string)* | — | plain `TextField`. `type` itself is never forwarded as a prop (Fabric.tsx destructures it out before `...rest` on **every** case) — `type: 'password'` does **not** get you a masked input, it silently renders as an ordinary `TextField`. `text`/`number`/`email`/`password`/`tel`/`url`/`textarea`/`search` are common intentional uses of this fallback. |

### Deferred `options`: schema-as-factory-function

`select`/`multi-select`/`radio`/`picker`/`combobox` normally need a static
`options` array in the schema itself — but when the option list can't be
known until render time (today: exactly one case, a sprite file list
fetched from disk), the schema export is a **factory function** instead of
a plain object:

```ts
// components/types.ts
export interface SchemaProps { spriteOptions: { text: string; value: string }[]; }
export type ComponentSchemaSource = ComponentSchema | ((props: SchemaProps) => ComponentSchema);

// components/button-control/schema.ts
export const buttonControlSchema = (props: SchemaProps): ComponentSchema => ({
  type: 'button-control',
  // ...
  fields: {
    ctrlOffFile: { label: 'Off: sprite', type: 'select', options: props.spriteOptions, section: 'Off State' },
    // ...
  },
});
```

The caller (`ObjectExplorer.tsx`'s `ComponentPropertiesPanel`) resolves the
data it already has (the dashboard's sprite list) and calls
`getSchema(node.type, { spriteOptions })`
(`components/registry.ts`) — which normalizes both shapes
(`typeof source === 'function' ? source(props) : source`), so nothing
downstream of `getSchema`/`ALL_SCHEMAS` needs to know which one a given
component type uses. `ALL_SCHEMAS` (used for palette metadata only —
type/label/icon/allowChildren) resolves factory schemas with an empty
sprite list, since those fields don't affect metadata.

**Only schemas that actually need runtime data are factory functions** —
every other schema in the app (`Shakers/schema.ts`, `CarDetail.tsx`'s inline
schema, most ReactiveAdmin CRUD screens, and every Dashboard Designer
component schema that has no sprite field) stays a plain object. Don't
convert a schema to a function "for consistency" — only when it genuinely
needs data a static object can't express. **Hard rule: a schema factory
function must never make a network call** — all data resolution happens in
the calling component, before the function is invoked.

There used to be a `fileSelect: true` sentinel for this (a fake field
property stripped by `ObjectExplorer.tsx` before reaching per-form) — it's
gone. If you see `fileSelect` anywhere, that schema was missed in the
migration; convert it to the factory-function pattern above rather than
reviving the sentinel.

### `list` — repeating rows

A field whose value is an **array of row objects**. Each row mounts its own
nested `useForm` over `itemSchema`, so row fields are ordinary top-level
keys — which is exactly why this works at all: `useForm.onChange` does
`name.split('.').slice(-1)[0]`, so dotted/nested field paths are actively
destroyed. Nesting the form is what makes that constraint irrelevant. Never
try to express rows as `rows.0.price`.

Required: **`itemSchema`** — a plain `SchemaDefinition`, or
`({row, index, rows}) => SchemaDefinition` when a row's field *config* must
depend on that row's own data (a gamepad mapping's `index` maxing at 5 for
an axis but 31 for a button), or when one row's `options` must exclude
values already used by sibling rows.

> **Hard rule:** a function `itemSchema` may vary field config but must
> return the **same key set** every call. `useForm` seeds `values` once at
> mount, so a key added later never receives a value. Asserted in dev.

Other props: `rowKey` (stable identity — supply a real id whenever rows can
be removed or reordered, or removing row 0 appears to edit row 1),
`rowLabel`, `min`/`max`, `fixed` (rows derived from external data, no
add/remove UI), `newRow`, `singular`/`addLabel`/`removeLabel`/`emptyText`,
`deriveRow` (cross-field coupling *within* a row — it's told which field
changed, rather than inferring it by diffing), `onRowCommit` (for consumers
issuing one server mutation per row), `deferWhileDragging`, `converters`,
`horizontal`/`rowStyle`.

You do **not** write validations for a list: `useSchema` derives them from
`itemSchema` + `min`/`max` and surfaces indexed messages
(`Row 2: Name — This field is required`) at the list's own key, which is
what flips the parent form invalid. `required: true` is a no-op on an array
(`!![]` is `true`) — use `min: 1`; the validator script warns about this.

Drag hooks are injected into every `slider`/`range` row field
automatically. Do not thread `onActivate`/`onDeactivate` by hand.

Related: **`useRowCommit`** (`per-form/useRowCommit.ts`) is the same
commit-gating primitive `list` uses, exported separately for per-row forms
that can't be a `list` — notably the Shakers grid cells, which are
`DetailsList` columns and so can't render as a vertical row stack. It
handles mount-tick suppression, the during-render identity reset, and
drag-deferred commits.

### `gamepad-select`

Renders a dropdown of named gamepad mappings, and **stays** — it's consumed
by the `button-control`/`slider-control` schemas. What the `list` field
replaced was the hand-rolled *editor* for those mappings in denim's
Settings, not this render case.

It still uses its own ad hoc runtime injection, though: unlike the
sprite-select fields above, `gamepad-select` schemas stay plain objects and
`ObjectExplorer.tsx`'s `perFormSchema` merges in `gamepadMappings`
field-by-field at render time
(`field.type === 'gamepad-select' ? { ...field, gamepadMappings } : field`)
rather than going through the schema-factory pattern. Prefer moving it onto
the `SchemaProps`/`getSchema()` factory route rather than extending the
type-sniff.

## Run the validator before calling a schema done

```bash
node .claude/skills/form-schema/scripts/validate-schema.cjs path/to/schema.ts
# or, with no args, scans all of src/:
node .claude/skills/form-schema/scripts/validate-schema.cjs
```

It parses with the real TypeScript compiler API (not regex) and checks,
against the exact tables above: unknown/typo'd `type` values (with a
did-you-mean suggestion), missing required extras per type (aware of the
`fileSelect` sentinel and the `gamepad-select` runtime-injection
convention, so it won't cry wolf on either), and use of the dead
`display`/`hint` properties. Exits non-zero only on real errors — warnings
don't fail the run. Same result every time, no tokens spent re-deriving the
catalog by hand.
