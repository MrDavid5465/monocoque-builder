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

export interface SpriteOption { text: string; value: string; }

// Runtime data a schema factory function may need to fill in field options
// it can't know statically (today: just the sprite file list, always
// pre-built with the "— none —" placeholder as its first entry — see
// ObjectExplorer.tsx's ComponentPropertiesPanel). Extend here, not with a
// new ad hoc prop, if a future field type needs another runtime-only input.
export interface SchemaProps {
  spriteOptions: SpriteOption[];
}

// Most component schemas are static plain objects. A schema whose field
// `options` depend on runtime data (sprite pickers) is instead authored as
// a factory function taking SchemaProps — see
// .claude/plans/schema-dispatcher-functions.md for the full rationale.
// registry.ts's getSchema()/ALL_SCHEMAS normalize both shapes for callers,
// so nothing outside this file and registry.ts needs to care which one a
// given component type uses.
export type ComponentSchemaSource = ComponentSchema | ((props: SchemaProps) => ComponentSchema);
