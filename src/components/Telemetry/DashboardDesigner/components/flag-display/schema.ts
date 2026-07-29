import { ComponentSchema } from '../types';

export const flagDisplaySchema: ComponentSchema = {
  type: 'flag-display',
  label: 'Flag Display',
  icon: 'Flag',
  allowChildren: false,
  bindable: true,
  fields: {
    name:   { label: 'Name', type: 'text' },
    x:      { label: 'X', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    y:      { label: 'Y', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    width:  { label: 'Width', type: 'slider', min: 4, max: 5000, section: 'Layout' },
    height: { label: 'Height', type: 'slider', min: 4, max: 5000, section: 'Layout' },
    gridCols: { label: 'Grid columns', type: 'slider', min: 1, max: 20, section: 'Grid' },
    gridRows: { label: 'Grid rows', type: 'slider', min: 1, max: 20, section: 'Grid' },
    gridGap:  { label: 'Cell gap (px)', type: 'slider', min: 0, max: 40, section: 'Grid' },
    borderRadius: { label: 'Corner radius', type: 'slider', min: 0, max: 500, section: 'Grid' },
    borderWidth:  { label: 'Border width', type: 'slider', min: 0, max: 20, section: 'Grid' },
    borderColor:  { label: 'Border colour', type: 'text', section: 'Grid' },
    showGear:     { label: 'Show gear', type: 'checkbox', section: 'Gear' },
    gearFontSize: { label: 'Gear font size', type: 'slider', min: 4, max: 400, section: 'Gear' },
    gearColor:    { label: 'Gear colour', type: 'text', section: 'Gear' },
    gearOffsetX:  { label: 'Gear offset X', type: 'slider', min: -500, max: 500, section: 'Gear' },
    gearOffsetY:  { label: 'Gear offset Y', type: 'slider', min: -500, max: 500, section: 'Gear' },
  },
};
