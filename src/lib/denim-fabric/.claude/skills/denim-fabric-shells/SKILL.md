---
name: denim-fabric-shells
description: How to use denim-fabric, the Fluent UI (formerly Office UI Fabric) skin of the Denim app shell - choosing TopBarShell (header + waffle panel, the original Denim look) or SidebarShell (grouped sidebar with icons and status dots, wide/medium/phone layouts), putting a ReactiveAdmin screen in master-detail panes (AdminMasterDetail), MasterDetail and useDetailRoute for other lists, FullBleed for canvas-like apps, theming, the Settings dialog, ConfirmDialog, Photo, and quick-entry UX. Use before building or changing an app's frame on denim-fabric, adding an application to a SidebarShell, laying out a list/detail screen, or migrating from the single-package Denim. Pair with denim's denim-app-shell skill (applications, routes, settings, server contract).
license: MIT
---

# Fluent shells with denim-fabric

denim-fabric renders Denim's headless core (`../denim`) with Fluent UI v8.
"Fabric" names the UI kit, not a layout; the layouts are components here:

| Shell | Use it for |
|---|---|
| `TopBarShell` (default export) | the original Denim look: fixed header with the active app's name and links, waffle panel, Settings in the panel footer. Existing Denim apps. |
| `SidebarShell` | configuration-style apps with many applications: grouped sidebar, icons, status dots, optional list \| detail, phone drill-in. |

Both take every `<DenimProvider>` prop (applications, components, settings,
RootComponent, ...; see denim's `denim-app-shell` skill) plus their own.
Import everything from `./lib/denim-fabric`: it re-exports the core.

Setup (providers, peer packages, the two complete app setups) is in the
README. Don't add a `ThemeProvider`, `loadTheme` or `initializeIcons()`;
the shell does all three. Mount one `<ConfirmDialogHost />` (from
denim-fabric; it is typical-admin-fabric's, re-exported, so the list delete
buttons and your own `confirmAsync()` calls share it).

## 1. SidebarShell

```tsx
<SidebarShell
  title="Rig Config"                 // sidebar heading
  settingsSource="server"
  defaultGroup="System"              // heading for apps without `group`
  useAppStatus={useRigStatus}        // optional status-dot hook
  components={{ devices: DevicesAdmin, designer: LayoutDesigner, about: About }}
/>
```

- Applications come from `applications` or `my.applications` (it selects
  `group icon` by default; `applicationFields=""` if the backend lacks
  them). `icon` is a Fluent icon name (`Devices3`, `ContactCard`, `Design`,
  `Info`, ...); without one the item shows the name's first letter.
- Groups keep configured order. The active app's `links` show under it in
  the sidebar, and as touch pills on a phone.
- Widths: wide >= 1200px (sidebar, collapsible to a rail), medium >= 700px
  (icon rail; its menu button opens the full sidebar over the content),
  narrow (drill-in: menu at `/` -> app -> detail, each with a back bar).
  Override with `breakpoints={{ medium, wide }}`.
- There are **no global action buttons**. Each application draws its own
  toolbar inside its content (or its panes). Settings (cross-feature
  preferences only) is in the sidebar footer.
- Content gets 20px padding (12px on a phone) and scrolls. A component that
  must fill the area wraps itself in `<FullBleed>` (a canvas, a map, a
  designer). `MasterDetail` does that itself.
- Kiosk routes (`/kiosk/<path>`) render without the sidebar.

### Motion

The shell animates briefly, `transform`/`opacity` only (README "Motion"):
the wide sidebar slides with the content moving beside it, the medium
overlay and Settings keep Fluent v8's own Panel slide and Modal fade, one
indicator slides between selected items (sidebar, `AdminMasterDetail`'s
list), and a phone's incoming pane slides in. Rules for anything you add:

- Keep a Fluent component's own motion where it has one; otherwise use
  `@fluentui/react-motion` (`createMotionComponent`/`createPresenceComponent`,
  `motionTokens`). Never animate width, height, margins or `left`/`top`:
  without GPU compositing (WebKitGTK) each frame repaints what moves, and
  layout per frame is far worse.
- Respect `useReducedMotion()` (core: the per-device `reduceMotion` setting
  or the OS preference). Motion components under SidebarShell skip
  automatically (`ShellMotionProvider`); turn off a Fluent v8 component's
  own animation yourself (styles `animation: 'none'`/`transition: 'none'`).
- A selection highlight that should slide: `SlidingIndicator` behind the
  items in a `position: relative; isolation: isolate` container, and the
  items paint no selected background of their own, not even on hover.
- Default an app to reduced motion with `defaultSettings={{ reduceMotion: true }}`.
- Measure: `localStorage.debugPerf = '1'` logs `[perf] anim <name>: ms,
  frames, long frames (max)` per animation (`perfMotionProps(name)` for your
  own motion components).

### Touch and keyboard

The rig touchscreen and phones are first-class: keep every new control at
least 44px (typical-admin-fabric's icon buttons grow to 44px under
`@media (pointer: coarse)`; reuse its `lib/touch.ts` styles), never hide an
action behind hover, and keep a visible
`:focus-visible` outline (`2px solid palette.themePrimary`). Use `Link`s for
navigation (they are focusable and work with the URL), not click handlers on
divs.

## 2. Master-detail

### A ReactiveAdmin screen

Replace `ReactiveAdmin` with `AdminMasterDetail`; same props:

```tsx
export default function DevicesAdmin() {
  return (
    <AdminMasterDetail
      dispatcher={dispatcher}
      name={{ singular: 'Device', plural: 'Devices' }}
      schemaDefinition={schemaDefinition}    // set list.buttons.add for an Add button in the list pane
      listColumns={['name', 'kind']}         // compact list: a subset of list.columns
      labels={{ singular: 'Rig device' }}    // optional: display text, see below
    />
  );
}
```

- List pane: typical-admin-fabric's `List`, without its page heading, with
  `basePath` set to where the app is mounted (so a click while a detail is
  open goes to `/devices/<id>/show`, not nested under the open one).
- Detail pane: a ReactiveAdmin whose list slot is empty, so its own
  `/new`, `/:id/show`, `/:id/edit` routes render there. Its slot overrides
  (`components={{ show: ..., edit: ... }}`), `callBacks` work as usual.
- `listProps` passes extra props to the `List` (`queryResultKey`,
  `idField`, `columnSelectable`, `storageKey`).
- Headings come from typical-admin's display `labels`, not the GraphQL
  names: "Devices", "Device", "Edit device", "New device" by default (a
  plain ReactiveAdmin keeps "Listing Devices" unless it gets `labels`).
  Override any key (`singular`, `plural`, `listHeading`, `showHeading`,
  `newHeading`, `editHeading`, ...; see the `reactive-admin` skill).
- Selection is the URL. Deep links, reload and browser Back/Forward work.
  The list highlights the row in the URL (`List`'s `selectedKey`) and turns
  to its page on a deep link, Back/Forward or a new record.
- The list stays mounted while details open and close (hidden under the
  detail on a phone): page, sort, filters and scroll survive, and rows open
  on click (`List`'s `selectOnClick`), so the row just closed opens again.
- On a phone the back bar is the only back control: the slots' own back
  arrow is dropped (`Links`' `hideBack`, also passed to a `links`
  override); Edit and Delete stay. The bar reads the list title, or the
  record (`labels.singular`) on an edit page, which it goes up to.
- MasterDetail's `back={{ label, to }}` sets that phone back target for
  your own lists.

### Anything else

```tsx
const { basePath, selected, id } = useDetailRoute([':id']);   // patterns after the mount point
<MasterDetail
  title="Zones" selected={selected} listUrl={basePath}
  list={<ZoneList basePath={basePath} />}              // links to `${basePath}/${zone.id}`
  detail={<ZoneEditor id={id!} />}
  listActions={<IconButton iconProps={{ iconName: 'Add' }} ariaLabel="Add zone" />}
/>
```

`useDetailRoute` must run in a component mounted under a `<route>/*` (every
application is). Apps that aren't lists don't use MasterDetail.

## 3. TopBarShell

```tsx
<TopBarShell settingsSource="server" settingsFields="deviceName"
             settingsTabs={settingsTabs} components={{ projects: ProjectsAdmin }}
             Brand={MyIcon} Controls={HeaderControls} ExternalApps={Shortcuts} />
```

- Header: waffle button, `Brand`, the active app's name; the app's links on
  wide screens (a slide-out menu on narrower ones, per `getStyle()`'s
  breakpoints), `Controls` on the right.
- `group`, `icon` and status dots are ignored here.
- Content sits below the fixed header with 1em side padding (`getStyle().content`).

## 4. Theming

- Settings hold a theme key `"<mode>-<color>"` (12 colours x `light` /
  `dark` / `hc`) and a font scale. The shell builds the Fluent theme from
  `themes` (default `THEMES`), calls `loadTheme`, applies a `ThemeProvider`
  to `<body>`, and colours the favicon. A theme change remounts the tree.
- In your components read colours from the theme, never hard-code them:
  `useTheme()` inside the shell (preferred), or `getTheme()`;
  `palette.themePrimary`, `.neutralLight`, `.white` (the page background,
  dark in dark mode), `semanticColors.*`. See `hand-rolled-components`.
- A custom `themes` map must keep the `<mode>-<color>` keys plus `default`;
  each value is `(fontSize) => IPartialTheme` (`buildTheme(mode, color)`
  shows the shape).
- `applyTheme(settings, themes)`, `useFluentTheme(themes)` and
  `FluentThemeRoot` are exported for a shell of your own.

## 5. Settings dialog

`SettingsDialog` renders the core's `useSettingsForm`: a General tab
(colour, mode, font size, default page, "Reduce motion (this device)", plus
`settingsGeneralFields`) and
one Pivot tab per `settingsTabs` entry, saved together. Writing tabs is the
core skill's section 5. Keep it for global preferences; a feature's own
configuration is its own application.

## 6. Photo

```tsx
import Photo from './lib/denim-fabric/Photo';

<Photo
  id={device.id}                     // download file name
  image={device.photo ?? ''}         // base64 PNG/JPEG, WITHOUT the data: prefix
  icon="image"                       // or "user": placeholder icon when empty
  submit={(base64: string) =>        // the saved image (PNG base64), '' on remove
    updateDevice({ variables: { id: device.id, update: { photo: base64 || null } } })}
/>
```

- Drop or pick a JPEG/PNG up to 500 kB; EXIF orientation is corrected; Crop,
  then Save, calls `submit`. Existing images get crop/download/delete
  buttons. It never talks to the server.
- Needs `react-image-crop`, `react-dropzone`, `exif-js`.
- For an image field inside a form, use per-form's `image-upload` type.

## 7. Quick entry in data-entry apps

When users enter many records in a row, don't bounce each one through the
full-page `/new` route: offer an add over the current page (a Fluent
`Panel`/`Modal`, or an inline row above the list), focus the first field,
pre-fill defaults, save on Enter, then clear and refocus. In a
MasterDetail, the detail pane's `/new` already keeps the list visible.

```tsx
function QuickAddProfile() {
  const formRef = useRef<IFormRef>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [key, setKey] = useState(0);                       // remount = clear
  const [addProfile] = useMutation(ADD_PROFILE);
  useEffect(() => {
    boxRef.current?.querySelector<HTMLElement>('input, textarea')?.focus();
  }, [key]);
  const save = async () => {
    if (!formRef.current?.isValid) return;
    await addProfile({ variables: { values: formRef.current.submit() } });
    setKey(k => k + 1);
  };
  return (
    <div ref={boxRef} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } }}>
      <Form key={key} ref={formRef} name="quickProfile"
            form={{ name: { type: 'text', label: 'Name', required: true } }} />
    </div>
  );
}
```

(`IFormRef` and `Form` come from `typical-admin-fabric/lib/templates/Form`.)

## 8. Changing a shell, or writing another

- Prefer props first (`Brand`, `Controls`, `SidebarFooter`, `breakpoints`,
  `themes`, `welcome`).
- Then copy the shell's folder (`TopBarShell/` or `SidebarShell/`) and edit
  the copy; `shared/` and the core stay as they are.
- A skin for another UI kit: read the `write-a-denim-skin` skill.
- Never put markup or a UI-kit import in denim (the core).

## Verify

Drive the app with typical-admin-fabric's `playwright-verify` skill at
1400px, 900px and 390px (with `hasTouch`/`isMobile`): the sidebar groups,
a list -> detail -> edit -> save, the phone's drill-in and Back, a deep
link, a non-list app, and no console errors. For motion, also run with
`reducedMotion: 'reduce'` (everything instant) and with CPU throttling
(`Emulation.setCPUThrottlingRate`) and the `debugPerf` logs; slow the
animations with CDP's `Animation.setPlaybackRate` to screenshot them frame
by frame. Long-lived GraphQL
subscriptions keep the network busy, so wait for `load` plus a settle time,
not `networkidle`.
