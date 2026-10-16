// Export parity: fails to type-check when this bar's exports differ from the
// surface every denim-fabric bar shares (denim-fabric/shared/barContract.ts),
// so the bars stay interchangeable. Nothing imports this file; `tsc` over
// the app's src checks it. See README "Same exports as every bar".
import type * as Bar from './index';
import type { Assert, MatchesBarExports } from '../denim-fabric/shared/barContract';

export type SidebarExportParity = Assert<MatchesBarExports<typeof Bar>>;
