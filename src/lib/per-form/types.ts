import type { CSSProperties, FC, ReactNode } from 'react';

export interface StringTMap<T> { [key: string]: T }

export type IForm = StringTMap<any>;
export type ISchema = StringTMap<Required<Field>>;
export type IValidationErrors = StringTMap<string[]>;
export type IIs = StringTMap<boolean>;
export type IConverters = StringTMap<
  (key: string, values: IForm, defaultNull: any, dirty?: boolean) => any
>;

export interface Validation {
  test(form: IForm): boolean;
  /** A function message is resolved against the same form the test just
   *  saw, so a validation can report *which* part failed — used by
   *  `listValidations` to say "Row 2: Name is required" rather than a flat
   *  "one or more rows are invalid". Plain strings work unchanged. */
  message: string | ((form: IForm) => string);
}

export interface IField {
  dirty?: boolean;
  errors: string[];
  hint?: string;
  label: string;
  name: string;
  onChange: (name: string, value: any) => void;
  onFocus?: (name: string) => void;
  options?: { text: string; value: string }[];
  parent?: string;
  placeholder?: string;
  touched?: boolean;
  type: string;
  value: any;
}

export interface Field {
  [key: string]: any;
  type: string;
  label: string;
  /** Optional accordion section label. Fields with the same section value are
   *  grouped into a collapsible panel. Fields without a section render flat. */
  section?: string;
  /** Set on any field within a section to start that whole section
   *  collapsed rather than per-form's normal default-open behavior. */
  sectionCollapsed?: boolean;
  required?: boolean;
  validations?: Array<Validation>;
  display?: boolean;
  defaultValue?: any;
  defaultNull?: any;
}

/** Context handed to every row-level callback on a `list` field. */
export interface ListRowContext<Row = any> {
  row: Row;
  index: number;
  rows: Row[];
}

/** A `list` field's per-row schema. Either a plain SchemaDefinition, or a
 *  function of that row's own value — the function form is what lets one
 *  row's field config depend on that row's data (e.g. a gamepad mapping's
 *  `index` slider maxing at 5 for an axis but 31 for a button), and what
 *  lets a row's `options` exclude values already used by sibling rows. */
export type ListRowSchema<Row> =
  | SchemaDefinition<Row>
  | ((ctx: ListRowContext<Row>) => SchemaDefinition<Row>);

/** Row-level event emitted alongside the ordinary `onChange(name, rows)`,
 *  for consumers that must issue one targeted server mutation per row
 *  rather than persisting the whole array on a parent save. Replaces the
 *  hand-rolled `prevRef` diffing every such consumer currently writes. */
export type ListRowCommit<Row = any> =
  | { kind: 'add'; index: number; row: Row; rows: Row[] }
  | { kind: 'remove'; index: number; row: Row; rows: Row[] }
  | { kind: 'update'; index: number; row: Row; rows: Row[]; changed: string[] };

/** A repeating-rows field: its value is an array of row objects, each
 *  rendered by its own nested `useForm` over `itemSchema`.
 *
 *  Every property here reaches the Template for free — `FormWrapper`'s
 *  `fieldRenderProps` spreads all schema keys except FORM_INTERNAL_KEYS —
 *  so this interface is documentation and a checkable shape, not a
 *  requirement imposed on `Field` (whose index signature already permits
 *  arbitrary extras). */
export interface IListField<Row = any> extends Field {
  type: 'list';
  label: string;

  /** REQUIRED. See ListRowSchema.
   *
   *  HARD RULE: a function `itemSchema` may vary field *config*
   *  (label/min/max/options/disabled) but must return the SAME KEY SET on
   *  every call. `useForm` seeds its `values` once at mount from the
   *  then-current schema keys, so a key added later never receives a value
   *  — the same failure already recorded in Shakers/schemas.ts's lpfHz
   *  note. Asserted in dev builds. */
  itemSchema: ListRowSchema<Row>;

  /** Stable row identity. A row's nested form remounts ONLY when this
   *  changes, or when an incoming value genuinely differs from what this
   *  field last emitted (see ListField's echo detection). Defaults to the
   *  row index — supply a real id whenever rows can be removed or
   *  reordered, or removing row 0 will appear to edit row 1. */
  rowKey?: (row: Row, index: number) => string;
  rowLabel?: (row: Row, index: number) => ReactNode;

  /** Also drives "at least N"/"at most N" validations — see listValidations. */
  min?: number;
  max?: number;

  /** Rows are derived from external data; renders no add/remove UI at all.
   *  Mutually exclusive with `newRow`. */
  fixed?: boolean;

  /** Seed for a newly added row. Missing keys fall back to each field's own
   *  `defaultValue`. Required unless `fixed`. */
  newRow?: Partial<Row> | ((rows: Row[]) => Partial<Row>);

  singular?: string;
  addLabel?: string;
  removeLabel?: string;
  emptyText?: string;

  /** Cross-field coupling WITHIN one row. Given the field that just
   *  changed, return a patch merged into that row before it is emitted.
   *  Unlike inferring the change by diffing against a previous value, this
   *  is told directly which field moved. */
  deriveRow?: (
    ctx: ListRowContext<Row> & { field: string; value: any },
  ) => Partial<Row> | void;

  onRowCommit?: (ev: ListRowCommit<Row>) => void;

  /** Defer the upward emit while a slider/range in a row is being dragged,
   *  flushing on release. The required onActivate/onDeactivate props are
   *  injected into the row schema automatically — schema authors must not
   *  wire them by hand. Default true. */
  deferWhileDragging?: boolean;

  /** Per-row submit converters, passed to each row's own useForm. */
  converters?: IConverters;
  horizontal?: boolean;
  rowStyle?: CSSProperties;
}

export type Form<F> = { [key in keyof F]: any };
export type ValidationErrors<T> = { [key in keyof T]: string[] };
export type SchemaDefinition<T> = { [key in keyof T]: Field };
export type Schema<T> = { [key in keyof T]: Required<Field> };

export interface FormWrapperProps<T> {
  dirty?: IIs;
  errors: IValidationErrors;
  name?: string;
  onChange: (name: string, value: any) => void;
  onFocus?: (name: string) => void;
  schema: Schema<SchemaDefinition<T>>;
  Template: FC<IField>;
  touched?: IIs;
  values: IForm;
  fieldProps?: { [key: string]: any };
}
