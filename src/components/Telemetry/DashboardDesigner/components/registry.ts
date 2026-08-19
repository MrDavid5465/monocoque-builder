import { ComponentType } from '../../../../types/dashboard';
import { ComponentSchema, ComponentSchemaSource, SchemaProps } from './types';
import { staticSpriteSchema } from './static-sprite/schema';
import { needleGaugeSchema } from './needle-gauge/schema';
import { barGaugeSchema } from './bar-gauge/schema';
import { spriteBarGaugeSchema } from './sprite-bar-gauge/schema';
import { textGaugeSchema } from './text-gauge/schema';
import { spriteTextGaugeSchema } from './sprite-text-gauge/schema';
import { graphBarGaugeSchema } from './graph-bar-gauge/schema';
import { flagDisplaySchema } from './flag-display/schema';
import { flagDisplaySpriteSchema } from './flag-display-sprite/schema';
import { groupSchema } from './group/schema';
import { buttonControlSchema } from './button-control/schema';
import { sliderControlSchema } from './slider-control/schema';
import { encoderControlSchema } from './encoder-control/schema';
import { gifGaugeSchema } from './gif-gauge/schema';
import { arcGaugeFaceSchema } from './arc-gauge-face/schema';
import { spriteArcGaugeFaceSchema } from './sprite-arc-gauge-face/schema';
import { transformSpriteSchema } from './transform-sprite/schema';
import { spriteArcFillSchema } from './sprite-arc-fill/schema';
import { clockTextSchema } from './clock-text/schema';
import { clockSpriteSchema } from './clock-sprite/schema';

const REGISTRY: Record<ComponentType, ComponentSchemaSource> = {
  'static-sprite':       staticSpriteSchema,
  'needle-gauge':        needleGaugeSchema,
  'bar-gauge':           barGaugeSchema,
  'sprite-bar-gauge':    spriteBarGaugeSchema,
  'text-gauge':          textGaugeSchema,
  'sprite-text-gauge':   spriteTextGaugeSchema,
  'graph-bar-gauge':     graphBarGaugeSchema,
  'flag-display':        flagDisplaySchema,
  'flag-display-sprite': flagDisplaySpriteSchema,
  'group':               groupSchema,
  'button-control':      buttonControlSchema,
  'slider-control':      sliderControlSchema,
  'encoder-control':     encoderControlSchema,
  'gif-gauge':             gifGaugeSchema,
  'arc-gauge-face':        arcGaugeFaceSchema,
  'sprite-arc-gauge-face': spriteArcGaugeFaceSchema,
  'transform-sprite':      transformSpriteSchema,
  'sprite-arc-fill':       spriteArcFillSchema,
  'clock-text':            clockTextSchema,
  'clock-sprite':          clockSpriteSchema,
};

// Metadata-only callers (ALL_SCHEMAS below, and anything just checking
// .type/.allowChildren/etc.) don't need real field `options` — this default
// lets them omit `props` instead of every call site supplying an empty list.
// Callers that actually render the form (ObjectExplorer.tsx) always pass the
// real spriteOptions explicitly.
const EMPTY_SCHEMA_PROPS: SchemaProps = { spriteOptions: [] };

// Normalizes both REGISTRY shapes (plain schema vs. factory function needing
// runtime data — see ComponentSchemaSource) for callers, so nothing outside
// this file needs to know which one a given component type uses.
export function getSchema(type: ComponentType, props: SchemaProps = EMPTY_SCHEMA_PROPS): ComponentSchema {
  const source = REGISTRY[type];
  return typeof source === 'function' ? source(props) : source;
}

export const ALL_SCHEMAS: ComponentSchema[] = Object.values(REGISTRY).map(
  source => typeof source === 'function' ? source(EMPTY_SCHEMA_PROPS) : source,
);

export const SPRITE_TYPES = new Set<ComponentType>([
  'static-sprite', 'needle-gauge', 'bar-gauge', 'sprite-bar-gauge', 'sprite-text-gauge', 'gif-gauge', 'transform-sprite', 'sprite-arc-fill', 'clock-sprite',
]);

export const FREEFORM_TYPES = new Set<ComponentType>([
  'text-gauge', 'graph-bar-gauge', 'group', 'flag-display', 'flag-display-sprite',
  'button-control', 'slider-control', 'encoder-control',
  'arc-gauge-face', 'sprite-arc-gauge-face', 'clock-text',
]);
