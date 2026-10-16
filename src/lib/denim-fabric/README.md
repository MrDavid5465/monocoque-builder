# denim-fabric

The shared [Fluent UI v8](https://developer.microsoft.com/en-us/fluentui)
(`@fluentui/react`) pieces of the [Denim](https://github.com/MrDavid5465/denim)
app shell. "Fabric" is Office UI Fabric, Fluent's old name: this is the
Fluent skin over Denim's headless core, just as typical-admin-fabric is the
Fluent skin over typical-admin.

It has **no bar of its own**. The bars are separate packages, so an app
ships only the one it uses:

| Package | The bar |
|---|---|
| [denim-fabric-topbar](https://github.com/MrDavid5465/denim-fabric-topbar) | the original Denim look: a fixed header with the active application's name and links, a waffle panel listing every application, Settings in the panel's footer |
| [denim-fabric-sidebar](https://github.com/MrDavid5465/denim-fabric-sidebar) | a configuration-app layout: applications grouped under headings with icons and status dots, Settings in the sidebar footer; wide, medium and phone layouts; touch-friendly |

Both bars export **exactly the same members** (the same names, the same
types), so switching is an import-path change. Each re-exports everything
here, so an app can import from its bar package alone.

What lives here, shared by every bar:

- the **Settings dialog** (the core's General tab and extension tabs),
  the **splash**, **theming** (12 colours x light / dark / high contrast,
  favicon in the theme colour), the **confirm dialog** (typical-admin-
  fabric's, re-exported) and the **logo**;
- **master-detail** (`MasterDetail`, `AdminMasterDetail` for a ReactiveAdmin
  screen, `useDetailRoute`) and **`FullBleed`**: they work under any bar;
- the **layout hook** (`useLayout`, `useShellLayout`, the breakpoints) that
  every bar provides;
- **motion** (`SlidingIndicator`, `DrillIn`, `ShellMotionProvider`) and the
  `debugPerf` timings;
- `lib/`: the convenience barrel (Fluent, react-router, Apollo hooks,
  date-fns, typical-admin-fabric's `Form`/`List`/cards, `getStyle()`), kept
  so existing imports keep working;
- the bars' shared props (`ShellProps`) and export contract
  (`shared/barContract.ts`).

It is meant to be cloned and changed: copy a bar's folder to vary it, or
use the bars as the model for a skin in another UI kit (see
[Write your own bar or skin](#write-your-own-bar-or-skin)).

Consumed as source (no build step, no npm package).

## Using with an AI coding agent

Before writing any code with denim-fabric, read:

- this package's skill,
  [`.claude/skills/denim-fabric/SKILL.md`](./.claude/skills/denim-fabric/SKILL.md):
  choosing a bar, master-detail with ReactiveAdmin, the layout hook,
  `FullBleed`, theming, the Settings dialog, `getStyle()`, quick entry;
- your bar's skill: `denim-fabric-topbar/.claude/skills/denim-fabric-topbar/SKILL.md`
  or `denim-fabric-sidebar/.claude/skills/denim-fabric-sidebar/SKILL.md`;
- [`.claude/skills/write-a-denim-skin/SKILL.md`](./.claude/skills/write-a-denim-skin/SKILL.md)
  before changing a bar, writing a new one, or writing a skin for another
  UI kit (the export surface and the parity check are there);
- the core's, `denim/.claude/skills/denim-app-shell/SKILL.md` (applications,
  routes, settings and their extension point, status dots, the server
  contract).

Then the siblings' skills:

- typical-admin-fabric `.claude/skills/`: `reactive-admin`, `form-schema`,
  `list-schema`, `hand-rolled-components`, `playwright-verify`
- typiql-rs `.claude/skills/typiql-api`: the backend

Skills in a cloned repository are not loaded automatically unless the agent
was started inside that repository, so open the `SKILL.md` files directly.

## Layout: clone the libraries side by side

The packages import each other by relative path (`../denim`,
`../denim-fabric`, `../typical-admin`, `../typical-admin-fabric`,
`../per-form`), so they must be sibling folders. Clone **one** bar:

```
your-app/src/lib/denim/
your-app/src/lib/denim-fabric/
your-app/src/lib/denim-fabric-sidebar/     (or denim-fabric-topbar/)
your-app/src/lib/typical-admin/
your-app/src/lib/typical-admin-fabric/
your-app/src/lib/per-form/
```

```sh
cd your-app/src/lib
git clone https://github.com/MrDavid5465/denim
git clone https://github.com/MrDavid5465/denim-fabric
git clone https://github.com/MrDavid5465/denim-fabric-sidebar   # or denim-fabric-topbar
git clone https://github.com/MrDavid5465/typical-admin
git clone https://github.com/MrDavid5465/typical-admin-fabric
git clone https://github.com/MrDavid5465/per-form
```

(or add them as git submodules at those paths, or copy them in). The
backend, [typiql-rs](https://github.com/MrDavid5465/typiql-rs), is a Rust
dependency; denim's README has the backend these setups run against.

Master-detail needs a typical-admin-fabric whose `List` has the
`basePath`, `selectOnClick`, `selectedKey` and `labels` props and whose
`Links` has `hideBack`, and the typical-admin with `labels.ts`.
`Photo` needs the typical-admin-fabric with `lib/templates/Photo/` and
`lib/formStyles.ts`.

## Peer npm packages

Versions known to work together:

```bash
npm i react@^18.3.1 react-dom@^18.3.1 \
  @fluentui/react@^8.125.6 @fluentui/react-motion@^9.16.4 \
  @apollo/client@^4.2.3 graphql@^16.14.2 rxjs@^7.8.2 \
  react-router@^7.17.0 react-router-dom@^7.17.0 \
  match-sorter@^8.3.0 date-fns@^4.4.0 \
  react-image-crop@^11.0.10 react-dropzone@^15.0.0 exif-js@^2.3.0
npm i -D typescript@~5.6.2 vite@^6 @vitejs/plugin-react@^4.3.4 \
  @types/react@^18.3.1 @types/react-dom@^18.3.1
```

- `react-image-crop`, `react-dropzone` and `exif-js` are for `Photo`
  (typical-admin-fabric's, re-exported here); they are needed to type-check
  the folders even if you never render it.
- `@fluentui/react-hooks` and `graphql-tag` come in with `@fluentui/react`
  and `@apollo/client`; don't install them.
- `@fluentui/react-motion` is Fluent v9's motion library (stable). It has
  no v9 component dependencies and runs beside Fluent v8; the bars use it
  for their motion (see "Motion").
- TypeScript needs Vite's client types: `"types": ["vite/client"]` in
  `tsconfig.json`. Everything type-checks under Vite's default strict
  `tsconfig` (`strict`, `noUnusedLocals`, `noUnusedParameters`).

## Minimal setup

These files are the same whichever bar you use; the bar READMEs have the
complete setups (more applications, master-detail, a status dot, a canvas
app).

**`vite.config.ts`**: proxy the GraphQL endpoint so it is same-origin in dev.

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/typiql': 'http://localhost:4123' },
  },
});
```

**`src/apollo.ts`**

```ts
import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client';

// typiql serves queries, mutations and subscriptions on one POST endpoint;
// HttpLink handles its multipart subscriptions on its own.
export const client = new ApolloClient({
  link: new HttpLink({ uri: import.meta.env.VITE_GRAPHQL_URL ?? '/typiql/graphql' }),
  cache: new InMemoryCache(),
});
```

**`src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApolloProvider } from '@apollo/client/react';
import { ConfirmDialogHost } from './lib/denim-fabric';
import { MergedSubscriptionProvider } from './lib/typical-admin/MergedSubscriptions';
import { client } from './apollo';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ApolloProvider client={client}>
      {/* One subscription connection for every mounted ReactiveAdmin screen. */}
      <MergedSubscriptionProvider>
        <BrowserRouter>
          <App />
          <ConfirmDialogHost />
        </BrowserRouter>
      </MergedSubscriptionProvider>
    </ApolloProvider>
  </React.StrictMode>,
);
```

- No `ThemeProvider`, `loadTheme` or `initializeIcons()`: the bar applies
  the theme to `<body>`, and importing it registers Fluent's icons.
- `<ConfirmDialogHost />` serves `confirmAsync()` (the list delete
  buttons). It is typical-admin-fabric's, re-exported: there is one.
- `MergedSubscriptionProvider` merges every live subscription into one
  connection, so open screens don't use up the browser's ~6 per origin.

**`src/admin/ProjectsAdmin.tsx`**: a ReactiveAdmin CRUD screen (see the
`reactive-admin` skill).

```tsx
import { gql } from '@apollo/client';
import ReactiveAdmin from '../lib/typical-admin-fabric';
import type { ITASchema, IDispatcher } from '../lib/typical-admin';

const FIELDS = 'id name description priority archived';

const dispatcher: IDispatcher = {
  list: gql`query getProjects { getProjects { ${FIELDS} } }`,
  show: gql`query getProject($id: String!) { getProject(id: $id) { ${FIELDS} } }`,
  new: gql`mutation addProject($values: ProjectInput!) { addProject(values: $values) { ${FIELDS} } }`,
  edit: gql`mutation updateProject($id: String!, $update: ProjectInput!) { updateProject(id: $id, update: $update) { ${FIELDS} } }`,
  delete: gql`mutation removeProject($id: String!) { removeProject(id: $id) { id } }`,
  subscribe: gql`subscription projectChanged { projectChanged { operationName value { id } } }`,
  subscribeToOne: gql`subscription projectChanged($id: String) { projectChanged(id: $id) { operationName value { id } } }`,
};

const display = {
  name: { label: 'Name' },
  priority: { label: 'Priority', options: { minWidth: 60, maxWidth: 80 } },
};

const form = {
  name: { type: 'text', label: 'Name', required: true },
  description: { type: 'text', label: 'Description', multiline: true, defaultNull: null },
  priority: { type: 'number', label: 'Priority', defaultNull: null },
  archived: { type: 'checkbox', label: 'Archived', defaultValue: false },
};

const schemaDefinition: ITASchema = {
  list: { columns: display, buttons: { add: true } },
  show: { ...display, description: { label: 'Description' } },
  new: form,
  edit: form,
};

// Mounted by the bar at /projects/*; ReactiveAdmin nests its own routes there.
export default function ProjectsAdmin() {
  return (
    <ReactiveAdmin
      dispatcher={dispatcher}
      name={{ singular: 'Project', plural: 'Projects' }}
      schemaDefinition={schemaDefinition}
    />
  );
}
```

**`src/App.tsx`**: the bar. This is the only file that names it.

```tsx
import Shell from './lib/denim-fabric-sidebar';   // or './lib/denim-fabric-topbar'
import ProjectsAdmin from './admin/ProjectsAdmin';

// The bar, Settings, theming and one route per application at /<path>/*.
// `components` maps each application's `frontEnd` (from the backend's
// my.applications) to its component.
export default function App() {
  return <Shell title="Projects" settingsSource="server" components={{ projects: ProjectsAdmin }} />;
}
```

Applications with no entry in `components` render an empty page; map the
others as you build them.

## Same exports as every bar

Every bar package's `index.ts` is exactly:

```ts
export * from '../denim-fabric';                 // this package, and the core
export const Shell: ShellComponent = ...;        // the bar's shell
export default Shell;
```

| Member | What it is |
|---|---|
| `default`, `Shell` | the bar's shell: `React.FC<ShellProps>` |
| `ShellProps` | every `<DenimProvider>` prop plus `themes`, `Logo`, `Brand`, `title`, `Controls`, `ExternalApps`, `SidebarFooter`, `breakpoints`, `welcome`. A bar ignores the ones it has no place for (each prop's comment says which bars use it). |
| everything else | from denim-fabric (below) and the core |

So an app moves between bars by changing one import:

```diff
-import Shell from './lib/denim-fabric-topbar';
+import Shell from './lib/denim-fabric-sidebar';
```

(and cloning the other bar). A bar's building blocks (`Header`, `NavBar`,
`Sidebar`, `StatusDot`, ...) are not on the surface; import them from the
bar's folder, e.g. `./lib/denim-fabric-sidebar/SidebarShell/Sidebar`, when
you copy or vary that bar.

**The parity check.** The surface is defined once, in
`shared/barContract.ts` (`BarExports` = this package's exports + `Shell` +
`default`). Each bar has a `parity.check.ts`:

```ts
import type * as Bar from './index';
import type { Assert, MatchesBarExports } from '../denim-fabric/shared/barContract';
export type SidebarExportParity = Assert<MatchesBarExports<typeof Bar>>;
```

It fails to type-check (`Type 'false' does not satisfy the constraint
'true'`) if the bar exports a member the contract doesn't have, lacks one,
or gives one a different type. Your app's `tsc` checks it (it is under
`src/`), so it runs in every app's type-check without any setup.

Type-only exports aren't visible to that check, so
`scripts/check-bar-parity.mjs` compares the bars' complete export lists,
types included, with the TypeScript compiler. Run it from an app with the
bars side by side (one bar is enough to check it against the contract):

```sh
node src/lib/denim-fabric/scripts/check-bar-parity.mjs \
  src/lib/denim-fabric-topbar src/lib/denim-fabric-sidebar
```

**Adding a bar, or a member.** A new bar copies one bar's `index.ts` and
`parity.check.ts` and keeps `index.ts` to those three lines. A member every
bar should have goes into denim-fabric (it reaches every bar through
`export *`) or, if each bar implements it differently, into `BarOwnExports`
in `shared/barContract.ts` and into every bar's `index.ts`, with a sensible
default or no-op where it doesn't apply. See the `write-a-denim-skin` skill.

## Master-detail

An optional list | detail pattern for an application's content. It works
under any bar: wide and medium screens show both panes, a phone one at a
time with a back bar. Under the sidebar that back bar is the sidebar's own
(it leads to the list while a detail is open); under the top bar, or no
bar, MasterDetail draws one above the detail.

### A ReactiveAdmin screen

Replace `ReactiveAdmin` with `AdminMasterDetail`; same props:

```tsx
import { gql } from '@apollo/client';
import { AdminMasterDetail } from '../lib/denim-fabric';
import type { ITASchema, IDispatcher } from '../lib/typical-admin';

const FIELDS = 'id name kind port enabled';

const dispatcher: IDispatcher = {
  list: gql`query getDevices { getDevices { ${FIELDS} } }`,
  show: gql`query getDevice($id: String!) { getDevice(id: $id) { ${FIELDS} } }`,
  new: gql`mutation addDevice($values: DeviceInput!) { addDevice(values: $values) { ${FIELDS} } }`,
  edit: gql`mutation updateDevice($id: String!, $update: DeviceInput!) { updateDevice(id: $id, update: $update) { ${FIELDS} } }`,
  delete: gql`mutation removeDevice($id: String!) { removeDevice(id: $id) { id } }`,
  subscribe: gql`subscription deviceChanged { deviceChanged { operationName value { id } } }`,
  subscribeToOne: gql`subscription deviceChanged($id: String) { deviceChanged(id: $id) { operationName value { id } } }`,
};

const kinds = ['Wheelbase', 'Pedals', 'Shifter', 'Shaker'].map(k => ({ text: k, value: k }));

const display = {
  name: { label: 'Name' },
  kind: { label: 'Kind' },
  port: { label: 'Port' },
  enabled: { label: 'Enabled', onRender: ({ value }: { value: any }) => (value ? 'Yes' : 'No') },
};

const form = {
  name: { type: 'text', label: 'Name', required: true },
  kind: { type: 'select', label: 'Kind', options: kinds, required: true },
  port: { type: 'text', label: 'Port', defaultNull: null },
  enabled: { type: 'checkbox', label: 'Enabled', defaultValue: true },
};

const schemaDefinition: ITASchema = {
  list: { columns: display, buttons: { add: true } },
  show: display,
  new: form,
  edit: form,
};

// The list pane shows the name and kind columns; selecting a row opens its
// show/edit pages in the detail pane (or full screen on a phone).
export default function DevicesAdmin() {
  return (
    <AdminMasterDetail
      dispatcher={dispatcher}
      name={{ singular: 'Device', plural: 'Devices' }}
      schemaDefinition={schemaDefinition}
      listColumns={['name', 'kind']}
    />
  );
}
```

- List pane: typical-admin-fabric's `List`, without its page heading, with
  `basePath` set to where the app is mounted (so a click while a detail is
  open goes to `/devices/<id>/show`, not nested under the open one). Set
  `list.buttons.add` for an Add button in it.
- Detail pane: a ReactiveAdmin whose list slot is empty, so its own `/new`,
  `/:id/show`, `/:id/edit` routes render there. Slot overrides
  (`components={{ show: ..., edit: ... }}`) and `callBacks` work as usual.
- Headings come from typical-admin's display `labels`, kept apart from the
  GraphQL names in `name`: "Devices", "Device", "Edit device", "New device"
  by default. Override any key, e.g. `labels={{ singular: 'Rig device',
  showHeading: '{singular} details' }}` (the `reactive-admin` skill lists
  them).
- `listProps` passes extra props to the `List` (`queryResultKey`,
  `idField`, `columnSelectable`, `storageKey`); also `components`,
  `callBacks`, `pageSize`, `labels`, `title` (default the list heading),
  `empty`, `listWidth`.
- Selection is the URL (`/devices/<id>/show`): deep links, reloads and the
  browser's Back and Forward work. The list highlights the row in the URL
  and turns to its page on a deep link, Back/Forward or a new record.
- The list stays mounted while details open and close (hidden under the
  detail on a phone): page, sort, filters and scroll survive, and rows open
  on click, so the row just closed opens again.
- On a phone the back bar is the only back control: the detail's own back
  arrow is dropped (`Links`' `hideBack`; Edit and Delete stay). From an
  edit page it goes up to the record, then to the list.

### Anything else

`AdminMasterDetail` is `MasterDetail` + ReactiveAdmin. For other content,
use `MasterDetail` with any list and detail, and `useDetailRoute` for the
selection in the URL:

```tsx
import { Link } from 'react-router-dom';
import { MasterDetail, useDetailRoute } from '../lib/denim-fabric';

const zones = [{ id: 'cockpit', name: 'Cockpit' }, { id: 'desk', name: 'Desk' }];

// Any list and any detail: selection is the ":id" after the app's path.
export default function ZonesApp() {
  const { basePath, selected, id } = useDetailRoute([':id']);
  const zone = zones.find(z => z.id === id);
  return (
    <MasterDetail
      title="Zones"
      selected={selected}
      listUrl={basePath}
      list={zones.map(z => (
        <Link key={z.id} to={`${basePath}/${z.id}`} style={{ display: 'block', minHeight: 44 }}>
          {z.name}
        </Link>
      ))}
      detail={zone ? <h2>{zone.name}</h2> : <p>No such zone.</p>}
    />
  );
}
```

| `MasterDetail` prop | What it does |
|---|---|
| `list`, `detail` | the panes' content; `detail` renders while `selected` |
| `selected`, `listUrl` | from `useDetailRoute()`: whether a detail is open, and the list's URL (the phone's back target) |
| `title`, `listActions` | the list pane's heading and controls |
| `empty` | the detail pane while nothing is selected |
| `listWidth` | list pane width in px (default 360; 85% of it on medium) |
| `back` | where a phone's back bar goes while a detail is open, `{ label, to }`; default the list (`title`, `listUrl`) |

`useDetailRoute(patterns)` defaults to ReactiveAdmin's `['new', ':id/show',
':id/edit']`; call it in a component mounted under a `<route>/*` (every
application is). Apps that aren't lists don't use MasterDetail.

## Layout under any bar

Every bar provides a `ShellLayoutContext`: the layout for the window's
width (`'wide'`, `'medium'` or `'narrow'`, from the bar's `breakpoints`,
default `{ medium: 700, wide: 1200 }`), whether the bar draws a phone back
bar of its own, and a `goUp(to)` that is the browser's Back when Back leads
there (so "up" never piles up history).

```tsx
import { useLayout } from '../lib/denim-fabric';

const narrow = useLayout() === 'narrow';   // the bar's layout; the window's outside a bar
```

`useShellLayout()` returns the whole context (null outside a bar);
`useBreakpoint(bp)`, `layoutFor(width, bp)` and `DEFAULT_BREAKPOINTS` are
there for a bar of your own (`useSimpleShellLayout(bp)` builds the context
for a bar without a back bar).

**`FullBleed`** cancels the bar's content padding, so its children fill
the whole content area (edge to edge, full height): a canvas, a map, a
designer. `MasterDetail` uses it. A bar describes its content area with CSS
custom properties on the page box, which `FullBleed` reads:

| Property | Set by |
|---|---|
| `--denim-content-padding` | padding on all four sides (sidebar: 20px, 12px on a phone) |
| `--denim-content-padding-inline`, `--denim-content-padding-block` | when the sides differ (top bar: `1em`, `0px`) |
| `--denim-content-height` | the content area's height, when the page box has none (top bar: the viewport below the header) |

```tsx
import { FullBleed } from '../lib/denim-fabric';

export default function LayoutDesigner() {
  return <FullBleed style={{ display: 'flex', flexDirection: 'column' }}>{/* toolbar + canvas */}</FullBleed>;
}
```

## Theming

- Settings hold a theme key `"<mode>-<color>"` (12 colours x `light` /
  `dark` / `hc`) and a font scale. The bar builds the Fluent theme from
  `themes` (default `THEMES`), calls `loadTheme`, applies a `ThemeProvider`
  to `<body>`, and colours the favicon. A theme change remounts the tree.
- In your components read colours from the theme, never hard-code them:
  `useTheme()` inside the bar (preferred), or `getTheme()`;
  `palette.themePrimary`, `.neutralLight`, `.white` (the page background,
  dark in dark mode), `semanticColors.*`. See `hand-rolled-components`.
- A custom `themes` map must keep the `<mode>-<color>` keys plus `default`;
  each value is `(fontSize) => IPartialTheme` (`buildTheme(mode, color)`
  shows the shape).
- `applyTheme(settings, themes)`, `useFluentTheme(themes)` and
  `FluentThemeRoot` are exported for a bar of your own.

## Settings dialog

`SettingsDialog` renders the core's `useSettingsForm`: a General tab
(colour, mode, font size, default page, "Reduce motion (this device)", plus
`settingsGeneralFields`) and one Pivot tab per `settingsTabs` entry, saved
together. Tabs that don't fit go into an overflow menu. Writing tabs is
the core skill's section 5. Keep it for global preferences; a feature's own
configuration is its own application.

## `getStyle()`

`getStyle()` (from `./lib/denim-fabric/lib` or `./lib/denim-fabric`)
returns class names for the current theme under the names it has always
had. Each style lives with what uses it, and `getStyle()` puts them
together:

| Members | Where they live |
|---|---|
| `splashScreen`, `appLogo`, `appHeader`, `modalHeader`, `modalBody`, `link`, `dropdownLink`, `alert`, `alertDismissed` | here, `lib/getStyle.ts` (`sharedStyles`) |
| `error`, `errors`, `hint`, `labelHorizontal`, `fieldHorizontal`, `dangerButton` | typical-admin-fabric, `lib/formStyles.ts` (`getFormStyle()`) |
| `content`, `navBar`, `headerLink`, `headerLinkActive`, `headerLinkContainer`, `waffle`, `appNavLink`, `appNavLinkActive`, `headerIconButton`, `iconButtonStyle`, `hiddenLgDown`, `hiddenXlUp` | denim-fabric-topbar, `TopBarShell/styles.ts`; present (and typed) only in an app with the top bar |

A bar adds its members with `registerBarStyles(builder)` and a `BarStyle`
interface augmentation (see the top bar's `styles.ts`). The sidebar's
styles are its components' own and aren't getStyle() members. The old
responsive helpers (`sm`, `md`, `lg`, `xLg`, `xxLg`, `xxxLg`, `hiddenSm`,
`hiddenMd`, ...) are gone; nothing used them. (typical-admin-fabric's own
`getStyle()` in its `lib/` still has its own.)

## Photo

`Photo` (an image picker with EXIF rotation, cropper, download and remove)
lives in typical-admin-fabric, `lib/templates/Photo/`, with the other form
components; see its README. denim-fabric re-exports it under the same name,
so `import { Photo } from './lib/denim-fabric'` and
`import Photo from './lib/denim-fabric/Photo'` keep working.

## Quick entry in data-entry apps

When users enter many records in a row, don't bounce each one through the
full-page `/new` route: offer an add over the current page (a Fluent
`Panel`/`Modal`, or an inline row above the list), focus the first field,
pre-fill defaults, save on Enter, then clear and refocus. In a
MasterDetail, the detail pane's `/new` already keeps the list visible. The
`denim-fabric` skill has an example.

## Motion

Every motion moves `transform` or `opacity` of one element and never
animates layout, so nothing is re-laid out per frame. Without GPU
compositing (WebKitGTK on some Linux drivers) each frame still repaints what
moves, so each one moves as little as it can. Where a Fluent v8 component
has motion of its own, the bars keep it; `@fluentui/react-motion` and its
tokens (`durationNormal`/`durationFast`, the decelerate curves) cover the
rest. The shared pieces:

| What | How |
|---|---|
| Settings dialog | Fluent's own `Modal` fade-out on close (dim layer included). On open, only the dialog surface fades and scales from 0.96 (a CSS animation on the Modal's surface, with motion tokens); the dim layer appears at once. |
| A selection that slides (`SlidingIndicator`): `AdminMasterDetail`'s list, the sidebar's items | one indicator behind the items slides to the new one (FLIP: `translate` and `scale` from the old rect). It is the only thing drawing the selection's background. A quick second click retargets from where it is; it snaps on first render, after a theme change, and when the item only moved. |
| Phone drill-in (`DrillIn`): MasterDetail's detail, the sidebar's panes | the incoming pane slides 32px and fades in: from the right going in, from the left coming back. Not on the page the app opened on. |

The bar's own motion (the sidebar's collapse slide, its overlay) is in the
bar's README.

**Reduce motion.** The core's `reduceMotion` setting ("Reduce motion (this
device)" on the General tab) and the OS's `prefers-reduced-motion` both turn
all of it off. It is a *device* setting: it stays in this browser even with
`settingsSource="server"`, and is never sent to `updateSettings`. Default
an app to reduced motion with `defaultSettings={{ reduceMotion: true }}`.
In your own components, `useReducedMotion()` (core) says whether to
animate, and `<ShellMotionProvider>` (every bar renders one around
everything) puts `@fluentui/react-motion` components below it into "skip"
while it's true.

**Measuring.** `localStorage.debugPerf = '1'` and a reload make the bars
log their interactions and animations (`[perf] ...` lines; the sidebar's
README lists them); `perfMotionProps(name)` from `shared/perf` makes your
own motion components log the same way.

## Write your own bar or skin

denim (the core) holds everything that isn't look: the registry, routes, nav
model, settings and their extension tabs, health, status dots. A skin draws
it with the core's hooks. Three ways to make your own:

- **Vary a bar**: copy `denim-fabric-topbar/TopBarShell/` or
  `denim-fabric-sidebar/SidebarShell/` into your app (or fork the package)
  and change it; it keeps working on the same core and the same shared
  pieces here.
- **A new Fluent bar**: a package `denim-fabric-<layout>` next to the
  others, whose `index.ts` and `parity.check.ts` follow
  [Same exports as every bar](#same-exports-as-every-bar).
- **Another UI kit**: implement the core's contract (splash, theme, chrome,
  `<DenimRoutes>`, a Settings dialog from `useSettingsForm`); denim's README
  has a complete plain-HTML skin. Name it after the kit, the way this one is
  named after Fabric.

## Migrating

**From the single-package Denim.** The top bar is the old `<Denim>`: same
props, same look (verified pixel-identical in Chromium). Clone
denim-fabric and denim-fabric-topbar next to denim, then:

```diff
-import Denim from './lib/denim';
+import Denim from './lib/denim-fabric-topbar';
```

denim's README has the full table of moved imports.

**From denim-fabric before the bar packages.**

| Before | Now |
|---|---|
| `import Denim from './lib/denim-fabric'`, `{ TopBarShell }` | `import Shell from './lib/denim-fabric-topbar'` (or `{ Shell }`) |
| `{ SidebarShell } from './lib/denim-fabric'` | `import Shell from './lib/denim-fabric-sidebar'` (or `{ Shell }`) |
| `TopBarShellProps`, `SidebarShellProps` | `ShellProps` |
| `useShellLayout`, `useBreakpoint`, `layoutFor`, `DEFAULT_BREAKPOINTS`, `ShellLayoutContext`, `FullBleed`, `MasterDetail`, `AdminMasterDetail`, `useDetailRoute` | unchanged, from `'./lib/denim-fabric'` (or your bar); new: `useLayout()`. `IShellLayoutContext` gained `backBar`. |
| `Header`, `NavBar`, `AppNavBar`, `HeaderLink`, `HeaderProps` | `'./lib/denim-fabric-topbar/TopBarShell/<name>'` |
| `Sidebar`, `StatusDot`, `SidebarProps`, `SidebarVariant` | `'./lib/denim-fabric-sidebar/SidebarShell/Sidebar'` |
| `'./lib/denim-fabric/SidebarShell/layout'`, `.../SidebarShell/FullBleed` | `'./lib/denim-fabric/shared/layout'`, `'./lib/denim-fabric/shared/FullBleed'` |
| `'./lib/denim-fabric/Photo'` | unchanged (a re-export); the code is in typical-admin-fabric's `lib/templates/Photo/` |
| `light`, `dark` (and `lib/light.ts`, `lib/dark.ts`) | removed: use `THEMES` / `buildTheme('light', 'blue')` |
| `getStyle().sm`, `.md`, `.hiddenSm`, ... | removed (unused) |
| `'./lib/denim-fabric/lib'`, `getStyle()`, `getStyle().error`, ... | unchanged |

## Verification

Checked in a Vite + React + TS app with the packages side by side, against
a read-only GraphQL mock shaped like the typiql-rs backend in denim's README:

- Strict `tsc` (Vite's `tsconfig`) over the Minimal setup with each bar,
  the bar READMEs' setups, and MasterDetail / AdminMasterDetail / FullBleed
  under both bars. Both parity checks pass; each fails on an added value
  export or a changed `Shell` type, and the script on an added type export.
- The top bar is pixel-identical to the pre-split one (Chromium, 1400px,
  900px, 800px and 390px with touch): home, a list, show, new, a plain
  page, the waffle panel, the Settings dialog, the link menu.
- MasterDetail under the top bar now fills the area below the header
  (before the split its panes stopped at their content), with its own back
  bar on a phone; under the sidebar it is unchanged.
- No console errors or warnings.

## What's in here

| Path | What it is |
|---|---|
| `index.ts` | the shared surface; also re-exports the whole core. No default export (that's the bar's) |
| `shared/shell.ts` | `ShellProps`, `ShellComponent` |
| `shared/barContract.ts` | `BarExports`, `MatchesBarExports`: the bars' export surface, for each bar's `parity.check.ts` |
| `shared/layout.ts` | `ShellLayoutContext`, `useLayout`, `useShellLayout`, `useBreakpoint`, `useGoUp`, `useSimpleShellLayout`, breakpoints |
| `shared/FullBleed.tsx` | `FullBleed` |
| `MasterDetail/` | `MasterDetail`, `AdminMasterDetail` (ReactiveAdmin), `useDetailRoute` |
| `shared/` (the rest) | `SettingsDialog`, `Splash`, `theme.tsx` (`applyTheme`, `useFluentTheme`, `FluentThemeRoot`, favicon), `ConfirmDialog` (re-export), `Logo`, icon registration, `motion.tsx` (`ShellMotionProvider`, `SlidingIndicator`, `DrillIn`), `perf.tsx` (the `debugPerf` timings) |
| `themes/` | `THEMES`, `buildTheme`, `PALETTES` (Fluent palettes for the core's theme keys) |
| `Photo/` | re-export of typical-admin-fabric's `Photo` |
| `lib/` | the convenience barrel (Fluent, react-router, Apollo hooks, date-fns, typical-admin-fabric `Form`/`List`/cards, `ButtonDropdown`, `withConditionalRender`), `getStyle()` and its builder |
| `scripts/check-bar-parity.mjs` | compares the bars' full export lists |

## License

MIT, see `LICENSE`.
