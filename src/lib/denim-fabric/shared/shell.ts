// The props every Fluent bar takes, defined once so the bars are
// interchangeable: denim-fabric-topbar and denim-fabric-sidebar both export
// `Shell: React.FC<ShellProps>`, and switching between them is an import
// path change. A prop a bar has no place for is accepted and ignored (each
// prop says which bars use it).
import type React from 'react';
import type { DenimShellProps } from '../../denim';
import type { ThemeBuilder } from '../themes';
import type { IconProps } from './Logo';
import type { IBreakpoints } from './layout';

/**
 * Props a bar passes to your `Brand`. `className` styles the brand's root
 * (the logo's size in the top bar; the whole link in the sidebar). The
 * sidebar passes the app title as `children`, so your link wraps the logo and
 * the title as one tap target: render `children` inside it.
 */
export interface BrandProps {
  className?: string;
  /** The sidebar's title, to render inside the brand link (absent in the top bar). */
  children?: React.ReactNode;
  /** Sizes the logo when `className` styles the whole link (sidebar). */
  logoClassName?: string;
}

export interface ShellProps extends DenimShellProps {
  /** Theme builders keyed `<mode>-<color>` plus `default`. Defaults to THEMES. (all bars) */
  themes?: Record<string, ThemeBuilder>;
  /** Splash-screen logo. (all bars) */
  Logo?: React.FC<IconProps>;
  /** Your product's icon: next to the waffle button (top bar); in the sidebar it receives the title as `children`, so logo and title are one link. */
  Brand?: React.FC<BrandProps>;
  /** Your product's name, at the top of the sidebar. (sidebar; the top bar shows the active app's name instead) */
  title?: string;
  /**
   * Always-visible app controls (a status light, a connect button). (all bars)
   * Top bar: the right side of the header; on narrow screens clicking it
   * also opens the link menu. Sidebar: the sidebar's footer (full sidebar,
   * icon rail and the phone's menu screen) and the right end of the phone's
   * top bar. Keep it small and presentational: a bar may mount it more than
   * once at a time (the sidebar's rail and panel during a slide), so put
   * side effects (subscriptions, mutations) elsewhere and share state
   * through context.
   */
  Controls?: React.FC<any>;
  /** Extra content at the top of the waffle panel. (top bar) */
  ExternalApps?: React.FC<any>;
  /** Extra content in the sidebar footer, above Settings. (sidebar) */
  SidebarFooter?: React.FC<any>;
  /**
   * Layout breakpoints in px, default `{ medium: 700, wide: 1200 }`: the
   * sidebar's wide/medium/phone layouts, and under any bar the layout that
   * MasterDetail and `useLayout()` see. (all bars)
   */
  breakpoints?: IBreakpoints;
  /** The `/` page when there is no RootComponent and no launch page. (all bars) */
  welcome?: React.ReactNode;
}

/** A bar's shell component. */
export type ShellComponent = React.FC<ShellProps>;
