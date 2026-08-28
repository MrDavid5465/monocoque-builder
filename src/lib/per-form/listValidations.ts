import type { IForm, IListField, Validation } from './types';
import { fieldValidations, resolveMessage } from './useValidator';

const asRows = (v: any): any[] => (Array.isArray(v) ? v : []);

const plural = (n: number, singular: string) => (n === 1 ? singular : `${singular}s`);

/** Resolves a `list` field's row schema for one row. Deliberately does NOT
 *  go through `useSchema` — that would be a circular import (useSchema
 *  calls this), and the only defaults these rules need (`required` falsy,
 *  `validations` empty) are already handled by `fieldValidations`. */
export function resolveRowSchema(field: IListField, row: any, index: number, rows: any[]) {
  const { itemSchema } = field;
  return typeof itemSchema === 'function'
    ? (itemSchema as (ctx: any) => any)({ row, index, rows })
    : itemSchema;
}

/** Derives the parent-form validations for a `list` field.
 *
 *  Per-row errors cannot live in the parent's error map — `useValidator`
 *  keys errors flat by top-level field name only. So instead of plumbing
 *  row state upward, row validity is re-derived here as a pure function of
 *  the emitted array: the rows are right there in `form[key]`. That keeps
 *  `useForm` completely untouched while still flipping its `isValid()`
 *  false, which is what actually blocks a parent save.
 *
 *  Attached automatically by `useSchema` — schema authors never write these. */
export function listValidations(key: string, field: IListField): Validation[] {
  const out: Validation[] = [];
  const { min, max, singular = 'row' } = field;

  if (typeof min === 'number' && min > 0) {
    out.push({
      test: (form: IForm) => asRows(form[key]).length >= min,
      message: `At least ${min} ${plural(min, singular)} ${min === 1 ? 'is' : 'are'} required`,
    });
  }

  if (typeof max === 'number' && Number.isFinite(max)) {
    out.push({
      test: (form: IForm) => asRows(form[key]).length <= max,
      message: `At most ${max} ${plural(max, singular)} allowed`,
    });
  }

  // One validation covering every row, with a function message so the
  // parent-level Feedback can name the offending row and field rather than
  // just asserting something somewhere is wrong.
  out.push({
    test: (form: IForm) => collectRowErrors(key, field, form).length === 0,
    message: (form: IForm) => collectRowErrors(key, field, form).join('; '),
  });

  return out;
}

function collectRowErrors(key: string, field: IListField, form: IForm): string[] {
  const rows = asRows(form[key]);
  const messages: string[] = [];

  rows.forEach((row, index) => {
    const rowSchema = resolveRowSchema(field, row, index, rows) as Record<string, any>;
    if (!rowSchema) return;

    Object.keys(rowSchema).forEach(fieldKey => {
      const failed = fieldValidations(rowSchema[fieldKey], fieldKey)
        .filter(v => !v.test(row ?? {}))
        .map(v => resolveMessage(v, row ?? {}));

      failed.forEach(m => {
        const label = rowSchema[fieldKey]?.label ?? fieldKey;
        messages.push(`Row ${index + 1}: ${label} — ${m}`);
      });
    });
  });

  return messages;
}
