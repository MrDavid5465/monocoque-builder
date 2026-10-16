// The export surface every Fluent bar package has, defined once.
//
// A bar package's index.ts is exactly:
//
//   export * from '../denim-fabric';     // the shared surface (and the core)
//   export const Shell: ShellComponent;  // its shell
//   export default Shell;
//
// so denim-fabric-topbar and denim-fabric-sidebar export the same members
// with the same types, and switching bars is an import-path change. Each
// bar has a `parity.check.ts` that compares its index with BarExports and
// fails to type-check when they differ; denim-fabric's
// `scripts/check-bar-parity.mjs` compares the bars' full export lists
// (types included) with each other.
//
// A bar's own building blocks (Header, Sidebar, ...) are not on the surface:
// import them from the bar's folder (`denim-fabric-topbar/TopBarShell/Header`)
// when you copy or vary that bar. A member every bar should have goes into
// denim-fabric (shared) or into BarOwnExports below, and into every bar.
import type * as Shared from '../index';
import type { ShellComponent } from './shell';

/** What a bar adds to the shared surface. */
export interface BarOwnExports {
  /** The bar's shell. */
  Shell: ShellComponent;
  /** The same shell, as the default export. */
  default: ShellComponent;
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
