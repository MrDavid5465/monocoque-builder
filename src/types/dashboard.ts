import type { SequenceConfig } from '../components/Telemetry/DashboardDesigner/useTelemetryPlayback';

export type ComponentType =
  | 'static-sprite'
  | 'needle-gauge'
  | 'bar-gauge'
  | 'sprite-bar-gauge'
  | 'text-gauge'
  | 'sprite-text-gauge'
  | 'graph-bar-gauge'
  | 'flag-display'
  | 'flag-display-sprite'
  | 'group'
  | 'button-control'
  | 'slider-control'
  | 'encoder-control'
  | 'gif-gauge'
  | 'arc-gauge-face'
  | 'sprite-arc-gauge-face'
  | 'transform-sprite'
  | 'sprite-arc-fill'
  | 'clock-text'
  | 'clock-sprite';
export type BaseDashType = 'sprite' | '360';

export interface BaseDashTypeInfo {
  type: BaseDashType;
  label: string;
  description: string;
}

export const BASE_DASH_TYPES: BaseDashTypeInfo[] = [
  {
    type: 'sprite',
    label: 'Image background',
    description: 'Flat image background with gauges on top. Each screen in a video wall uses a cropped region of the same image.',
  },
  {
    type: '360',
    label: '360° photo background',
    description: '360° equirectangular photo background. Pan and zoom each screen to its own angle of the scene — great for video walls where every screen sees a different part of the same environment.',
  },
];

export interface TelemetryBinding {
  field: string;
  inputMin: number;
  inputMax: number;
  outputMin: number;
  outputMax: number;
  influence?: { field: string; weight: number };
  advanced?: string;
  // Whether this binding is swept during the kiosk boot-up sweep animation.
  // Undefined/true participates (the historical default, so existing
  // dashboards keep sweeping everything on boot); false opts out. Does NOT
  // affect the manual edit-mode test sweep, which always sweeps every bound
  // field regardless of this flag.
  startupSweep?: boolean;
  // What happens once the bound telemetry value falls outside [inputMin, inputMax].
  // Undefined/'stop' clamps to the boundary and keeps rendering (today's historical
  // behaviour). 'hide' renders nothing instead — used to hand off between staged
  // gauge elements (e.g. a needle-gauge that hides once fully swept so a
  // transform-sprite can take over the rest of the range).
  limitBehavior?: 'stop' | 'hide';
}

export interface ComponentNode {
  id: string;
  type: ComponentType;
  name: string;
  // Position relative to parent container (canvas root for top-level).
  // For needle-gauge: x/y is the PIVOT POINT (the rotation centre), not the image top-left.
  // For all other types: x/y is the image top-left.
  x: number;
  y: number;
  // Manual/static rotation (degrees, CSS transform: rotate()), universal to every node
  // type. Set by the Transform tool's rotate handle (or hand-edited here). Composes with
  // any existing binding-driven transform the type already has — see Canvas.tsx.
  rotation?: number;
  // sprite-based types:
  file?: string;
  width?: number;
  height?: number;
  backlit?: boolean;
  nightFile?: string;  // Optional sprite to crossfade in at night (sprite-type nodes)
  // Crop tool: trims a fixed pixel inset off one or more edges of the
  // rendered sprite, in the node's own unscaled width/height space — e.g.
  // hiding a sprite's own baked-in edge glow where it would otherwise
  // overlap a neighboring element. Combines with any binding-driven reveal
  // (sprite-bar-gauge's fill clip) by taking the larger inset per side, so
  // telemetry acts on whatever's left after the crop. Applies to every
  // single-image sprite node type (static-sprite, needle-gauge, bar-gauge,
  // sprite-bar-gauge, transform-sprite, sprite-arc-fill) — ignored elsewhere.
  cropLeft?: number;
  cropTop?: number;
  cropRight?: number;
  cropBottom?: number;
  // needle-gauge: pixel offset of the pivot WITHIN the image
  rotationX?: number;
  rotationY?: number;
  // transform-sprite: translates the sprite along one axis between moveMin/moveMax
  // (pixels) as the binding fraction goes 0→1 — the translate analogue of
  // rotationX/rotationY for a needle-gauge.
  moveAxis?: 'x' | 'y';
  moveMin?: number;
  moveMax?: number;
  // sprite-arc-fill: pixel offset of the arc's rotational center WITHIN the image, plus the
  // angular window (from arcStartAngle, sweeping arcSweepAngle degrees CW) the drawn arc
  // physically occupies — the binding fraction reveals that window via a conic-gradient mask.
  arcCenterX?: number;
  arcCenterY?: number;
  arcStartAngle?: number;
  arcSweepAngle?: number;
  binding?: TelemetryBinding;
  // any type can nest children
  children?: ComponentNode[];

  // --- text-gauge & sprite-text-gauge ---
  format?: 'integer' | 'decimal1' | 'decimal2' | 'comma-integer' | 'time' | 'raw';
  prefix?: string;
  suffix?: string;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  fontWeight?: 'normal' | 'bold';
  textAlign?: 'left' | 'center' | 'right';
  // sprite-text-gauge only: where x/y anchors within the rendered digit
  // row's content box — 'left'/'top' (the defaults) keep x/y as the box's
  // top-left corner, matching pre-existing behavior exactly.
  verticalAlign?: 'top' | 'middle' | 'bottom';

  // --- sprite-text-gauge ---
  charWidth?: number;
  charHeight?: number;
  charMap?: string;
  charSpacing?: number;
  numDigits?: number;
  // Columns per row in the sprite sheet's character grid. Omitted/1 keeps the
  // legacy single-row behavior; charMap indexes read in row-major order.
  charGridCols?: number;
  // When numDigits pads a shorter value, leave the leading pad cells blank
  // instead of rendering charMap's index-0 glyph (padStart uses ' ', which
  // isn't itself in charMap, so it falls back to index 0 otherwise).
  hideLeadingZeros?: boolean;

  // --- sprite-bar-gauge: background sprite + fill direction ---
  backgroundFile?: string;
  fillDirection?: 'ltr' | 'rtl' | 'btt' | 'ttb';

  // --- graph-bar-gauge ---
  graphType?: 'h-bar' | 'v-bar' | 'arc' | 'segments';
  colorLow?: string;
  colorHigh?: string;
  colorMid?: string;
  backgroundColor?: string;
  showValue?: boolean;
  borderRadius?: number;
  segments?: number;
  // Optional: drive the colorLow/Mid/High gradient from a different telemetry
  // field than the one that drives fill level (binding.field). Falls back to
  // binding's own field/range when unset, matching pre-existing behaviour.
  colorField?: string;
  colorInputMin?: number;
  colorInputMax?: number;

  // --- flag-display (plain coloured LED/grid) ---
  gridCols?: number;
  gridRows?: number;
  gridGap?: number;
  borderWidth?: number;
  borderColor?: string;
  showGear?: boolean;
  gearFontSize?: number;
  gearColor?: string;

  // --- flag-display-sprite ---
  fileGreen?: string;
  fileYellow?: string;
  fileRed?: string;
  fileBlue?: string;
  fileWhite?: string;
  fileChequered?: string;
  fileBlack?: string;
  fileBlackWhite?: string;
  fileBlackOrange?: string;
  fileOrange?: string;
  fileInPit?: string;
  fileOff?: string;
  // gear text overlay shared by both flag types
  gearOffsetX?: number;
  gearOffsetY?: number;

  // --- named gamepad mapping references (button/slider/encoder) ---
  gamepadMappingId?: string;
  encoderMappingIds?: string[];

  // --- button-control ---
  buttonMode?: 'momentary' | 'toggle';
  buttonStyle?: 'plain' | 'sprite';
  showPressedState?: boolean;
  ctrlLabel?: string;
  ctrlFontSize?: number;
  ctrlBorderRadius?: number;
  ctrlOffBg?: string;
  ctrlOffBorder?: string;
  ctrlOffBorderWidth?: number;
  ctrlOffColor?: string;
  ctrlOffOpacity?: number;
  ctrlOffFile?: string;
  ctrlOnBg?: string;
  ctrlOnBorder?: string;
  ctrlOnBorderWidth?: number;
  ctrlOnColor?: string;
  ctrlOnOpacity?: number;
  ctrlOnFile?: string;
  ctrlPressedBg?: string;
  ctrlPressedBorder?: string;
  ctrlPressedBorderWidth?: number;
  ctrlPressedColor?: string;
  ctrlPressedOpacity?: number;
  ctrlPressedFile?: string;
  ctrlTransition?: 'instant' | 'fade';
  ctrlTransitionMs?: number;
  ctrlShine?: boolean;
  ctrlShineColor?: string;
  ctrlShineOpacity?: number;
  gamepadButtonIndex?: number;

  // --- slider-control ---
  sliderOrientation?: 'horizontal' | 'vertical';
  sliderTrackColor?: string;
  sliderTrackBorderRadius?: number;
  sliderThumbFile?: string;
  sliderThumbColor?: string;
  sliderThumbW?: number;
  sliderThumbH?: number;
  sliderMin?: number;
  sliderMax?: number;
  sliderDefault?: number;
  gamepadAxisIndex?: number;

  // --- encoder-control ---
  encoderPositions?: number;
  encoderDefault?: number;
  encoderKnobFile?: string;
  encoderKnobSize?: number;
  encoderKnobColor?: string;
  encoderBtnRadius?: number;
  encoderBtnSize?: number;
  encoderStartAngle?: number;
  encoderArcSpan?: number;
  encoderBtnOnFile?: string;
  encoderBtnOffFile?: string;
  encoderBtnOnColor?: string;
  encoderBtnOffColor?: string;
  encoderBtnBorderRadius?: number;
  encoderBtnBorderColor?: string;
  encoderBtnTransition?: 'instant' | 'fade';
  encoderBtnTransitionMs?: number;
  encoderGamepadIndices?: number[];

  // --- gif-gauge ---
  gifFrameCount?: number;
  gifCols?: number;
  gifFps?: number;
  gifMode?: 'value' | 'startup';

  // --- arc-gauge-face + sprite-arc-gauge-face (shared) ---
  gaugeStartAngle?: number;
  gaugeSweepAngle?: number;
  gaugeMinValue?: number;
  gaugeMaxValue?: number;
  gaugeMaxField?: string;
  gaugeMajorInterval?: number;
  gaugeMidInterval?: number;
  gaugeMinorInterval?: number;
  gaugeMajorLen?: number;
  gaugeMidLen?: number;
  gaugeMinorLen?: number;
  gaugeMajorWeight?: number;
  gaugeMidWeight?: number;
  gaugeMinorWeight?: number;
  gaugeTickColor?: string;
  gaugeTickRadius?: number;
  gaugeRedlineValue?: number;
  gaugeRedlineColor?: string;
  gaugeLabelOffset?: number;
  gaugeLabelRotate?: boolean;
  gaugeLabelDivisor?: number;
  gaugeSubLabel?: string;
  // arc-gauge-face drawn labels
  gaugeLabelFont?: string;
  gaugeLabelSize?: number;
  gaugeLabelWeight?: string;
  gaugeLabelColor?: string;
  gaugeSubLabelSize?: number;
  gaugeSubLabelColor?: string;

  // --- clock-text & clock-sprite ---
  // Real time uses the VIEWER's own local timezone (an ordinary wall
  // clock, one per device); simulated time is UTC-only by convention (see
  // dayNightSim.ts) since it's a purely artificial in-game clock with no
  // real-world timezone of its own — every viewer must read the identical
  // simulated hour/minute regardless of where the device physically is.
  clockSource?: 'real' | 'simulated';
  clockFormat?: '12h' | '24h';
  showSeconds?: boolean;

  // --- counter-rotation (wheel-mounted display) ---
  // Rotates this element opposite to the steering input so it appears stationary.
  // For groups, the pivot is the group's (x, y) position — place the group at the
  // desired rotation centre (e.g. screen centre).
  counterRotate?: boolean;
  // Physical degrees at full steering lock (steering = ±1.0). Typical GT: 200–250.
  steerMaxDeg?: number;
}

export interface DashboardConfig {
  name: string;
  baseDashType: BaseDashType;
  path: string;
  canvasWidth: number;
  canvasHeight: number;
  background?: string;
  dayNight: boolean;
  neckFx: boolean;
  components: ComponentNode[];
  kioskExitButton: { x: number; y: number; opacity: number };
  groupIds?: string[];

  // Background overflow / pan
  bgOverflow?: number;
  bgOffsetX?: number;
  bgOffsetY?: number;

  // NeckFX per-axis tuning
  neckFxGainX?: number;
  neckFxGainY?: number;
  neckFxDisableX?: boolean;
  neckFxDisableY?: boolean;

  // 360-specific (designer only)
  photo360File?: string;
  photo360Yaw?: number;
  photo360Pitch?: number;
  photo360Fov?: number;
  photo360Roll?: number;
  // Set to true while a manage page is actively editing the 360 pan; kiosk shows live viewer.
  photo360Editing?: boolean;
  // When true, kiosk always shows the live 360 viewer instead of a baked screenshot.
  photo360LiveKiosk?: boolean;

  // Day/night transition state (only meaningful when dayNight: true).
  // The current night state itself is global (see useGlobalNightMode), not per-dashboard.
  nightModeButton?: boolean; // Show a floating day/night toggle button in kiosk mode

  intendedScreenWidth?: number;
  intendedScreenHeight?: number;

  // Test Sequence panel settings (design-time gauge preview) — persisted so
  // Save keeps your preferred sweep/sine parameters across sessions.
  sequenceConfig?: SequenceConfig;
}

export interface DashboardListEntry {
  name: string;
  baseDashType: BaseDashType;
  dayNight: boolean;
  thumbnailDay?: string;
  thumbnailNight?: string;
}

// Kept only for v1 migration in useDashboard.ts
export interface SpriteElement {
  id: string;
  type: 'sprite-needle' | 'sprite-bar' | 'sprite-static';
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
  backlit: boolean;
  rotationX?: number;
  rotationY?: number;
  binding?: TelemetryBinding;
}
