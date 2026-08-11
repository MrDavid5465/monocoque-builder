import { ComponentSchema, SchemaProps } from '../types';
import { COUNTER_ROTATE_FIELDS, CROP_FIELDS } from '../shared';

export const barGaugeSchema = (props: SchemaProps): ComponentSchema => ({
  type: 'bar-gauge',
  label: 'Bar Gauge',
  icon: 'ProgressRingDots',
  allowChildren: true,
  bindable: true,
  fields: {
    name:   { label: 'Name', type: 'text' },
    file:   { label: 'Image', type: 'select', options: props.spriteOptions },
    x:      { label: 'X', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    y:      { label: 'Y', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    width:  { label: 'Width', type: 'slider', min: 4, max: 5000, section: 'Layout' },
    height: { label: 'Height', type: 'slider', min: 4, max: 5000, section: 'Layout' },
    nightFile: { label: 'Night version (optional)', type: 'select', options: props.spriteOptions, section: 'Appearance' },
    backlit:   { label: 'Backlit (shines above night overlay)', type: 'checkbox', section: 'Appearance' },
    ...COUNTER_ROTATE_FIELDS,
    ...CROP_FIELDS,
  },
});
