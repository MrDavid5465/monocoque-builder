# Plan: schema/dispatcher definitions become functions where dynamic data is needed; remove `fileSelect`

Status: **not started** — deferred until back at the real dev environment
(this session ran in a remote/ephemeral container). Captured here so the
next session has full context instead of re-deriving it.

## Context

Some Dashboard Designer component schemas need field data that isn't known
until render time — today, exactly two cases: sprite lists (for the sprite
picker fields) and gamepad mappings (for `gamepad-select`). Both are solved
today with one-off, non-generalizing mechanisms inside `ObjectExplorer.tsx`'s
`perFormSchema`:

```ts
// current code, src/components/Telemetry/DashboardDesigner/ObjectExplorer.tsx
const { fileSelect, ...rest } = field as any;
if (fileSelect) {
  out[key] = { ...rest, options: [{ text: '— none —', value: '' }, ...sprites.map(...)] };
} else if (field.type === 'gamepad-select') {
  out[key] = { ...rest, gamepadMappings };
}
```

`fileSelect: true` is a sentinel invented for this one purpose, special-cased
by name in the one component that knows to look for it. Every future
"this field needs runtime data" case would need its own bespoke branch here.
This was found and discussed while building the `form-schema` skill
(`.claude/skills/form-schema/`) — see that skill for the full static
property-catalog context this plan builds on.

## Decision

Schema (and, where paired with one, dispatcher) definitions that need
runtime data become **factory functions** instead of plain objects:

```ts
// today (static, e.g. Shakers/schema.ts) — stays exactly like this:
export const fooSchema: SchemaDefinition<Foo> = { ... };

// new, only for schemas that actually need runtime data:
export const buttonControlSchema = (props: { spriteOptions: { text: string; value: string }[] }): ComponentSchema => ({
  type: 'button-control',
  label: 'Button Control',
  icon: 'ToggleLeft',
  allowChildren: false,
  bindable: true,
  fields: {
    // ...
    ctrlOffFile: { label: 'Off: sprite', type: 'select', options: props.spriteOptions, section: 'Off State' },
    // ...
  },
});
```

The calling component resolves whatever data it needs — using data it
already has via its own hooks, same as today — and calls the function
synchronously. **`SchemaDefinition<T>`/`ComponentSchema`/`IDispatcher`'s own
shapes do not change** — only how individual schema/dispatcher *constants*
are authored and invoked at their call site changes.

**Hard rule, non-negotiable: a field must never make a network call, ever.**
All data resolution happens in the consuming component, before the schema
function is invoked. This is the whole point of the change — formalizing
the pattern `ObjectExplorer.tsx` already uses ad hoc, so it generalizes
instead of growing a new special case per field.

**Scope, confirmed**: only schemas/dispatchers that actually need dynamic
data become functions. The majority of schemas in the app (`Shakers/schema.ts`,
`CarDetail.tsx`'s inline schema, most ReactiveAdmin CRUD screens) are static
and are **not** touched — they stay plain objects exactly as they are today.
(Considered making every schema a function uniformly for one consistent
authoring convention; rejected as unnecessary migration cost for schemas
that will never need it.)

**`fileSelect: true` is removed entirely.** Its two current usages become
ordinary `type: 'select'` fields whose `options` the schema function fills
in from a prop the caller passes in (see example above).

## Explicitly out of scope for this plan

- **`gamepad-select`** — left exactly as it works today (including its own
  runtime injection in `ObjectExplorer.tsx`). It's slated for replacement by
  a generalized `list` field in separate, not-yet-started work (a
  `list-schema` skill, discussed but not designed yet — see "open thread"
  below). Don't fold gamepad-select into this plan's migration; don't
  redesign it here.
- The `list` field itself.
- Migrating any currently-static schema/dispatcher to function form "just
  because" — only convert where a real dynamic-data need exists today.

## Concrete changes

1. **`components/button-control/schema.ts`, `components/slider-control/schema.ts`**
   (`src/components/Telemetry/DashboardDesigner/`): convert the
   `buttonControlSchema`/`sliderControlSchema` exports from plain
   `ComponentSchema` object literals to `(props: { spriteOptions: {text,value}[] }) => ComponentSchema`
   functions. Replace every `{ ..., type: 'select', fileSelect: true, ... }`
   field with `{ ..., type: 'select', options: props.spriteOptions, ... }`.

2. **`ObjectExplorer.tsx`'s `perFormSchema`**: delete the `fileSelect` branch
   entirely. Since the schema export is now a function for these two
   component types, the call site needs to invoke it with resolved props
   before reading `.fields`, instead of reading `.fields` off a static
   object directly. The `gamepad-select` branch stays untouched (out of
   scope, see above).

   **Open design question for the next session**: `ObjectExplorer.tsx` is a
   single shared call site that iterates over *every* Dashboard Designer
   component type's schema, not just button/slider-control. Once some
   schemas are functions and most aren't, this call site needs a clean way
   to handle both shapes — e.g. `typeof schema === 'function' ? schema(props) : schema`.
   Decide and document this normalization at that call site rather than
   pushing the "is this a function" check into every consumer.

3. **Dispatcher-as-function**: same pattern applies to `IDispatcher`
   definitions (`typical-admin`'s `Create`/`Update`/`List`/`Index`,
   `src/lib/typical-admin/index.tsx`) *if and when* a real dispatcher needs
   runtime-dependent gql documents/variables. No such concrete need was
   identified while writing this plan — every existing `IDispatcher`
   definition found (e.g. `components/*/queries.ts`) is static. This is
   establishing the pattern for the first time it's actually needed, not a
   scheduled migration of existing dispatchers.

4. **Update the `form-schema` skill** (`.claude/skills/form-schema/SKILL.md`)
   once this lands:
   - Remove the "`fileSelect` sentinel" section (superseded).
   - Document the schema-as-function pattern in its place, including the
     "only where dynamic data is needed" scope rule and the "field never
     makes a network call" hard rule.
   - `validate-schema.cjs` will need real changes: it currently only walks
     object literals directly. A function-shaped schema export
     (`export const fooSchema = (props) => ({...})`) needs the validator to
     look inside the function's return expression instead — decide whether
     that's worth the added AST complexity, or whether function-shaped
     schemas get a lighter/different validation pass.

## Verification (once implemented, at the real dev env)

- `npm run tauri dev` → Dashboard Designer → add a Button Control and a
  Slider Control node → confirm the sprite dropdowns (`ctrlOffFile`,
  `ctrlOnFile`, `ctrlPressedFile`, `sliderThumbFile`) still populate and
  select correctly (use the `playwright-verify` skill for this).
- `npx tsc --noEmit` and `npx eslint .` clean.
- Re-run `.claude/skills/form-schema/scripts/validate-schema.cjs` across
  `src/` — confirm no new false positives/negatives against the now-function
  schemas.
- `npm run test:e2e` still green.

## Open thread, not part of this plan

`gamepad-select`'s replacement (`list-schema` skill / generalized `list`
field type) was discussed in the same session — a repeating-rows field type
mounting a full nested per-row `useForm`, with add/remove rows built into
the field itself (both confirmed). Design not yet started; pick up
separately, after this plan lands.
