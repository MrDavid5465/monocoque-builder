import { ComponentSchema } from '../types';

export const sliderControlSchema: ComponentSchema = {
  type: 'slider-control',
  label: 'Slider Control',
  icon: 'Slider',
  allowChildren: false,
  bindable: true,
  fields: {
    name:   { label: 'Name', type: 'text' },
    x:      { label: 'X', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    y:      { label: 'Y', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    width:  { label: 'Width', type: 'slider', min: 10, max: 2000, section: 'Layout' },
    height: { label: 'Height', type: 'slider', min: 10, max: 2000, section: 'Layout' },
    sliderOrientation: {
      label: 'Orientation', type: 'select', section: 'Track',
      options: [
        { text: 'Horizontal', value: 'horizontal' },
        { text: 'Vertical', value: 'vertical' },
      ],
    },
    sliderTrackColor:        { label: 'Track color', type: 'text', section: 'Track' },
    sliderTrackBorderRadius: { label: 'Track border radius', type: 'slider', min: 0, max: 100, section: 'Track' },
    sliderThumbFile:  { label: 'Thumb sprite', type: 'select', fileSelect: true, section: 'Thumb' },
    sliderThumbColor: { label: 'Thumb color', type: 'text', section: 'Thumb' },
    sliderThumbW:     { label: 'Thumb width', type: 'slider', min: 4, max: 200, section: 'Thumb' },
    sliderThumbH:     { label: 'Thumb height', type: 'slider', min: 4, max: 200, section: 'Thumb' },
    sliderMin:     { label: 'Axis min (-1..0)', type: 'slider', min: -1, max: 0, step: 0.1, section: 'Range' },
    sliderMax:     { label: 'Axis max (0..1)', type: 'slider', min: 0, max: 1, step: 0.1, section: 'Range' },
    sliderDefault: { label: 'Default value', type: 'slider', min: -1, max: 1, step: 0.1, section: 'Range' },
    gamepadMappingId: { label: 'Gamepad axis', type: 'gamepad-select', gamepadFilter: 'axis', section: 'Gamepad' },
  },
};
