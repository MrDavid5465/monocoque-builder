# Building with denim

This system is **Fluent UI (v8) under the hood, CSS-in-JS**. Two consequences
shape everything below: there is **no CSS class vocabulary and no CSS custom
properties** to reach for, and components must sit inside a theme provider or
they fall back to stock Fluent and stop looking like this product.

## Wrap the tree

Everything renders through Fluent's `ThemeProvider`, with denim's own palette.
Both are exported from this system — do not import Fluent directly:

```jsx
import { ThemeProvider, lightTheme, Form, FormCard } from '<this system>';

<ThemeProvider theme={lightTheme}>
  <FormCard style={{ maxWidth: 420 }}>
    <Form
      name="deviceProfile"
      form={{
        name:    { type: 'text',     label: 'Profile name', required: true },
        device:  { type: 'text',     label: 'Output device' },
        enabled: { type: 'checkbox', label: 'Enabled' },
      }}
      initialValues={{ name: 'Endurance — rear', enabled: true }}
    />
  </FormCard>
</ThemeProvider>
```

`darkTheme` is the same palette in dark. Skip the provider and every surface
renders in default Fluent blue-grey instead of this product's colours.

Two more context rules, both of which produce blank output when missed:

- **Router.** `Header`, `HeaderLink`, `Links`, `ReactiveAdmin` and every CRUD
  slot call react-router hooks. Wrap in the exported `MemoryRouter` (or your
  app's router). Never nest one router inside another — react-router throws
  and the subtree renders nothing.
- **Apollo.** `ReactiveAdmin`, `ListScreen`, `CardList`, `SwitchableList`,
  `Create`, `Update`, `Show`, `Delete` and `Denim` all fetch. They need an
  Apollo provider; without one they sit on `loading...` forever.

## The styling idiom: props and theme, never classes

There is no `className` vocabulary in this system. Style in three ways, in
this order of preference:

1. **Component props.** Most layout intent is already a prop — `ThumbnailCard`
   takes `title`, `titlePrefix`, `actions`, `thumbnailUrl`, `fit`, `width`,
   `thumbnailHeight`; `CardList` takes `titleField`, `thumbnailField`,
   `cardWidth`; `ButtonDropdown` takes `color="primary"`.
2. **Theme values for your own glue.** Read them with `useTheme()` (or
   `getTheme()`), then use real Fluent palette keys:
   `theme.palette.themePrimary`, `neutralPrimary`, `neutralSecondary`,
   `neutralLighter`, `white`. Use these instead of hex literals so light/dark
   both work.
3. **Inline styles** for one-off spacing. That is what this system's own
   components do internally; there is no utility-class layer to prefer.

```jsx
const theme = useTheme();
<div style={{ color: theme.palette.neutralSecondary, padding: 12 }}>…</div>
```

## Schema-driven, not hand-assembled

The two workhorses take a **schema** rather than children:

- **`Form`** — `form={{ fieldName: { type, label, ...} }}`. Field kinds include
  `text`, `number`, `textarea`, `checkbox`, `radio`, `select` (with
  `options: [{text, value}]`), `slider` (`min`/`max`/`step`), `date`,
  `combobox`. An unrecognised `type` falls back to a plain text field.
  `required: true` is the validation mechanism.
- **`List`** — `items` you already have plus `schema={{ key: { label, onRender } }}`.
  A field's `onRender({ value, values })` formats that cell; that is how you
  turn a number into `1:27.412` or a filename into a URL.

**`ReactiveAdmin` is the composition unit for anything CRUD.** Give it a
`dispatcher` (gql documents per slot) and a `schemaDefinition`
(`{ list: { columns, buttons }, show, edit, new }`) and it routes
list/show/new/edit for you. Do not assemble `ListScreen` + `Create` + `Show` +
`Update` by hand — those are the slots it fills. Override exactly one slot and
the rest stay generated:

```jsx
<ReactiveAdmin
  dispatcher={dispatcher}
  name={{ singular: 'Car', plural: 'Cars' }}
  schemaDefinition={schemaDefinition}
  components={{ list: (props) => <SwitchableList {...props} titleField="name" /> }}
/>
```

The templates are equally usable **standalone** when no CRUD is involved:
`Form`, `FormCard`, `ThumbnailCard`, `List`, `ListControls`, `Prompt`.

## Where the truth lives

Read these before styling anything: each component's own
`components/<group>/<Name>/<Name>.d.ts` (the prop contract) and
`<Name>.prompt.md`. `styles.css` imports only `_ds_bundle.css`, which carries
component CSS — its handful of `--rc-*` custom properties belong to the image
cropper and are **not** design tokens. Colour and type live in the theme
object, nowhere else.

## Gotchas that cost real debugging time

- **`Fabric` here is not a theme provider.** In denim's internal lib `Fabric`
  aliases Fluent's `ThemeProvider`, but the `Fabric` exported by this system is
  per-form's field renderer. Use `ThemeProvider` for theming.
- **Two lists, two jobs.** `List` is presentational (you pass `items`);
  `ListScreen` is the Apollo-bound CRUD screen that fetches its own rows.
- **`Photo`'s `image` prop is raw base64**, not a data URI — it prepends
  `data:image/png;base64,` itself.
- **`ConfirmDialogHost` renders nothing on its own.** Mount it once near the
  root and open it by awaiting `confirmAsync(message, options)`.
- **`ListControls` is `position: absolute`** — it expects a
  `position: relative` ancestor, which `List` provides.
- **`HeaderLink` renders white text**, for the theme-blue header bar only.
