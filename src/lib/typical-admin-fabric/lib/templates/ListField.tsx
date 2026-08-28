import React, { useRef, type FC } from 'react';
import { Stack, DefaultButton, IconButton, Icon, getTheme } from '@fluentui/react';
import useForm, {
  FormWrapper,
  useRowCommit,
  resolveRowSchema,
  type IField,
  type IListField,
} from '../../../per-form';

interface ListFieldProps {
  name: string;
  value: any;
  onChange: (name: string, value: any) => void;
  onFocus?: (name: string) => void;
  /** Fabric's own `Raw` renderer, passed down rather than imported, to
   *  avoid a circular import (Fabric imports this file). Same
   *  self-reference `multicheckbox` already uses. */
  Template: FC<IField>;
  [key: string]: any;
}

const asRows = (v: any): any[] => (Array.isArray(v) ? v : []);

const shallowEqualRow = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
};

/** Injects the drag hooks every `slider`/`range` field needs so the row's
 *  commit is deferred until pointer-release. Done here rather than by the
 *  schema author — it's mechanical, and every consumer that hand-threaded
 *  it previously got to choose whether to bother. */
function withDragHooks(
  rowSchema: Record<string, any>,
  drag: { onActivate: () => void; onDeactivate: () => void },
): Record<string, any> {
  let touched = false;
  const out: Record<string, any> = {};
  for (const [k, f] of Object.entries(rowSchema)) {
    if (f && (f.type === 'slider' || f.type === 'range')) {
      out[k] = { ...f, onActivate: drag.onActivate, onDeactivate: drag.onDeactivate };
      touched = true;
    } else {
      out[k] = f;
    }
  }
  return touched ? out : rowSchema;
}

interface ListRowProps {
  row: any;
  index: number;
  rows: any[];
  field: IListField;
  identity: string;
  Template: FC<IField>;
  onRowChange: (index: number, nextRow: any, forceRemount: boolean) => void;
}

/** One row. Its own `useForm` over the row schema means row fields are
 *  plain top-level keys — which is exactly why this design never trips
 *  `useForm.onChange`'s `name.split('.').slice(-1)[0]` path-stripping.
 *  Nesting the form is what makes the flat-key constraint a non-issue. */
const ListRow: React.FC<ListRowProps> = ({
  row, index, rows, field, identity, Template, onRowChange,
}) => {
  const theme = getTheme();

  // No mount tick to swallow: the commit below is driven from this
  // component's own synchronous change handler, not from an effect. Hence
  // skipFirstChange:false — swallowing here would eat the user's first
  // real edit.
  const { handleChange, drag } = useRowCommit<any>({
    identity,
    initial: row,
    skipFirstChange: false,
    deferWhileDragging: field.deferWhileDragging ?? true,
    onCommit: (next) => onRowChange(index, next, false),
  });

  const resolved = resolveRowSchema(field, row, index, rows) as Record<string, any>;
  const rowSchema = withDragHooks(resolved, drag);

  // Dev guard for the documented hard rule: a function `itemSchema` may
  // vary field config but not its key set, because useForm seeds `values`
  // once at mount and a key added later never receives one.
  const firstKeys = useRef<string | null>(null);
  if (import.meta.env?.DEV) {
    const keys = Object.keys(rowSchema).sort().join(',');
    if (firstKeys.current === null) firstKeys.current = keys;
    else if (firstKeys.current !== keys) {
      // eslint-disable-next-line no-console
      console.error(
        `[per-form] list "${field.label}" row ${index}: itemSchema changed its key set ` +
        `("${firstKeys.current}" -> "${keys}"). Field config may vary per row; keys may not.`,
      );
    }
  }

  const form = useForm<any>({
    schema: rowSchema as any,
    passedValues: row ?? {},
    converters: field.converters ?? {},
  });

  const handleFieldChange = (fieldName: string, fieldValue: any) => {
    form.change(fieldName, fieldValue);

    // Computed synchronously rather than read back from form.values on a
    // later render — that is what removes the need for any effect here,
    // and with it the mount tick.
    //
    // Spread `row` first: `useForm` only seeds values for keys present in
    // the schema, so form.values omits any identity/metadata a row carries
    // but doesn't render as an input (channelId, id, a display name).
    // Without this those keys are silently dropped the moment a row is
    // edited, and the emitted array no longer round-trips.
    let next = { ...row, ...form.values, [fieldName]: fieldValue };

    const patch = field.deriveRow?.({ row: next, index, rows, field: fieldName, value: fieldValue });
    const patched = patch && Object.keys(patch).length > 0;
    if (patched) next = { ...next, ...patch };

    // A deriveRow patch has to remount this row: the nested form is
    // uncontrolled after mount, so a corrected value can't otherwise reach
    // its inputs. Echo detection alone won't catch it (we're the ones
    // emitting the patched row, so it shallow-equals what comes back).
    handleChange(next);
    if (patched) onRowChange(index, next, true);
  };

  return (
    <Stack
      horizontal={!!field.horizontal}
      tokens={{ childrenGap: field.horizontal ? 12 : 4 }}
      // Fabric wraps each field in its own <Stack className={rest.className}>,
      // so a field's `styles.root.flex` lands on the INPUT and never on that
      // wrapper — a horizontal row would otherwise collapse to natural widths
      // no matter what the schema asked for. Share the row evenly here
      // instead, which is what `horizontal` implies anyway. `minWidth: 0` so
      // a long select value can't push its column past its share.
      styles={
        field.horizontal
          ? { root: { selectors: { '> *': { flex: '1 1 0', minWidth: 0 } } } }
          : undefined
      }
      style={{ flex: 1, minWidth: 0, ...(field.rowStyle ?? {}) }}
    >
      <FormWrapper
        errors={form.errors}
        dirty={form.dirty}
        touched={form.touched}
        values={form.values}
        schema={form.schema as any}
        onChange={handleFieldChange}
        onFocus={form.focus}
        Template={Template}
      />
      {field.horizontal ? null : (
        <div style={{ borderBottom: `1px solid ${theme.palette.neutralLighter}` }} />
      )}
    </Stack>
  );
};

/**
 * Repeating-rows field. Renders one nested form per row and republishes the
 * whole array upward through the ordinary `onChange(name, rows)` contract.
 *
 * Echo detection is the one genuinely new mechanism here. Our own emitted
 * array flows straight back down as `value` on the next render. Remounting
 * rows whenever `value` changes reproduces the bug EffectRow documents
 * (editing a value remounts the very form being edited); never remounting
 * reproduces the one AmbientLights documents (saved values load but never
 * appear, because nested forms are uncontrolled after mount). So: remount a
 * row only when its incoming value differs from what we last emitted for
 * it. Our own echo shallow-equals and is ignored; a server refetch, a
 * profile load, or a deriveRow patch does not, and remounts that one row.
 */
export const ListField: React.FC<ListFieldProps> = (props) => {
  const { name, value, onChange, Template, ...rest } = props;
  const field = rest as unknown as IListField;
  const theme = getTheme();

  const rows = asRows(value);
  const rowKeyOf = (row: any, i: number) =>
    field.rowKey ? field.rowKey(row, i) : String(i);

  const lastEmitted = useRef<any[] | null>(null);
  const epochs = useRef<Record<string, number>>({});

  // Bumped during render, not in an effect: a remounting child's own mount
  // effect runs in the same commit and effects fire child-before-parent, so
  // a parent effect would decide one render too late. Same reasoning
  // LfeRow records for its identity reset.
  rows.forEach((row, i) => {
    const k = rowKeyOf(row, i);
    const mine = lastEmitted.current?.find((r, j) => rowKeyOf(r, j) === k);
    if (mine !== undefined && !shallowEqualRow(mine, row)) {
      epochs.current[k] = (epochs.current[k] ?? 0) + 1;
    }
  });

  const emit = (nextRows: any[]) => {
    lastEmitted.current = nextRows;
    onChange(name, nextRows);
  };

  const handleRowChange = (index: number, nextRow: any, forceRemount: boolean) => {
    const nextRows = rows.map((r, i) => (i === index ? nextRow : r));
    if (forceRemount) {
      const k = rowKeyOf(nextRow, index);
      epochs.current[k] = (epochs.current[k] ?? 0) + 1;
    }
    emit(nextRows);
    field.onRowCommit?.({ kind: 'update', index, row: nextRow, rows: nextRows, changed: [] });
  };

  const handleAdd = () => {
    const seed =
      typeof field.newRow === 'function'
        ? (field.newRow as (r: any[]) => any)(rows)
        : (field.newRow ?? {});
    const resolved = resolveRowSchema(field, seed, rows.length, rows) as Record<string, any>;
    const defaults = Object.entries(resolved ?? {}).reduce(
      (acc, [k, f]) => ({ ...acc, [k]: (f as any)?.defaultValue ?? '' }),
      {} as Record<string, any>,
    );
    const row = { ...defaults, ...seed };
    const nextRows = [...rows, row];
    emit(nextRows);
    field.onRowCommit?.({ kind: 'add', index: nextRows.length - 1, row, rows: nextRows });
  };

  const handleRemove = (index: number) => {
    const row = rows[index];
    const nextRows = rows.filter((_, i) => i !== index);
    emit(nextRows);
    field.onRowCommit?.({ kind: 'remove', index, row, rows: nextRows });
  };

  const min = field.min ?? 0;
  const max = field.max ?? Infinity;
  const canAdd = !field.fixed && rows.length < max;
  const canRemove = !field.fixed && rows.length > min;
  const singular = field.singular ?? 'row';

  return (
    <Stack tokens={{ childrenGap: 8 }}>
      {rows.length === 0 && (
        <span style={{ fontSize: '0.85em', color: theme.palette.neutralSecondary }}>
          {field.emptyText ?? `No ${singular}s yet.`}
        </span>
      )}

      {rows.map((row, i) => {
        const k = rowKeyOf(row, i);
        return (
          <Stack key={`${k}:${epochs.current[k] ?? 0}`} tokens={{ childrenGap: 4 }}>
            {field.rowLabel && (
              <span style={{ fontSize: '0.8em', fontWeight: 600, opacity: 0.75 }}>
                {field.rowLabel(row, i)}
              </span>
            )}
            <Stack horizontal verticalAlign="start" tokens={{ childrenGap: 8 }}>
              <ListRow
                row={row}
                index={i}
                rows={rows}
                field={field}
                identity={k}
                Template={Template}
                onRowChange={handleRowChange}
              />
              {canRemove && (
                <IconButton
                  title={field.removeLabel ?? `Remove ${singular}`}
                  ariaLabel={field.removeLabel ?? `Remove ${singular}`}
                  onClick={() => handleRemove(i)}
                >
                  <Icon iconName="Delete" style={{ color: theme.palette.redDark }} />
                </IconButton>
              )}
            </Stack>
          </Stack>
        );
      })}

      {canAdd && (
        <DefaultButton
          text={field.addLabel ?? `Add ${singular}`}
          iconProps={{ iconName: 'Add' }}
          onClick={handleAdd}
          style={{ alignSelf: 'flex-start' }}
        />
      )}
    </Stack>
  );
};

export default ListField;
