import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Form from '../lib/typical-admin-fabric/lib/templates/Form';

/** Renders a real Form containing a real `list` field — exercising the whole
 *  pipeline (useSchema's derived validations, FormWrapper, Fabric's case,
 *  ListField, and each row's nested useForm), not a mock of it. */
function renderList(field: any, initialRows: any[], onChange = vi.fn()) {
  render(
    React.createElement(Form as any, {
      form: { items: { label: 'Items', ...field } },
      name: 'testForm',
      initialValues: { items: initialRows },
      onChange,
    }),
  );
  return onChange;
}

const textRow = {
  type: 'list',
  itemSchema: { title: { type: 'text', label: 'Title' } },
  singular: 'item',
  newRow: { title: '' },
};

const lastRows = (onChange: any) => {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]?.[1]?.raw?.items;
};

describe('ListField rendering', () => {
  it('renders one nested form per row', () => {
    renderList(textRow, [{ title: 'alpha' }, { title: 'beta' }]);
    expect(screen.getByDisplayValue('alpha')).toBeTruthy();
    expect(screen.getByDisplayValue('beta')).toBeTruthy();
  });

  it('shows emptyText when there are no rows', () => {
    renderList({ ...textRow, emptyText: 'Nothing here' }, []);
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });

  it('renders rowLabel per row', () => {
    renderList(
      { ...textRow, rowLabel: (_r: any, i: number) => `Position ${i + 1}` },
      [{ title: 'a' }, { title: 'b' }],
    );
    expect(screen.getByText('Position 1')).toBeTruthy();
    expect(screen.getByText('Position 2')).toBeTruthy();
  });
});

describe('ListField editing', () => {
  it('emits the whole array with the edited row updated', () => {
    const onChange = renderList(textRow, [{ title: 'alpha' }, { title: 'beta' }]);
    fireEvent.change(screen.getByDisplayValue('alpha'), { target: { value: 'ALPHA' } });
    expect(lastRows(onChange)).toEqual([{ title: 'ALPHA' }, { title: 'beta' }]);
  });

  it('does not lose the very first edit (the swallowed-first-edit regression)', () => {
    const onChange = renderList(textRow, [{ title: 'x' }]);
    const before = onChange.mock.calls.length;
    fireEvent.change(screen.getByDisplayValue('x'), { target: { value: 'y' } });
    expect(onChange.mock.calls.length).toBeGreaterThan(before);
    expect(lastRows(onChange)).toEqual([{ title: 'y' }]);
  });

  it('preserves row keys that are not rendered as fields', () => {
    // useForm only seeds values for schema keys, so identity/metadata a row
    // carries but doesn't render (channelId here) would otherwise vanish
    // from the emitted array on the first edit.
    const onChange = renderList(
      { type: 'list', singular: 'row', itemSchema: { day: { type: 'text', label: 'Day' } } },
      [{ channelId: 7, name: 'Lamp 1', day: '0' }],
    );
    fireEvent.change(screen.getByDisplayValue('0'), { target: { value: '0.2' } });
    expect(lastRows(onChange)).toEqual([{ channelId: 7, name: 'Lamp 1', day: '0.2' }]);
  });

  it('edits the correct row when several share a shape', () => {
    const onChange = renderList(textRow, [{ title: 'a' }, { title: 'b' }, { title: 'c' }]);
    fireEvent.change(screen.getByDisplayValue('b'), { target: { value: 'B' } });
    expect(lastRows(onChange)).toEqual([{ title: 'a' }, { title: 'B' }, { title: 'c' }]);
  });
});

describe('ListField add/remove', () => {
  it('adds a row seeded from newRow', () => {
    const onChange = renderList({ ...textRow, newRow: { title: 'seeded' } }, []);
    fireEvent.click(screen.getByRole('button', { name: /add item/i }));
    expect(lastRows(onChange)).toEqual([{ title: 'seeded' }]);
  });

  it('removes the clicked row, not the last one', () => {
    const onChange = renderList(textRow, [{ title: 'a' }, { title: 'b' }, { title: 'c' }]);
    const removes = screen.getAllByRole('button', { name: /remove item/i });
    fireEvent.click(removes[1]);
    expect(lastRows(onChange)).toEqual([{ title: 'a' }, { title: 'c' }]);
  });

  it('hides add/remove entirely when fixed', () => {
    renderList({ ...textRow, fixed: true }, [{ title: 'a' }]);
    expect(screen.queryByRole('button', { name: /add item/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove item/i })).toBeNull();
  });

  it('stops adding at max and stops removing at min', () => {
    renderList({ ...textRow, min: 1, max: 2 }, [{ title: 'a' }, { title: 'b' }]);
    expect(screen.queryByRole('button', { name: /add item/i })).toBeNull();
    expect(screen.getAllByRole('button', { name: /remove item/i })).toHaveLength(2);
  });

  it('does not offer remove when at min', () => {
    renderList({ ...textRow, min: 1 }, [{ title: 'only' }]);
    expect(screen.queryByRole('button', { name: /remove item/i })).toBeNull();
  });
});

describe('ListField row-dependent schema', () => {
  it('resolves itemSchema per row from that row own values', () => {
    renderList(
      {
        type: 'list',
        singular: 'row',
        itemSchema: ({ row }: any) => ({
          kind: { type: 'text', label: 'Kind' },
          value: { type: 'text', label: row.kind === 'axis' ? 'Axis value' : 'Button value' },
        }),
      },
      [{ kind: 'axis', value: '1' }, { kind: 'button', value: '2' }],
    );
    expect(screen.getByText('Axis value')).toBeTruthy();
    expect(screen.getByText('Button value')).toBeTruthy();
  });

  it('applies a deriveRow patch alongside the edit', () => {
    const onChange = renderList(
      {
        type: 'list',
        singular: 'row',
        itemSchema: { kind: { type: 'text', label: 'Kind' }, index: { type: 'text', label: 'Index' } },
        deriveRow: ({ field }: any) => (field === 'kind' ? { index: '0' } : undefined),
      },
      [{ kind: 'button', index: '31' }],
    );
    fireEvent.change(screen.getByDisplayValue('button'), { target: { value: 'axis' } });
    expect(lastRows(onChange)).toEqual([{ kind: 'axis', index: '0' }]);
  });
});
