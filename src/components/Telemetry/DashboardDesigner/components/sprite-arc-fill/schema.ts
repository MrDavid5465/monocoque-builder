import { ComponentSchema, SchemaProps } from '../types';
import { COUNTER_ROTATE_FIELDS, CROP_FIELDS } from '../shared';

export const spriteArcFillSchema = (props: SchemaProps): ComponentSchema => ({
  type: 'sprite-arc-fill',
  label: 'Sprite Arc Fill',
  icon: 'CircleHalfFull',
  allowChildren: false,
  bindable: true,
  bindingHint: 'Reveals the arc image angularly between Arc start/sweep as the value fills.',
  fields: {
    name:   { label: 'Name', type: 'text' },
    file:   { label: 'Arc sprite', type: 'select', options: props.spriteOptions },
    x:      { label: 'X', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    y:      { label: 'Y', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    width:  { label: 'Width', type: 'slider', min: 4, max: 5000, section: 'Layout' },
    height: { label: 'Height', type: 'slider', min: 4, max: 5000, section: 'Layout' },
    backlit: { label: 'Backlit (shines above night overlay)', type: 'checkbox', section: 'Appearance' },
    arcCenterX: { label: 'Arc center X within image', type: 'slider', min: -2000, max: 2000, section: 'Arc' },
    arcCenterY: { label: 'Arc center Y within image', type: 'slider', min: -2000, max: 2000, section: 'Arc' },
    arcStartAngle: { label: "Start angle (° from 12 o'clock, CW)", type: 'slider', min: -360, max: 360, section: 'Arc' },
    arcSweepAngle: { label: 'Sweep angle (°)', type: 'slider', min: 1, max: 360, section: 'Arc' },
    ...COUNTER_ROTATE_FIELDS,
    ...CROP_FIELDS,
  },
});
