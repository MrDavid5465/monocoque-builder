---
name: write-a-denim-skin
description: How to write your own skin (UI-kit package or layout) for Denim's headless core - the five-part contract (splash, theme, chrome from useApplications/useNav, DenimRoutes, Settings from useSettingsForm), splitShellProps, how denim-fabric's TopBarShell and SidebarShell implement it, and where a variation belongs (props, a copied shell, or a new package named after its UI kit). Use before building an app frame in a UI kit other than Fluent, a new layout, or a heavily changed copy of TopBarShell/SidebarShell.
license: MIT
---

# Writing a Denim skin

Denim follows the pattern of typical-admin / typical-admin-fabric: a
headless core (`denim`) and a package per UI kit (`denim-fabric` = Fluent
UI, formerly Office UI Fabric). Layouts live inside the UI-kit package.
These libraries are cloned or copied side by side so you can overlay them,
or write a skin of your own over the same core.

## Decide where the change goes

1. **A prop** of an existing shell (`Brand`, `Controls`, `SidebarFooter`,
   `breakpoints`, `themes`, `welcome`, the core's `defaultGroup`,
   `useAppStatus`). Cheapest; try first.
2. **A copied shell**: copy `denim-fabric/TopBarShell/` or `SidebarShell/`
   into your app (e.g. `src/shell/`), fix its relative imports, and change
   it. You keep `shared/` (Settings dialog, splash, theme, ConfirmDialog)
   and the core.
3. **A new skin package** for another UI kit, named after the kit
   (`denim-<kit>`), cloned next to `denim`. Layouts go inside it as
   components, never as separate packages.

Never add markup or a UI-kit import to `denim`; it must stay headless.

## The contract

A shell component takes `DenimShellProps` plus its own props, splits them
with `splitShellProps`, and renders `<DenimProvider>` around a layout that:

| # | Does | With |
|---|---|---|
| 1 | shows a splash while not ready ("waiting" = backend down, being polled); `RootComponent` stands in for it | `useDenim().status`, `useDenim().RootComponent` |
| 2 | applies the theme in its kit | `useSettings().settings.theme` (`"<mode>-<color>"`, `parseThemeKey`), `.fontSize` |
| 3 | draws chrome, hidden on kiosk routes and landing pages | `useApplications()` (`groups`), `useNav()` (`activeApp`, `activeLink`, `isAppActive`, `isLinkActive`, `appUrl`, `linkUrl`, `showChrome`), `useAppStatus(app)` per nav item |
| 4 | renders the content | `<DenimRoutes wrap={(content, { app, kiosk }) => ...} home? welcome? />` |
| 5 | offers a Settings dialog | `useSettingsForm(isOpen)`: render `general.schema` (a per-form schema) with `general.initialValues` / `general.onChange`, each `tabs[i].Component` with `tabs[i].props`, then `await save()` (true on success), `saving`, `error` |

```tsx
export function MyShell(props: DenimShellProps & { title?: string }) {
  const [core, own] = splitShellProps(props);
  return <DenimProvider {...core}><MyLayout {...own} /></DenimProvider>;
}
```

denim's README has a complete plain-HTML skin that type-checks and runs;
start from it, or from a copy of a Fluent shell.

## Things the Fluent shells learned (keep them)

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
  same place (SidebarShell's `useGoUp`), else a push, so history doesn't
  pile up.
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
  `useReducedMotion()` is true. (SidebarShell's `slide.ts` and
  `shared/motion.tsx`.)

## Verify

Type-check under Vite's strict `tsconfig` with the libraries side by side,
then drive it in headless Chromium (typical-admin-fabric's
`playwright-verify` skill) at desktop, tablet and phone widths: nav, a deep
link, Back, the Settings dialog with an extension tab, and no console
errors.
