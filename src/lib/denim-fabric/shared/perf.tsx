// Opt-in timing for the shell's interactions, for measuring in the real
// webview (where no profiler is at hand). Off unless the page has
//
//   localStorage.debugPerf = '1'
//
// (set it in the devtools console, then reload). Then each interaction logs
//
//   [perf] sidebar-toggle: 12.3ms to commit, 31.0ms to next frame
//   [perf] commit shell-content update 4.1ms (base 40.2ms)
//
// "to commit" is input -> React has applied the change to the DOM; "to next
// frame" is input -> the frame after it (style, layout and paint included,
// as far as requestAnimationFrame can tell). `commit <id>` lines come from
// React Profilers around the shell's main parts: how long that part took to
// render, and its full un-memoized cost ("base"). A part that doesn't log
// didn't re-render. Every timing is also a performance.measure, so it shows
// in a devtools performance recording.
//
// Animations log when they end:
//
//   [perf] anim settings-enter: 271ms, 17 frames, 2 long (max 48ms)
//
// from the animation's start to its end, the frames drawn meanwhile (one
// requestAnimationFrame callback each), and how many of them took over 32ms
// (two missed 60Hz frames: visible stutter) with the worst one.
import React from 'react';

let enabled: boolean | undefined;

/** True when `localStorage.debugPerf` is set. Read once per page load. */
export function perfEnabled(): boolean {
  if (enabled === undefined) {
    try {
      enabled = !!localStorage.getItem('debugPerf') && localStorage.getItem('debugPerf') !== '0';
    } catch {
      enabled = false;
    }
  }
  return enabled;
}

const pending = new Map<string, number>();

/**
 * Starts timing an interaction (call it in the event handler). Logs the time
 * to the frame after the change; `perfCommitted(name)` from an effect adds
 * the time to commit.
 */
export function perfStart(name: string): void {
  if (!perfEnabled()) return;
  const t0 = performance.now();
  pending.set(name, t0);
  performance.mark(`${name}:start`);
  // Two frames: the first runs before the paint that shows the change.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const committed = pending.get(name + ':commit');
      pending.delete(name);
      pending.delete(name + ':commit');
      const frame = performance.now() - t0;
      try {
        performance.measure(`${name} (to next frame)`, `${name}:start`);
      } catch {
        // mark cleared: nothing to measure against
      }
      console.log(
        `[perf] ${name}: ${committed !== undefined ? `${committed.toFixed(1)}ms to commit, ` : ''}` +
          `${frame.toFixed(1)}ms to next frame`,
      );
    }),
  );
}

/** Records when the interaction started with perfStart(name) reached the DOM. */
export function perfCommitted(name: string): void {
  if (!perfEnabled()) return;
  const t0 = pending.get(name);
  if (t0 === undefined || pending.has(name + ':commit')) return;
  pending.set(name + ':commit', performance.now() - t0);
}

const LONG_FRAME_MS = 32;
const anims = new Map<string, (cancelled?: boolean) => void>();

const runningAnimations = () =>
  typeof document.getAnimations !== 'function'
    ? 0
    : document.getAnimations().filter(a => {
        if (a.playState !== 'running') return false;
        const iterations = (a.effect as KeyframeEffect | null)?.getTiming?.().iterations;
        return iterations !== Infinity;
      }).length;

/**
 * Starts sampling frames for the animation `name`; `perfAnimEnd(name)` ends
 * it and logs (`perfAnimEnd(name, true)` if it was interrupted). Starting the
 * same name again ends the previous run first. With `untilIdle`, it also
 * ends by itself at the first frame (after the second) with no animation
 * running on the page: for CSS animations and transitions, such as Fluent
 * v8's Panel slide and Modal fade, whose callbacks run on timers. A no-op
 * without debugPerf.
 */
export function perfAnimStart(name: string, { untilIdle = false } = {}): void {
  if (!perfEnabled()) return;
  anims.get(name)?.();
  const t0 = performance.now();
  performance.mark(`anim ${name}:start`);
  const deltas: number[] = [];
  let last = t0;
  let raf = 0;
  const tick = (now: number) => {
    // A frame's timestamp is when it began, which can be before t0.
    deltas.push(Math.max(0, now - last));
    last = now;
    if (untilIdle && deltas.length > 2 && runningAnimations() === 0) {
      anims.get(name)?.();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  anims.set(name, (cancelled?: boolean) => {
    cancelAnimationFrame(raf);
    anims.delete(name);
    const total = performance.now() - t0;
    const long = deltas.filter(d => d > LONG_FRAME_MS);
    try {
      performance.measure(`anim ${name}`, `anim ${name}:start`);
    } catch {
      // mark cleared
    }
    console.log(
      `[perf] anim ${name}: ${total.toFixed(0)}ms, ${deltas.length} frames, ${long.length} long` +
        (deltas.length ? ` (max ${Math.max(...deltas).toFixed(0)}ms)` : '') +
        (cancelled ? ' (interrupted)' : ''),
    );
  });
}

/** Ends the animation started with perfAnimStart(name) and logs it. */
export function perfAnimEnd(name: string, cancelled = false): void {
  anims.get(name)?.(cancelled);
}

/**
 * The onMotionStart/onMotionFinish/onMotionCancel props that log a Fluent
 * motion component's animation as `name` (presence components log
 * `name-enter` / `name-exit`).
 */
export function perfMotionProps(name: string, { untilIdle = false } = {}) {
  if (!perfEnabled()) return {};
  const id = (data?: { direction?: string }) => (data?.direction ? `${name}-${data.direction}` : name);
  if (untilIdle) {
    // For motions replayed with replayKey: Fluent cancels the previous run
    // and re-wires its end callbacks before that cancel is reported, so a
    // replay never reports its finish. Time it to the page going idle.
    return { onMotionStart: (_: null, data?: { direction?: string }) => perfAnimStart(id(data), { untilIdle: true }) };
  }
  return {
    onMotionStart: (_: null, data?: { direction?: string }) => perfAnimStart(id(data)),
    onMotionFinish: (_: null, data?: { direction?: string }) => perfAnimEnd(id(data)),
    onMotionCancel: (_: null, data?: { direction?: string }) => perfAnimEnd(id(data), true),
  };
}

const onRender: React.ProfilerOnRenderCallback = (id, phase, actual, base) => {
  console.log(`[perf] commit ${id} ${phase} ${actual.toFixed(1)}ms (base ${base.toFixed(1)}ms)`);
};

/** A React Profiler that logs each commit of its subtree when debugPerf is on. */
export const PerfProfiler: React.FC<{ id: string; children?: React.ReactNode }> = ({ id, children }) =>
  perfEnabled() ? (
    <React.Profiler id={id} onRender={onRender}>
      {children}
    </React.Profiler>
  ) : (
    <>{children}</>
  );
