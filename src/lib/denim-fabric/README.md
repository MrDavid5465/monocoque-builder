# denim-fabric

The [Denim](https://github.com/MrDavid5465/denim) app shell rendered with
[Fluent UI v8](https://developer.microsoft.com/en-us/fluentui)
(`@fluentui/react`). "Fabric" is Office UI Fabric, Fluent's old name: this
package is the Fluent skin over Denim's headless core, just as
typical-admin-fabric is the Fluent skin over typical-admin. Layouts are
components inside it:

- **`TopBarShell`**: the original Denim look. A fixed header with the
  current application's name and links, a waffle panel listing every
  application, Settings in the panel's footer.
- **`SidebarShell`**: a configuration-app layout. Applications grouped under
  headings with icons and status dots, Settings in the sidebar footer, and
  an optional list | detail pattern (`MasterDetail`) for the content. Wide,
  medium and phone layouts; touch-friendly.

Shared Fluent pieces: the Settings dialog (with the core's extension tabs),
the splash screen, theme application (12 colours x light / dark / high
contrast, favicon in the theme colour), the confirm dialog (typical-admin-
fabric's, re-exported), and `Photo` (an image picker and cropper).

It is meant to be cloned and changed: copy a shell's folder to vary it, or
use it as the model for a skin in another UI kit (see
[Write your own skin](#write-your-own-skin)).

Consumed as source (no build step, no npm package).

## Using with an AI coding agent

Before writing any code with denim-fabric, read its skill,
[`.claude/skills/denim-fabric-shells/SKILL.md`](./.claude/skills/denim-fabric-shells/SKILL.md)
(the two shells, master-detail with ReactiveAdmin, responsive behaviour,
theming, Photo, quick entry),
[`.claude/skills/write-a-denim-skin/SKILL.md`](./.claude/skills/write-a-denim-skin/SKILL.md)
before changing a shell or writing a skin for another UI kit, and the core's,
`denim/.claude/skills/denim-app-shell/SKILL.md` (applications, routes,
settings and their extension point, status dots, the server contract).

Then the siblings' skills:

- typical-admin-fabric `.claude/skills/`: `reactive-admin`, `form-schema`,
  `list-schema`, `hand-rolled-components`, `playwright-verify`
- typiql-rs `.claude/skills/typiql-api`: the backend

Skills in a cloned repository are not loaded automatically unless the agent
was started inside that repository, so open the `SKILL.md` files directly.

## Layout: clone the libraries side by side

denim-fabric imports its siblings by relative path (`../denim`,
`../typical-admin`, `../typical-admin-fabric`, `../per-form`), so all five
must be sibling folders:

```
your-app/src/lib/denim/
your-app/src/lib/denim-fabric/
your-app/src/lib/typical-admin/
your-app/src/lib/typical-admin-fabric/
your-app/src/lib/per-form/
```

```sh
cd your-app/src/lib
git clone https://github.com/MrDavid5465/denim
git clone https://github.com/MrDavid5465/denim-fabric
git clone https://github.com/MrDavid5465/typical-admin
git clone https://github.com/MrDavid5465/typical-admin-fabric
git clone https://github.com/MrDavid5465/per-form
```

(or add them as git submodules at those paths, or copy them in). The
backend, [typiql-rs](https://github.com/MrDavid5465/typiql-rs), is a Rust
dependency; denim's README has the backend these setups run against.

`SidebarShell`'s master-detail needs a typical-admin-fabric whose `List`
has the `basePath`, `selectOnClick`, `selectedKey` and `labels` props and
whose `Links` has `hideBack`, and the typical-admin with `labels.ts` (all
added alongside this package).

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

- typical-admin-fabric's list plus three packages for `Photo`
  (`react-image-crop`, `react-dropzone`, `exif-js`), needed to type-check the
  folder even if you never render `Photo`.
- `@fluentui/react-hooks` and `graphql-tag` come in with `@fluentui/react`
  and `@apollo/client`; don't install them.
- `@fluentui/react-motion` is Fluent v9's motion library (stable). It has
  no v9 component dependencies and runs beside Fluent v8; the shells use it
  for their own motion (see "Motion").
- TypeScript needs Vite's client types: `"types": ["vite/client"]` in
  `tsconfig.json`. Everything type-checks under Vite's default strict
  `tsconfig` (`strict`, `noUnusedLocals`, `noUnusedParameters`).

## Common setup

Both setups below share these files and run against the typiql-rs backend in
denim's README (types `Project`, `Device`, `Profile`; the app list seeded
with groups and icons).

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

- No `ThemeProvider`, `loadTheme` or `initializeIcons()`: the shell applies
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

// Mounted by the shell at /projects/*; ReactiveAdmin nests its own routes there.
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

## Setup 1: TopBarShell

**`src/App.tsx`**

```tsx
import { TopBarShell } from './lib/denim-fabric';
import ProjectsAdmin from './admin/ProjectsAdmin';
import { settingsTabs } from './settings/DeviceTab';

// The header, waffle panel, Settings, theming and one route per application
// at /<path>/*. `components` maps each application's `frontEnd` (from the
// backend's my.applications) to its component.
export default function App() {
  return (
    <TopBarShell
      settingsSource="server"
      settingsFields="deviceName"
      settingsTabs={settingsTabs}
      components={{ projects: ProjectsAdmin }}
    />
  );
}
```

Applications with no entry in `components` render an empty page; map the
others as you build them.

**`src/settings/DeviceTab.tsx`**: an extra Settings tab (the extension point
is the core's; see its skill, section 5).

```tsx
import { useEffect, useState } from 'react';
import { Form } from '../lib/denim-fabric/lib';
import type { ISettingsTab, ISettingsTabProps } from '../lib/denim-fabric';

// A Settings tab: this device's name, saved with the rest of the settings.
function DeviceTab({ settings, onChange }: ISettingsTabProps) {
  const [name, setName] = useState<string>(settings.deviceName ?? '');
  useEffect(() => {
    // Merged into the one save; isValid=false blocks Save and shows the message.
    onChange({ deviceName: name }, name.length <= 40, 'Device name: 40 characters at most.');
  }, [name, onChange]);
  return (
    <Form
      name="device"
      form={{ deviceName: { type: 'text', label: 'Device name' } }}
      initialValues={{ deviceName: settings.deviceName ?? '' }}
      onChange={(_n: string, { clean }: any) => setName(clean.deviceName ?? '')}
    />
  );
}

export const settingsTabs: ISettingsTab[] = [
  { key: 'device', headerText: 'Device', Component: DeviceTab },
];
```

### `TopBarShell` props

Every `<DenimProvider>` prop (`components`, `applications`,
`settingsSource`, `settingsTabs`, ... see denim's README), plus:

| Prop | What it does |
|---|---|
| `themes` | theme builders keyed `<mode>-<color>` plus `default`; default `THEMES` |
| `Logo` | splash-screen logo |
| `Brand` | icon next to the waffle button |
| `Controls` | right side of the header; on narrow screens it also opens the link menu |
| `ExternalApps` | extra content at the top of the waffle panel |
| `welcome` | the `/` page when there is no `RootComponent` and no launch page |

## Setup 2: SidebarShell

**`src/App.tsx`**

```tsx
import { SidebarShell } from './lib/denim-fabric';
import DevicesAdmin from './admin/DevicesAdmin';
import ProfilesAdmin from './admin/ProfilesAdmin';
import ProjectsAdmin from './admin/ProjectsAdmin';
import LayoutDesigner from './designer/LayoutDesigner';
import About from './About';
import { useRigStatus } from './rigStatus';

// The sidebar lists my.applications under their `group` headings with their
// `icon`s; applications without a group go under `defaultGroup`.
export default function App() {
  return (
    <SidebarShell
      title="Rig Config"
      settingsSource="server"
      defaultGroup="System"
      useAppStatus={useRigStatus}
      components={{
        devices: DevicesAdmin,      // ReactiveAdmin in list | detail panes
        profiles: ProfilesAdmin,
        designer: LayoutDesigner,   // not a list: takes the whole content area
        projects: ProjectsAdmin,    // a plain ReactiveAdmin page
        about: About,
      }}
    />
  );
}
```

**`src/admin/DevicesAdmin.tsx`**: a ReactiveAdmin screen inside
master-detail. `AdminMasterDetail` takes ReactiveAdmin's props; the list
pane is typical-admin-fabric's `List` (compact: `listColumns`, no page
heading), the detail pane its show / new / edit slots.

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

// The list pane shows only the name column; selecting a row opens its
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

Compared with a plain screen, the only change is `ReactiveAdmin` ->
`AdminMasterDetail` (plus the optional `listColumns`). `ProfilesAdmin` is
the same over the `Profile` type. Set `list.buttons.add` for an Add button
in the list pane.

The headings read "Devices", "Device", "Edit device", "New device":
`AdminMasterDetail` uses typical-admin's display `labels`, kept apart from
the GraphQL names in `name`. Override any of them, e.g.
`labels={{ singular: 'Rig device', plural: 'Rig devices', showHeading: '{singular} details' }}`
(the `reactive-admin` skill lists the keys).

**`src/rigStatus.ts`**: the status-dot hook (called once per application).

```ts
import { gql } from '@apollo/client';
import { useQuery } from '@apollo/client/react';
import type { IApplication, IAppStatus } from './lib/denim-fabric';

const GET_DEVICES = gql`query getDevices { getDevices { id name kind port enabled } }`;

// Devices turns amber while any device is disabled.
export function useRigStatus(app: IApplication): IAppStatus | undefined {
  const isDevices = app.path === 'devices';
  const { data } = useQuery<any>(GET_DEVICES, { skip: !isDevices });
  if (!isDevices || !data) return undefined;
  return data.getDevices.some((d: any) => !d.enabled)
    ? { tone: 'warning', label: 'A device is disabled' }
    : { tone: 'ok', label: 'All devices enabled' };
}
```

**`src/designer/LayoutDesigner.tsx`**: an application that isn't a list.
`FullBleed` cancels the content padding so it fills the area; it owns its
own toolbar (there are no global Save/Revert buttons), and reports its own
status dot.

```tsx
import { useState } from 'react';
import { DefaultButton, Stack, useTheme } from '@fluentui/react';
import { FullBleed, useReportAppStatus } from '../lib/denim-fabric';
import type { IApplication } from '../lib/denim-fabric';

export default function LayoutDesigner({ app }: { app: IApplication }) {
  const theme = useTheme();
  const [boxes, setBoxes] = useState([{ x: 40, y: 40 }, { x: 220, y: 120 }]);
  const [dirty, setDirty] = useState(false);
  useReportAppStatus(app.path, dirty ? { tone: 'warning', label: 'Unsaved layout' } : undefined);

  return (
    <FullBleed style={{ display: 'flex', flexDirection: 'column' }}>
      <Stack horizontal tokens={{ childrenGap: 8, padding: 8 }} style={{ borderBottom: `1px solid ${theme.palette.neutralLight}` }}>
        <DefaultButton
          text="Add gauge"
          onClick={() => {
            setBoxes(b => [...b, { x: 40 + b.length * 30, y: 200 }]);
            setDirty(true);
          }}
        />
        <DefaultButton text="Save layout" disabled={!dirty} onClick={() => setDirty(false)} />
      </Stack>
      <div
        style={{
          flex: 1,
          position: 'relative',
          backgroundColor: theme.palette.neutralLighterAlt,
          backgroundImage: `radial-gradient(${theme.palette.neutralQuaternary} 1px, transparent 1px)`,
          backgroundSize: '20px 20px',
        }}
      >
        {boxes.map((b, i) => (
          <div
            key={i}
            style={{
              position: 'absolute', left: b.x, top: b.y, width: 140, height: 90,
              border: `2px solid ${theme.palette.themePrimary}`, borderRadius: 8,
              background: theme.palette.white, display: 'grid', placeItems: 'center',
            }}
          >
            Gauge {i + 1}
          </div>
        ))}
      </div>
    </FullBleed>
  );
}
```

`About` is any plain component: it scrolls inside the content area with the
shell's padding.

### Without a backend app list

Pass `applications` instead; `group` and `icon` are plain fields:

```tsx
const applications: IApplication[] = [
  { name: 'Devices', path: 'devices', defaultRoute: '', frontEnd: 'devices', links: [], group: 'RIG', icon: 'Devices3' },
  { name: 'Designer', path: 'designer', defaultRoute: '', frontEnd: 'designer', links: [], group: 'DASHBOARDS', icon: 'Design' },
  { name: 'About', path: 'about', defaultRoute: '', frontEnd: 'about', links: [], icon: 'Info' },
];
<SidebarShell title="Rig Config" applications={applications} components={...} />
```

With the app list from the backend, SidebarShell selects `group icon`;
pass `applicationFields=""` if your backend doesn't have them.

### How it behaves

| Width | Layout |
|---|---|
| wide (>= 1200px: a desktop, a wide rig touchscreen) | sidebar \| content; inside `MasterDetail`, sidebar \| list \| detail. The sidebar collapses to an icon rail (remembered per browser). |
| medium (>= 700px) | icon rail \| content (list \| detail). The rail's menu button opens the full sidebar over the content. |
| narrow (a phone) | one screen at a time: the menu (at `/`), then the application (list), then the detail, each with a back bar |

- Selection lives in the URL (`/devices/<id>/show`), so deep links, reloads
  and the browser's Back and Forward buttons work at every width. The back
  bar is the browser's Back when that leads to the same place, so it never
  piles up history.
- In `AdminMasterDetail` the list stays mounted while a detail opens and
  closes (on a phone too, hidden), so its page, sort, filters and scroll
  survive, and the row just closed can be opened again. The row in the URL
  is highlighted; a deep link, Back/Forward or a new record turns the list
  to that row's page and scrolls it into view.
- On a phone the back bar is the only back control: the detail's own back
  arrow is dropped (its Edit and Delete stay), and from an edit page the
  bar goes up to the record, then to the list.
- On a phone, `/` is the menu rather than the launch page (wide and medium
  layouts still redirect `/` to the launch page). An application's `links`
  show as touch pills under the back bar.
- Touch targets are at least 44px, nothing depends on hover, and keyboard
  focus is visible. The Settings dialog is in the sidebar footer; each
  application keeps its own configuration in its own pages.
- `/kiosk/<path>` shows the application without the sidebar.
- It moves, briefly (see "Motion"): the sidebar slides, the selection
  slides between items, a phone's panes slide in. The "Reduce motion"
  setting, or the OS preference, turns all of it off.

### `SidebarShell` props

Every `<DenimProvider>` prop, plus:

| Prop | What it does |
|---|---|
| `title` | your product's name, at the top of the sidebar |
| `Brand` | icon next to the title |
| `Logo` | splash-screen logo |
| `themes` | theme builders; default `THEMES` |
| `SidebarFooter` | extra content in the sidebar footer, above Settings |
| `breakpoints` | `{ medium, wide }` in px; default `{ medium: 700, wide: 1200 }` |
| `welcome` | the `/` page on wide/medium screens with no `RootComponent` and no launch page |
| `defaultGroup` (core) | heading for applications without `group` |
| `useAppStatus` (core) | status-dot hook |

### `MasterDetail` for anything

`AdminMasterDetail` is `MasterDetail` + ReactiveAdmin. For other content,
use `MasterDetail` with any list and detail, and `useDetailRoute` for the
selection in the URL:

```tsx
import { Link } from 'react-router-dom';
import { MasterDetail, useDetailRoute } from './lib/denim-fabric';

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
':id/edit']`. `AdminMasterDetail` also takes `components` (detail-pane slot
overrides), `callBacks`, `pageSize`, `labels`, `title` (default the list
heading, `labels.plural`), `listProps` (passed to the `List`:
`queryResultKey`, `idField`, ...) and `empty`.

## Write your own skin

denim (the core) holds everything that isn't look: the registry, routes, nav
model, settings and their extension tabs, health, status dots. A skin draws
it with the core's hooks. Two ways to make your own:

- **Vary a Fluent shell**: copy `TopBarShell/` or `SidebarShell/` into your
  app (or your fork) and change it; it keeps working on the same core and
  the same `shared/` pieces.
- **Another UI kit**: implement the core's contract (splash, theme, chrome,
  `<DenimRoutes>`, a Settings dialog from `useSettingsForm`); denim's README
  has a complete plain-HTML skin. Name it after the kit, the way this one is
  named after Fabric.

## Migrating from the single-package Denim

`TopBarShell` is the old `<Denim>`: same props, same look (verified
pixel-identical in Chromium at 1400px and 800px). The quickest switch is to
change the import:

```diff
-import Denim from './lib/denim';
+import Denim from './lib/denim-fabric';
```

denim's README has the full table of moved imports (`denim/lib` ->
`denim-fabric/lib`, `components/Photo` -> `denim-fabric/Photo`,
`components/ConfirmDialog` -> `confirmAsync`/`ConfirmDialogHost` from
denim-fabric, themes, `getCurrentApp` -> `useNav().activeApp`).

## Motion

Every motion moves `transform` or `opacity` of one element and never
animates layout, so nothing is re-laid out per frame. Without GPU
compositing (WebKitGTK on some Linux drivers) each frame still repaints what
moves, so each one moves as little as it can. Where a Fluent v8 component
has motion of its own, the shell keeps it; `@fluentui/react-motion` and its
tokens (`durationNormal`/`durationFast`, the decelerate curves) cover the
rest.

| What | How |
|---|---|
| Medium layout's overlay sidebar | Fluent's own `Panel` slide (and its scrim's fade), in and out |
| Settings dialog | Fluent's own `Modal` fade-out on close (dim layer included). On open, only the dialog surface fades and scales from 0.96 (a CSS animation on the Modal's surface element, with motion tokens); the dim layer appears at once. The content doesn't re-render during the fade-out. |
| Wide sidebar collapse/expand | the full panel slides by `264 - 60`px and the content moves with it (`translateX`, same clock and curve), while the icon rail fades over the panel's left end. The layout keeps its starting width during the slide and changes once at the end, in the same frame that drops the transforms. Toggling mid-slide reverses from where it is. (`SidebarShell/slide.ts`: the Web Animations API with the motion tokens, because a motion component computes its keyframes once, at mount.) |
| Selected sidebar item, selected list row (`AdminMasterDetail`) | one indicator (background and accent bar) behind the items slides to the new one (FLIP: `translate` and `scale` from the old rect). It is the only thing drawing the selection's background; the item's bold text changes at once. A quick second click retargets from where it is. It snaps, without sliding, on first render, after a theme change or collapse, and when the item only moved (`shared/motion.tsx`, `SlidingIndicator`). |
| Phone drill-in | the incoming pane slides 32px and fades in: from the right going in (menu to application, list to detail), from the left coming back. The pane going away just goes. Not on the page the app opened on. |

**Reduce motion.** The core's `reduceMotion` setting ("Reduce motion (this
device)" on the General tab) and the OS's `prefers-reduced-motion` both turn
all of the above off, Fluent's own Panel and Modal motion included (the
panel and dialog then also hide at once on close). The setting is a
*device* setting (`DEVICE_SETTINGS` in the core): it stays in this browser
even with `settingsSource="server"`, and is never sent to `updateSettings`,
so the backend needs no field. A desktop webview without GPU compositing may
want it while a phone on the same server doesn't. Default an app to reduced
motion with `defaultSettings={{ reduceMotion: true }}`. In your own
components, `useReducedMotion()` (core) says whether to animate, and
`<ShellMotionProvider>` (SidebarShell renders one around everything) puts
`@fluentui/react-motion` components below it into "skip" while it's true.

## Measuring the shell's interactions

SidebarShell can time its own interactions in any browser or webview,
including one without devtools. In the console run
`localStorage.debugPerf = '1'` and reload; `localStorage.removeItem('debugPerf')`
and a reload turn it off. (In the Tauri window, open the inspector with
right-click > Inspect Element, or Ctrl+Shift+I, in a debug build.) Each
interaction then logs lines like:

```
[perf] sidebar-toggle: 4.1ms to commit, 18.0ms to next frame
[perf] commit shell-sidebar update 2.3ms (base 1.9ms)
[perf] anim sidebar-expand: 205ms, 13 frames, 0 long (max 17ms)
```

- The interactions are `sidebar-toggle`, `overlay-open`/`overlay-close`
  (the medium layout's menu) and `settings-open`/`settings-close`.
- "to commit" is the time from the click until React has changed the DOM.
  "to next frame" adds style, layout and paint, as far as
  `requestAnimationFrame` can see them.
- `commit <part>` comes from React Profilers around `shell-sidebar`,
  `shell-content` (the page) and `settings-dialog`. It shows how long that
  part took to render, and its un-memoized cost ("base"). A part that
  doesn't log didn't re-render.
- `anim <name>` is one animation, logged when it ends: its length, the
  frames drawn meanwhile (`requestAnimationFrame` callbacks), how many took
  over 32ms (two missed 60Hz frames: visible stutter) and the worst one.
  `(interrupted)` means it was reversed or cut short. The names are
  `sidebar-expand`/`sidebar-collapse`, `sidebar-selection`,
  `list-selection`, `drill-in-right`/`drill-in-left`,
  `overlay-open`/`overlay-close` and `settings-enter`/`settings-exit`. The
  last four, and the drill-in, are timed until no animation is running on
  the page, so they include anything else animating meanwhile (Fluent fades
  rows in when a list shows them, for instance). Fluent motion components
  can log the same way with `perfMotionProps(name)` from `shared/perf`.
- Each timing is also a `performance.measure`, so it appears in a devtools
  performance recording.

The shell keeps the work around its motion small. Toggling the sidebar or
opening Settings doesn't re-render the page. Variant and state classes are
merged with `mergeStyles` rather than listed side by side, because which of
two Fluent classes wins depends on rule order, and a theme change reorders
the rules.

## Verification

Both setups above type-check under Vite's strict `tsconfig` with the peer
packages above and the five libraries side by side, and were driven in
headless Chromium (over the LAN, against the typiql-rs backend in denim's
README):

- TopBarShell: pixel-identical to the pre-split Denim; active link by whole
  segments; waffle panel; a Settings extension tab saving to the server; a
  theme change; kiosk route.
- SidebarShell: groups in order, icons, status dots from the hook and from
  the app; a ReactiveAdmin list/show/edit/new in master-detail at 1400px,
  900px and 390px with touch emulation (drill-in, back bar, browser Back and
  Forward, deep links); a non-list app filling the area; re-visiting apps;
  Settings from the footer; 44px targets; visible focus. No console errors.
- Motion (Chromium with 6x CPU throttling, at 1400px, 900px and 390px
  with touch): every animation above, frame by frame; the panel's edge and
  the content's edge together on every frame of a collapse/expand, no
  layout during the slide, one layout change at its end and no jump; a
  quick second toggle reversing; only one selection highlight on screen at
  any frame, also with three quick clicks and from the keyboard; the
  indicator exact after a theme change and in the rail; the OS preference
  and the setting each turning everything off; the setting kept per device
  and never sent to the server.
- Master-detail: one back control on a phone (Edit and Delete kept); display
  labels; page, sort and filter kept across opening and closing a detail
  (and a save in it) at 1400px, 900px and 390px, with the closed row
  reopening; the URL's row highlighted on a deep link, a row switch, Back
  and a new record; icon buttons 44px with a coarse pointer and 32px with
  a mouse. TopBarShell stayed pixel-identical.

## What's in here

| Path | What it is |
|---|---|
| `index.ts` | public API; also re-exports the whole core. Default export: `TopBarShell` |
| `TopBarShell/` | the shell, `Header`, `NavBar` (current app's links), `AppNavBar` (waffle panel), `HeaderLink` |
| `SidebarShell/` | the shell, `Sidebar` (full / rail / screen variants, `StatusDot`), `layout.ts` (breakpoints, back-bar context), `slide.ts` (the wide collapse/expand slide), `FullBleed` |
| `MasterDetail/` | `MasterDetail`, `AdminMasterDetail` (ReactiveAdmin), `useDetailRoute` |
| `shared/` | `SettingsDialog`, `Splash`, `theme.tsx` (`applyTheme`, `useFluentTheme`, `FluentThemeRoot`, favicon), `ConfirmDialog` (re-export), `Logo`, icon registration, `motion.tsx` (`ShellMotionProvider`, `SlidingIndicator`, `DrillIn`), `perf.tsx` (the `debugPerf` timings) |
| `themes/` | `THEMES`, `buildTheme`, `PALETTES` (Fluent palettes for the core's theme keys) |
| `Photo/` | image picker with EXIF rotation, cropper, download and remove |
| `lib/` | convenience re-exports (Fluent, react-router, Apollo hooks, typical-admin-fabric `Form`/`List`/cards), `getStyle()`, two older single themes |

## License

MIT, see `LICENSE`.
