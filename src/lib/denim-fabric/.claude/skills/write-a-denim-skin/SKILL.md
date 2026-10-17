---
name: write-a-denim-skin
description: How to write your own skin or bar for Denim's headless core - the five-part contract (splash, theme, chrome from useApplications/useNav, DenimRoutes, Settings from useSettingsForm), splitShellProps, how denim-fabric's bar packages (denim-fabric-topbar, denim-fabric-sidebar) implement it, the export surface every bar shares and its parity check, where shared pieces live (denim-fabric) versus a bar's own, and where a variation belongs (props, a copied bar, a new bar package, or a new UI-kit package). Use before building an app frame in a UI kit other than Fluent, a new layout, a heavily changed copy of a bar, or adding an export to a bar.
license: MIT
---

# Writing a Denim skin or bar

Denim follows the pattern of typical-admin / typical-admin-fabric: a
headless core (`denim`) and a package per UI kit (`denim-fabric` = Fluent
UI, formerly Office UI Fabric). The bars (layouts) are separate packages
named core -> UI kit -> layout, so an app ships only the bar it uses:

```
denim                  headless core: provider, hooks, routes, contract
denim-fabric           shared Fluent pieces; no bar
denim-fabric-topbar    the top bar        (index.ts = shared surface + Shell + roles)
denim-fabric-sidebar   the sidebar        (index.ts = shared surface + Shell + roles)
```

These libraries are cloned or copied side by side so you can overlay them,
or write a skin of your own over the same core.

## Decide where the change goes

1. **A prop** of a bar (`Brand`, `Controls`, `SidebarFooter`,
   `breakpoints`, `themes`, `welcome`, the core's `defaultGroup`,
   `useAppStatus`). Cheapest; try first.
2. **A copied bar**: copy `denim-fabric-topbar/TopBarShell/` or
   `denim-fabric-sidebar/SidebarShell/` into your app (e.g. `src/shell/`),
   fix its relative imports, and change it. You keep denim-fabric (Settings
   dialog, splash, theme, ConfirmDialog, master-detail, the layout hook)
   and the core.
3. **A new Fluent bar**: a package `denim-fabric-<layout>` cloned next to
   denim-fabric, following "The export surface" below.
4. **A new skin package** for another UI kit, named after the kit
   (`denim-<kit>`, with its bars as `denim-<kit>-<layout>` if it has more
   than one), cloned next to `denim`.

Never add markup or a UI-kit import to `denim`; it must stay headless.
Never put a bar into denim-fabric; it holds only what every bar shares.

## Where the pieces live

| Piece | Lives in | Why |
|---|---|---|
| Settings dialog, splash, logo, theme application, palettes, ConfirmDialog | denim-fabric `shared/`, `themes/` | every bar draws them the same |
| `MasterDetail`, `AdminMasterDetail`, `useDetailRoute`, `FullBleed` | denim-fabric `MasterDetail/`, `shared/FullBleed.tsx` | content, not chrome: must work under any bar |
| the layout hook (`ShellLayoutContext`, `useLayout`, `useShellLayout`, breakpoints, `useGoUp`) | denim-fabric `shared/layout.ts` | every bar provides it; content reads it |
| motion (`SlidingIndicator`, `DrillIn`, `ShellMotionProvider`), `debugPerf` | denim-fabric `shared/motion.tsx`, `shared/perf.tsx` | any bar can use them |
| `ShellProps`, the export contract, the role props | denim-fabric `shared/shell.ts`, `shared/barContract.ts` | defined once for every bar |
| the application status dot | denim-fabric `shared/StatusDot.tsx` | both bars draw it (their `StatusDot` role) |
| `getStyle()` and the convenience barrel | denim-fabric `lib/` | compatibility; bars register their own styles into it |
| form styles, `Photo` | typical-admin-fabric `lib/formStyles.ts`, `lib/templates/Photo/` | form pieces, next to the other form components |
| a bar's chrome and its styles | the bar's package | only that bar uses them |

When a bar grows something another bar could use (a hook, a motion, a
component that isn't chrome), move it to denim-fabric rather than copying
it.

## The contract

A shell component takes `ShellProps` (which extends the core's
`DenimShellProps`), splits them with `splitShellProps`, and renders
`<DenimProvider>` around a layout that:

| # | Does | With |
|---|---|---|
| 1 | shows a splash while not ready ("waiting" = backend down, being polled); `RootComponent` stands in for it | `useDenim().status`, `useDenim().RootComponent` |
| 2 | applies the theme in its kit | `useSettings().settings.theme` (`"<mode>-<color>"`, `parseThemeKey`), `.fontSize` |
| 3 | draws chrome, hidden on kiosk routes and landing pages | `useApplications()` (`groups`), `useNav()` (`activeApp`, `activeLink`, `isAppActive`, `isLinkActive`, `appUrl`, `linkUrl`, `showChrome`), `useAppStatus(app)` per nav item |
| 4 | renders the content | `<DenimRoutes wrap={(content, { app, kiosk }) => ...} home? welcome? />` |
| 5 | offers a Settings dialog | `useSettingsForm(isOpen)`: render `general.schema` (a per-form schema) with `general.initialValues` / `general.onChange`, each `tabs[i].Component` (the form's, which tracks mounting, not the app's) with `tabs[i].props`, then `await save()` (true on success; sends only what changed), `saving`, `error`; hold Save while `loading` (open tabs still loading their data) isn't empty |

A Fluent bar also:

- provides `ShellLayoutContext` (`layout` from its `breakpoints`,
  `backBar`, `setBack`, `goUp`). Without a phone back bar of its own, use
  `useSimpleShellLayout(breakpoints)` (`backBar: false`; MasterDetail then
  draws its own). With one, set `backBar: true` and honour `setBack`.
- sets the content CSS variables `FullBleed` reads on the box its pages
  render in: `--denim-content-padding`, or `-inline`/`-block` when the
  sides differ, and `--denim-content-height` when that box has no definite
  height.
- wraps everything in `<ShellMotionProvider>` (reduced motion).

```tsx
export const MyShell: React.FC<ShellProps> = props => {
  const [core, own] = splitShellProps(props);
  return <DenimProvider {...core}><MyLayout {...own} /></DenimProvider>;
};
```

denim's README has a complete plain-HTML skin that type-checks and runs;
start from it, or from a copy of a Fluent bar.

## The export surface (every bar the same)

Interchangeable packages export the same members with the same types, even
though the components differ, so switching is an import-path change. A
Fluent bar's `index.ts` is:

```ts
import { MyShell } from './MyShell';
import { MyBar, MyLinks, MyLink, MyAppPicker } from './MyShell/parts';
import { StatusDot as SharedStatusDot } from '../denim-fabric/shared/StatusDot';
import type { ShellComponent } from '../denim-fabric/shared/shell';
import type {
  AppSwitcherComponent, BarComponent, BarLinkComponent, BarNavComponent, StatusDotComponent,
} from '../denim-fabric/shared/barContract';

export * from '../denim-fabric';               // the shared surface, and the core
export const Shell: ShellComponent = MyShell;  // ShellProps; say which props it ignores
export default Shell;
// The building blocks, under the role names every bar uses:
export const Bar: BarComponent = MyBar;                  // the whole bar
export const BarNav: BarNavComponent = MyLinks;          // an app's links (default the active app's)
export const BarLink: BarLinkComponent = MyLink;         // one link
export const AppSwitcher: AppSwitcherComponent = MyAppPicker;  // choosing an app
export const StatusDot: StatusDotComponent = SharedStatusDot;  // an app's status dot
```

### Role names

Only one bar is used at a time, so its building blocks are exported under
shared ROLE names, not their component names:

| Role | Props (barContract.ts) | Top bar | Sidebar |
|---|---|---|---|
| `Bar` | `BarProps` (`Brand?`, `Controls?`) | `Header` | `Sidebar` |
| `BarNav` | `BarNavProps` (`app?`, `onNavigate?`, `className?`) | `NavBar` | `SidebarLinks` |
| `BarLink` | `BarLinkProps` (`to`, `children`, `active?`, `className?`, `onClick?`) | `HeaderLink` | `SidebarLink` |
| `AppSwitcher` | `AppSwitcherProps` (`onNavigate?`) | `AppNavBar` (waffle panel) | `AppList` (grouped list) |
| `StatusDot` | `StatusDotProps` (`app`) | shared `StatusDot`, in the waffle panel | shared `StatusDot`, beside each app |

- Type each role export with its role's component type (`BarComponent`,
  ...), not the component's own: the parity check compares the types
  exactly, so code using a role works under every bar.
- The component itself may take more props, all optional (the sidebar's
  `variant`, the waffle panel's `isOpen`); a required extra prop makes the
  role assignment fail to compile. The component keeps its own name in the
  bar's folder for those extras.
- A role must work rendered on its own, with only its role's props: give
  extras defaults (the sidebar's `Sidebar` opens a Settings dialog of its
  own without `onOpenSettings`; the top bar's `AppNavBar` draws its own
  waffle button without `isOpen`).
- A new bar provides all five. A role with no natural counterpart still
  gets a sensible component (a plain list of links, the shared dot), never
  an omission.

and its `parity.check.ts` is:

```ts
import type * as Bar from './index';
import type { Assert, MatchesBarExports } from '../denim-fabric/shared/barContract';
export type MyBarExportParity = Assert<MatchesBarExports<typeof Bar>>;
```

`MatchesBarExports` compares the bar's value exports with `BarExports`
(denim-fabric's exports + `BarOwnExports`: `Shell`, `default` and the five
roles), names and types. The app's `tsc` checks it, because the bar sits under `src/`. Type-
only exports are invisible to it; `denim-fabric/scripts/check-bar-parity.mjs
<bar dir>...` compares the full lists (types included) with the
TypeScript compiler, reading the bar-own members from `BarOwnExports`
(it names a missing role export). Run both after any change to a bar's
`index.ts`.

Rules:

- Prop differences go into `ShellProps` (one type for all bars): add an
  optional prop, document which bars use it, and let the others ignore it.
- A new member every bar should have: put it in denim-fabric if it can be
  shared (it reaches every bar through `export *`); otherwise add it to
  `BarOwnExports` and to every bar's `index.ts`, with a sensible default or
  no-op where it doesn't apply.
- A bar's building blocks are on the surface only under their role names
  (above); their component names stay in the bar's folder.
- `ShellProps.Controls` is honoured by every bar, always visible (the top
  bar's header; the sidebar's footer in every variant and the phone's top
  bar). A bar may mount it more than once (the sidebar's rail and panel
  during a slide), so apps keep it presentational.
- Another UI kit's skin defines its own surface the same way (a shared type
  in its shared package), and keeps the same member names as the Fluent
  one where they mean the same thing.

## Styles

Keep a bar's styles in its own package. If old code reads them through
`getStyle()` (the top bar's `navBar`, `headerLink`, ...), register them:
`registerBarStyles(builder)` from `denim-fabric/lib/getStyle`, plus a
`declare module '../../denim-fabric/lib/getStyle' { interface BarStyle
extends MyBarStyle {} }` so they are typed there. A new bar needn't add any.
Merge a component's variant and state classes with `mergeStyles` into one
class; never rely on the order of two Fluent classes (a theme change
reshuffles rules).

## Things the Fluent bars learned (keep them)

- **Theme timing** (Fluent): `loadTheme` mutates a global without
  re-rendering; apply it in a layout effect and force one more render
  (`shared/theme.tsx`'s `useFluentTheme`). Other kits with context-based
  theming don't need this.
- **Stable component types**: never define a component inside render (a
  new type every render remounts its subtree, losing state and flashing
  blank pages). The core keys each app route by `app.path`.
- **Selection in the URL**: put master-detail selection in the path, so
  deep links and Back work; read it with a `useDetailRoute`-style helper
  (`useParams()['*']` under the app's `/*` route).
- **Phone back bar**: make "up" the browser's Back when Back leads to the
  same place (`useGoUp`), else a push, so history doesn't pile up.
- **Touch**: 44px targets, no hover-only controls, a visible
  `:focus-visible` outline.
- **No global action buttons**: apps own their toolbars.
- **Settings are global preferences**; app config stays in the app.
- **Motion that stays cheap**: animate `transform`/`opacity` of one element,
  never layout; keep the layout at its start state during a slide and
  change it once at the end. Without GPU compositing (WebKitGTK) every
  frame repaints what moves. A sliding selection is one indicator element
  and the items paint no selected background (not even hovered), or two
  highlights show mid-slide. Turn everything off while
  `useReducedMotion()` is true. (The sidebar's `SidebarShell/slide.ts` and
  denim-fabric's `shared/motion.tsx`.)

## Verify

Type-check under Vite's strict `tsconfig` with the libraries side by side
(this runs every bar's `parity.check.ts`), run
`check-bar-parity.mjs` over the bars you have, then drive it in headless
Chromium (typical-admin-fabric's `playwright-verify` skill) at desktop,
tablet and phone widths: nav, a deep link, Back, the Settings dialog with an
extension tab, a MasterDetail screen and a FullBleed app under your bar, and
no console errors. Switching an app between two bars must need only the
import change.
