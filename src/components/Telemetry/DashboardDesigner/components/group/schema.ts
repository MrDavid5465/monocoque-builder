import { ComponentSchema } from '../types';
import { COUNTER_ROTATE_FIELDS } from '../shared';

export const groupSchema: ComponentSchema = {
  type: 'group',
  label: 'Group',
  icon: 'GroupObject',
  allowChildren: true,
  bindable: true,
  fields: {
    name: { label: 'Name', type: 'text' },
    x:    { label: 'X', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    y:    { label: 'Y', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    ...COUNTER_ROTATE_FIELDS,
  },
};
