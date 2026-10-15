// Shared between SidebarShell and MasterDetail: the current layout and the
// narrow-screen back bar.
import React from 'react';

/** wide: sidebar | list | detail. medium: collapsed sidebar. narrow: one pane at a time. */
export type ShellLayout = 'wide' | 'medium' | 'narrow';

export interface IBreakpoints {
  /** Below this width (px) the layout is "narrow". Default 700. */
  medium: number;
  /** From this width (px) the layout is "wide". Default 1200. */
  wide: number;
}

export const DEFAULT_BREAKPOINTS: IBreakpoints = { medium: 700, wide: 1200 };

export function layoutFor(width: number, bp: IBreakpoints = DEFAULT_BREAKPOINTS): ShellLayout {
  return width >= bp.wide ? 'wide' : width >= bp.medium ? 'medium' : 'narrow';
}

/** The layout for the window's current width; updates on resize/rotate. */
export function useBreakpoint(bp: IBreakpoints = DEFAULT_BREAKPOINTS): ShellLayout {
  const measure = () => (typeof window === 'undefined' ? 'wide' : layoutFor(window.innerWidth, bp));
  const [layout, setLayout] = React.useState<ShellLayout>(measure);
  React.useEffect(() => {
    const onResize = () => setLayout(measure());
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bp.medium, bp.wide]);
  return layout;
}

/** Where a narrow screen's back bar goes, and what it says. */
export interface IBackTarget {
  /** The parent level's name, e.g. the list's title. */
  label: string;
  /** Its URL. */
  to: string;
}

export interface IShellLayoutContext {
  layout: ShellLayout;
  /** Replaces the narrow back bar's target while set; null restores the default (the menu). */
  setBack: (target: IBackTarget | null) => void;
  /** Goes "up" to `to`: browser Back when that's where Back leads, else a push. */
  goUp: (to: string) => void;
}

/** Null outside a SidebarShell. */
export const ShellLayoutContext = React.createContext<IShellLayoutContext | null>(null);

export const useShellLayout = () => React.useContext(ShellLayoutContext);
