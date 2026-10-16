---
name: denim-fabric-sidebar
description: How to use denim-fabric-sidebar, the sidebar Fluent UI shell for Denim - its Shell and props (title, Brand, SidebarFooter, breakpoints, welcome), groups, icons and status dots, the wide / medium / phone layouts and the phone drill-in and back bar, its motion (collapse slide, sliding selection) and perf logging, and switching to denim-fabric-topbar. Use before building or changing an app whose frame is the sidebar, adding an application to it, or touching its layout or motion. Pair with denim-fabric's denim-fabric skill and denim's denim-app-shell skill.
license: MIT
---

# The sidebar (denim-fabric-sidebar)

One of denim-fabric's interchangeable bars: a configuration-app layout. It
exports exactly what denim-fabric-topbar exports (`Shell`, the default
export, and everything from denim-fabric and the core), so an app that
switches bars changes one import. Shared pieces (master-detail, the layout
hook, `FullBleed`, theming, Settings, getStyle, Photo) are in denim-fabric's
`denim-fabric` skill.

```tsx
import Shell from './lib/denim-fabric-sidebar';

<Shell
  title="Rig Config"                 // sidebar heading
  settingsSource="server"
  defaultGroup="System"              // heading for apps without `group`
  useAppStatus={useRigStatus}        // optional status-dot hook
  components={{ devices: DevicesAdmin, designer: LayoutDesigner, about: About }}
/>
```

## Applications

- They come from `applications` or `my.applications` (it selects `group
  icon` by default; `applicationFields=""` if the backend lacks them).
  `icon` is a Fluent icon name (`Devices3`, `ContactCard`, `Design`,
  `Info`, ...); without one the item shows the name's first letter.
- Groups keep configured order. The active app's `links` show under it in
  the sidebar, and as touch pills on a phone.
- Status dots: `useAppStatus(app)` (the core's hook prop) or an app's own
  `useReportAppStatus(app.path, status)`.
- There are **no global action buttons**. Each application draws its own
  toolbar inside its content (or its panes). Settings (cross-feature
  preferences only) is in the sidebar footer, under `SidebarFooter`.

## Layouts

- Wide >= 1200px: sidebar, collapsible to an icon rail (remembered per
  browser). Medium >= 700px: icon rail; its menu button opens the full
  sidebar over the content (a Fluent `Panel`). Narrow: drill-in, menu at
  `/` -> app -> detail, each with a back bar. Override with
  `breakpoints={{ medium, wide }}`.
- Content gets 20px padding (12px on a phone, `--denim-content-padding`)
  and scrolls. A component that must fill the area wraps itself in
  `<FullBleed>`; `MasterDetail` does that itself.
- The layout context: `useShellLayout()` has `backBar: true`; MasterDetail
  points the phone back bar at its list while a detail is open
  (`setBack`), and the bar goes up with `goUp` (Back when Back leads
  there).
- `Controls` and `ExternalApps` are the top bar's: accepted and ignored.
- Kiosk routes (`/kiosk/<path>`) render without the sidebar.

## Motion

Brief, `transform`/`opacity` only (README "Motion"): the wide sidebar
slides with the content moving beside it (`SidebarShell/slide.ts`, Web
Animations with the motion tokens; the layout changes once, at the end),
the medium overlay keeps Fluent v8's own Panel slide, one indicator slides
between selected items, and a phone's incoming pane slides in. All off
under "Reduce motion" (the core's device setting) or the OS preference.
`localStorage.debugPerf = '1'` logs every interaction and animation
(README "Measuring its interactions").

Keep the slide cheap: never animate width, margins or `left`; keep the
layout at its start state during a slide and change it once at the end;
the selected items paint no background of their own (the indicator does).

## Touch and keyboard

The rig touchscreen and phones are first-class: keep every control at
least 44px (`TOUCH` in `Sidebar.tsx`), never hide an action behind hover,
and keep a visible `:focus-visible` outline. Use `Link`s for navigation.

## Changing it

- Props first (`title`, `Brand`, `SidebarFooter`, `breakpoints`, `themes`,
  `welcome`).
- Then copy `SidebarShell/` into your app and edit the copy; its parts are
  `index.tsx` (layouts, back bar, pills, the layout context), `Sidebar.tsx`
  (`Sidebar` full / rail / screen, `StatusDot`, styles) and `slide.ts`.
  Import them from the folder (`./lib/denim-fabric-sidebar/SidebarShell/Sidebar`);
  they are not on the package's export surface.
- Merge variant and state classes with `mergeStyles` into ONE class, never
  list two Fluent classes side by side: which wins depends on rule order,
  which a theme change reshuffles.
- Never add a member to `index.ts` alone: the export surface is shared with
  every bar (`parity.check.ts` fails your `tsc`). See `write-a-denim-skin`.

## Switching to the top bar

Clone `denim-fabric-topbar` next to it, change `import Shell from
'./lib/denim-fabric-sidebar'` to `'./lib/denim-fabric-topbar'`, and delete
this folder. Groups, icons and status dots aren't shown there; master-detail
screens and FullBleed apps keep working (MasterDetail draws its own phone
back bar).

## Verify

Drive it with typical-admin-fabric's `playwright-verify` skill at 1400px,
900px and 390px (with `hasTouch`/`isMobile`): the groups, icons and status
dots, a list -> detail -> edit -> save, the phone's drill-in and Back, a
deep link, a non-list app, Settings from the footer, and no console errors.
For motion, also run with `reducedMotion: 'reduce'` (everything instant)
and with CPU throttling and the `debugPerf` logs; slow the animations with
CDP's `Animation.setPlaybackRate` to screenshot them frame by frame.
