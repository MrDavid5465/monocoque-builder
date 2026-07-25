import type { RefObject, FC } from 'react';

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
  message: string;
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

export interface ISubform<T> {
  name: { plural: string; singular: string };
  type: 'list' | 'single';
  max?: number;
  min?: number;
  start?: number;
  schema: SchemaDefinition<T>;
}

export type MasterFormState = { [key: string]: RefObject<any> };
export type MasterForm<T, F> = { forms: { [key in keyof T]: ISubform<F> } } & { name: string };
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
