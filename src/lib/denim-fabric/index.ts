// denim-fabric: the shared Fluent UI v8 (formerly Office UI Fabric) pieces
// of the Denim app shell, over the headless core in ../denim. It has no bar
// of its own: an app adds one bar package beside it, denim-fabric-topbar
// (header + waffle panel) or denim-fabric-sidebar (grouped sidebar), and
// ships only that one. Both bars re-export everything here. See README and
// .claude/skills/.

// Everything from the core, so one import serves an app.
export * from '../denim';

// The bars' shared props and export surface (the role exports' props too)
export type { ShellProps, ShellComponent } from './shared/shell';
export type {
  BarOwnExports,
  BarExports,
  BarProps,
  BarNavProps,
  BarLinkProps,
  AppSwitcherProps,
  StatusDotProps,
  BarComponent,
  BarNavComponent,
  BarLinkComponent,
  AppSwitcherComponent,
  StatusDotComponent,
} from './shared/barContract';

// Layout, under any bar
export {
  useShellLayout,
  useLayout,
  useBreakpoint,
  useGoUp,
  useSimpleShellLayout,
  layoutFor,
  DEFAULT_BREAKPOINTS,
  ShellLayoutContext,
} from './shared/layout';
export type { ShellLayout, IBreakpoints, IBackTarget, IShellLayoutContext } from './shared/layout';
export { FullBleed } from './shared/FullBleed';

// The master-detail pattern
export { MasterDetail } from './MasterDetail/MasterDetail';
export type { MasterDetailProps } from './MasterDetail/MasterDetail';
export { AdminMasterDetail } from './MasterDetail/AdminMasterDetail';
export type { AdminMasterDetailProps } from './MasterDetail/AdminMasterDetail';
export { useDetailRoute, ADMIN_DETAIL_PATTERNS } from './MasterDetail/useDetailRoute';
export type { IDetailRoute } from './MasterDetail/useDetailRoute';

// Shared Fluent pieces
export { SettingsDialog } from './shared/SettingsDialog';
export type { SettingsDialogProps } from './shared/SettingsDialog';
export { Splash } from './shared/Splash';
export type { SplashProps } from './shared/Splash';
export { applyTheme, useFluentTheme, FluentThemeRoot, setFaviconColor } from './shared/theme';
export { confirmAsync, ConfirmDialogHost } from './shared/ConfirmDialog';
export type { ConfirmOptions } from './shared/ConfirmDialog';
export { default as Logo } from './shared/Logo';
export type { IconProps } from './shared/Logo';
export { default as Photo } from './Photo';
export { ShellMotionProvider, SlidingIndicator, DrillIn } from './shared/motion';
export type { SlidingIndicatorProps, DrillInProps } from './shared/motion';
export { perfEnabled, perfStart, perfAnimStart, perfAnimEnd, perfMotionProps } from './shared/perf';

// Fluent themes for the core's theme keys
export { THEMES, buildTheme, PALETTES } from './themes';
export type { ThemeBuilder } from './themes';

// getStyle() and its builder (shared + form + the bar's styles)
export { getStyle, useCurrentApp } from './lib';
export { default as styles, sharedStyles, registerBarStyles } from './lib/getStyle';
export type { Style, SharedStyle, BarStyle } from './lib/getStyle';
