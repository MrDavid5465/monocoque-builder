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
//   tab. Their submitted values are saved with Denim's own. A field whose
//   value isn't stored under its own key (or in its own shape) maps it with
//   `read` / `write` (ISettingsFieldMapping in settingsForm.ts).
// - `settingsTabs`: whole extra tabs, each a component receiving
//   ISettingsTabProps. Use these for anything a flat field list can't hold.
//
// Everything reported through `onChange` is merged into ONE save when the
// user presses Save, and only what differs from the saved settings is sent:
// written to localStorage (settingsSource="local") or sent as
// `updateSettings(settings: {...})` (settingsSource="server"); nothing at
// all when nothing changed. Then every registered `registerSave` callback
// runs, for side effects a tab needs beyond that (writing its own typiql
// records, calling its own mutations).
//
// A tab that loads its own data first (a query) must not report values
// before the data is there: a form seeded before its data arrives reports
// empty values, and saving those deletes what was saved. Declare
// `loads: true` and call `setReady(true)` once the data is in (and
// `setReady(false)` if it goes away again). Until then the dialog holds
// Save while the tab is open, drops the tab's `onChange` patches, and skips
// its `registerSave` callback.

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
   * previous patch and is merged into the saved settings; only its keys
   * whose value differs from the saved one are sent, so reporting the whole
   * form is fine. Pass `isValid: false` to block Save (with `message` shown
   * next to it). Ignored while the tab isn't ready (see `setReady`).
   */
  onChange: (patch: Record<string, any>, isValid?: boolean, message?: string) => void;
  /**
   * Register a callback that runs after the settings themselves are saved.
   * Re-register whenever the state it closes over changes (in an effect).
   * A skin's tab control may unmount inactive tabs (Fluent's Pivot does); the last registered callback is
   * kept and still runs, as is the last patch.
   */
  registerSave: (save: (() => void | Promise<void>) | undefined) => void;
  /**
   * Say whether this tab's data has arrived (`loads: true` tabs start not
   * ready). While an open tab isn't ready, Save is held, its `onChange`
   * patches are dropped (so call setReady(true) BEFORE reporting: put its
   * effect first), and its `registerSave` callback doesn't run. Stable;
   * calling it with the current state does nothing.
   */
  setReady: (ready: boolean) => void;
}

export interface ISettingsTab {
  /** Stable, unique key (also the Pivot item key). */
  key: string;
  headerText: string;
  Component: React.ComponentType<ISettingsTabProps>;
  /**
   * The tab loads its own data before it can show or report values: it
   * starts not ready and calls `setReady(true)` when its data is in.
   */
  loads?: boolean;
}

export interface ISettingsExtensions {
  settingsTabs?: ISettingsTab[];
  /**
   * per-form schema fields appended to the General tab. A field may also
   * carry `read` / `write` (ISettingsFieldMapping) to map a stored value to
   * its starting value and back.
   */
  settingsGeneralFields?: Record<string, any>;
}
