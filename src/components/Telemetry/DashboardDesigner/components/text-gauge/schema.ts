import { ComponentSchema } from '../types';
import { COUNTER_ROTATE_FIELDS } from '../shared';

export const textGaugeSchema: ComponentSchema = {
  type: 'text-gauge',
  label: 'Text Gauge',
  icon: 'Font',
  allowChildren: false,
  bindable: true,
  fields: {
    name: { label: 'Name', type: 'text' },
    x:    { label: 'X', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    y:    { label: 'Y', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    format: {
      label: 'Format', type: 'select', section: 'Format',
      options: [
        { text: 'Integer (0)', value: 'integer' },
        { text: '1 decimal (0.0)', value: 'decimal1' },
        { text: '2 decimals (0.00)', value: 'decimal2' },
        { text: 'Comma integer (1,234)', value: 'comma-integer' },
        { text: 'Time (0:00.000)', value: 'time' },
        { text: 'Raw (no transform)', value: 'raw' },
      ],
    },
    prefix:     { label: 'Prefix text', type: 'text', section: 'Format' },
    suffix:     { label: 'Suffix text', type: 'text', section: 'Format' },
    fontFamily: { label: 'Font family', type: 'text', section: 'Appearance' },
    fontSize:   { label: 'Font size (px)', type: 'slider', min: 6, max: 400, section: 'Appearance' },
    color:      { label: 'Colour (hex)', type: 'text', section: 'Appearance' },
    fontWeight: { label: 'Weight', type: 'select', section: 'Appearance', options: [{ text: 'Normal', value: 'normal' }, { text: 'Bold', value: 'bold' }] },
    textAlign:  { label: 'Align', type: 'select', section: 'Appearance', options: [{ text: 'Left', value: 'left' }, { text: 'Center', value: 'center' }, { text: 'Right', value: 'right' }] },
    ...COUNTER_ROTATE_FIELDS,
  },
};
