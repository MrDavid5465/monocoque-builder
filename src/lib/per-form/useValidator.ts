import type { IForm, IValidationErrors, Schema, SchemaDefinition, Validation } from './types';

/** Resolves a Validation's message, which may be a function of the form it
 *  was tested against (see Validation.message). */
export function resolveMessage(v: Validation, values: IForm): string {
  return typeof v.message === 'function' ? v.message(values) : v.message;
}

/** The whole validation rule set for one field, in evaluation order.
 *  Exported so `listValidations` can re-run the exact same rules per row —
 *  a `list` field's parent-level aggregate must agree with what each row's
 *  own nested form is already showing inline, and duplicating the rules
 *  here would let the two drift.
 *
 *  `list` fields skip the leading-blank-space base check: `form[k]` is an
 *  array there, and `/^\s+/` stringifies it, so a first row of `' x'`
 *  would false-positive against the *parent* field. */
export function fieldValidations(field: Record<string, any>, key: string): Validation[] {
  const { required, validations = [], type } = field;
  const base: Validation[] = [];

  if (type !== 'list') {
    base.push({
      test: (form) => !/^\s+/.test(form[key]),
      message: 'This field can not start with blank spaces',
    });
  }

  if (required) {
    base.push({
      test: (form) => !!form[key],
      message: 'This field is required',
    });
  }

  return [...base, ...validations];
}

/** Runs every field's rules against `values`, keyed by field name. Pure —
 *  shared by `useValidator` and `listValidations`. */
export function validateValues(
  schemaMap: Record<string, any>,
  values: IForm,
): IValidationErrors {
  const keys = Object.keys(values).filter(k => !!schemaMap[k]);
  return keys.reduce((acc, k) => {
    const errors = fieldValidations(schemaMap[k], k)
      .filter(v => !v.test(values))
      .map(v => resolveMessage(v, values));
    return { ...acc, [k]: errors };
  }, {} as IValidationErrors);
}

export function useValidator<T>(schema: Schema<SchemaDefinition<T>>) {
  return function validate(values: IForm): IValidationErrors {
    return validateValues(schema as Record<string, any>, values);
  };
}
