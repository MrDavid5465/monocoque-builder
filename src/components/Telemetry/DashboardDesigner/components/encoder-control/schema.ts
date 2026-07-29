import { ComponentSchema } from '../types';

export const encoderControlSchema: ComponentSchema = {
  type: 'encoder-control',
  label: 'Encoder Control',
  icon: 'Settings',
  allowChildren: false,
  bindable: true,
  fields: {
    name:   { label: 'Name', type: 'text' },
    x:      { label: 'X', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    y:      { label: 'Y', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    width:  { label: 'Width', type: 'slider', min: 40, max: 2000, section: 'Layout' },
    height: { label: 'Height', type: 'slider', min: 40, max: 2000, section: 'Layout' },
    encoderPositions: { label: 'Number of positions', type: 'slider', min: 2, max: 24, section: 'Layout' },
    encoderDefault:   { label: 'Default position', type: 'slider', min: 0, max: 23, section: 'Layout' },
    // Knob
    encoderKnobFile:  { label: 'Knob sprite', type: 'select', fileSelect: true, section: 'Knob' },
    encoderKnobSize:  { label: 'Knob size (px)', type: 'slider', min: 10, max: 200, section: 'Knob' },
    encoderKnobColor: { label: 'Knob color', type: 'text', section: 'Knob' },
    // Arc layout
    encoderBtnRadius:  { label: 'Arc radius (px)', type: 'slider', min: 10, max: 500, section: 'Arc Layout' },
    encoderBtnSize:    { label: 'Button size (px)', type: 'slider', min: 6, max: 100, section: 'Arc Layout' },
    encoderStartAngle: { label: 'Start angle (° top CW)', type: 'slider', min: -180, max: 180, section: 'Arc Layout' },
    encoderArcSpan:    { label: 'Arc span (°)', type: 'slider', min: 30, max: 360, section: 'Arc Layout' },
    // Button appearance
    encoderBtnOnFile:       { label: 'Button ON sprite', type: 'select', fileSelect: true, section: 'Button' },
    encoderBtnOffFile:      { label: 'Button OFF sprite', type: 'select', fileSelect: true, section: 'Button' },
    encoderBtnOnColor:      { label: 'Button ON color', type: 'text', section: 'Button' },
    encoderBtnOffColor:     { label: 'Button OFF color', type: 'text', section: 'Button' },
    encoderBtnBorderRadius: { label: 'Button border radius', type: 'slider', min: 0, max: 50, section: 'Button' },
    encoderBtnBorderColor:  { label: 'Button border color', type: 'text', section: 'Button' },
    encoderBtnTransition: {
      label: 'Transition type', type: 'select', section: 'Transition',
      options: [
        { text: 'Instant', value: 'instant' },
        { text: 'Fade', value: 'fade' },
      ],
    },
    encoderBtnTransitionMs: { label: 'Transition (ms)', type: 'slider', min: 50, max: 1000, section: 'Transition' },
    // Note: encoderGamepadIndices (number[]) must be set in JSON directly
  },
};
