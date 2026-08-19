import { createContext } from 'react';

// Server-authoritative simulated clock, ms since epoch UTC (see
// useGlobalNightMode.ts) — provided once at Canvas's root and consumed ONLY
// by ClockTextNode/ClockSpriteNode via useContext, deliberately NOT threaded
// through NodeRendererProps/sharedChildProps like nightAmount/isNight are.
// Those props are spread into EVERY node in the tree via NodeRenderer's own
// recursive rendering, so a value that ticks at ~60Hz (matching telemetry)
// would force the ENTIRE dashboard — every single node, not just clocks —
// to re-render 60 times a second. Context only re-renders the components
// that actually call useContext, so only real clock-source='simulated'
// nodes pay that cost. Discovered live: threading it as a normal prop
// destabilized the properties panel (a "Maximum update depth exceeded"
// warning reproduced under rapid interaction) once the whole tree's
// re-render rate jumped this high — Context is the same fix already applied
// to NightModeFeedContext/PreviewCarFeedContext earlier this app for the
// identical "don't prop-drill a fast-changing value through everything"
// problem.
export const ClockTimeContext = createContext<number | null>(null);
