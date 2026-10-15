// Denim's chrome settings: theme, font size and launch page, plus whatever
// extra keys an app's own settings tabs add (see ISettingsTab).
//
// Where they live is the `settingsSource` prop on <Denim>:
// - "local" (the default): this browser's localStorage. Right for a public
//   site with anonymous visitors, where one shared backend record would leak
//   one visitor's choice to everyone, and for any app with no backend
//   settings at all.
// - "server": the backend's `my.settings` / `updateSettings` (see README,
//   "Server contract"). localStorage then only caches the last-seen theme so
//   the first paint isn't unthemed while `my` loads.
//
// DEVICE_SETTINGS are the exception: they always live in this browser's
// localStorage, in both modes, because they describe the device rather than
// the user. `reduceMotion` is one: a desktop webview without GPU compositing
// wants it, a phone on the same server may not. They are never sent to
// `updateSettings`, so a backend needs no field for them.
export interface IDenimSettings {
  launchPage: string;
  theme: string;
  fontSize: number;
  /**
   * Turns the skin's own motion off (slides, fades, moving highlights), on
   * top of the OS's "reduce motion" preference. Per device, see
   * DEVICE_SETTINGS. Default false; an app can default it with
   * `defaultSettings={{ reduceMotion: true }}`.
   */
  reduceMotion?: boolean;
  // An app's own settings (settingsTabs / settingsGeneralFields) ride along.
  [key: string]: any;
}

/** @deprecated use IDenimSettings */
export type ILocalSettings = IDenimSettings;

const KEY = 'denim-settings';

export const DEFAULT_SETTINGS: IDenimSettings = {
  launchPage: '',
  theme: 'default',
  fontSize: 1,
  reduceMotion: false,
};

/** Settings kept per device (localStorage) even with settingsSource="server". */
export const DEVICE_SETTINGS = ['reduceMotion'] as const;

/** Splits `values` into the device settings and the rest. */
export function splitDeviceSettings(values: Record<string, any>): [Record<string, any>, Record<string, any>] {
  const device: Record<string, any> = {};
  const rest: Record<string, any> = {};
  Object.entries(values).forEach(([k, v]) => {
    if ((DEVICE_SETTINGS as readonly string[]).includes(k)) device[k] = v;
    else rest[k] = v;
  });
  return [device, rest];
}

export function readLocalSettings(
  defaults: Partial<IDenimSettings> = {},
): IDenimSettings {
  const base = { ...DEFAULT_SETTINGS, ...defaults };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    return { ...base, ...JSON.parse(raw) };
  } catch {
    return base;
  }
}

export function writeLocalSettings(settings: IDenimSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable (private mode, quota): nothing to do
  }
}
