import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRowCommit } from '../lib/per-form/useRowCommit';

const setup = (opts: Partial<Parameters<typeof useRowCommit>[0]> = {}) => {
  const onCommit = vi.fn();
  const view = renderHook(
    ({ identity }: { identity: string }) =>
      useRowCommit<any>({ identity, onCommit, ...(opts as any) }),
    { initialProps: { identity: 'row-1' } },
  );
  return { onCommit, ...view };
};

// ─── mount ticks ─────────────────────────────────────────────────────────────

describe('useRowCommit mount tick', () => {
  it('swallows the first change by default (a remounted Form fires one)', () => {
    const { result, onCommit } = setup();
    act(() => result.current.handleChange({ a: 1 }));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits the second change — the first real user edit', () => {
    const { result, onCommit } = setup();
    act(() => result.current.handleChange({ a: 1 }));
    act(() => result.current.handleChange({ a: 2 }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toEqual({ a: 2 });
    expect(onCommit.mock.calls[0][2]).toEqual(['a']);
  });

  it('commits immediately when skipFirstChange is false (ListField drives it directly)', () => {
    const { result, onCommit } = setup({ skipFirstChange: false });
    act(() => result.current.handleChange({ a: 1 }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('never silently swallows a first edit that has no seeded baseline', () => {
    // Regression: falling back to `next` as the baseline made the diff
    // trivially empty, so the very first edit committed nothing at all.
    const { result, onCommit } = setup({ skipFirstChange: false });
    act(() => result.current.handleChange({ a: 1, b: 2 }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][2].sort()).toEqual(['a', 'b']);
  });

  it('diffs the first edit precisely when `initial` is seeded', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useRowCommit<any>({
        identity: 'r', initial: { a: 1, b: 2 }, skipFirstChange: false, onCommit,
      }),
    );
    act(() => result.current.handleChange({ a: 1, b: 9 }));
    expect(onCommit.mock.calls[0][2]).toEqual(['b']);
    expect(onCommit.mock.calls[0][1]).toEqual({ a: 1, b: 2 });
  });

  it('re-arms the skip when identity changes — the ping-pong guard', () => {
    // This is the regression LfeRow documents: without re-arming, the
    // second mount's seeded values commit as if the user had toggled,
    // which deletes the row, which remounts, forever.
    const { result, rerender, onCommit } = setup();
    act(() => result.current.handleChange({ enabled: true }));   // mount 1
    act(() => result.current.handleChange({ enabled: false }));  // real edit
    onCommit.mockClear();

    rerender({ identity: 'row-2' });
    act(() => result.current.handleChange({ enabled: true }));   // mount 2
    expect(onCommit).not.toHaveBeenCalled();
  });
});

// ─── change diffing ──────────────────────────────────────────────────────────

describe('useRowCommit diffing', () => {
  it('does not commit when nothing actually changed', () => {
    const { result, onCommit } = setup({ skipFirstChange: false });
    act(() => result.current.handleChange({ a: 1, b: 2 }));
    onCommit.mockClear();
    act(() => result.current.handleChange({ a: 1, b: 2 }));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('reports only the keys that moved', () => {
    const { result, onCommit } = setup({ skipFirstChange: false });
    act(() => result.current.handleChange({ a: 1, b: 2 }));
    onCommit.mockClear();
    act(() => result.current.handleChange({ a: 1, b: 9 }));
    expect(onCommit.mock.calls[0][2]).toEqual(['b']);
  });

  it('passes the previous row alongside the next', () => {
    const { result, onCommit } = setup({ skipFirstChange: false });
    act(() => result.current.handleChange({ a: 1 }));
    act(() => result.current.handleChange({ a: 2 }));
    const [next, prev] = onCommit.mock.calls[1];
    expect(prev).toEqual({ a: 1 });
    expect(next).toEqual({ a: 2 });
  });
});

// ─── drag gating ─────────────────────────────────────────────────────────────

describe('useRowCommit drag gating', () => {
  it('defers commits while dragging, then flushes once on release', () => {
    const { result, onCommit } = setup({ skipFirstChange: false });
    act(() => result.current.handleChange({ v: 0 }));
    onCommit.mockClear();

    act(() => result.current.drag.onActivate());
    act(() => result.current.handleChange({ v: 1 }));
    act(() => result.current.handleChange({ v: 2 }));
    act(() => result.current.handleChange({ v: 3 }));
    expect(onCommit).not.toHaveBeenCalled();

    act(() => result.current.drag.onDeactivate());
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toEqual({ v: 3 });
  });

  it('does not commit on release when nothing was dragged', () => {
    const { result, onCommit } = setup({ skipFirstChange: false });
    act(() => result.current.handleChange({ v: 0 }));
    onCommit.mockClear();
    act(() => result.current.drag.onActivate());
    act(() => result.current.drag.onDeactivate());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits live while dragging when deferWhileDragging is false', () => {
    const { result, onCommit } = setup({ skipFirstChange: false, deferWhileDragging: false });
    act(() => result.current.handleChange({ v: 0 }));
    onCommit.mockClear();
    act(() => result.current.drag.onActivate());
    act(() => result.current.handleChange({ v: 1 }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

// ─── resync ──────────────────────────────────────────────────────────────────

describe('useRowCommit resync', () => {
  it('adopts a new baseline without committing', () => {
    const { result, onCommit } = setup({ skipFirstChange: false });
    act(() => result.current.handleChange({ a: 1 }));
    onCommit.mockClear();

    act(() => result.current.resync({ a: 5 }));
    expect(onCommit).not.toHaveBeenCalled();

    // Next edit diffs against the resynced baseline, not the stale one.
    act(() => result.current.handleChange({ a: 5 }));
    expect(onCommit).not.toHaveBeenCalled();
    act(() => result.current.handleChange({ a: 6 }));
    expect(onCommit.mock.calls[0][1]).toEqual({ a: 5 });
  });
});
