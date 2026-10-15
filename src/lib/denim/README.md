# denim

The headless core of the Denim app shell for React apps on the typiql
stack. Denim decides **what** the frame of an app knows; a UI-kit package
(a "skin") decides **how it looks**:

- an **application registry**: a static `applications` list, or the
  backend's `my.applications`; each application has a name, a path, links,
  and optionally a `group` and an `icon`;
- **routing**: one route per application at `/<path>/*`, a header-less
  `/kiosk/<path>/*` variant, a `defaultRoute` redirect that leaves deep links
  alone, and the `/` page (a `RootComponent`, the launch page, or a welcome);
- a **nav model**: the active application and link, by whole-segment URL
  matching, and whether chrome should show;
- a **settings store**: theme key, font size and launch page, in
  `localStorage` or on the server, with an extension contract (extra Settings
  tabs and General fields) expressed as data;
- **health polling** and the splash state: when the backend isn't up yet,
  Denim polls it and recovers on its own;
- per-application **status dots** (from a hook, or reported by the app);
- the **page reset** (no 8px body margin).

It renders no markup and imports no UI kit. It exposes a provider, hooks and
a routes component; a skin draws the chrome with them.

| Package | What it is |
|---|---|
| **denim** (this) | the core: `<DenimProvider>`, hooks, `<DenimRoutes>`, the server contract |
| [denim-fabric](https://github.com/MrDavid5465/denim-fabric) | the Fluent UI skin ("Fabric" is Fluent's old name): `TopBarShell` (the original Denim look), `SidebarShell` (grouped sidebar, master-detail), the Settings dialog, splash, themes, Photo |
| your own | any UI kit: implement the contract in [Writing a skin](#writing-a-skin) |

Pages inside an application are normally
[typical-admin-fabric](../typical-admin-fabric)'s `ReactiveAdmin` CRUD
screens over a [typiql-rs](../typiql-rs) backend, with
[per-form](../per-form) for forms.

Consumed as source (no build step, no npm package).

## Using with an AI coding agent

Before writing any code with Denim, read its skill,
[`.claude/skills/denim-app-shell/SKILL.md`](./.claude/skills/denim-app-shell/SKILL.md):
the core contract, registering applications, routes, settings and the
Settings extension point, status dots, the server contract, and plain-http
LAN pitfalls. If you use denim-fabric, also read its skill,
`denim-fabric/.claude/skills/denim-fabric-shells/SKILL.md` (the two shells,
master-detail, theming, Photo, and writing your own skin).

Then the siblings' skills:

- typiql-rs `.claude/skills/typiql-api`: the backend, types and generated GraphQL names
- typical-admin-fabric `.claude/skills/`:
  - `reactive-admin`: CRUD screens, slot overrides, live updates
  - `form-schema`: form field types and properties
  - `list-schema`: list/show columns and list components
  - `hand-rolled-components`: one-off components from Fluent primitives
  - `playwright-verify`: checking the running app in headless Chromium

Skills in a cloned repository are not loaded automatically unless the agent
was started inside that repository, so open the `SKILL.md` files directly.

## Layout: clone the libraries side by side

The libraries import each other by relative path (`../denim`,
`../typical-admin-fabric`, `../per-form`), so they must be sibling folders.
The core alone needs no siblings; denim-fabric needs all of them:

```
your-app/src/lib/denim/
your-app/src/lib/denim-fabric/
your-app/src/lib/typical-admin/
your-app/src/lib/typical-admin-fabric/
your-app/src/lib/per-form/
```

Get them from:

- https://github.com/MrDavid5465/denim
- https://github.com/MrDavid5465/typical-admin
- https://github.com/MrDavid5465/typical-admin-fabric
- https://github.com/MrDavid5465/per-form
- https://github.com/MrDavid5465/denim-fabric

```sh
cd your-app/src/lib
git clone https://github.com/MrDavid5465/denim
git clone https://github.com/MrDavid5465/typical-admin
git clone https://github.com/MrDavid5465/typical-admin-fabric
git clone https://github.com/MrDavid5465/per-form
git clone https://github.com/MrDavid5465/denim-fabric
```

(or add them as git submodules at those paths, or copy them in). They are
meant to be overlaid and tweaked: keep your changes in your copy, or write
your own skin next to them.

## Peer npm packages

The core alone:

```bash
npm i react@^18.3.1 react-dom@^18.3.1 \
  @apollo/client@^4.2.3 graphql@^16.14.2 rxjs@^7.8.2 \
  react-router@^7.17.0 react-router-dom@^7.17.0
```

With denim-fabric, use the list in its README (it adds Fluent UI and the
packages typical-admin-fabric and Photo need). TypeScript needs Vite's
client types (`"types": ["vite/client"]`); everything type-checks under
Vite's default strict `tsconfig` (`strict`, `noUnusedLocals`,
`noUnusedParameters`).

## Minimal app

With the Fluent skin (the full setups, with ReactiveAdmin screens, are in
denim-fabric's README):

```tsx
// main.tsx: the core reads Apollo from <ApolloProvider> and the router from
// <BrowserRouter>; it never imports your client.
<ApolloProvider client={client}>
  <BrowserRouter>
    <App />
  </BrowserRouter>
</ApolloProvider>

// App.tsx
import { SidebarShell } from './lib/denim-fabric';
export default function App() {
  return <SidebarShell title="Rig Config" components={{ devices: DevicesAdmin, designer: LayoutDesigner }} />;
}
```

Every shell takes all of `<DenimProvider>`'s props (below) plus its own.

## `<DenimProvider>` props

| Prop | Default | What it does |
|---|---|---|
| `components` | `{}` | `frontEnd` key -> component rendered at `/<path>/*`, given `{ app }` |
| `applications` | from `my.applications` | static app list; when set, `my.applications` is not queried |
| `applicationFields` | `""` | extra `Application` fields to select, e.g. `"group icon"` (SidebarShell defaults to that) |
| `settingsSource` | `"local"` | `"local"`: localStorage. `"server"`: `my.settings` + `updateSettings` |
| `defaultSettings` | `{ theme: 'default', fontSize: 1, launchPage: '', reduceMotion: false }` | values before anything is saved (e.g. `{ reduceMotion: true }` for an app that should default to no motion) |
| `settingsFields` | `""` | extra `AppSettings` fields to select (server mode), for your settings tabs |
| `settingsTabs` | `[]` | extra Settings tabs, `{ key, headerText, Component }` |
| `settingsGeneralFields` | none | extra per-form fields on the General tab |
| `RootComponent` | none | the `/` page (also shown while `my` loads); chrome is hidden off application routes |
| `defaultGroup` | `"Applications"` | group heading for applications without `group` |
| `useAppStatus` | none | hook `(app) => IAppStatus \| tone \| undefined`, called once per app in the nav, for its status dot |

## Hooks and components

```ts
import {
  DenimProvider, DenimRoutes,                  // provider, routes
  useDenim, useApplications, useNav, useSettings,
  useSettingsForm, useAppStatus, useReportAppStatus, useReducedMotion,
} from './lib/denim';
```

| API | Returns / does |
|---|---|
| `useDenim()` | everything: `applications`, `components`, `RootComponent`, `status` (`"loading" \| "waiting" \| "ready"`), `settings`, `saveSettings(values)`, `settingsTabs`, ... |
| `useApplications()` | `{ applications, groups, ready }`; `groups` is `[{ name, applications }]` in configured order |
| `useNav()` | `{ pathname, activeApp, activeLink, isKiosk, showChrome, appUrl(app), linkUrl(app, link), isAppActive(app), isLinkActive(app, linkPath) }` |
| `useSettings()` | `{ settings, saveSettings, settingsSource, settingsTabs, settingsGeneralFields }` |
| `useSettingsForm(isOpen)` | a Settings dialog's logic: `{ general: { schema, initialValues, onChange }, tabs: [{ key, headerText, Component, props }], save(), saving, error }` |
| `useAppStatus(app)` | the app's status dot: reported by the app, else from the `useAppStatus` prop |
| `useReportAppStatus(appPath, status)` | an app publishes its own dot, e.g. `'ok'`, `{ tone: 'warning', label: 'Unsaved layout' }`; `undefined` clears it |
| `useReducedMotion()` | true when a skin should not animate: the `reduceMotion` device setting or the OS's `prefers-reduced-motion`; follows changes to either |
| `<DenimRoutes wrap home welcome />` | the routes; `wrap(content, { app, kiosk })` puts each route in the skin's layout |
| `computeNav`, `groupApplications`, `isLinkActive` | the nav model as pure functions |

Status tones are `ok`, `warning`, `error`, `busy` and `off`. The
`useAppStatus` prop is called as a hook, so pass a module-level function:

```ts
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

## Writing a skin

A skin is a shell component that takes `DenimShellProps` (plus its own
props) and renders `<DenimProvider>` with, inside it:

1. a splash while `useDenim().status !== "ready"` (`"waiting"`: the backend
   is down and Denim is polling it); a `RootComponent` stands in for it;
2. the theme for `settings.theme` (`"<mode>-<color>"`, see `themes/`) and
   `settings.fontSize`, in your UI kit;
3. chrome from `useApplications()` and `useNav()`, hidden when
   `useNav().showChrome` is false (kiosk routes, landing pages);
4. `<DenimRoutes wrap={...} />` for the content;
5. a Settings dialog from `useSettingsForm()`: the General tab is a per-form
   schema, and each extension tab is a `Component` you render with its
   `props`.

This whole skin, in plain HTML, type-checks and runs:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DenimProvider, DenimRoutes, DenimShellProps, splitShellProps,
  useApplications, useDenim, useNav, useSettingsForm,
} from './lib/denim';

export function PlainShell(props: DenimShellProps) {
  const [core] = splitShellProps(props); // the provider's props; the rest are yours
  return (
    <DenimProvider {...core}>
      <PlainLayout />
    </DenimProvider>
  );
}

function PlainLayout() {
  const { status } = useDenim();
  const { groups } = useApplications();
  const nav = useNav();
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (status !== 'ready') return <p>{status === 'waiting' ? 'Waiting for server…' : 'Loading…'}</p>;
  // A real skin would also apply settings.theme here (see denim-fabric's shared/theme.tsx).
  return (
    <div style={{ display: 'flex' }}>
      {nav.showChrome && (
        <nav>
          {groups.map(g => (
            <section key={g.name}>
              <h2>{g.name}</h2>
              {g.applications.map(app => (
                <Link key={app.path} to={nav.appUrl(app)} aria-current={nav.isAppActive(app) ? 'page' : undefined}>
                  {app.name}
                </Link>
              ))}
            </section>
          ))}
          <button onClick={() => setSettingsOpen(true)}>Settings</button>
        </nav>
      )}
      <main style={{ flex: 1 }}>
        <DenimRoutes wrap={content => <div className="page">{content}</div>} />
      </main>
      {settingsOpen && <PlainSettings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function PlainSettings({ onClose }: { onClose: () => void }) {
  const form = useSettingsForm(true);
  return (
    <dialog open>
      {/* <YourForm schema={form.general.schema} initialValues={form.general.initialValues} onChange={form.general.onChange} /> */}
      {form.tabs.map(({ key, headerText, Component, props }) => (
        <fieldset key={key}><legend>{headerText}</legend><Component {...props} /></fieldset>
      ))}
      <button disabled={form.saving} onClick={async () => { if (await form.save()) onClose(); }}>Save</button>
      {form.error && <p role="alert">{form.error}</p>}
    </dialog>
  );
}
```

denim-fabric's `TopBarShell` and `SidebarShell` are the same shape with
Fluent UI; start a new skin from a copy of one of them.

## Server contract

Every part is optional. What Denim asks for depends on its props:

| Denim needs | When | GraphQL |
|---|---|---|
| nothing | `applications` given and `settingsSource="local"` | none |
| the app list | `applications` not given | `my { applications { name path defaultRoute frontEnd links { path text } <applicationFields> } }` |
| settings | `settingsSource="server"` | `my { settings { launchPage theme fontSize <settingsFields> } }` and `updateSettings(settings: AppSettingsInput!)` |

The exact shapes:

```graphql
type Query {
  my: My!
}

type My {
  applications: [Application!]!   # only if Denim queries the app list
  settings: AppSettings           # only for settingsSource="server"; null = defaults
}

type Application {
  name: String!
  path: String!          # URL segment, /<path>/*
  defaultRoute: String!  # "" for none
  frontEnd: String!      # key into the shell's `components`
  links: [AppLink!]!
  group: String          # optional: nav group heading, e.g. "RIG"
  icon: String           # optional: icon name (Fluent UI's, for denim-fabric)
}

type AppLink { path: String!  text: String! }

type AppSettings {        # nullable fields fall back to defaultSettings
  launchPage: String
  theme: String           # "<mode>-<color>", e.g. "dark-teal"
  fontSize: Float
  # ...plus anything your settings tabs read (settingsFields)
}

type Mutation {
  # Patch semantics: omitted fields are left alone. The input type MUST be
  # named AppSettingsInput; the argument may be nullable or not. It may
  # return any object type: Denim selects only __typename, then refetches my.
  updateSettings(settings: AppSettingsInput!): My!
}
```

`group` and `icon` are selected only when `applicationFields` names them
(SidebarShell does by default), so a backend without them keeps working
with TopBarShell, or with `<SidebarShell applicationFields="">`.

Denim also exports `uploadFile` / `getFileBase64` documents
(`denimDispatcher.upload`, `.getFile`) for apps that use them; Denim itself
never sends them, so they are not part of the contract.

### Implementing it on typiql-rs

`Application` and `AppSettings` are ordinary typiql types, so they also get
the generated CRUD API (an admin screen for the app list is just a
ReactiveAdmin over `Application`). Only `my` (a combined view) and
`updateSettings` (patch the single settings record, creating it on first
save) are hand-written.

**`Cargo.toml`** (typiql-rs cloned next to the app):

```toml
[dependencies]
typiql = { package = "typiql-core", path = "../typiql-rs/crates/typiql-core" }
typiql-adapter-json = { path = "../typiql-rs/crates/typiql-adapter-json" }
async-graphql = "7"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "net"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
axum = "0.8"
```

**`src/denim_contract.rs`**

```rust
#![allow(clippy::too_many_arguments)]

use async_graphql::{Context, Object, Result, SimpleObject};
use typiql::{resolve_list, resolve_upsert, typiql_type, TypiQLBroker};

/// One sub-page link of an application (`/<app.path>/<link.path>`).
#[derive(
    async_graphql::SimpleObject, async_graphql::InputObject,
    serde::Serialize, serde::Deserialize, Clone, Debug, Default,
)]
#[graphql(input_name = "AppLinkInput")]
pub struct AppLink {
    pub path: String,
    pub text: String,
}

/// One entry in the app switcher / one top-level route.
#[typiql_type]
pub struct Application {
    #[typiql(key)]
    pub id: String,
    pub name: String,
    /// URL segment: the app lives at `/<path>/*`.
    pub path: String,
    /// Sub-path `/<path>` redirects to; "" for none.
    pub default_route: String,
    /// Key into the shell's `components={{ … }}`.
    pub front_end: String,
    pub links: Vec<AppLink>,
    /// Optional nav group heading, e.g. "RIG" (SidebarShell).
    pub group: Option<String>,
    /// Optional Fluent icon name, e.g. "Devices3" (SidebarShell).
    pub icon: Option<String>,
    /// Menu order (not part of Denim's contract).
    pub position: i64,
}

/// The settings record. Denim reads launchPage/theme/fontSize; add your
/// app's own fields here and select them with `settingsFields="…"`.
#[typiql_type]
pub struct AppSettings {
    #[typiql(key)]
    pub id: String,
    pub launch_page: Option<String>,
    pub theme: Option<String>,
    pub font_size: Option<f64>,
    /// An app's own setting, edited in a Settings tab.
    pub device_name: Option<String>,
}

#[derive(SimpleObject)]
pub struct My {
    pub applications: Vec<Application>,
    pub settings: Option<AppSettings>,
}

async fn load_my(ctx: &Context<'_>) -> Result<My> {
    let mut applications = resolve_list::<Application>(ctx, vec![]).await?;
    applications.sort_by_key(|a| a.position);
    // One settings record for the whole app. Scope it with a user_id filter
    // once you have users.
    let settings = resolve_list::<AppSettings>(ctx, vec![]).await?.into_iter().next();
    Ok(My { applications, settings })
}

#[derive(Default)]
pub struct DenimQuery;

#[Object]
impl DenimQuery {
    async fn my(&self, ctx: &Context<'_>) -> Result<My> {
        load_my(ctx).await
    }
}

#[derive(Default)]
pub struct DenimMutation;

#[Object]
impl DenimMutation {
    /// Patch the single settings record, creating it on first save.
    async fn update_settings(&self, ctx: &Context<'_>, settings: AppSettingsInput) -> Result<My> {
        // No filters: the first (only) row, or a new one with upsert = true.
        if let Some(row) = resolve_upsert::<AppSettings>(ctx, vec![], settings, vec![], vec![], true).await? {
            // Hand-written writes don't publish on their own.
            TypiQLBroker::publish(AppSettingsChanged { operation_name: "update".into(), value: row });
        }
        load_my(ctx).await
    }
}
```

**`src/main.rs`**: the app's types, the roots, and the app list seeded once.
These are the types denim-fabric's README setups use.

```rust
use std::{collections::HashMap, sync::Arc};
use typiql::{typiql_schema, typiql_type, AdapterMap, TypiQLAdapter, TypiQLType};
use typiql_adapter_json::JsonAdapter;

mod denim_contract;
use denim_contract::*;

#[typiql_type]
pub struct Project {
    #[typiql(key)]
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub priority: Option<i32>,
    pub archived: Option<bool>,
}

#[typiql_type]
pub struct Device {
    #[typiql(key)]
    pub id: String,
    pub name: String,
    pub kind: String,
    pub port: Option<String>,
    pub enabled: Option<bool>,
}

#[typiql_type]
pub struct Profile {
    #[typiql(key)]
    pub id: String,
    pub name: String,
    pub notes: Option<String>,
}

typiql_schema!(Project, Device, Profile, Application, AppSettings; DenimQuery; DenimMutation);

/// Seed the app list once (an empty table), so the nav has entries.
async fn seed_applications(adapter: &Arc<dyn TypiQLAdapter>) {
    let loc = || Application::collection_name().into();
    if !adapter.get_many(loc(), vec![]).await.is_empty() {
        return;
    }
    let apps = [
        serde_json::json!({ "name": "Devices", "path": "devices", "default_route": "", "front_end": "devices",
            "group": "RIG", "icon": "Devices3", "position": 1, "links": [] }),
        serde_json::json!({ "name": "Profiles", "path": "profiles", "default_route": "", "front_end": "profiles",
            "group": "RIG", "icon": "ContactCard", "position": 2, "links": [] }),
        serde_json::json!({ "name": "Designer", "path": "designer", "default_route": "", "front_end": "designer",
            "group": "DASHBOARDS", "icon": "Design", "position": 3, "links": [] }),
        serde_json::json!({ "name": "Projects", "path": "projects", "default_route": "", "front_end": "projects",
            "group": "PLANNING", "icon": "ProjectCollection", "position": 4,
            "links": [ { "path": "", "text": "All projects" }, { "path": "new", "text": "New project" } ] }),
        // No group: listed under the shell's defaultGroup.
        serde_json::json!({ "name": "About", "path": "about", "default_route": "", "front_end": "about",
            "icon": "Info", "position": 5, "links": [] }),
    ];
    for app in apps {
        adapter.add(loc(), Application::key_field(), app).await.expect("seed");
    }
}

#[tokio::main]
async fn main() {
    let data_dir = std::env::var("DATA_DIR").unwrap_or_else(|_| "data".into());
    let port = std::env::var("PORT").unwrap_or_else(|_| "4123".into());
    let adapter: Arc<dyn TypiQLAdapter> = Arc::new(JsonAdapter::new(&data_dir));
    seed_applications(&adapter).await;

    let mut adapters: AdapterMap = HashMap::new();
    adapters.insert("default", adapter);
    let schema = build_typiql_schema(adapters);

    let app = axum::Router::new().nest("/typiql", typiql::typiql_router(schema, "/typiql/graphql"));
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

This backend compiles against typiql-rs and served the verification runs in
denim-fabric's README. Variations:

- **A fixed app list in code**: make `Application` a plain
  `#[derive(SimpleObject)]` struct and return a `vec![...]` from `my`; no
  storage or seeding. Or skip the contract and pass `applications`.
- **Per-user settings**: add a `user_id` field to `AppSettings` and filter on
  it in `load_my` and `resolve_upsert` (the `identify` argument).
- **More settings**: add fields to `AppSettings` (they appear in
  `AppSettingsInput` automatically) and list them in `settingsFields`.

## Migrating from the single-package Denim

Before the split, `denim` rendered the Fluent shell itself. That shell is
now `TopBarShell` in denim-fabric, with the same props and the same look
(verified pixel-identical). Clone denim-fabric next to denim, then:

| Before | After |
|---|---|
| `import Denim from './lib/denim'` | `import Denim from './lib/denim-fabric'` (default export = `TopBarShell`) |
| `import { IApplication, ISettingsTab, THEMES, ... } from './lib/denim'` | same names from `'./lib/denim-fabric'` (it re-exports the core); or the core types from `'./lib/denim'` |
| `'./lib/denim/lib'` (Form, List, Fluent re-exports, `getStyle`) | `'./lib/denim-fabric/lib'` |
| `'./lib/denim/lib/queries'` | unchanged (core) |
| `'./lib/denim/components/ConfirmDialog'` | `'./lib/denim-fabric'` (`confirmAsync`, `ConfirmDialogHost`): one implementation, typical-admin-fabric's, re-exported. Mount one `<ConfirmDialogHost />` |
| `'./lib/denim/components/Photo'` | `'./lib/denim-fabric/Photo'` |
| `'./lib/denim/components/Splashscreen'` | `Splash` from `'./lib/denim-fabric'` |
| `'./lib/denim/themes'` (`THEMES`, `buildTheme`, palettes) | `'./lib/denim-fabric/themes'`; the key helpers (`themeKey`, `parseThemeKey`, `COLOR_KEYS`, `MODE_KEYS`) are also in the core's `themes` |
| `HeaderLink` | from `'./lib/denim-fabric'` |
| `getCurrentApp()` (read `document.location`) | `useNav().activeApp` (works under `HashRouter` too), or `useCurrentApp()` from denim-fabric |
| `setTheme(theme, themes)` | `applyTheme(settings, themes)` from denim-fabric |
| `components/Admin` (commented-out legacy) | removed |

Behaviour that changed: the waffle panel now expands the current
application under `HashRouter` too; TopBar links carry `aria-current`; the
Settings dialog has a Cancel button next to Save.

## What's in here

| Path | What it is |
|---|---|
| `index.ts` | the public API |
| `DenimProvider.tsx` | the provider: `my` query, settings store, health, status dots |
| `hooks.ts` | `useDenim`, `useApplications`, `useNav`, `useSettings`, `useAppStatus`, `useReportAppStatus` |
| `DenimRoutes.tsx` | application, kiosk and `/` routes; `defaultRoute` redirect |
| `nav.ts` | the nav model as pure functions |
| `settingsForm.ts` | `useSettingsForm`, the General tab schema |
| `contract.ts` | `DenimShellProps`, `splitShellProps`, and the skin contract in comments |
| `themes/` | the theme-key vocabulary (`"<mode>-<color>"`) |
| `lib/queries.ts` | the server contract's documents and types |
| `lib/localSettings.ts`, `lib/settingsExtensions.ts`, `lib/health.ts`, `lib/pageReset.ts` | settings storage, the extension types, health polling, page reset |

## License

MIT, see `LICENSE`.
