import { ComponentSchema, SchemaProps } from '../types';
import { COUNTER_ROTATE_FIELDS } from '../shared';

export const gifGaugeSchema = (props: SchemaProps): ComponentSchema => ({
  type: 'gif-gauge',
  label: 'GIF Gauge',
  icon: 'GIF',
  allowChildren: true,
  bindable: true,
  bindingHint: 'Only used in value-driven mode.',
  fields: {
    name:   { label: 'Name', type: 'text' },
    file:   { label: 'Spritesheet', type: 'select', options: props.spriteOptions },
    x:      { label: 'X', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    y:      { label: 'Y', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    width:  { label: 'Width', type: 'slider', min: 4, max: 5000, section: 'Layout' },
    height: { label: 'Height', type: 'slider', min: 4, max: 5000, section: 'Layout' },
    gifFrameCount: { label: 'Frame count', type: 'slider', min: 1, max: 4096, section: 'Animation' },
    gifCols:       { label: 'Sheet columns (1 = vertical strip, frameCount = horizontal strip)', type: 'slider', min: 1, max: 4096, section: 'Animation' },
    gifMode: {
      label: 'Mode', type: 'select', section: 'Animation',
      options: [
        { text: 'Value-driven (binding scrubs frames)', value: 'value' },
        { text: 'Startup animation (plays once when sim goes active)', value: 'startup' },
      ],
    },
    gifFps:  { label: 'FPS (startup mode)', type: 'slider', min: 1, max: 120, section: 'Animation' },
    ...COUNTER_ROTATE_FIELDS,
  },
});
