// Display text for the admin screens, kept apart from `name`, whose
// singular/plural are also the GraphQL stems (getDevices, addDevice, ...).
//
// Without a `labels` prop every screen reads exactly as it always has
// ("Listing Devices", "Showing Device", "Edit Device"). Passing `labels`, even
// `{}`, switches to text that reads like English ("Devices", "Device",
// "Edit device"), and any entry can be overridden. Templates may use
// {singular}, {plural}, {singularLower}, {pluralLower}, or be a function of
// those values.
import type { Name } from './index';

export type LabelTemplate = string | ((vars: Record<string, string>) => string);

export interface ITALabels {
  /** Display name of one record. Default `name.singular`. */
  singular?: string;
  /** Display name of several records. Default `name.plural`. */
  plural?: string;
  /** List page heading. */
  listHeading?: LabelTemplate;
  /** Show page heading. */
  showHeading?: LabelTemplate;
  /** New page heading. */
  newHeading?: LabelTemplate;
  /** Edit page heading. */
  editHeading?: LabelTemplate;
  /** Per-row / per-card delete button's tooltip. */
  deleteTitle?: LabelTemplate;
  /** Confirmation for a list row's / card's delete button. */
  deleteConfirm?: LabelTemplate;
  /** Confirmation for the Show page's Delete button. */
  deletePrompt?: LabelTemplate;
  /** Accessible names of the icon-only buttons. */
  back?: LabelTemplate;
  edit?: LabelTemplate;
  add?: LabelTemplate;
}

export type ResolvedLabels = Required<Omit<ITALabels, 'singular' | 'plural'>> & {
  singular: string;
  plural: string;
  singularLower: string;
  pluralLower: string;
};

const ARIA = {
  back: 'Back',
  edit: 'Edit {singularLower}',
  add: 'Add {singularLower}',
};

/** The text every screen has always shown; used when there is no `labels` prop. */
export const LEGACY_LABELS: Required<Omit<ITALabels, 'singular' | 'plural'>> = {
  listHeading: 'Listing {plural}',
  showHeading: 'Showing {singular}',
  newHeading: 'New {singular}',
  editHeading: 'Edit {singular}',
  deleteTitle: 'Delete {singular}',
  deleteConfirm: 'Delete this {singular}? This cannot be undone.',
  deletePrompt: "Are you sure you'd like to delete this {singular}?",
  ...ARIA,
};

/** The defaults once `labels` is passed. */
export const DEFAULT_LABELS: Required<Omit<ITALabels, 'singular' | 'plural'>> = {
  listHeading: '{plural}',
  showHeading: '{singular}',
  newHeading: 'New {singularLower}',
  editHeading: 'Edit {singularLower}',
  deleteTitle: 'Delete {singularLower}',
  deleteConfirm: 'Delete this {singularLower}? This cannot be undone.',
  deletePrompt: 'Delete this {singularLower}? This cannot be undone.',
  ...ARIA,
};

// "Device" -> "device", but "GPU" and "USB hub" stay as they are.
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** Merges `name`, the defaults and `labels`. No `labels` = the legacy text. */
export function resolveLabels(name: Name, labels?: ITALabels): ResolvedLabels {
  const { singular = name.singular, plural = name.plural, ...rest } = labels ?? {};
  const base = labels ? DEFAULT_LABELS : LEGACY_LABELS;
  const defined = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  return {
    ...base,
    ...defined,
    singular,
    plural,
    singularLower: lowerFirst(singular),
    pluralLower: lowerFirst(plural),
  };
}

/** Fills one entry: label(l, 'editHeading') -> "Edit device". */
export function label(labels: ResolvedLabels, key: keyof ITALabels): string {
  const template = (labels as any)[key] as LabelTemplate;
  const vars: Record<string, string> = {
    singular: labels.singular,
    plural: labels.plural,
    singularLower: labels.singularLower,
    pluralLower: labels.pluralLower,
  };
  if (typeof template === 'function') return template(vars);
  return String(template).replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}
