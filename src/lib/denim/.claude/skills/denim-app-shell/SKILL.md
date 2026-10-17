---
name: denim-app-shell
description: How to build a React app's shell on Denim's headless core (denim) - the provider and hooks (DenimProvider, useDenim, useApplications, useNav, useSettings, useSettingsForm), registering applications with groups, icons and nav links, routes, kiosk routes and deep links, local vs server settings and the Settings extension point (settingsTabs, settingsGeneralFields, settingsFields), status dots, the optional `my`/`updateSettings` server contract, the contract a skin implements, and plain-http LAN pitfalls. Use before creating a new app on this stack, adding an app/page to the nav, adding a setting, writing or changing a skin, or touching routing, settings or the server contract. For the Fluent skin itself read denim-fabric's denim-fabric skill (choosing a bar, MasterDetail, the layout hook, theming) and the bar's own skill (denim-fabric-topbar or denim-fabric-sidebar) too.
license: MIT
---

# Building an app shell on Denim

Denim is split in two, the way typical-admin / typical-admin-fabric are:

- **denim** (the core, this repo): headless. It owns the application
  registry, routing, the nav model, the settings store, health polling and
  status dots, and hands them out through a provider and hooks. No UI kit.
- **a skin** renders it. **denim-fabric** is the Fluent UI one ("Fabric" is
  Fluent's old name): shared pieces, plus one bar package per layout,
  `denim-fabric-topbar` (header + waffle panel, the original look) and
  `denim-fabric-sidebar` (grouped sidebar). The bars export the same
  members, so switching is an import-path change. You can write your own
  (section 7).

Apps normally import everything from the skin (`./lib/denim-fabric`, or
the bar, re-exports the core). Use the core directly for hooks in your own
components and when writing a skin.

Folder layout is fixed: the libraries import each other by relative path,
so clone `denim`, `denim-fabric`, one bar (`denim-fabric-sidebar` or
`denim-fabric-topbar`), `typical-admin`, `typical-admin-fabric` and
`per-form` side by side (e.g. `src/lib/denim`, `src/lib/denim-fabric`,
...). See the READMEs for peer packages and full setups.

## 1. Mount it

```tsx
// main.tsx: providers. The core reads Apollo from <ApolloProvider> and the
// location from the router; it never imports your client.
<ApolloProvider client={client}>
  <MergedSubscriptionProvider>        {/* typical-admin: one subscription connection */}
    <BrowserRouter>
      <App />
      <ConfirmDialogHost />           {/* from denim-fabric (= typical-admin-fabric's) */}
    </BrowserRouter>
  </MergedSubscriptionProvider>
</ApolloProvider>

// App.tsx: a shell is the whole frame. Every shell takes all
// <DenimProvider> props plus its own.
import Shell from './lib/denim-fabric-sidebar';   // or './lib/denim-fabric-topbar'
export default function App() {
  return <Shell title="Rig Config" components={{ devices: DevicesAdmin, designer: LayoutDesigner }} />;
}
```

- Don't wrap a Fluent shell in your own `ThemeProvider` or call `loadTheme`
  or `initializeIcons()`; the shell does.
- A shell can be the element of a `<Route path="/*">` or rendered directly
  under the router. `BrowserRouter` and `HashRouter` both work (the nav
  model reads the router's location).

## 2. Register applications (nav + routes)

An **application** is one entry in the nav and one top-level route:

```ts
interface IApplication {
  name: string;          // label in the nav
  path: string;          // URL segment: the app owns /<path>/*
  defaultRoute: string;  // /<path> redirects to /<path>/<defaultRoute>; "" for none
  frontEnd: string;      // key into the shell's components={{ ... }}
  links: { path: string; text: string }[];  // sub-pages, /<path>/<link.path>
  group?: string | null; // optional nav heading ("RIG"); none -> defaultGroup
  icon?: string | null;  // optional icon name (denim-fabric: a Fluent icon name)
}
```

Two sources, pick one:

- **Static** (`applications={[...]}`): the list lives in the frontend. No
  backend contract needed. Best for a single-purpose app.
- **Backend** (omit `applications`): the core queries
  `my { applications {...} }`. Use it when the list differs per user/role or
  is edited at runtime. `group`/`icon` are selected only when
  `applicationFields` names them (`"group icon"`; SidebarShell's default).

Groups keep configured order: a group appears where its first application
appears, applications keep their order inside it, and ungrouped ones go
under `defaultGroup` (default "Applications"). Skins without groups (the
TopBarShell) ignore `group`/`icon`.

Adding a page takes **both** a link entry and a route in the component that
renders it; one without the other is unreachable or a dead link.

What the core routes (`<DenimRoutes>`):

| URL | Renders |
|---|---|
| `/<path>/*` | `components[frontEnd]` with prop `{ app }`, inside the skin's chrome |
| `/<path>` exactly, with `defaultRoute` | `<Navigate replace>` to `/<path>/<defaultRoute>` (deep links below are left alone) |
| `/kiosk/<path>/*` | the same component with no chrome (wall displays, embeds) |
| `/` | `RootComponent` if given, else a redirect to the `launchPage` setting, else a welcome. (SidebarShell on a phone shows its menu here instead.) |
| anything else | the `/` content; there is no 404 route |

The component nests its own routes **relative** to `/<path>`:

```tsx
export default function ProjectsApp() {
  return (
    <Routes>
      <Route path="board" element={<ProjectBoard />} />
      {/* ReactiveAdmin owns list/new/:id/show/:id/edit under /projects */}
      <Route path="*" element={<ProjectsAdmin />} />
    </Routes>
  );
}
```

`RootComponent` (a public site's homepage) also stands in for the splash
while `my` loads, and chrome is hidden on any path that isn't an application
(`useNav().showChrome`).

## 3. The nav model

`useNav()` gives `activeApp` (by the first path segment, or the second under
`/kiosk`), `activeLink` (the most specific active link), `isKiosk`,
`showChrome`, and `appUrl`, `linkUrl`, `isAppActive`, `isLinkActive`.
Matching is by **whole segments**: link `check` is not active on `checks`,
and a link to the app root (`""`) is active only on the root itself. The
same functions are exported pure (`computeNav`, `isLinkActive`,
`groupApplications`) for tests and non-React code.

## 4. Settings: where they live

Denim's own settings are `theme` (`"<mode>-<color>"`, e.g. `dark-teal`),
`fontSize` (1, 1.14, 1.29), `launchPage` and `reduceMotion` (a device
setting, below). `settingsSource` decides where:

| | `"local"` (default) | `"server"` |
|---|---|---|
| Stored in | this browser's `localStorage` (`denim-settings`) | the backend: `my.settings`, saved with `updateSettings` |
| Backend needs | nothing | the settings half of the README's contract |
| Right for | public sites (anonymous visitors), single-user tools, prototypes | settings shared by every device of an installation or account |

`defaultSettings={{ theme: 'light-blue', launchPage: 'projects' }}` sets the
values before anything is saved. `useSettings().saveSettings(values)` merges
and persists from anywhere.

**Device settings** (`DEVICE_SETTINGS`, today only `reduceMotion`) live in
this browser's `localStorage` in both modes and are never sent to
`updateSettings`, so a server backend needs no field for them: they describe
the device (a desktop webview without GPU compositing wants reduced motion,
a phone may not). `reduceMotion` is on the General tab as "Reduce motion
(this device)"; skins read it, together with the OS preference, through
`useReducedMotion()`. Default it per app with
`defaultSettings={{ reduceMotion: true }}`.

The Settings dialog is for **global, cross-cutting preferences** (theme,
units, this device's name). A feature's own configuration, however small,
belongs in its own application or page, not a Settings tab.

## 5. Extending the Settings dialog

The core owns the General tab. An app adds to it in three ways:

```tsx
import type { ISettingsTab, ISettingsTabProps } from './lib/denim-fabric';
import { Form } from './lib/denim-fabric/lib';   // typical-admin-fabric's per-form Form

// (a) Extra fields on the General tab: a per-form schema (see form-schema).
// A field whose value isn't stored under its own key maps it with
// `read(key, settings)` -> starting value and `write(key, values, settings)`
// -> the settings patch to save (per-form's `converter`, if any, runs first).
const generalFields = {
  units: { type: 'select', label: 'Units', defaultValue: 'metric',
           options: [{ text: 'Metric', value: 'metric' }, { text: 'Imperial', value: 'imperial' }] },
  deviceName: {
    type: 'text', label: 'Device name',
    read: (_key: string, settings: IDenimSettings) => settings.deviceMap?.[myId] ?? '',
    write: (key: string, values: Record<string, any>, settings: IDenimSettings) =>
      ({ deviceMap: { ...settings.deviceMap, [myId]: values[key] } }),
  },
};

// (b) A whole tab.
function DeviceTab({ settings, onChange, registerSave }: ISettingsTabProps) {
  const [name, setName] = useState<string>(settings.deviceName ?? '');
  useEffect(() => {
    // Merged into the one save; isValid=false blocks Save and shows the message.
    onChange({ deviceName: name }, name.length <= 40, 'Device name: 40 characters at most.');
    // Optional: side effects after the settings are saved (your own mutations).
    registerSave(async () => { /* e.g. await renameDevice({ variables: { name } }) */ });
  }, [name, onChange, registerSave]);
  return (
    <Form name="device" form={{ deviceName: { type: 'text', label: 'Device name' } }}
          initialValues={{ deviceName: settings.deviceName ?? '' }}
          onChange={(_n: string, { clean }: any) => setName(clean.deviceName ?? '')} />
  );
}

// (b2) A tab that loads its own data: declare `loads: true` and say when the
// data is in, BEFORE reporting anything. Until then Save is held while the
// tab is open, its patches are dropped and its registerSave doesn't run, so
// a form seeded before its data arrived can't save empty values over it.
function DefaultsTab({ isOpen, setReady, registerSave }: ISettingsTabProps) {
  const { data } = useQuery(GET_DEFAULTS, { skip: !isOpen });
  useEffect(() => setReady(!!data), [data, setReady]);   // first
  useEffect(() => {
    if (data) registerSave(async () => { /* write only what changed */ });
  }, [data, registerSave]);
  if (!data) return <span>Loading…</span>;               // no form before the data
  return <Form ... />;
}
const settingsTabs: ISettingsTab[] = [
  { key: 'device', headerText: 'Device', Component: DeviceTab },
  { key: 'defaults', headerText: 'Defaults', Component: DefaultsTab, loads: true },
];

// (c) settingsFields: with settingsSource="server", the extra AppSettings
// fields to select in my.settings so tabs can read them.
<Shell settingsSource="server" settingsFields="units deviceName"
       settingsGeneralFields={generalFields} settingsTabs={settingsTabs} ... />
```

How saving works (`useSettingsForm`, the same in every skin):

- Save merges General's values and every ready tab's latest `onChange`
  patch into one object and keeps only the keys whose value differs from
  the saved settings (deep, ignoring `__typename`; `null`, `undefined`
  and `''` count as equal). Nothing changed: nothing is sent. Local:
  written to `localStorage` (extra keys included). Server: sent as
  `updateSettings(settings: {...})`, then `my` is refetched; every key must
  therefore exist on the backend's `AppSettingsInput`. So a tab can report
  its whole form; it needn't diff.
- Then each ready tab's `registerSave` callback runs in tab order. A thrown
  error shows next to Save and keeps the dialog open. These write the
  tab's own records, so diff those yourself (`changedSettings` and
  `sameSettingValue` are exported for it).
- Loading: a tab with `loads: true` (or any tab after `setReady(false)`)
  is not ready. While an open tab isn't ready, `useSettingsForm().loading`
  lists it and `save()` refuses (the Fluent dialog disables Save and says
  "Loading <tab>…"); its `onChange` patches are dropped, so call
  `setReady(true)` before reporting. A closed (unmounted) loading tab
  doesn't hold Save; it just contributes nothing.
- `onChange`/`registerSave`/`setReady` are stable per tab: list them as
  effect deps.
- Tab controls may unmount inactive tabs (Fluent's Pivot does). Patches and
  save callbacks survive that, so keep a tab's state in what you report.
- Server mode: `settings` includes Apollo's `__typename`, also on nested
  objects. Strip it from anything you send back; input types reject it.
- Don't share one `onChange` handler between two per-form `Form`s with
  different fields (a field missing from one reads as cleared).

## 6. Status dots

A nav item can show a status dot (tones `ok`, `warning`, `error`, `busy`,
`off`, with an accessible `label`). Two sources:

```tsx
// (a) A hook for every app, on the provider/shell: called once per app in
// the nav, so it may use Apollo. Pass a module-level function.
export function useRigStatus(app: IApplication): IAppStatus | undefined {
  const isDevices = app.path === 'devices';
  const { data } = useQuery<any>(GET_DEVICES, { skip: !isDevices });
  if (!isDevices || !data) return undefined;
  return data.getDevices.some((d: any) => !d.enabled)
    ? { tone: 'warning', label: 'A device is disabled' } : 'ok';
}
<Shell useAppStatus={useRigStatus} ... />   // the bar's Shell

// (b) The app reports its own, from its component. The last report stays
// after it unmounts; report undefined to clear.
useReportAppStatus(app.path, dirty ? { tone: 'warning', label: 'Unsaved layout' } : undefined);
```

A reported status wins over the hook's.

## 7. Writing or changing a skin

A skin is a shell component taking `DenimShellProps` (+ its own props) that
renders `<DenimProvider>` and, inside it:

1. a splash while `useDenim().status !== 'ready'` (`'waiting'` = the backend
   is down and the core is polling it); `RootComponent` stands in for it;
2. the theme for `settings.theme` / `settings.fontSize` in its UI kit (the
   key vocabulary is in `themes/`: `parseThemeKey`, `COLOR_KEYS`, ...);
3. chrome from `useApplications()` / `useNav()`, hidden when
   `!useNav().showChrome`;
4. `<DenimRoutes wrap={(content, { app, kiosk }) => ...} />` for content;
5. a Settings dialog from `useSettingsForm(isOpen)`: render
   `general.schema` with your form component and each `tabs[i].Component`
   with `tabs[i].props`; call `save()`.

`splitShellProps(props)` separates the provider's props from the skin's.
The README has a complete plain-HTML skin (about 60 lines) that type-checks
and runs. To vary a Fluent bar, copy `denim-fabric-topbar/TopBarShell/` or
`denim-fabric-sidebar/SidebarShell/` rather than forking the core; a new
bar follows denim-fabric's `write-a-denim-skin` skill (the bars' shared
export surface and its parity check).

## 8. Plain http on the LAN is not a secure context

Opening the app as `http://192.168.x.x:5173` (a phone, a rig touchscreen,
another PC) is not a
[secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts);
only `https://` and `http://localhost` are. There, `crypto.randomUUID`,
`crypto.subtle`, `navigator.clipboard`, service workers and some device APIs
are `undefined`, and code that calls them throws only on other devices.

- Let typiql generate record keys (it does; never generate keys client-side).
- For a client-side id, fall back to `crypto.getRandomValues`, which works
  without a secure context:

  ```ts
  export function uuid(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && window.isSecureContext) {
      return crypto.randomUUID();
    }
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  ```
- Guard clipboard buttons with `window.isSecureContext`, or serve over https.
- Point the GraphQL URL at `window.location.hostname` (or a same-origin
  proxy), never `localhost`, so other devices reach the backend.

## 9. What is not the core's job

- **A CRUD screen**: ReactiveAdmin (typical-admin-fabric's `reactive-admin`
  skill); in SidebarShell wrap it in `AdminMasterDetail`.
- **Look and layout**: the skin. Prefer the skin's props first, then a copy
  of the skin, never markup in the core.
- **Auth, your pages' data fetching, per-feature config**: your app.

## Exports at a glance

`import { ... } from './lib/denim'`: `DenimProvider`, `DenimContext`,
`DenimRoutes`, `AppElement`, `AppDefaultRedirect`, `useDenim`,
`useApplications`, `useNav`, `useSettings`, `useSettingsForm`,
`useAppStatus`, `useReportAppStatus`, `splitShellProps`, `computeNav`,
`groupApplications`, `isLinkActive`, `appUrl`, `linkUrl`,
`generalSettingsSchema`, theme-key helpers (`themeKey`, `parseThemeKey`,
`COLOR_KEYS`, `MODE_KEYS`, labels), `buildMyQuery`, `UPDATE_SETTINGS`,
`OPTIONAL_APPLICATION_FIELDS`, `useHealthPoll`, `pingServer`,
`applyPageReset`, `DEFAULT_SETTINGS`, `readLocalSettings`,
`writeLocalSettings`; types `DenimProviderProps`, `DenimShellProps`,
`IApplication`, `ILink`, `IDenimSettings`, `ISettingsTab`,
`ISettingsTabProps`, `IAppStatus`, `AppStatusTone`, `INavState`.
