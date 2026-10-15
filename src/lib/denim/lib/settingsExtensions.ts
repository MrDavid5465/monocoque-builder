import type React from 'react';
import type { IDenimSettings } from './localSettings';

// The extension point of the Settings dialog (TopBarShell: waffle ->
// Settings; SidebarShell: the sidebar footer). Data only: a skin renders it
// through useSettingsForm() (settingsForm.ts).
//
// Denim owns the General tab (theme colour, mode, font size, launch page).
// An app adds its own global preferences in two ways:
//
// - `settingsGeneralFields`: extra per-form fields appended to the General
//   tab. Their submitted values are saved with Denim's own.
// - `settingsTabs`: whole extra tabs, each a component receiving
//   ISettingsTabProps. Use these for anything a flat field list can't hold.
//
// Everything reported through `onChange` is merged into ONE save when the
// user presses Save: written to localStorage (settingsSource="local") or sent
// as `updateSettings(settings: {...})` (settingsSource="server"). Then every
// registered `registerSave` callback runs, for side effects a tab needs
// beyond that (writing its own typiql records, calling its own mutations).

export interface ISettingsTabProps {
  /**
   * The saved settings: localStorage's object, or `my.settings` as the server
   * returned it (including the extra `settingsFields` the app asked for, and
   * Apollo's `__typename`; strip `__typename` from nested objects you send
   * back, since input types reject it).
   */
  settings: IDenimSettings;
  /** Whether the modal is open (e.g. `skip: !isOpen` on a tab's own queries). */
  isOpen: boolean;
  /**
   * Report this tab's contribution to the save. `patch` replaces the tab's
   * previous patch and is merged into the saved settings. Pass
   * `isValid: false` to block Save (with `message` shown next to it).
   */
  onChange: (patch: Record<string, any>, isValid?: boolean, message?: string) => void;
  /**
   * Register a callback that runs after the settings themselves are saved.
   * Re-register whenever the state it closes over changes (in an effect).
   * A skin's tab control may unmount inactive tabs (Fluent's Pivot does); the last registered callback is
   * kept and still runs, as is the last patch.
   */
  registerSave: (save: (() => void | Promise<void>) | undefined) => void;
}

export interface ISettingsTab {
  /** Stable, unique key (also the Pivot item key). */
  key: string;
  headerText: string;
  Component: React.ComponentType<ISettingsTabProps>;
}

export interface ISettingsExtensions {
  settingsTabs?: ISettingsTab[];
  /** per-form schema fields appended to the General tab. */
  settingsGeneralFields?: Record<string, any>;
}
