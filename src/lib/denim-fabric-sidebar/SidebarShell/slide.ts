// The wide sidebar's collapse/expand slide: the full panel slides, the page
// beside it moves with it, and the layout changes once, at the end.
//
// The layout keeps its starting widths for the whole slide. Three
// animations then run on the same clock, with the same duration and curve:
// the full panel's translateX (between -delta and 0), the content's
// translateX (0 to +delta when expanding, 0 to -delta when collapsing), so
// the panel's edge and the content's edge stay together, and the icon
// rail's opacity (it sits over the panel's left end and fades in or out).
// Transform and opacity only: the content is not re-laid out per frame.
// When they finish, the new width is applied, and in that same commit (a
// layout effect, before paint) the animations are cancelled, removing the
// transforms. The finished frame and the new layout are the same picture,
// so nothing jumps. Toggling again mid-slide reverses all three from where
// they are.
//
// This uses the Web Animations API directly, with Fluent's motion tokens,
// rather than a @fluentui/react-motion component: a motion component
// computes its keyframes when it mounts, so playing the content's motion in
// the other direction would mean remounting the content (the whole page);
// and a presence component restarts rather than reverses when interrupted.
import React from 'react';
import { motionTokens } from '@fluentui/react-motion';
import { perfAnimEnd, perfAnimStart } from '../../denim-fabric/shared/perf';

export interface SidebarSlideOptions {
  /** The wanted state; flips at once on a toggle. */
  collapsed: boolean;
  /** False (another layout, reduced motion): no slide, the layout follows at once. */
  enabled: boolean;
  /** Full width minus rail width, px. */
  delta: number;
  panelRef: React.RefObject<HTMLElement | null>;
  railRef: React.RefObject<HTMLElement | null>;
  mainRef: React.RefObject<HTMLElement | null>;
}

export interface SidebarSlideState {
  /** The state the layout (widths) is in; lags `collapsed` until the slide ends. */
  layoutCollapsed: boolean;
  /** Both the rail and the full panel are on screen. */
  sliding: boolean;
}

const perfName = (collapsing: boolean) => (collapsing ? 'sidebar-collapse' : 'sidebar-expand');

export function useSidebarSlide({
  collapsed,
  enabled,
  delta,
  panelRef,
  railRef,
  mainRef,
}: SidebarSlideOptions): SidebarSlideState {
  const [layoutCollapsed, setLayoutCollapsed] = React.useState(collapsed);
  const [sliding, setSliding] = React.useState(false);
  const [seen, setSeen] = React.useState(collapsed);
  if (seen !== collapsed) {
    setSeen(collapsed);
    if (enabled) setSliding(true);
    else setLayoutCollapsed(collapsed);
  }
  if (!enabled && !sliding && layoutCollapsed !== collapsed) setLayoutCollapsed(collapsed);

  const anims = React.useRef<Animation[]>([]);
  const target = React.useRef(collapsed);
  target.current = collapsed;

  React.useLayoutEffect(() => {
    if (!sliding) return;
    const running = anims.current;
    if (running.length) {
      // Retarget: back the way it came, from where it is.
      perfAnimEnd(perfName(!collapsed), true);
      perfAnimStart(perfName(collapsed));
      running.forEach(a => a.reverse());
      return;
    }
    const panel = panelRef.current;
    const rail = railRef.current;
    const main = mainRef.current;
    if (!panel || !rail || !main || typeof panel.animate !== 'function') {
      setLayoutCollapsed(collapsed);
      setSliding(false);
      return;
    }
    const expanding = !collapsed;
    const timing: KeyframeAnimationOptions = {
      duration: expanding ? motionTokens.durationNormal : motionTokens.durationFast,
      // The curve of Fluent's own Panel slide (the medium overlay), so both
      // sidebars move alike.
      easing: motionTokens.curveDecelerateMax,
      fill: 'forwards',
    };
    const out = `translateX(-${delta}px)`;
    perfAnimStart(perfName(collapsed));
    const list = [
      panel.animate(expanding ? [{ transform: out }, { transform: 'none' }] : [{ transform: 'none' }, { transform: out }], timing),
      main.animate(
        [{ transform: 'none' }, { transform: `translateX(${expanding ? delta : -delta}px)` }],
        timing,
      ),
      rail.animate(expanding ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }], timing),
    ];
    anims.current = list;
    // Fires at either end: the far one, or the start after a reverse.
    list[0].onfinish = () => {
      perfAnimEnd(perfName(target.current));
      setLayoutCollapsed(target.current);
      setSliding(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliding, collapsed]);

  // In the commit that applies the final layout: drop the transforms.
  React.useLayoutEffect(() => {
    if (sliding || !anims.current.length) return;
    anims.current.forEach(a => {
      a.onfinish = null;
      a.cancel();
    });
    anims.current = [];
  }, [sliding]);

  // Leaving the wide layout (or reduced motion turning on) mid-slide.
  React.useLayoutEffect(() => {
    if (enabled || !sliding) return;
    perfAnimEnd(perfName(collapsed), true);
    setLayoutCollapsed(collapsed);
    setSliding(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { layoutCollapsed, sliding };
}
