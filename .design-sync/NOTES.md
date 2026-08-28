# design-sync notes — denim design system

## Why this lives in the app repo, not in denim

The design system is three libraries — `denim`, `typical-admin-fabric`,
`typical-admin` — consumed as **source** (git submodules under an app's
`src/lib/`), not as built npm packages. They have no `dist`, so there is no
package entry to bundle; `.design-sync/ds-entry.tsx` is a hand-written barrel
that names the public surface (packaging only, no reimplementation).

They are also **not independently buildable**. Two spots reach out of the
libraries into the consuming app:

- `denim/components/Header/AppNavBar` → `Settings/` → the app's `themes`,
  `graphql/client`, and four `Telemetry/*` query modules.
- `typical-admin-fabric/lib/templates/Fabric` → the app's
  `components/shared/TyreGrid` (the `tyre-position` field type).

Their relative paths (`../../../../../graphql/client`) only resolve when the
libraries sit at `<app>/src/lib/*`. A standalone workspace was tried first
(`/home/david/source/repos/denim-ds`, three GitHub clones as siblings) and the
build failed on exactly those imports. Building from the app is what keeps the
bundle honest — every card is the component the app really renders.

**If the libraries are ever decoupled**, this config and entry can move to the
denim repo. The prerequisite is extracting `per-form` to its own repo (it is
fully self-contained and all three libraries depend on it) and making
TyreGrid/Settings injectable rather than imported.

## Repo layout facts

- The three libraries were migrated to GitHub this session
  (`MrDavid5465/{denim,typical-admin-fabric,typical-admin}`), full Azure DevOps
  history preserved, plus one catch-up commit each bringing them up to the
  vendored copy in this app. The standalone `~/source/repos/denim` and
  `~/source/repos/typiql-admin-fabric` are **unwired create-react-library
  scaffolds** — not the real code, don't sync from them.
- `Admin` (`denim/components/Admin`) is abandoned — a UI for configuring
  applications/permissions, superseded by configuring that from code. Its file
  is entirely commented out. Excluded from the surface.
- `typical-admin-fabric` ships **two** components named `List`: the
  presentational `lib/List.tsx` and the Apollo-bound CRUD screen `List.tsx`.
  The presentational one keeps the `List` name (it's the reusable primitive);
  the CRUD screen is exported as `ListScreen`.

## ReactiveAdmin is the composition unit

`typical-admin-fabric`'s default export **is** ReactiveAdmin — app screens do
`import ReactiveAdmin from '.../typical-admin-fabric'`. `Create`/`Show`/
`Update`/`ListScreen` are the **dispatcher slots** it fills internally, reached
directly only when overriding one via the `components` prop. They are exported
and carded so override work is possible, but the primary card is
ReactiveAdmin itself. The templates (`Form`, `FormCard`, `ThumbnailCard`,
`List`, `ListControls`) are equally first-class **standalone** — usable
directly when a CRUD interface isn't needed.

## Build gotchas

- **Prop extraction fails for every component** — ts-morph yields
  `[key: string]: unknown` because the props interfaces are local, non-exported
  `interface Props` (and `Form`'s is generic, `Props<T>`). Fixed with
  hand-written `cfg.dtsPropsFor` bodies for all 24, transcribed from the real
  source interfaces including their doc comments. **Re-check these whenever a
  component's props change** — they're hand-maintained and will silently rot.
  `ButtonDropdown`, `Fabric`, `Photo` are genuinely `React.FC<any>` upstream,
  so their bodies are best-effort from the destructured params.
- **Previews need three contexts**, supplied by `DesignPreviewShell` in the
  entry (wired via `cfg.provider`): Fluent `ThemeProvider` with denim's own
  light palette, `MemoryRouter` (Header/Links/ReactiveAdmin routes call router
  hooks that throw outside one), and Apollo `MockedProvider` with no mocks so
  data-bound screens sit in a loading state instead of crashing.
- **Apollo v4 moved `MockedProvider`** to `@apollo/client/testing/react`; it is
  *not* in `@apollo/client/testing` (which now only has MockLink,
  MockSubscriptionLink, realisticDelay).
- Styling is Fluent **CSS-in-JS** — there is no static stylesheet to point
  `cfg.cssEntry` at. The bundle self-styles; the theme arrives via the
  provider. `tokens: 6 defined, 6 referenced` is expected, not a shortfall.
- esbuild's postinstall is blocked by this environment's script policy but the
  binary still resolves — no action needed.
- playwright 1.61.1 (repo pin) matches the cached `chromium-1228`, so the
  render check works with no extra install.

## Known render warns (triaged, expected)

- `[RENDER_BLANK]` on `Fabric`, `FormCard`, `HeaderLink`, `ThumbnailCard` and
  `[RENDER_THIN]` on `Logo` — all fired **before** their previews were
  authored; they are wrappers that paint nothing without children. Re-check
  only if they persist after authoring.

## States that can't render statically

- `Form` validation errors: per-form surfaces them only after a field is
  touched or submitted, so no static preview can show the error styling. The
  `NewRecord` cell renders the blank required field without an error, which is
  the honest still-frame. **`Fabric` is the exception** — it takes `errors` as
  a direct prop, so its `WithValidationError` cell does show the error text.
- `Photo`'s crop view and empty drop tile: both driven by internal state set
  during a real file drop, not by props.
- `ListControls`' column-picker panel, `Prompt`/`ConfirmDialogHost` before
  they're opened, `Delete`'s confirmation, and `Header`'s application nav
  (behind the waffle/hamburger panel — which is why there is no populated-vs-
  empty applications cell; they render identically).

## Re-sync risks

- `cfg.dtsPropsFor` is hand-written for all 24 components. It is the design
  agent's API contract and it does **not** track source changes — if a
  component gains or renames a prop, the contract silently lies. Re-read the
  source interfaces on any re-sync that follows library changes.
- `.design-sync/ds-entry.tsx` hardcodes paths into `src/lib/*`. Moving or
  renaming a component file breaks the build loudly (good), but *deleting* an
  export just drops it from the surface silently.
- The preview compositions were ported from this app's own screens
  (`CarsAdmin`, the ambient-lighting settings panel). If those screens change
  shape, the previews still render — they're independent copies — but they
  stop being representative.
- The bundle inlines 40 npm packages including all of Fluent UI (~2.6 MB).
  That's expected for a CSS-in-JS DS, not a misconfiguration.


## Preview-authoring gotchas (each one cost a rebuild cycle)

- **Router instance.** The bundle inlines its own react-router. A preview that
  imports `react-router-dom` itself creates a SECOND React context and
  `useParams` returns nothing inside bundled components. Import
  `Routes`/`Route`/`useNavigate` from the bundle instead — the entry
  re-exports them for this. (Apollo is immune: it caches its context on a
  global, so a preview's own `MockedProvider` does reach bundled components.)
- **Never nest a Router.** react-router throws on a `<Router>` inside a
  `<Router>`, and the card renders blank with the error swallowed. The preview
  shell already provides one — navigate within it (`useNavigate`) and match
  with `Routes`/`Route`. See the `AtRoute` helper in Show/Update/Links.
- **Entry changes need a FULL `package-build.mjs`.** `preview-rebuild.mjs`
  only recompiles previews; a new entry export won't be on `window.Denim` and
  you'll get `X is not a function` at runtime.
- **`package-capture.mjs --components X` prunes review sheets outside its
  scope.** Re-capture a component before grading it if an unrelated scoped run
  has happened since.
- **`Photo`'s `image` prop is raw base64**, not a data URI — it prepends the
  `data:image/png;base64,` prefix itself. A data URI renders a broken image.
- **`ListControls.customButtons`** are `{key, label, icon, onClick}` with
  `icon` a Fluent icon name. `{text, onClick}` renders an invisible button.
- **Components that need a frame.** `ListControls` is `position: absolute`
  (needs a relative ancestor) and `HeaderLink` renders white text for the
  theme-blue bar. Preview them inside a stand-in frame or they read as loose
  icons / invisible text.
- **Card-mode overrides** are set for `Header`, `Prompt`, `Denim` (portal or
  fixed positioning -> `single`) and `HeaderLink`, `ListControls` (wider than a
  grid cell -> `column`). Validate prescribes these; don't re-derive them.

## Cost note for the next run

Authoring + grading 24 components was done sequentially in the main agent
context (reading every review sheet inline), which is token-expensive. The
skill's intended path is to fan the authoring out over subagents after a
2-3 component solo calibration. If a future run is allowed to spawn
subagents, do that — the solo learnings above are exactly what belongs in
their batch prompt.
