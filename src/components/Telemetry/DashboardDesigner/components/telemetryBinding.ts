import { Field } from '../../../../lib/per-form';
import { TelemetryBinding } from '../../../../types/dashboard';

export const TELEMETRY_BINDING_FIELDS = [
  'rpm', 'speed', 'gear', 'throttle', 'brake', 'clutch', 'steering',
  'gLat', 'gLon', 'gVert', 'fuel', 'turboBoost',
  'tyreTempFl', 'tyreTempFr', 'tyreTempRl', 'tyreTempRr',
  'tyreWearFl', 'tyreWearFr', 'tyreWearRl', 'tyreWearRr',
];

const FIELD_OPTIONS = TELEMETRY_BINDING_FIELDS.map(f => ({ text: f, value: f }));

// Seeds a binding's other fields the moment "Field" is switched away from
// "— none —" for the first time (they aren't part of `raw` yet, since
// they're only rendered once a binding exists).
const NEW_BINDING_DEFAULTS = { inputMin: 0, inputMax: 8000, outputMin: 0, outputMax: 360, startupSweep: true };

export type DraggingBindingField = 'inputMin' | 'inputMax' | 'outputMin' | 'outputMax' | null;

// Telemetry binding is a sub-schema merged directly into a bindable
// component's own field schema (same flat `fields` object, same single
// Form) rather than a field type of its own or a separate Form — "Field"
// always offers "— none —", which IS how a binding gets removed. Grouped
// under the shared 'Telemetry' section key so it visually co-locates with
// any component-specific fields that already use that section (e.g.
// graph-bar-gauge's colorField).
export function buildBindingFieldSchema(
  binding: TelemetryBinding | undefined,
  advancedEnabled: boolean,
  onDragStart: (field: DraggingBindingField) => void,
  onDragEnd: () => void,
  hint?: string,
): Record<string, Field> {
  const fields: Record<string, Field> = {
    field: {
      label: hint ? `Telemetry field — ${hint}` : 'Telemetry field',
      type: 'select', section: 'Telemetry',
      options: [{ text: '— none —', value: '' }, ...FIELD_OPTIONS],
    },
  };

  if (!binding) return fields;

  const slider = (f: DraggingBindingField, extra: { label: string; min: number; max: number }): Field => ({
    type: 'slider', section: 'Telemetry',
    onActivate: () => onDragStart(f),
    onDeactivate: onDragEnd,
    ...extra,
  });

  fields.inputMin = slider('inputMin', { label: 'Input min', min: -99999, max: 99999 });
  fields.inputMax = slider('inputMax', { label: 'Input max', min: -99999, max: 99999 });
  fields.outputMin = slider('outputMin', { label: 'Output min', min: -720, max: 720 });
  fields.outputMax = slider('outputMax', { label: 'Output max', min: -720, max: 720 });
  fields.startupSweep = { label: 'Include in startup sweep', type: 'checkbox', section: 'Telemetry' };
  fields.advancedEnabled = { label: 'Advanced expression', type: 'checkbox', section: 'Telemetry' };
  if (advancedEnabled) {
    fields.advanced = {
      label: 'Expression', type: 'text', section: 'Telemetry',
      multiline: true, rows: 4,
      styles: { field: { fontFamily: 'monospace', fontSize: '0.8em' } },
    };
  }
  fields.influenceField = {
    label: 'Influence from (optional)', type: 'select', section: 'Telemetry',
    options: [{ text: 'None', value: '' }, ...FIELD_OPTIONS],
  };
  if (binding.influence) {
    fields.influenceWeight = { label: 'Influence weight', type: 'slider', section: 'Telemetry', min: -1, max: 1, step: 0.01 };
  }
  return fields;
}

export function buildBindingInitialValues(binding: TelemetryBinding | undefined, advancedEnabled: boolean): Record<string, any> {
  return {
    field: binding?.field ?? '',
    inputMin: binding?.inputMin ?? NEW_BINDING_DEFAULTS.inputMin,
    inputMax: binding?.inputMax ?? NEW_BINDING_DEFAULTS.inputMax,
    outputMin: binding?.outputMin ?? NEW_BINDING_DEFAULTS.outputMin,
    outputMax: binding?.outputMax ?? NEW_BINDING_DEFAULTS.outputMax,
    startupSweep: binding?.startupSweep ?? NEW_BINDING_DEFAULTS.startupSweep,
    advancedEnabled,
    advanced: binding?.advanced ?? '',
    influenceField: binding?.influence?.field ?? '',
    influenceWeight: binding?.influence?.weight ?? 0.2,
  };
}

// `raw` here is the *whole* form's raw values (binding fields plus every
// other field the node's own schema declares) — only the binding-shaped
// keys are read out and reassembled.
export function reassembleBinding(raw: any, advancedEnabled: boolean): TelemetryBinding | undefined {
  if (!raw.field) return undefined;
  return {
    field: raw.field,
    inputMin: raw.inputMin ?? NEW_BINDING_DEFAULTS.inputMin,
    inputMax: raw.inputMax ?? NEW_BINDING_DEFAULTS.inputMax,
    outputMin: raw.outputMin ?? NEW_BINDING_DEFAULTS.outputMin,
    outputMax: raw.outputMax ?? NEW_BINDING_DEFAULTS.outputMax,
    startupSweep: raw.startupSweep ?? NEW_BINDING_DEFAULTS.startupSweep,
    advanced: advancedEnabled ? raw.advanced : undefined,
    influence: raw.influenceField ? { field: raw.influenceField, weight: raw.influenceWeight ?? 0.2 } : undefined,
  };
}
