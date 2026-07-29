import { ComponentSchema } from '../types';
import { COUNTER_ROTATE_FIELDS } from '../shared';

export const graphBarGaugeSchema: ComponentSchema = {
  type: 'graph-bar-gauge',
  label: 'Graph Bar Gauge',
  icon: 'BarChart4',
  allowChildren: false,
  bindable: true,
  fields: {
    name:   { label: 'Name', type: 'text' },
    x:      { label: 'X', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    y:      { label: 'Y', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    width:  { label: 'Width', type: 'slider', min: 4, max: 5000, section: 'Layout' },
    height: { label: 'Height', type: 'slider', min: 4, max: 5000, section: 'Layout' },
    graphType: {
      label: 'Style', type: 'select', section: 'Appearance',
      options: [
        { text: 'Horizontal bar', value: 'h-bar' },
        { text: 'Vertical bar', value: 'v-bar' },
        { text: 'Arc (sweep)', value: 'arc' },
        { text: 'Segmented LEDs', value: 'segments' },
      ],
    },
    colorLow:        { label: 'Colour (low)', type: 'text', section: 'Appearance' },
    colorMid:        { label: 'Colour (mid)', type: 'text', section: 'Appearance' },
    colorHigh:       { label: 'Colour (high)', type: 'text', section: 'Appearance' },
    backgroundColor: { label: 'Track colour', type: 'text', section: 'Appearance' },
    borderRadius:    { label: 'Corner radius', type: 'slider', min: 0, max: 200, section: 'Appearance' },
    segments:        { label: 'Segments (LED mode)', type: 'slider', min: 2, max: 64, section: 'Appearance' },
    showValue:       { label: 'Show value label', type: 'checkbox', section: 'Appearance' },
    // Optional: drive the colour gradient from a different field than fill
    // level (e.g. a tire widget where height tracks wear but colour tracks
    // temp). Leave colorField blank to use the Telemetry binding (merged
    // into this same Form/section by ObjectExplorer.tsx) for both, as before.
    colorField:    { label: 'Colour field (optional)', type: 'text', section: 'Telemetry' },
    colorInputMin: { label: 'Colour field min', type: 'slider', min: -99999, max: 99999, section: 'Telemetry' },
    colorInputMax: { label: 'Colour field max', type: 'slider', min: -99999, max: 99999, section: 'Telemetry' },
    ...COUNTER_ROTATE_FIELDS,
  },
};
