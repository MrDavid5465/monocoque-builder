import { ComponentSchema, SchemaProps } from '../types';
import { COUNTER_ROTATE_FIELDS } from '../shared';

// Same per-character sprite-sheet mechanism as sprite-text-gauge (reuses its
// charWidth/charHeight/charMap/charGridCols/charSpacing fields directly —
// see ComponentNode's doc comment), just with the displayed string built
// from the clock instead of a telemetry binding. No numDigits/hideLeadingZeros/
// format/prefix/suffix — a clock's output is always a fixed HH:MM[:SS] shape,
// not a variable-width formatted number. Not `bindable: true`, same
// rationale as clock-text.
export const clockSpriteSchema = (props: SchemaProps): ComponentSchema => ({
  type: 'clock-sprite',
  label: 'Clock (Sprite)',
  icon: 'Clock',
  allowChildren: false,
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
    clockSource: {
      label: 'Time source', type: 'select', section: 'Clock', defaultValue: 'real',
      options: [
        { text: 'Real (this device\'s clock)', value: 'real' },
        { text: 'Simulated (in-game day/night clock)', value: 'simulated' },
      ],
    },
    clockFormat: {
      // No AM/PM glyph is assumed to exist in an arbitrary sprite sheet, so
      // 12-hour mode here shows the hour 1-12 with no AM/PM suffix — use
      // clock-text instead if that distinction needs to be visible.
      label: 'Hour format', type: 'select', section: 'Clock', defaultValue: '24h',
      options: [{ text: '12-hour (no AM/PM glyph)', value: '12h' }, { text: '24-hour', value: '24h' }],
    },
    showSeconds: { label: 'Show seconds', type: 'checkbox', section: 'Clock' },
    charWidth:   { label: 'Char width (px)', type: 'slider', min: 1, max: 500, section: 'Character Grid' },
    charHeight:  { label: 'Char height (px)', type: 'slider', min: 1, max: 500, section: 'Character Grid' },
    charMap:     { label: 'Char map', type: 'text', section: 'Character Grid' },
    charGridCols: { label: 'Grid columns', type: 'slider', min: 1, max: 50, section: 'Character Grid' },
    charSpacing: { label: 'Char spacing (px)', type: 'slider', min: -50, max: 100, section: 'Character Grid' },
    ...COUNTER_ROTATE_FIELDS,
  },
});
