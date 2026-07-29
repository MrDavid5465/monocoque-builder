import { ComponentSchema } from '../types';

export const buttonControlSchema: ComponentSchema = {
  type: 'button-control',
  label: 'Button Control',
  icon: 'ToggleLeft',
  allowChildren: false,
  bindable: true,
  fields: {
    name:   { label: 'Name', type: 'text' },
    x:      { label: 'X', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    y:      { label: 'Y', type: 'slider', min: -1000, max: 5000, section: 'Layout' },
    width:  { label: 'Width', type: 'slider', min: 10, max: 2000, section: 'Layout' },
    height: { label: 'Height', type: 'slider', min: 10, max: 2000, section: 'Layout' },
    buttonMode: {
      label: 'Mode', type: 'select', section: 'Mode',
      options: [
        { text: 'Momentary (press & hold)', value: 'momentary' },
        { text: 'Toggle (on/off)', value: 'toggle' },
      ],
    },
    buttonStyle: {
      label: 'Style', type: 'select', section: 'Mode',
      options: [
        { text: 'Plain (CSS)', value: 'plain' },
        { text: 'Sprite (image)', value: 'sprite' },
      ],
    },
    showPressedState: { label: 'Show pressed state', type: 'checkbox', section: 'Mode' },
    ctrlLabel:        { label: 'Label text', type: 'text', section: 'Mode' },
    ctrlFontSize:     { label: 'Font size', type: 'slider', min: 8, max: 96, section: 'Mode' },
    ctrlBorderRadius: { label: 'Border radius', type: 'slider', min: 0, max: 200, section: 'Mode' },
    // Off state
    ctrlOffBg:          { label: 'Off: background', type: 'text', section: 'Off State' },
    ctrlOffBorder:      { label: 'Off: border color', type: 'text', section: 'Off State' },
    ctrlOffBorderWidth: { label: 'Off: border width', type: 'slider', min: 0, max: 20, section: 'Off State' },
    ctrlOffColor:       { label: 'Off: text color', type: 'text', section: 'Off State' },
    ctrlOffOpacity:     { label: 'Off: opacity', type: 'slider', min: 0, max: 1, step: 0.05, section: 'Off State' },
    ctrlOffFile:        { label: 'Off: sprite', type: 'select', fileSelect: true, section: 'Off State' },
    // On state
    ctrlOnBg:          { label: 'On: background', type: 'text', section: 'On State' },
    ctrlOnBorder:      { label: 'On: border color', type: 'text', section: 'On State' },
    ctrlOnBorderWidth: { label: 'On: border width', type: 'slider', min: 0, max: 20, section: 'On State' },
    ctrlOnColor:       { label: 'On: text color', type: 'text', section: 'On State' },
    ctrlOnOpacity:     { label: 'On: opacity', type: 'slider', min: 0, max: 1, step: 0.05, section: 'On State' },
    ctrlOnFile:        { label: 'On: sprite', type: 'select', fileSelect: true, section: 'On State' },
    // Pressed state
    ctrlPressedBg:          { label: 'Pressed: background', type: 'text', section: 'Pressed State' },
    ctrlPressedBorder:      { label: 'Pressed: border color', type: 'text', section: 'Pressed State' },
    ctrlPressedBorderWidth: { label: 'Pressed: border width', type: 'slider', min: 0, max: 20, section: 'Pressed State' },
    ctrlPressedColor:       { label: 'Pressed: text color', type: 'text', section: 'Pressed State' },
    ctrlPressedOpacity:     { label: 'Pressed: opacity', type: 'slider', min: 0, max: 1, step: 0.05, section: 'Pressed State' },
    ctrlPressedFile:        { label: 'Pressed: sprite', type: 'select', fileSelect: true, section: 'Pressed State' },
    // Transition
    ctrlTransition: {
      label: 'Transition type', type: 'select', section: 'Transition',
      options: [
        { text: 'Instant', value: 'instant' },
        { text: 'Fade', value: 'fade' },
      ],
    },
    ctrlTransitionMs: { label: 'Transition (ms)', type: 'slider', min: 50, max: 2000, section: 'Transition' },
    // Shine-through
    ctrlShine:        { label: 'Shine-through', type: 'checkbox', section: 'Shine' },
    ctrlShineColor:   { label: 'Shine color', type: 'text', section: 'Shine' },
    ctrlShineOpacity: { label: 'Shine opacity', type: 'slider', min: 0, max: 1, step: 0.05, section: 'Shine' },
    // Gamepad mapping
    gamepadMappingId: { label: 'Gamepad action', type: 'gamepad-select', gamepadFilter: 'button', section: 'Gamepad' },
  },
};
