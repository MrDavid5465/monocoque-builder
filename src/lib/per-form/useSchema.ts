import { listValidations } from './listValidations';
import type { Field, IListField, Schema, SchemaDefinition } from './types';

const FIELD_DEFAULTS: Partial<Field> = {
  defaultValue: '',
  display: true,
  required: false,
  validations: [],
};

/** Defaults that depend on the field's own type, applied before the flat
 *  FIELD_DEFAULTS above. A `list` must default to `[]`, not `''` —
 *  `useForm.defaultValues()` would otherwise seed an empty string where
 *  every consumer expects an array. Returns a fresh array per field so two
 *  list fields can never share (and mutate) one default. */
function typeDefaults(field: Field): Partial<Field> {
  return field.type === 'list' ? { defaultValue: [] } : {};
}

/** `required: true` is a trap on a list: `!!form[key]` is `true` for `[]`,
 *  so the stock required check passes on an empty list. Normalize it into
 *  the equivalent that actually works — `min: 1` — and drop `required` so
 *  the stock check doesn't also run. Authors should write `min` directly;
 *  the schema validator script warns about `required` on a list. */
function normalizeListRequired(field: Field): Field {
  if (field.type !== 'list' || !field.required) return field;
  const { required: _dropped, ...rest } = field;
  return { ...rest, required: false, min: Math.max(field.min ?? 0, 1) };
}

export function useSchema<T>(schema: SchemaDefinition<T>): Schema<SchemaDefinition<T>> {
  return Object.entries(schema).reduce((acc, [key, rawField]) => {
    const field = normalizeListRequired(rawField as Field);

    const withDefaults = Object.entries({ ...FIELD_DEFAULTS, ...typeDefaults(field) }).reduce(
      (f, [k, v]) => (f[k] === undefined ? { ...f, [k]: v } : f),
      field as Record<string, any>,
    );

    // A list field's parent-level validations are derived, never authored —
    // see listValidations. Appended after the author's own so a custom rule
    // still runs first.
    const finalField =
      withDefaults.type === 'list'
        ? {
            ...withDefaults,
            validations: [
              ...(withDefaults.validations ?? []),
              ...listValidations(key, withDefaults as IListField),
            ],
          }
        : withDefaults;

    return { ...acc, [key]: finalField };
  }, {} as Schema<SchemaDefinition<T>>);
}
