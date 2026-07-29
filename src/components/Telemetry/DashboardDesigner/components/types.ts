import { ComponentType } from '../../../../types/dashboard';
import { Field } from '../../../../lib/per-form';

// Each component type's properties render through a real per-form `Form`
// (see ComponentPropertiesPanel in ObjectExplorer.tsx) — `fields` is a
// per-form schema (Record<fieldKey, Field>), not the old bespoke FieldDef[]
// FormRenderer.tsx used. `Field.type` is one of Fabric.tsx's `case '...'`
// values ('text'/'checkbox'/'select'/'range'/'slider'/'gamepad-select'/...)
// — see per-form/types.ts for the base Field shape and Fabric.tsx for which
// extra props each type reads off `rest`.
export interface ComponentSchema {
  type: ComponentType;
  label: string;
  icon: string;
  allowChildren: boolean;
  fields: Record<string, Field>;
  // Renders a TelemetryBindingSection below this schema's own Form — the
  // binding's field set (input/output range, advanced, influence) is
  // data-dependent, so it isn't part of `fields` itself. See
  // ObjectExplorer.tsx's ComponentPropertiesPanel and
  // components/TelemetryBindingSection.tsx.
  bindable?: boolean;
  bindingHint?: string;
}
