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

export interface ShellProps extends DenimShellProps {
  /** Theme builders keyed `<mode>-<color>` plus `default`. Defaults to THEMES. (all bars) */
  themes?: Record<string, ThemeBuilder>;
  /** Splash-screen logo. (all bars) */
  Logo?: React.FC<IconProps>;
  /** Your product's icon: next to the waffle button (top bar), next to the title (sidebar). */
  Brand?: React.FC<any>;
  /** Your product's name, at the top of the sidebar. (sidebar; the top bar shows the active app's name instead) */
  title?: string;
  /** Right side of the header; on narrow screens it also opens the link menu. (top bar) */
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
