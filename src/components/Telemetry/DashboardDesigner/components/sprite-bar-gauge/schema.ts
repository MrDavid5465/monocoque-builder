import { ComponentSchema } from '../types';
import { COUNTER_ROTATE_FIELDS } from '../shared';

export const spriteBarGaugeSchema: ComponentSchema = {
  type: 'sprite-bar-gauge',
  label: 'Sprite Bar Gauge',
  icon: 'ProgressRingDots',
  allowChildren: false,
  bindable: true,
  fields: {
    name:           { label: 'Name', type: 'text' },
    file:           { label: 'Filled sprite', type: 'select', fileSelect: true },
    backgroundFile: { label: 'Empty sprite (opt)', type: 'select', fileSelect: true },
    x:      { label: 'X', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    y:      { label: 'Y', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    width:  { label: 'Width', type: 'slider', min: 4, max: 5000, section: 'Layout' },
    height: { label: 'Height', type: 'slider', min: 4, max: 5000, section: 'Layout' },
    backlit: { label: 'Backlit (shines above night overlay)', type: 'checkbox', section: 'Appearance' },
    fillDirection: {
      label: 'Fill direction', type: 'select', section: 'Appearance',
      options: [
        { text: 'Left → Right', value: 'ltr' },
        { text: 'Right → Left', value: 'rtl' },
        { text: 'Bottom → Top', value: 'btt' },
        { text: 'Top → Bottom', value: 'ttb' },
      ],
    },
    ...COUNTER_ROTATE_FIELDS,
  },
};
