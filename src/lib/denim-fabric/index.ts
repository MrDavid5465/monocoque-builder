// denim-fabric: the Denim app shell rendered with Fluent UI v8 (formerly
// Office UI Fabric). Two layouts over the headless core in ../denim:
// TopBarShell (the original header + waffle look) and SidebarShell (grouped
// sidebar, optional master-detail). See README and .claude/skills/.
import { TopBarShell } from './TopBarShell';

// Everything from the core, so one import serves an app.
export * from '../denim';

// Shells
export { TopBarShell };
export type { TopBarShellProps } from './TopBarShell';
export { SidebarShell } from './SidebarShell';
export type { SidebarShellProps } from './SidebarShell';
export default TopBarShell;

// TopBarShell's pieces, for a variation of it
export { Header } from './TopBarShell/Header';
export type { HeaderProps } from './TopBarShell/Header';
export { HeaderLink } from './TopBarShell/HeaderLink';
export { NavBar } from './TopBarShell/NavBar';
export { AppNavBar } from './TopBarShell/AppNavBar';

// SidebarShell's pieces and the master-detail pattern
export { Sidebar, StatusDot } from './SidebarShell/Sidebar';
export type { SidebarProps, SidebarVariant } from './SidebarShell/Sidebar';
export { FullBleed } from './SidebarShell/FullBleed';
export {
  useShellLayout,
  useBreakpoint,
  layoutFor,
  DEFAULT_BREAKPOINTS,
  ShellLayoutContext,
} from './SidebarShell/layout';
export type { ShellLayout, IBreakpoints, IBackTarget, IShellLayoutContext } from './SidebarShell/layout';
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
export { default as light } from './lib/light';
export { default as dark } from './lib/dark';
export { getStyle, useCurrentApp } from './lib';
export { default as styles } from './lib/getStyle';
