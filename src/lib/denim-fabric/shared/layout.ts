// The shell-neutral layout: which of three widths the window is, and the
// phone back bar. Every bar provides it (ShellLayoutContext), so content
// such as MasterDetail reads one layout whichever bar it is under, and
// falls back to measuring the window outside any bar.
import React from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

/** wide: list | detail side by side, full chrome. medium: narrower chrome. narrow: one pane at a time. */
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
  /**
   * Whether the bar draws a phone back bar of its own (the sidebar does,
   * the top bar doesn't). When false, MasterDetail draws its own back
   * control above an open detail.
   */
  backBar: boolean;
  /** Replaces the bar's back-bar target while set; null restores the default. A no-op without a back bar. */
  setBack: (target: IBackTarget | null) => void;
  /** Goes "up" to `to`: browser Back when that's where Back leads, else a push. */
  goUp: (to: string) => void;
}

/** Provided by every bar. Null outside one. */
export const ShellLayoutContext = React.createContext<IShellLayoutContext | null>(null);

/** The bar's layout context, or null outside a bar. */
export const useShellLayout = () => React.useContext(ShellLayoutContext);

/**
 * The current layout: the bar's (with its breakpoints) under a bar, else the
 * window's with `bp`. What content should use to adapt.
 */
export function useLayout(bp: IBreakpoints = DEFAULT_BREAKPOINTS): ShellLayout {
  const shell = useShellLayout();
  const own = useBreakpoint(bp);
  return shell?.layout ?? own;
}

/**
 * Tracks this tab's history so "up" can be the browser's Back when Back
 * leads to the same place (no duplicate entries), and a push otherwise
 * (a deep link has nothing to go back to). For a bar's `goUp`.
 */
export function useGoUp() {
  const location = useLocation();
  const navType = useNavigationType();
  const navigate = useNavigate();
  const stack = React.useRef<{ key: string; path: string }[]>([]);
  React.useEffect(() => {
    const s = stack.current;
    const entry = { key: location.key, path: location.pathname.replace(/\/+$/, '') || '/' };
    const at = s.findIndex(e => e.key === location.key);
    if (at >= 0) s.length = at + 1; // Back (or Forward) to a known entry
    else if (navType === 'REPLACE' && s.length) s[s.length - 1] = entry;
    else s.push(entry);
  }, [location.key, location.pathname, navType]);
  return React.useCallback(
    (to: string) => {
      const s = stack.current;
      const target = to.replace(/\/+$/, '') || '/';
      if (s.length >= 2 && s[s.length - 2].path === target) navigate(-1);
      else navigate(to);
    },
    [navigate],
  );
}

const noBack = () => {};

/**
 * The layout context for a bar without a back bar of its own (the top bar):
 * the window's layout with the bar's breakpoints.
 */
export function useSimpleShellLayout(bp: IBreakpoints = DEFAULT_BREAKPOINTS): IShellLayoutContext {
  const layout = useBreakpoint(bp);
  const goUp = useGoUp();
  return React.useMemo(() => ({ layout, backBar: false, setBack: noBack, goUp }), [layout, goUp]);
}
