import { forwardRef } from 'react';
import Photo360Viewer, { Photo360Handle } from './Photo360Viewer';

interface Props {
  dayPhotoUrl: string;
  // Undefined when this car has no night variant — Photo360Viewer just
  // renders the day photo alone in that case (mixAmount never leaves 0).
  nightPhotoUrl?: string;
  // 0 = full day, 1 = full night, continuous — see dayNightSim.ts. A manual
  // toggle produces a hard 0/1; Photo360Viewer's own render loop eases that
  // into a smooth transition (see its onBeforeCompile/render-loop comments),
  // the simulated clock produces a real ramp through dawn/dusk already.
  nightAmount: number;
  yaw: number;
  pitch: number;
  fov: number;
  roll: number;
  displayWidth: number;
  displayHeight: number;
  onChange: (yaw: number, pitch: number, fov: number, roll: number) => void;
  readOnly?: boolean;
  telemetryData?: Record<string, number>;
  swayEnabled?: boolean;
  swayGainX?: number;
  swayGainY?: number;
  swayDisableX?: boolean;
  swayDisableY?: boolean;
  onLoaded?: () => void;
}

// Thin pass-through onto Photo360Viewer, which does the actual day/night
// blending itself now (one shader, one WebGL context, one texture pair) —
// this used to layer two full Photo360Viewer instances and crossfade them
// with CSS opacity, which meant two WebGLRenderers (two live GPU contexts)
// per 360 dashboard. Browsers cap simultaneous WebGL contexts per process
// (commonly ~16) — with a few kiosk windows open across multiple screens
// (all sharing that same per-process budget), doubling the context count
// per window was enough to exhaust it, silently losing context on whichever
// window's viewer the browser evicted first (confirmed live: only one
// window's 360 viewer would render at a time, and switching to a different
// browser — a fresh GPU process, fresh budget — "fixed" it, which is the
// signature of a context-limit issue rather than an app bug). Kept as its
// own component (rather than inlining at each of DashPanEditor's/
// DashboardDesigner's two call sites) purely so neither has to know
// Photo360Viewer's day/night prop names changed here if that internal
// design changes again.
const Photo360CrossfadeViewer = forwardRef<Photo360Handle, Props>(({
  dayPhotoUrl, nightPhotoUrl, nightAmount, ...rest
}, ref) => (
  <Photo360Viewer
    ref={ref}
    photoUrl={dayPhotoUrl}
    nightPhotoUrl={nightPhotoUrl}
    nightAmount={nightAmount}
    {...rest}
  />
));

Photo360CrossfadeViewer.displayName = 'Photo360CrossfadeViewer';
export default Photo360CrossfadeViewer;
