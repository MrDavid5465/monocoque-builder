import { ComponentSchema } from '../types';
import { COUNTER_ROTATE_FIELDS } from '../shared';

export const transformSpriteSchema: ComponentSchema = {
  type: 'transform-sprite',
  label: 'Transform Sprite',
  icon: 'ArrowTallUpRight',
  allowChildren: true,
  bindable: true,
  bindingHint: 'Slides the sprite along Move axis between Move min/max.',
  fields: {
    name:   { label: 'Name', type: 'text' },
    file:   { label: 'Image', type: 'select', fileSelect: true },
    x:      { label: 'X', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    y:      { label: 'Y', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    width:  { label: 'Width', type: 'slider', min: 4, max: 5000, section: 'Layout' },
    height: { label: 'Height', type: 'slider', min: 4, max: 5000, section: 'Layout' },
    nightFile: { label: 'Night version (optional)', type: 'select', fileSelect: true, section: 'Appearance' },
    backlit:   { label: 'Backlit (shines above night overlay)', type: 'checkbox', section: 'Appearance' },
    moveAxis: {
      label: 'Move axis', type: 'select', section: 'Movement',
      options: [{ text: 'Horizontal (X)', value: 'x' }, { text: 'Vertical (Y)', value: 'y' }],
    },
    moveMin: { label: 'Move min (px)', type: 'slider', min: -2000, max: 2000, section: 'Movement' },
    moveMax: { label: 'Move max (px)', type: 'slider', min: -2000, max: 2000, section: 'Movement' },
    ...COUNTER_ROTATE_FIELDS,
  },
};
