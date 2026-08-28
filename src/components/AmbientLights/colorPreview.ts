export interface ChannelColor {
  channelId: number;
  r: number;
  g: number;
  b: number;
}

// Deliberately NOT hue-boosted, only brightness-lifted — this is the
// literal {r,g,b} Huenicorn is streaming to the bridge, the same signal
// that drives the 360° tint (see Photo360Viewer.tsx's ambientTint
// uniform). Confirmed live that it can disagree noticeably with what the
// bulb actually renders (a visibly purple-blue light streaming r/g/b
// within ~0.03 of each other, red the highest of the three) — exaggerating
// hue here would risk showing a confidently wrong color (e.g. orange for
// a blue-dominant reading) rather than an honest "here's what's actually
// being sent." Only lifting brightness so a dim-but-real reading isn't
// just an indistinguishable near-black square against a dark background.
// Shared by index.tsx's status swatch and ChannelMapper.tsx's per-channel
// region fill, so both read the same signal the same way.
export const liftForPreview = (c: { r: number; g: number; b: number }) => {
  const luma = (c.r + c.g + c.b) / 3 || 0.0001;
  const lift = Math.max(1, 0.5 / luma);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return { r: clamp(c.r * lift), g: clamp(c.g * lift), b: clamp(c.b * lift) };
};

export const colorToCss = (c: { r: number; g: number; b: number }) => {
  const lifted = liftForPreview(c);
  return `rgb(${Math.round(lifted.r * 255)}, ${Math.round(lifted.g * 255)}, ${Math.round(lifted.b * 255)})`;
};
