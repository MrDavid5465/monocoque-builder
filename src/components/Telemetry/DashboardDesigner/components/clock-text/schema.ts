import { ComponentSchema } from '../types';
import { COUNTER_ROTATE_FIELDS } from '../shared';

// Not `bindable: true` — a clock has nothing to bind to telemetry (its
// value is either the viewer's own wall clock or the day/night simulation's
// clock), the first schema in this app to legitimately omit it.
export const clockTextSchema: ComponentSchema = {
  type: 'clock-text',
  label: 'Clock (Text)',
  icon: 'Clock',
  allowChildren: false,
  fields: {
    name: { label: 'Name', type: 'text' },
    x:    { label: 'X', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    y:    { label: 'Y', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    clockSource: {
      label: 'Time source', type: 'select', section: 'Clock', defaultValue: 'real',
      options: [
        { text: 'Real (this device\'s clock)', value: 'real' },
        { text: 'Simulated (in-game day/night clock)', value: 'simulated' },
      ],
    },
    clockFormat: {
      label: 'Hour format', type: 'select', section: 'Clock', defaultValue: '24h',
      options: [{ text: '12-hour (AM/PM)', value: '12h' }, { text: '24-hour', value: '24h' }],
    },
    showSeconds: { label: 'Show seconds', type: 'checkbox', section: 'Clock' },
    fontFamily: { label: 'Font family', type: 'text', section: 'Appearance' },
    fontSize:   { label: 'Font size (px)', type: 'slider', min: 6, max: 400, section: 'Appearance' },
    color:      { label: 'Colour (hex)', type: 'text', section: 'Appearance' },
    fontWeight: { label: 'Weight', type: 'select', section: 'Appearance', options: [{ text: 'Normal', value: 'normal' }, { text: 'Bold', value: 'bold' }] },
    textAlign:  { label: 'Align', type: 'select', section: 'Appearance', options: [{ text: 'Left', value: 'left' }, { text: 'Center', value: 'center' }, { text: 'Right', value: 'right' }] },
    ...COUNTER_ROTATE_FIELDS,
  },
};
