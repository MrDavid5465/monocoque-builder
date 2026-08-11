import { Field } from '../../../../lib/per-form';

export const COUNTER_ROTATE_FIELDS: Record<string, Field> = {
  counterRotate: { label: 'Counter-rotate with steering', type: 'checkbox', section: 'Rotation' },
  steerMaxDeg:   { label: 'Steering rotation (° total)',   type: 'slider', min: 0, max: 1440, step: 10, section: 'Rotation' },
};

// Hand-entry counterpart to the interactive Crop tool (Canvas toolbar) — same
// fields it writes, for precise/typed values. Only meaningful on node types
// that render a single sprite image; see cropInsetPx in canvasUtils.ts.
export const CROP_FIELDS: Record<string, Field> = {
  cropLeft:   { label: 'Crop left (px)',   type: 'slider', min: 0, max: 2000, section: 'Crop' },
  cropTop:    { label: 'Crop top (px)',    type: 'slider', min: 0, max: 2000, section: 'Crop' },
  cropRight:  { label: 'Crop right (px)',  type: 'slider', min: 0, max: 2000, section: 'Crop' },
  cropBottom: { label: 'Crop bottom (px)', type: 'slider', min: 0, max: 2000, section: 'Crop' },
};
