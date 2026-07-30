import { ComponentType } from '../../../../types/dashboard';
import { ComponentSchema } from './types';
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

const REGISTRY: Record<ComponentType, ComponentSchema> = {
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
};

export function getSchema(type: ComponentType): ComponentSchema {
  return REGISTRY[type];
}

export const ALL_SCHEMAS: ComponentSchema[] = Object.values(REGISTRY);

export const SPRITE_TYPES = new Set<ComponentType>([
  'static-sprite', 'needle-gauge', 'bar-gauge', 'sprite-bar-gauge', 'sprite-text-gauge', 'gif-gauge', 'transform-sprite',
]);

export const FREEFORM_TYPES = new Set<ComponentType>([
  'text-gauge', 'graph-bar-gauge', 'group', 'flag-display', 'flag-display-sprite',
  'button-control', 'slider-control', 'encoder-control',
  'arc-gauge-face', 'sprite-arc-gauge-face',
]);
