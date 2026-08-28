import { useRef } from 'react';

export interface UseRowCommitOptions<Row> {
  /** Stable identity of the row this hook is committing for. When it
   *  changes, the next incoming change is treated as a fresh mount rather
   *  than a user edit (see `skipFirstChange`). */
  identity: string | number;
  /** The row's current value, used to seed the diff baseline at mount and
   *  on identity change. Strongly recommended whenever `skipFirstChange`
   *  is false: without a baseline the first edit has nothing to diff
   *  against, and would either be swallowed entirely or report every key
   *  as changed. Consumers relying on the mount tick to establish the
   *  baseline (`skipFirstChange: true`) may omit it. */
  initial?: Row;
  /** Called only for real edits, never at mount, never mid-drag. `changed`
   *  lists the keys that actually differ from the previous committed row,
   *  so a consumer can dispatch one targeted mutation per field instead of
   *  hand-diffing against its own ref. */
  onCommit: (next: Row, prev: Row, changed: string[]) => void;
  /** True when the change source fires a spurious change on mount — which
   *  `typical-admin-fabric`'s `Form` does, via its
   *  `useEffect(..., [name, values, isValid])`. Consumers driving this hook
   *  from their own synchronous handler (ListField) pass false, because
   *  there is no mount tick to swallow and swallowing one would eat the
   *  user's first real edit. Default true. */
  skipFirstChange?: boolean;
  /** Hold the commit while a slider is being dragged, flushing on release.
   *  Default true. */
  deferWhileDragging?: boolean;
}

const changedKeys = (prev: any, next: any): string[] => {
  const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})]);
  return [...keys].filter(k => (prev ?? {})[k] !== (next ?? {})[k]);
};

/**
 * The commit-gating primitive shared by `ListField` and every per-row form
 * in the Shakers grids.
 *
 * It exists because the same three concerns were previously re-implemented
 * (and got out of sync) in `LfeRow`, `EffectRow`, `ChannelHeader`, and three
 * separate `FieldCell` copies:
 *
 *  1. **Mount ticks aren't user edits.** A remounted `Form` fires `onChange`
 *     once with its seeded values. Committing that is what caused the
 *     shipped infinite add/remove ping-pong documented in LfeRow: the row's
 *     `enabled` toggle round-tripped through a server mutation that deleted
 *     the row, which remounted the form, which fired again.
 *  2. **The identity reset must happen during render.** It is done inline
 *     in the hook body, NOT in a `useEffect`, because the remounted child
 *     form's own mount effect runs in the same commit and effects fire
 *     child-before-parent — a parent effect resets one render too late to
 *     catch it. This is the single subtlest line in the file.
 *  3. **Dragging shouldn't commit per-pixel.** While a slider is held, the
 *     row's own form still updates (UI stays live) but the upward commit is
 *     deferred and flushed once on release.
 */
export function useRowCommit<Row>(opts: UseRowCommitOptions<Row>) {
  const {
    identity,
    initial,
    onCommit,
    skipFirstChange = true,
    deferWhileDragging = true,
  } = opts;

  const prevRef = useRef<Row | null>(initial ?? null);
  const skipNext = useRef(skipFirstChange);
  const lastIdentity = useRef(identity);
  const dragging = useRef(false);
  const pending = useRef<Row | null>(null);

  // Inline during render — see (2) above. Do not move into an effect.
  if (lastIdentity.current !== identity) {
    lastIdentity.current = identity;
    skipNext.current = skipFirstChange;
    prevRef.current = initial ?? null;
    pending.current = null;
  }

  const flush = (next: Row) => {
    // Falling back to `{}` rather than `next` matters: `next` would make
    // the diff trivially empty and silently swallow the very first edit
    // when no baseline was seeded. `{}` instead reports every key as
    // changed — noisier, but never lost. Pass `initial` to get a precise
    // diff on the first edit.
    const prev = (prevRef.current ?? ({} as Row)) as Row;
    const changed = changedKeys(prev, next);
    prevRef.current = next;
    pending.current = null;
    if (changed.length) onCommit(next, prev, changed);
  };

  const handleChange = (next: Row) => {
    if (skipNext.current) {
      skipNext.current = false;
      prevRef.current = next;
      pending.current = null;
      return;
    }
    pending.current = next;
    if (deferWhileDragging && dragging.current) return;
    flush(next);
  };

  /** Inject into every slider/range field of the row schema. `ListField`
   *  does this automatically; Shakers row components pass it through their
   *  existing schema factories. */
  const drag = {
    onActivate: () => {
      dragging.current = true;
    },
    onDeactivate: () => {
      dragging.current = false;
      if (pending.current !== null) flush(pending.current);
    },
  };

  /** Adopt `row` as the new baseline WITHOUT committing — for when external
   *  data replaces the row's values but its identity is unchanged, so the
   *  next user edit diffs against what's actually on screen. */
  const resync = (row: Row) => {
    prevRef.current = row;
    pending.current = null;
  };

  return { handleChange, drag, resync };
}

export default useRowCommit;
