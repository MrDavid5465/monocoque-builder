// Fluent palettes for the core's theme keys ("<mode>-<color>"). The key
// vocabulary (COLOR_KEYS, MODE_KEYS, themeKey, parseThemeKey) lives in the
// core and is re-exported here for convenience.
import type { IPartialTheme } from '@fluentui/react';
import { COLOR_KEYS, MODE_KEYS, themeKey } from '../../denim';
import type { ThemeMode, ColorKey } from '../../denim';
import { PALETTES } from './palettes';

export { PALETTES };
export {
  COLOR_KEYS,
  COLOR_LABELS,
  MODE_KEYS,
  MODE_LABELS,
  themeKey,
  parseThemeKey,
} from '../../denim';
export type { ThemeMode, ColorKey } from '../../denim';

/** Builds a Fluent theme for a font scale (1, 1.14, 1.29). */
export type ThemeBuilder = (fontSize?: number) => IPartialTheme;

const fontsAndSpacing = (fontSize: number) => ({
  fonts: {
    tiny: { fontSize: Math.round(10 * fontSize) },
    xSmall: { fontSize: Math.round(10 * fontSize) },
    small: { fontSize: Math.round(12 * fontSize) },
    smallPlus: { fontSize: Math.round(12 * fontSize) },
    medium: { fontSize: Math.round(14 * fontSize) },
    mediumPlus: { fontSize: Math.round(16 * fontSize) },
    large: { fontSize: Math.round(18 * fontSize) },
    xLarge: { fontSize: Math.round(20 * fontSize) },
    xLargePlus: { fontSize: Math.round(24 * fontSize) },
    xxLarge: { fontSize: Math.round(28 * fontSize) },
    xxLargePlus: { fontSize: Math.round(32 * fontSize) },
    superLarge: { fontSize: Math.round(42 * fontSize) },
    mega: { fontSize: Math.round(68 * fontSize) },
  },
  spacing: {
    s2: `${Math.round(4 * fontSize)}px`,
    s1: `${Math.round(8 * fontSize)}px`,
    m: `${Math.round(16 * fontSize)}px`,
    l1: `${Math.round(20 * fontSize)}px`,
    l2: `${Math.round(32 * fontSize)}px`,
  },
});

export const buildTheme = (mode: ThemeMode, color: ColorKey): ThemeBuilder => (fontSize = 1) => ({
  palette: PALETTES[mode][color],
  isInverted: mode !== 'light',
  ...fontsAndSpacing(fontSize),
});

// Full { themeKey: builder } map for every mode x colour, plus a `default`
// alias (dark-red). The shells' `themes` prop defaults to this.
export const THEMES: Record<string, ThemeBuilder> = (() => {
  const map: Record<string, ThemeBuilder> = {};
  for (const mode of MODE_KEYS) {
    for (const color of COLOR_KEYS) {
      map[themeKey(mode, color)] = buildTheme(mode, color);
    }
  }
  map.default = map[themeKey('dark', 'red')];
  return map;
})();
