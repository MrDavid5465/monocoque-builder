// Standard ALSA/WAV channel orderings for common surround layouts — a
// 4-channel device is conventionally wired Front Left/Front Right/Rear
// Left/Rear Right (quad), not just "Channel 1..4", and users pick a pan by
// that physical position. Falls back to a generic "Channel N" label for any
// channel count without a standard named layout.
const CHANNEL_LAYOUT_NAMES: Record<number, readonly string[]> = {
  1: ['Mono'],
  2: ['Left', 'Right'],
  4: ['Front Left', 'Front Right', 'Rear Left', 'Rear Right'],
  6: ['Front Left', 'Front Right', 'Front Center', 'LFE', 'Rear Left', 'Rear Right'],
  8: ['Front Left', 'Front Right', 'Front Center', 'LFE', 'Rear Left', 'Rear Right', 'Side Left', 'Side Right'],
};

export function channelPositionName(channelCount: number, index: number): string {
  return CHANNEL_LAYOUT_NAMES[channelCount]?.[index] ?? `Channel ${index + 1}`;
}
