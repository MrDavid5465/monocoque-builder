import { describe, it, expect } from 'vitest';
import { listValidations } from '../lib/per-form/listValidations';
import { useSchema } from '../lib/per-form/useSchema';
import { useValidator } from '../lib/per-form/useValidator';
import type { IListField } from '../lib/per-form/types';

const resolve = (v: any, form: any) =>
  typeof v.message === 'function' ? v.message(form) : v.message;

const failures = (field: IListField, key: string, form: any) =>
  listValidations(key, field)
    .filter(v => !v.test(form))
    .map(v => resolve(v, form));

const mappingSchema = {
  name: { type: 'text', label: 'Name', required: true },
  index: { type: 'slider', label: 'Index' },
};

// ─── min / max ───────────────────────────────────────────────────────────────

describe('listValidations min/max', () => {
  const field = {
    type: 'list', label: 'Mappings', itemSchema: mappingSchema,
    min: 1, max: 2, singular: 'mapping',
  } as unknown as IListField;

  it('fails below min, naming the singular', () => {
    expect(failures(field, 'maps', { maps: [] }))
      .toContain('At least 1 mapping is required');
  });

  it('passes at min', () => {
    expect(failures(field, 'maps', { maps: [{ name: 'a', index: 0 }] }))
      .not.toContain('At least 1 mapping is required');
  });

  it('fails above max, pluralizing', () => {
    const rows = [1, 2, 3].map(n => ({ name: `n${n}`, index: 0 }));
    expect(failures(field, 'maps', { maps: rows }))
      .toContain('At most 2 mappings allowed');
  });

  it('treats a non-array value as empty rather than throwing', () => {
    expect(() => failures(field, 'maps', { maps: undefined })).not.toThrow();
    expect(failures(field, 'maps', { maps: undefined }))
      .toContain('At least 1 mapping is required');
  });
});

// ─── per-row errors ──────────────────────────────────────────────────────────

describe('listValidations row errors', () => {
  const field = {
    type: 'list', label: 'Mappings', itemSchema: mappingSchema, singular: 'mapping',
  } as unknown as IListField;

  it('reports the offending row index and field label', () => {
    const form = { maps: [{ name: 'ok', index: 0 }, { name: '', index: 0 }] };
    const msgs = failures(field, 'maps', form);
    expect(msgs.join(' ')).toContain('Row 2');
    expect(msgs.join(' ')).toContain('Name');
    expect(msgs.join(' ')).toContain('This field is required');
  });

  it('does not report a row that is fine', () => {
    const form = { maps: [{ name: 'ok', index: 0 }] };
    expect(failures(field, 'maps', form)).toHaveLength(0);
  });

  it('resolves a function itemSchema per row', () => {
    const dynamic = {
      type: 'list', label: 'Rows', singular: 'row',
      itemSchema: ({ row }: any) => ({
        value: { type: 'text', label: 'Value', required: row.mode === 'strict' },
      }),
    } as unknown as IListField;

    const lax = { rows: [{ mode: 'lax', value: '' }] };
    const strict = { rows: [{ mode: 'strict', value: '' }] };

    expect(failures(dynamic, 'rows', lax)).toHaveLength(0);
    expect(failures(dynamic, 'rows', strict).join(' ')).toContain('Row 1');
  });
});

// ─── integration with useSchema / useValidator ───────────────────────────────

describe('list field through the real schema + validator pipeline', () => {
  const schema: any = {
    maps: {
      type: 'list', label: 'Mappings', itemSchema: mappingSchema,
      min: 1, singular: 'mapping',
    },
  };

  it('defaults a list value to [] rather than the flat "" default', () => {
    expect((useSchema(schema) as any).maps.defaultValue).toEqual([]);
  });

  it('auto-attaches the derived validations without the author writing any', () => {
    expect((useSchema(schema) as any).maps.validations.length).toBeGreaterThan(0);
  });

  it('makes the parent form invalid when a row is invalid', () => {
    const validate = useValidator(useSchema(schema) as any);
    const errors = validate({ maps: [{ name: '', index: 0 }] });
    expect(errors.maps.length).toBeGreaterThan(0);
  });

  it('is valid when every row is valid', () => {
    const validate = useValidator(useSchema(schema) as any);
    expect(validate({ maps: [{ name: 'ok', index: 0 }] }).maps).toHaveLength(0);
  });

  it('does not false-positive the leading-space check on an array value', () => {
    // The flat base rule stringifies its input; [' x'] would otherwise trip
    // "can not start with blank spaces" on the *parent* list field.
    const loose: any = { maps: { type: 'list', label: 'M', itemSchema: {} } };
    const validate = useValidator(useSchema(loose) as any);
    expect(validate({ maps: [' x'] }).maps).toHaveLength(0);
  });

  it('normalizes required:true into min:1, which [] actually fails', () => {
    const req: any = {
      maps: { type: 'list', label: 'M', itemSchema: mappingSchema, required: true, singular: 'mapping' },
    };
    const built = useSchema(req) as any;
    expect(built.maps.min).toBe(1);
    expect(built.maps.required).toBe(false);
    // The stock required check would have passed here, since !![] === true.
    expect(useValidator(built)({ maps: [] }).maps.length).toBeGreaterThan(0);
  });
});
