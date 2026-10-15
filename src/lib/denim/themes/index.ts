// The theme vocabulary Denim's settings speak: `settings.theme` is a key
// "<mode>-<color>", e.g. "dark-teal". The core only stores and parses these
// keys; a skin maps each key to real colours (denim-fabric's THEMES maps them
// to Fluent palettes). A skin of your own can map the same keys to anything.

export type ThemeMode = 'dark' | 'light' | 'hc';
export type ColorKey =
  | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'cyan'
  | 'blue' | 'indigo' | 'purple' | 'violet' | 'magenta' | 'pink';

export const COLOR_KEYS: ColorKey[] = [
  'red', 'orange', 'yellow', 'green', 'teal', 'cyan',
  'blue', 'indigo', 'purple', 'violet', 'magenta', 'pink',
];

export const COLOR_LABELS: Record<ColorKey, string> = {
  red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', teal: 'Teal', cyan: 'Cyan',
  blue: 'Blue', indigo: 'Indigo', purple: 'Purple', violet: 'Violet', magenta: 'Magenta', pink: 'Pink',
};

export const MODE_KEYS: ThemeMode[] = ['light', 'dark', 'hc'];

export const MODE_LABELS: Record<ThemeMode, string> = {
  light: 'Light', dark: 'Dark', hc: 'High Contrast',
};

export const themeKey = (mode: ThemeMode, color: ColorKey): string => `${mode}-${color}`;

// Splits e.g. "dark-purple" -> { mode: "dark", color: "purple" } or
// "hc-teal" -> { mode: "hc", color: "teal" }. Falls back to dark-red (the
// reference theme all dark-mode contrast is validated against) for anything
// unrecognized, e.g. a settings.theme value from before this scheme existed.
export function parseThemeKey(key: string | undefined | null): { mode: ThemeMode; color: ColorKey } {
  const dash = (key ?? '').indexOf('-');
  const mode = dash > 0 ? (key as string).slice(0, dash) : '';
  const color = dash > 0 ? (key as string).slice(dash + 1) : '';
  if (MODE_KEYS.includes(mode as ThemeMode) && COLOR_KEYS.includes(color as ColorKey)) {
    return { mode: mode as ThemeMode, color: color as ColorKey };
  }
  return { mode: 'dark', color: 'red' };
}
