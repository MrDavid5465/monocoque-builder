import { ComponentSchema, SchemaProps } from '../types';
import { COUNTER_ROTATE_FIELDS } from '../shared';

export const spriteTextGaugeSchema = (props: SchemaProps): ComponentSchema => ({
  type: 'sprite-text-gauge',
  label: 'Sprite Text Gauge',
  icon: 'NumberSymbol',
  allowChildren: false,
  bindable: true,
  fields: {
    name: { label: 'Name', type: 'text' },
    file: { label: 'Sprite sheet', type: 'select', options: props.spriteOptions },
    x:    { label: 'X', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    y:    { label: 'Y', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    textAlign: {
      label: 'Horizontal align', type: 'select', section: 'Layout',
      options: [{ text: 'Left', value: 'left' }, { text: 'Center', value: 'center' }, { text: 'Right', value: 'right' }],
    },
    verticalAlign: {
      label: 'Vertical align', type: 'select', section: 'Layout',
      options: [{ text: 'Top', value: 'top' }, { text: 'Middle', value: 'middle' }, { text: 'Bottom', value: 'bottom' }],
    },
    charWidth:   { label: 'Char width (px)', type: 'slider', min: 1, max: 500, section: 'Character Grid' },
    charHeight:  { label: 'Char height (px)', type: 'slider', min: 1, max: 500, section: 'Character Grid' },
    charMap:     { label: 'Char map', type: 'text', section: 'Character Grid' },
    charGridCols: { label: 'Grid columns', type: 'slider', min: 1, max: 50, section: 'Character Grid' },
    charSpacing: { label: 'Char spacing (px)', type: 'slider', min: -50, max: 100, section: 'Character Grid' },
    numDigits:   { label: 'Display digits', type: 'slider', min: 1, max: 20, section: 'Character Grid' },
    hideLeadingZeros: { label: 'Hide leading zeros', type: 'checkbox', section: 'Character Grid' },
    format: {
      label: 'Format', type: 'select', section: 'Format',
      options: [
        { text: 'Integer', value: 'integer' },
        { text: '1 decimal', value: 'decimal1' },
        { text: '2 decimals', value: 'decimal2' },
        { text: 'Comma integer', value: 'comma-integer' },
        { text: 'Time (m:ss.mmm)', value: 'time' },
        { text: 'Raw', value: 'raw' },
      ],
    },
    prefix: { label: 'Prefix text', type: 'text', section: 'Format' },
    suffix: { label: 'Suffix text', type: 'text', section: 'Format' },
    ...COUNTER_ROTATE_FIELDS,
  },
});
