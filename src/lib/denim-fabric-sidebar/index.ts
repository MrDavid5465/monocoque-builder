// denim-fabric-sidebar: the sidebar for denim-fabric (Fluent UI v8), a
// configuration-app layout: applications grouped under headings with icons
// and status dots, Settings in the sidebar footer, wide / medium / phone
// layouts, touch-friendly, with brief motion.
//
// The export surface is the same as every other bar's (denim-fabric's
// shared/barContract.ts): everything from denim-fabric (and so the core),
// plus `Shell` and the default export. Switching to denim-fabric-topbar is
// an import-path change. parity.check.ts keeps it that way.
import { SidebarShell } from './SidebarShell';
import type { ShellComponent } from '../denim-fabric/shared/shell';

export * from '../denim-fabric';

/** The sidebar shell (ShellProps; ignores `Controls` and `ExternalApps`). */
export const Shell: ShellComponent = SidebarShell;
export default Shell;
