---
name: denim-fabric
description: How to use denim-fabric, the shared Fluent UI (formerly Office UI Fabric) pieces of the Denim app shell - choosing a bar package (denim-fabric-topbar or denim-fabric-sidebar, which export the same members), putting a ReactiveAdmin screen in master-detail panes (AdminMasterDetail), MasterDetail and useDetailRoute for other lists, the shell-neutral layout hook (useLayout, useShellLayout, breakpoints), FullBleed for canvas-like apps, theming, the Settings dialog, ConfirmDialog, getStyle() and where its members live, Photo (now typical-admin-fabric's), and quick-entry UX. Use before building or changing an app's frame on denim-fabric, laying out a list/detail screen, switching bars, or migrating from the single-package Denim or the pre-split denim-fabric. Pair with the bar's own skill (denim-fabric-topbar / denim-fabric-sidebar) and denim's denim-app-shell skill.
license: MIT
---

# Fluent shells with denim-fabric

denim-fabric renders Denim's headless core (`../denim`) with Fluent UI v8.
"Fabric" names the UI kit, not a layout. It holds what every bar shares;
**the bars are separate packages**, so an app ships only the one it uses:

| Bar package | Use it for |
|---|---|
| `denim-fabric-topbar` | the original Denim look: fixed header with the active app's name and links, waffle panel, Settings in the panel footer. Existing Denim apps. |
| `denim-fabric-sidebar` | configuration-style apps with many applications: grouped sidebar, icons, status dots, phone drill-in. |

Both export **exactly the same members**: `Shell` (also the default
export), plus everything from denim-fabric and the core. Switching is an
import-path change. Both take the same `ShellProps` (every `<DenimProvider>`
prop, see denim's `denim-app-shell` skill, plus `themes`, `Logo`, `Brand`,
`title`, `Controls`, `ExternalApps`, `SidebarFooter`, `breakpoints`,
`welcome`); a bar ignores the props it has no place for.

```tsx
import Shell from './lib/denim-fabric-sidebar';   // the only line that names the bar
<Shell title="Rig Config" settingsSource="server" components={{ devices: DevicesAdmin }} />
```

Import everything else from `./lib/denim-fabric` (or from the bar: it
re-exports the same). Read the bar's skill for what it draws.

Setup (providers, peer packages, minimal setup) is in denim-fabric's
README; each bar's README has a complete setup. Don't add a
`ThemeProvider`, `loadTheme` or `initializeIcons()`; the bar does all three.
Mount one `<ConfirmDialogHost />` (from denim-fabric; it is
typical-admin-fabric's, re-exported, so the list delete buttons and your own
`confirmAsync()` calls share it).

## 1. Master-detail (under any bar)

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
  record (`labels.singular`) on an edit page, which it goes up to. Under
  the sidebar that back bar is the sidebar's; under the top bar (no back
  bar of its own) MasterDetail draws it above the detail.
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

## 2. Layout under any bar

- `useLayout()` -> `'wide' | 'medium' | 'narrow'`: the bar's layout (its
  `breakpoints`, default `{ medium: 700, wide: 1200 }`), or the window's
  outside a bar. Use it in content that adapts (`const narrow =
  useLayout() === 'narrow'`).
- `useShellLayout()` -> the bar's context or null: `layout`, `backBar`
  (whether the bar draws a phone back bar; the sidebar does, the top bar
  doesn't), `setBack(target | null)` (point that back bar elsewhere while
  set), `goUp(to)` (Back when Back leads there, else a push).
- `FullBleed` cancels the bar's content padding so its children fill the
  area edge to edge, full height (a canvas, a map, a designer). It reads
  the bar's CSS variables (`--denim-content-padding`, `-inline`, `-block`,
  `--denim-content-height`); a new bar sets them on its page box.
- Never measure `window.innerWidth` yourself for layout, and never import
  from a bar's folder for this; the hooks are shared.

## 3. Theming

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
  shows the shape). `light` / `dark` (the two old single themes) are gone.
- `applyTheme(settings, themes)`, `useFluentTheme(themes)` and
  `FluentThemeRoot` are exported for a bar of your own.

## 4. Settings dialog

`SettingsDialog` renders the core's `useSettingsForm`: a General tab
(colour, mode, font size, default page, "Reduce motion (this device)", plus
`settingsGeneralFields`) and one Pivot tab per `settingsTabs` entry, saved
together (extra tabs overflow into a menu). Writing tabs is the core
skill's section 5. Keep it for global preferences; a feature's own
configuration is its own application.

## 5. getStyle() and Photo

`getStyle()` (`./lib/denim-fabric/lib`) keeps its member names, but each
style lives with what uses it:

- shared shell styles (`splashScreen`, `appLogo`, `appHeader`,
  `modalHeader`, `modalBody`, `link`, `dropdownLink`, `alert`,
  `alertDismissed`): denim-fabric `lib/getStyle.ts`;
- form styles (`error`, `errors`, `hint`, `labelHorizontal`,
  `fieldHorizontal`, `dangerButton`): typical-admin-fabric
  `lib/formStyles.ts` (`getFormStyle()`); prefer that in form code;
- the top bar's (`navBar`, `headerLink*`, `waffle`, `appNavLink*`,
  `headerIconButton`, `iconButtonStyle`, `content`, `hiddenLgDown`,
  `hiddenXlUp`): denim-fabric-topbar `TopBarShell/styles.ts`, registered
  into getStyle() when the top bar is imported. Not there in a sidebar
  app.

The responsive helpers (`sm`, `md`, `hiddenMdDown`, ...) are gone from
denim-fabric's getStyle(). For new code prefer `mergeStyleSets` with the
theme in the component.

`Photo` is typical-admin-fabric's (`lib/templates/Photo/`; its README and
`form-schema` skill). `Photo` from denim-fabric, and
`./lib/denim-fabric/Photo`, are re-exports. For an image field inside a
per-form form, use per-form's `image-upload` type instead.

## 6. Motion, touch, keyboard

- Keep a Fluent component's own motion where it has one; otherwise use
  `@fluentui/react-motion` (`createMotionComponent`/`createPresenceComponent`,
  `motionTokens`). Never animate width, height, margins or `left`/`top`:
  without GPU compositing (WebKitGTK) each frame repaints what moves, and
  layout per frame is far worse.
- Respect `useReducedMotion()` (core: the per-device `reduceMotion` setting
  or the OS preference). Motion components under any bar skip
  automatically (`ShellMotionProvider`); turn off a Fluent v8 component's
  own animation yourself (styles `animation: 'none'`/`transition: 'none'`).
- A selection highlight that should slide: `SlidingIndicator` behind the
  items in a `position: relative; isolation: isolate` container, and the
  items paint no selected background of their own, not even on hover.
- Default an app to reduced motion with `defaultSettings={{ reduceMotion: true }}`.
- Measure: `localStorage.debugPerf = '1'` logs `[perf] anim <name>: ms,
  frames, long frames (max)` per animation (`perfMotionProps(name)` for
  your own motion components).
- Touch: keep every new control at least 44px (typical-admin-fabric's icon
  buttons grow to 44px under `@media (pointer: coarse)`; reuse its
  `lib/touch.ts` styles), never hide an action behind hover, and keep a
  visible `:focus-visible` outline (`2px solid palette.themePrimary`). Use
  `Link`s for navigation, not click handlers on divs.

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

## 8. Switching bars, changing one, writing another

- Switch: clone the other bar, change the one import, delete the old bar.
  Nothing else changes (the parity check guarantees the same exports).
- Prefer props first (`Brand`, `Controls`, `SidebarFooter`, `breakpoints`,
  `themes`, `welcome`).
- Then copy the bar's folder (`TopBarShell/` or `SidebarShell/`) and edit
  the copy; denim-fabric and the core stay as they are. Its building
  blocks (`Header`, `Sidebar`, `StatusDot`, ...) are imported from the
  bar's folder, not its index.
- A new bar, or a skin for another UI kit: read the `write-a-denim-skin`
  skill (the export contract and the parity check are there).
- Never put markup or a UI-kit import in denim (the core), and never put a
  bar into denim-fabric.

## Migrating from the pre-split denim-fabric

`{ TopBarShell }` / default import -> `Shell` from `./lib/denim-fabric-topbar`;
`{ SidebarShell }` -> `Shell` from `./lib/denim-fabric-sidebar`;
`TopBarShellProps`/`SidebarShellProps` -> `ShellProps`; the layout hook,
`FullBleed`, `MasterDetail`, `AdminMasterDetail`, `useDetailRoute`, `lib/`,
`getStyle()` and `Photo` keep their names (`SidebarShell/layout` and
`SidebarShell/FullBleed` moved to `shared/`). The README has the full table.

## Verify

Drive the app with typical-admin-fabric's `playwright-verify` skill at
1400px, 900px and 390px (with `hasTouch`/`isMobile`): the bar's nav, a
list -> detail -> edit -> save, the phone's back control and browser Back,
a deep link, a non-list app, and no console errors. For motion, also run
with `reducedMotion: 'reduce'` (everything instant) and with CPU
throttling (`Emulation.setCPUThrottlingRate`) and the `debugPerf` logs.
Long-lived GraphQL subscriptions keep the network busy, so wait for `load`
plus a settle time, not `networkidle`.
