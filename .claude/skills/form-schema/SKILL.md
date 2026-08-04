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
| *(unmatched string)* | — | plain `TextField`. `type` itself is never forwarded as a prop (Fabric.tsx destructures it out before `...rest` on **every** case) — `type: 'password'` does **not** get you a masked input, it silently renders as an ordinary `TextField`. `text`/`number`/`email`/`password`/`tel`/`url`/`textarea`/`search` are common intentional uses of this fallback. |

### Deferred `options`: the `fileSelect` sentinel

`select`/`multi-select`/`radio`/`picker`/`combobox` normally need a static
`options` array in the schema itself — but when the option list can't be
known until render time (e.g. a sprite file list fetched from disk), the
established pattern (`ObjectExplorer.tsx`'s `perFormSchema`) is: the static
schema sets `fileSelect: true` instead of `options`, and the component
rendering the form injects real `options` into a copy of the schema right
before passing it to `<Form>`. `fileSelect` is a sentinel this app invented,
not a real per-form/Fabric.tsx key — it gets stripped before the field ever
reaches per-form. See `button-control/schema.ts` and `slider-control/schema.ts`
for the two real examples.

### `gamepad-select` is slated for replacement

It works (via the same runtime-injection pattern as `fileSelect`, see
`ObjectExplorer.tsx`), but it's too narrow — a **generalized `list` field**
is planned to replace it. Don't build new features on `gamepad-select` or
invest in improving its validation further; a `list-schema` skill covering
the replacement is coming next.

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
