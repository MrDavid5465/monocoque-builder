// Design-system entry for claude.ai/design.
//
// PACKAGING ONLY — every export below re-exports the real shipped component
// from the vendored libraries under src/lib/. Nothing here reimplements a
// component.
//
// Why this file exists, and why it lives in the app rather than in the denim
// repo: denim, typical-admin-fabric and typical-admin are consumed as source
// (git submodules under an app's src/lib/), not as built npm packages, so
// there is no dist entry to bundle. They are also not independently
// buildable — two spots reach into the consuming app:
//
//   * denim/components/Header/AppNavBar -> Settings/ -> the app's `themes`,
//     `graphql/client`, and several `Telemetry/*` query modules
//   * typical-admin-fabric/lib/templates/Fabric -> the app's
//     `components/shared/TyreGrid` (the `tyre-position` field type)
//
// Those imports resolve only when the libraries sit at <app>/src/lib/*, so
// the app is the only place the real components can be bundled without
// stubbing them out. Building here keeps the bundle honest: every card is the
// component the app actually renders. If the libraries are ever decoupled
// (and per-form extracted to its own repo — it is self-contained and all
// three libraries depend on it), this entry and its config can move to denim.
//
// Naming note: typical-admin-fabric ships TWO components called `List` — the
// presentational one (lib/List) and the Apollo-bound CRUD screen (List.tsx).
// The presentational one keeps the plain `List` name because it's the
// reusable primitive; the CRUD screen is exposed as `ListScreen`.

import * as React from 'react';
import { ThemeProvider, createTheme } from '@fluentui/react';
import { MemoryRouter } from 'react-router-dom';
import { MockedProvider } from '@apollo/client/testing/react';
import lightPalette from '../src/lib/denim/lib/light';
import darkPalette from '../src/lib/denim/lib/dark';

// ---------------------------------------------------------------------------
// Standalone primitives — usable directly when a CRUD interface/ReactiveAdmin
// is not needed.
// ---------------------------------------------------------------------------
export { default as Form } from '../src/lib/typical-admin-fabric/lib/templates/Form';
export { default as FormCard } from '../src/lib/typical-admin-fabric/lib/templates/FormCard';
export { default as ThumbnailCard } from '../src/lib/typical-admin-fabric/lib/templates/ThumbnailCard';
export { default as List } from '../src/lib/typical-admin-fabric/lib/List';
export { default as ListControls } from '../src/lib/typical-admin-fabric/lib/ListControls';
export { default as Prompt } from '../src/lib/typical-admin-fabric/Prompt';
export { default as Fabric } from '../src/lib/typical-admin-fabric/lib/templates/Fabric';

export { ButtonDropdown } from '../src/lib/denim/lib/ButtonDropdown';
export { ConfirmDialogHost, confirmAsync } from '../src/lib/denim/components/ConfirmDialog';
export { default as Splashscreen } from '../src/lib/denim/components/Splashscreen';
export { default as Photo } from '../src/lib/denim/components/Photo';
export { default as Logo } from '../src/lib/denim/logo';

// ---------------------------------------------------------------------------
// Chrome — needs a router in scope.
// ---------------------------------------------------------------------------
export { Header } from '../src/lib/denim/components/Header';
export { HeaderLink } from '../src/lib/denim/components/Header/lib/HeaderLink';

// ---------------------------------------------------------------------------
// ReactiveAdmin: the composition unit. An app renders ONE of these with a
// dispatcher + schemaDefinition and gets the whole list/show/new/edit router.
// The slot components below are what it fills those routes with — exported
// because the `components` override contract lets a screen replace one slot
// while the rest stay generated.
// ---------------------------------------------------------------------------
export { default as ReactiveAdmin } from '../src/lib/typical-admin-fabric';

export { default as ListScreen } from '../src/lib/typical-admin-fabric/List';
export { default as Create } from '../src/lib/typical-admin-fabric/Create';
export { default as Update } from '../src/lib/typical-admin-fabric/Update';
export { default as Show } from '../src/lib/typical-admin-fabric/Show';
export { default as Delete } from '../src/lib/typical-admin-fabric/Delete';
export { default as Links } from '../src/lib/typical-admin-fabric/Links';
export { default as CardList } from '../src/lib/typical-admin-fabric/CardList';
export { default as SwitchableList } from '../src/lib/typical-admin-fabric/SwitchableList';

// The full application shell: theme + header + routed applications.
export { default as Denim } from '../src/lib/denim/components';
// denim's own gql documents (my/updateSettings/getFile/upload). Exported so a
// preview can mock the exact `my` query the shell fetches — MockedProvider
// matches on document identity, so an equivalent hand-written query would not
// match.
export { default as denimDispatcher } from '../src/lib/denim/lib/queries';

// ---------------------------------------------------------------------------
// Preview harness (cfg.provider). Not a design-system component — it supplies
// the three contexts these components read from, so preview cards render the
// way they do inside a real app:
//   * ThemeProvider — denim's own light palette + font scale. Without it every
//     component falls back to stock Fluent and the cards misrepresent the DS.
//   * MemoryRouter  — Header/HeaderLink/Links and every ReactiveAdmin route
//     call react-router hooks that throw outside a router.
//   * MockedProvider — Apollo with no mocks: components that fire a query get
//     a permanent loading state rather than a crash, which is the honest
//     still-frame for a data-bound screen.
// ---------------------------------------------------------------------------
// Router primitives, re-exported so previews can put themselves on a route
// that carries params (e.g. `/cars/:id/show` for the Show slot). Two rules
// they exist to satisfy:
//
//  1. They MUST come from the bundle, not a preview's own import of
//     react-router-dom. The bundle inlines its own react-router copy, and a
//     second copy is a second React context — `useParams` inside a bundled
//     component would see no params at all. (Apollo is immune to this: it
//     caches its context on a global, so a preview's own MockedProvider does
//     reach bundled components.)
//  2. A preview must NOT wrap itself in another MemoryRouter — react-router
//     throws on a Router nested inside a Router, which renders the card
//     blank. Navigate within the shell's router instead; `useNavigate` is
//     exported for exactly that.
export { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';

// Theming, re-exported so a design built with this system can apply denim's
// own palette. There is no CSS class or custom-property vocabulary to reach
// for — Fluent is CSS-in-JS, so the design language lives in this theme
// object (palette + font ramp) and in each component's props.
//
// NOTE: do not confuse this with the exported `Fabric` component. In denim's
// own lib, `Fabric` is an alias for Fluent's ThemeProvider — but the `Fabric`
// exported HERE is typical-admin-fabric's per-form field renderer, which is a
// different thing entirely.
export { ThemeProvider, getTheme, useTheme } from '@fluentui/react';

export const lightTheme = createTheme(lightPalette(1) as any);
export const darkTheme = createTheme(darkPalette(1) as any);

export const DesignPreviewShell: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <MockedProvider mocks={[]}>
    <MemoryRouter initialEntries={['/']}>
      <ThemeProvider theme={lightTheme} applyTo="none">
        {children}
      </ThemeProvider>
    </MemoryRouter>
  </MockedProvider>
);
