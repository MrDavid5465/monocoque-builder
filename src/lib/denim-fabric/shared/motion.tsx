// The shells' own motion, on @fluentui/react-motion (Fluent v9's motion
// library; it has no v9 component dependencies and runs beside Fluent v8).
// Only where a Fluent v8 component has no motion of its own: the overlay
// Panel and the Settings Modal keep their built-in slide and fade. The wide
// sidebar's slide is in SidebarShell/slide.ts (Web Animations with the
// same motion tokens; see there why).
//
// Every motion animates `transform` and/or `opacity` of one element, never
// layout. Without GPU compositing (WebKitGTK on some Linux drivers) each
// frame still repaints what moves, so each motion moves as little as
// possible: the sidebar panel, one highlight, or the pane coming in.
//
// Reduced motion: useReducedMotion() (the core's `reduceMotion` device
// setting, or the OS preference) puts <ShellMotionProvider> into Fluent's
// "skip" behaviour, which finishes every motion below it at once. Fluent
// motion also shortens itself to 1ms under the OS preference on its own.
import React from 'react';
import {
  createMotionComponent,
  MotionBehaviourProvider,
  motionTokens,
} from '@fluentui/react-motion';
import { useReducedMotion } from '../../denim';
import { perfMotionProps } from './perf';

/** Skips every Fluent motion below it while motion is reduced. */
export const ShellMotionProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const reduced = useReducedMotion();
  return <MotionBehaviourProvider value={reduced ? 'skip' : 'default'}>{children}</MotionBehaviourProvider>;
};

/**
 * A pane coming in on a phone: from the right when drilling in, from the
 * left on the way back. A short slide plus a fade.
 */
const DrillMotion = createMotionComponent<{ from: string }>(({ from }) => ({
  keyframes: [
    { opacity: 0, transform: `translateX(${from === 'left' ? -32 : 32}px)` },
    { opacity: 1, transform: 'none' },
  ],
  duration: motionTokens.durationNormal,
  easing: motionTokens.curveDecelerateMid,
}));

export interface DrillInProps {
  from: 'left' | 'right';
  /** Animates when the child mounts. False: only on replayKey changes (and never on the first render). */
  animateMount?: boolean;
  /** Replays the motion on the same element (e.g. a hidden list shown again). */
  replayKey?: string | number;
  children: React.ReactElement;
}

/** The phone drill-in. The child must be a DOM element (or forward its ref to one). */
export const DrillIn: React.FC<DrillInProps> = ({ from, animateMount = true, replayKey, children }) => {
  const reduced = useReducedMotion();
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
  }, []);
  const skip = reduced || (!mounted.current && !animateMount);
  return (
    <MotionBehaviourProvider value={skip ? 'skip' : 'default'}>
      <DrillMotion from={from} replayKey={replayKey} {...(skip ? {} : perfMotionProps(`drill-in-${from}`, { untilIdle: true }))}>
        {children}
      </DrillMotion>
    </MotionBehaviourProvider>
  );
};

/** FLIP for a highlight: from the old rect's offset and scale to its new place. */
const IndicatorMove = createMotionComponent<{ dx: number; dy: number; sx: number; sy: number }>(
  ({ dx, dy, sx, sy }) => ({
    keyframes: [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: 'none' }],
    duration: motionTokens.durationNormal,
    easing: motionTokens.curveDecelerateMid,
  }),
);

interface IRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const sameRect = (a: IRect | null, b: IRect | null) =>
  a === b ||
  (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

export interface SlidingIndicatorProps {
  /** The positioned container the indicator is drawn in (and measured against). */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Finds the selected element inside the container. */
  selector: string;
  /** The highlight's look (background, accent bar, radius). */
  className: string;
  /** Name in the debugPerf log. */
  perfName: string;
}

/**
 * One highlight element that follows the selected item: it sits behind the
 * item (z-index -1 in the container's stacking context, so the container
 * needs `position: relative; isolation: isolate`) and slides to the next
 * one with a transform, from wherever it is on screen (a second click
 * mid-slide retargets). It is the only thing drawing the selection's
 * background: the items must not paint one, not even hovered. Re-measures
 * after every render of its parent, on any class or child change in the
 * container and on resize; it snaps (no slide) when the same element just
 * moved, on first render, and under reduced motion.
 */
export const SlidingIndicator: React.FC<SlidingIndicatorProps> = ({
  containerRef,
  selector,
  className,
  perfName,
}) => {
  const reduced = useReducedMotion();
  const [state, setState] = React.useState<{ rect: IRect | null; from: IRect | null; n: number }>({
    rect: null,
    from: null,
    n: 0,
  });
  // The element last highlighted. Another element becoming the selected one
  // is a selection change (slide); the same one moving is a re-layout (snap).
  // Keyed on the element rather than on the selected id, because a list may
  // mark its new row before the app's state (the URL) changes, or after.
  const elRef = React.useRef<HTMLElement | null>(null);
  const rectRef = React.useRef<IRect | null>(null);
  const reducedRef = React.useRef(reduced);
  reducedRef.current = reduced;

  const measure = React.useCallback(() => {
    const c = containerRef.current;
    const el = c?.querySelector<HTMLElement>(selector);
    let rect: IRect | null = null;
    if (c && el && el.offsetParent !== null) {
      const cr = c.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      rect = {
        top: Math.round(r.top - cr.top + c.scrollTop - c.clientTop),
        left: Math.round(r.left - cr.left + c.scrollLeft - c.clientLeft),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    }
    const prevRect = rectRef.current;
    const prevEl = elRef.current;
    elRef.current = rect ? el! : null;
    if (sameRect(prevRect, rect)) return;
    rectRef.current = rect;
    const animate = !reducedRef.current && !!prevRect && !!rect && !!prevEl && prevEl !== el;
    // Slide from where the indicator is on screen now: mid-slide after a
    // quick second click, that's between two items, not the last target.
    let from = prevRect;
    const shown = animate && c ? c.querySelector<HTMLElement>(':scope > [data-denim-indicator]') : null;
    if (shown && c) {
      const cr = c.getBoundingClientRect();
      const r = shown.getBoundingClientRect();
      from = {
        top: r.top - cr.top + c.scrollTop - c.clientTop,
        left: r.left - cr.left + c.scrollLeft - c.clientLeft,
        width: r.width,
        height: r.height,
      };
    }
    setState(prev => ({ rect, from: animate ? from : null, n: animate ? prev.n + 1 : prev.n }));
  }, [containerRef, selector]);

  // After every render of the parent (selection, variant, theme).
  React.useLayoutEffect(measure);

  // And whatever changes under it without re-rendering the parent: rows
  // arriving, a page change, the container resizing.
  React.useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    // The container and its children: anything above the selected item
    // growing or shrinking (a web font arriving, a group loading) resizes
    // one of them, without any DOM change.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    const observeSizes = () => {
      if (!ro) return;
      ro.disconnect();
      ro.observe(c);
      Array.from(c.children).forEach(child => ro.observe(child));
    };
    observeSizes();
    const mo = new MutationObserver(records => {
      if (records.some(r => r.type === 'childList' && r.target === c)) observeSizes();
      schedule();
    });
    mo.observe(c, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-current', 'hidden'] });
    document.fonts?.addEventListener?.('loadingdone', schedule);
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      ro?.disconnect();
      document.fonts?.removeEventListener?.('loadingdone', schedule);
    };
  }, [containerRef, measure]);

  const { rect, from, n } = state;
  if (!rect) return null;
  const box = (
    <div
      className={className}
      aria-hidden
      data-denim-indicator=""

      style={{
        position: 'absolute',
        zIndex: -1,
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        boxSizing: 'border-box',
        pointerEvents: 'none',
        transformOrigin: '0 0',
      }}
    />
  );
  if (!from) return box;
  return (
    <IndicatorMove
      key={n}
      dx={from.left - rect.left}
      dy={from.top - rect.top}
      sx={from.width / rect.width}
      sy={from.height / rect.height}
      {...perfMotionProps(perfName)}
    >
      {box}
    </IndicatorMove>
  );
};
