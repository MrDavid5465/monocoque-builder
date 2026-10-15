// Applies the core's theme settings with Fluent UI: loadTheme() for code that
// reads the global theme (getTheme()), a ThemeProvider applied to <body> for
// Fluent controls and useTheme(), and a favicon in the theme colour.
import React from 'react';
import { loadTheme, ThemeProvider } from '@fluentui/react';
import { useSettings } from '../../denim';
import './icons';
import { THEMES, ThemeBuilder } from '../themes';

// The Denim mark as a data URI, so the browser tab icon can follow the theme
// colour (a static /favicon file can't be recoloured at runtime).
const FAVICON_SVG = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">` +
  `<path d="M 24 73 A 32 32 0 1 1 56 73 L 50 62 A 20 20 0 1 0 30 62 Z" fill="${color}"/>` +
  `<path d="M 42 44 L 41 48 L 38 46 L 32 22 Z" fill="${color}"/>` +
  `<circle cx="40" cy="45" r="3" fill="${color}"/>` +
  `</svg>`;

export function setFaviconColor(color: string): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG(color))}`;
}

/** Loads the Fluent theme for `{ theme, fontSize }` settings. */
export function applyTheme(
  settings: { theme?: string; fontSize?: number },
  themes: Record<string, ThemeBuilder> = THEMES,
) {
  const build = themes[settings.theme || 'default'] || themes.default;
  const theme = build(settings.fontSize || 1);
  loadTheme(theme);
  if (theme.palette?.themePrimary) setFaviconColor(theme.palette.themePrimary);
  return theme;
}

/**
 * Applies the current settings' theme. Call it in the component that renders
 * the shell's whole tree, and wrap that tree in <FluentThemeRoot> with the
 * key it returns.
 *
 * Fluent's loadTheme mutates a module-level theme; it does not re-render
 * anything. Components that read getTheme() during render (the header, the
 * cards) pick the new value up only on their next render, and a memoized
 * one may not get a next render. So the returned key changes only AFTER
 * loadTheme has run: the render that first sees new settings still returns
 * the old key; this layout effect loads the theme and then switches the key,
 * and <FluentThemeRoot> remounts the tree under the new theme (still before
 * paint, so no flash). Returning the new key straight away remounted the
 * tree while the old theme was still loaded, and anything memoized kept the
 * old colours. Calling loadTheme in the render body instead trips React's
 * "cannot update a component while rendering a different component" warning.
 */
export function useFluentTheme(themes: Record<string, ThemeBuilder> = THEMES): string {
  const { settings } = useSettings();
  const key = `${settings.theme}${settings.fontSize}`;
  const [appliedKey, setAppliedKey] = React.useState(key);
  const [, forceRerender] = React.useReducer((n: number) => n + 1, 0);
  React.useLayoutEffect(() => {
    applyTheme(settings, themes);
    // First mount: same key, so re-render (nothing has rendered against a
    // stale theme that a remount would need to replace).
    if (key === appliedKey) forceRerender();
    else setAppliedKey(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.theme, settings.fontSize]);
  return appliedKey;
}

/**
 * The ThemeProvider for the shell, applied to <body> (page background and
 * text colour). Keyed by the theme, so a theme change remounts the tree and
 * nothing keeps stale class names.
 */
export const FluentThemeRoot: React.FC<{
  themeKey: string;
  themes?: Record<string, ThemeBuilder>;
  children?: React.ReactNode;
}> = ({ themeKey, themes = THEMES, children }) => {
  const { settings } = useSettings();
  const theme = React.useMemo(
    () => (themes[settings.theme || 'default'] || themes.default)(settings.fontSize || 1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [themeKey],
  );
  return (
    <ThemeProvider key={themeKey} theme={theme} applyTo="body">
      {children}
    </ThemeProvider>
  );
};
