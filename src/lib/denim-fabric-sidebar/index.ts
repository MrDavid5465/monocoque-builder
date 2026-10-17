// denim-fabric-sidebar: the sidebar for denim-fabric (Fluent UI v8), a
// configuration-app layout: applications grouped under headings with icons
// and status dots, the app's Controls and Settings in the sidebar footer,
// wide / medium / phone layouts, touch-friendly, with brief motion.
//
// The export surface is the same as every other bar's (denim-fabric's
// shared/barContract.ts): everything from denim-fabric (and so the core),
// `Shell` and the default export, and the bar's building blocks under the
// shared role names (Bar, BarNav, BarLink, AppSwitcher, StatusDot), each
// typed with the role's shared props. Switching to denim-fabric-topbar is
// an import-path change. parity.check.ts keeps it that way.
//
// The components keep their own names in SidebarShell/Sidebar.tsx (Sidebar,
// SidebarLinks, SidebarLink, AppList, StatusDot), with their extra props.
import { SidebarShell } from './SidebarShell';
import { AppList, Sidebar, SidebarLink, SidebarLinks } from './SidebarShell/Sidebar';
import { StatusDot as SharedStatusDot } from '../denim-fabric/shared/StatusDot';
import type { ShellComponent } from '../denim-fabric/shared/shell';
import type {
  AppSwitcherComponent,
  BarComponent,
  BarLinkComponent,
  BarNavComponent,
  StatusDotComponent,
} from '../denim-fabric/shared/barContract';

export * from '../denim-fabric';

/** The sidebar shell (ShellProps; ignores `ExternalApps`). */
export const Shell: ShellComponent = SidebarShell;
export default Shell;

/** The bar: the full sidebar (`Sidebar`), with Settings in its footer. */
export const Bar: BarComponent = Sidebar;
/** An application's links, as listed under it (`SidebarLinks`). */
export const BarNav: BarNavComponent = SidebarLinks;
/** One link under an application (`SidebarLink`). */
export const BarLink: BarLinkComponent = SidebarLink;
/** The grouped application list (`AppList`). */
export const AppSwitcher: AppSwitcherComponent = AppList;
/** An application's status dot, as drawn beside it in the sidebar. */
export const StatusDot: StatusDotComponent = SharedStatusDot;
