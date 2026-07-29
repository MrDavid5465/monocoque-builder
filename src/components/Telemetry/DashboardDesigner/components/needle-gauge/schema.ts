import { ComponentSchema } from '../types';
import { COUNTER_ROTATE_FIELDS } from '../shared';

export const needleGaugeSchema: ComponentSchema = {
  type: 'needle-gauge',
  label: 'Needle Gauge',
  icon: 'Rotate',
  allowChildren: true,
  bindable: true,
  fields: {
    name:   { label: 'Name', type: 'text' },
    file:   { label: 'Image', type: 'select', fileSelect: true },
    x:      { label: 'X (pivot)', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    y:      { label: 'Y (pivot)', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    width:  { label: 'Width', type: 'slider', min: 4, max: 5000, section: 'Layout' },
    height: { label: 'Height', type: 'slider', min: 4, max: 5000, section: 'Layout' },
    nightFile: { label: 'Night version (optional)', type: 'select', fileSelect: true, section: 'Appearance' },
    backlit:   { label: 'Backlit (shines above night overlay)', type: 'checkbox', section: 'Appearance' },
    rotationX: { label: 'Pivot X within image', type: 'slider', min: 0, max: 2000, section: 'Pivot' },
    rotationY: { label: 'Pivot Y within image', type: 'slider', min: 0, max: 2000, section: 'Pivot' },
    ...COUNTER_ROTATE_FIELDS,
  },
};
