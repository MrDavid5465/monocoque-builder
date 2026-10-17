// The export surface every Fluent bar package has, defined once.
//
// A bar package's index.ts is exactly:
//
//   export * from '../denim-fabric';     // the shared surface (and the core)
//   export const Shell: ShellComponent;  // its shell
//   export default Shell;
//   export const Bar: BarComponent;      // its building blocks, under the
//   export const BarNav: ...             // role names below
//
// so denim-fabric-topbar and denim-fabric-sidebar export the same members
// with the same types, and switching bars is an import-path change. Each
// bar has a `parity.check.ts` that compares its index with BarExports and
// fails to type-check when they differ; denim-fabric's
// `scripts/check-bar-parity.mjs` compares the bars' full export lists
// (types included) with each other and with BarOwnExports.
//
// ROLE NAMES. Only one bar is used at a time, so a bar's building blocks are
// exported under the same role names whatever the components are called:
//
//   role         top bar                         sidebar
//   Bar          Header                          Sidebar
//   BarNav       NavBar (the app's links)        SidebarLinks (links under the active app)
//   BarLink      HeaderLink                      SidebarLink
//   AppSwitcher  AppNavBar (the waffle panel)    AppList (the grouped app list)
//   StatusDot    StatusDot (in the waffle panel) StatusDot (beside each app)
//
// Each role export is typed with the shared props below (exactly), so code
// written against a role works under every bar. A component may take more
// (optional) props than its role's; use its own name, from the bar's folder,
// for those (`denim-fabric-topbar/TopBarShell/Header`, ...). A future bar
// must provide all five.
import type React from 'react';
import type * as Shared from '../index';
import type { IApplication } from '../../denim';
import type { ShellComponent, BrandProps } from './shell';

/** `Bar`: the whole bar (the top bar's header, the sidebar). */
export interface BarProps {
  /** Your product's icon (and, in the sidebar, the link around the title: see BrandProps). */
  Brand?: React.FC<BrandProps>;
  /** Always-visible app controls (ShellProps.Controls). */
  Controls?: React.FC<any>;
}

/** `BarNav`: the links of one application (default: the active one). */
export interface BarNavProps {
  /** Whose links; default the active application. */
  app?: IApplication;
  /** Called after a link is chosen (closes a menu or an overlay). */
  onNavigate?: () => void;
  className?: string;
}

/** `BarLink`: one navigation link. */
export interface BarLinkProps {
  to: string;
  children: React.ReactNode;
  /** Drawn as the current page (and `aria-current="page"`). */
  active?: boolean;
  className?: string;
  onClick?: () => void;
}

/** `AppSwitcher`: choosing an application. */
export interface AppSwitcherProps {
  /** Called after an application or link is chosen. */
  onNavigate?: () => void;
}

/** `StatusDot`: an application's status (the core's useAppStatus). */
export interface StatusDotProps {
  app: IApplication;
}

export type BarComponent = React.FC<BarProps>;
export type BarNavComponent = React.FC<BarNavProps>;
export type BarLinkComponent = React.FC<BarLinkProps>;
export type AppSwitcherComponent = React.FC<AppSwitcherProps>;
export type StatusDotComponent = React.FC<StatusDotProps>;

/** What a bar adds to the shared surface: its shell and its role exports. */
export interface BarOwnExports {
  /** The bar's shell. */
  Shell: ShellComponent;
  /** The same shell, as the default export. */
  default: ShellComponent;
  /** The bar itself. */
  Bar: BarComponent;
  /** An application's links. */
  BarNav: BarNavComponent;
  /** One link. */
  BarLink: BarLinkComponent;
  /** Choosing an application. */
  AppSwitcher: AppSwitcherComponent;
  /** An application's status dot. */
  StatusDot: StatusDotComponent;
}

/** A bar package's complete value exports. */
export type BarExports = typeof Shared & BarOwnExports;

/** True when A and B are the same type. */
export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails to compile unless T is true. */
export type Assert<T extends true> = T;

/** True when every member of T is true. */
export type AllTrue<T> = false extends T[keyof T] ? false : true;

/**
 * True when module M (`typeof import('./index')`) exports exactly the
 * members of BarExports, each with the same type.
 */
export type MatchesBarExports<M> = Equal<keyof M, keyof BarExports> extends true
  ? AllTrue<{ [K in keyof BarExports]: K extends keyof M ? Equal<M[K], BarExports[K]> : false }>
  : false;
