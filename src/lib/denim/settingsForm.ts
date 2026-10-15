// The logic of a Settings dialog, without the dialog: the General tab's
// schema, each extension tab's props, merging everything into one save, and
// validity. A skin renders it with its own dialog, tabs and form component
// (denim-fabric's SettingsDialog uses a Fluent Modal, Pivot and per-form).
import React from 'react';
import { useSettings } from './hooks';
import { COLOR_KEYS, COLOR_LABELS, MODE_KEYS, MODE_LABELS, parseThemeKey, themeKey } from './themes';
import type { ISettingsTab, ISettingsTabProps } from './lib/settingsExtensions';
import type { IDenimSettings } from './lib/localSettings';

/**
 * The General tab's fields, as a per-form schema (data, no UI). Theme is
 * edited as two fields, `themeColor` and `themeMode`, which
 * useSettingsForm joins back into the `theme` key on save.
 */
export const generalSettingsSchema = () => ({
  launchPage: {
    type: 'text',
    label: 'Default page',
    required: false,
  },
  themeColor: {
    type: 'select',
    label: 'Colour',
    options: COLOR_KEYS.map(k => ({ key: k, text: COLOR_LABELS[k], value: k })),
  },
  themeMode: {
    type: 'select',
    label: 'Theme',
    options: MODE_KEYS.map(k => ({ key: k, text: MODE_LABELS[k], value: k })),
  },
  fontSize: {
    type: 'select',
    label: 'Font Size',
    options: [
      { text: 'Small', value: 1.0 },
      { text: 'Medium', value: 1.14 },
      { text: 'Large', value: 1.29 },
    ],
    defaultValue: 1,
    converter: (_key: string, values: Record<string, any>) => parseFloat(values['fontSize']) || 1.0,
  },
  // Per device (DEVICE_SETTINGS): kept in this browser even when the other
  // settings live on the server.
  reduceMotion: {
    type: 'checkbox',
    label: 'Reduce motion (this device)',
    required: false,
    converter: (_key: string, values: Record<string, any>) => !!values['reduceMotion'],
  },
});

/** The General form's starting values: the settings, with `theme` split in two. */
export const generalSettingsValues = (settings: IDenimSettings) => ({
  ...settings,
  themeMode: parseThemeKey(settings.theme).mode,
  themeColor: parseThemeKey(settings.theme).color,
});

type SaveFn = (() => void | Promise<void>) | undefined;

export interface ISettingsFormTab extends ISettingsTab {
  /** Pass these to `Component`. */
  props: ISettingsTabProps;
}

export interface ISettingsForm {
  general: {
    /** per-form schema: Denim's fields plus `settingsGeneralFields`. */
    schema: Record<string, any>;
    initialValues: Record<string, any>;
    /** Wire to per-form's `onChange(name, { clean, isValid })`. */
    onChange: (name: string, state: { clean: Record<string, any>; isValid: boolean }) => void;
  };
  /** The extension tabs, each with the props to render its Component with. */
  tabs: ISettingsFormTab[];
  /** Validates, merges General + every tab's patch into one save, runs registerSave callbacks. Resolves true on success. */
  save: () => Promise<boolean>;
  saving: boolean;
  /** A validation or save error to show next to Save. */
  error: string | null;
}

/**
 * Everything a Settings dialog needs. `isOpen` resets the draft on every
 * opening, so an unsaved edit from last time doesn't come back.
 */
export function useSettingsForm(isOpen: boolean): ISettingsForm {
  const { settings, saveSettings, settingsTabs, settingsGeneralFields } = useSettings();

  // Pushed up from each tab via onChange rather than pulled from refs at
  // save time: a tab control may unmount inactive tabs (Fluent's Pivot
  // does), so a ref into another tab is null by the time Save is pressed.
  const [generalValues, setGeneralValues] = React.useState<Record<string, any>>({});
  const [generalValid, setGeneralValid] = React.useState(true);
  const [tabPatches, setTabPatches] = React.useState<Record<string, Record<string, any>>>({});
  const [tabValidity, setTabValidity] = React.useState<Record<string, { valid: boolean; message?: string }>>({});
  const saveFns = React.useRef<Record<string, SaveFn>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setTabPatches({});
      setTabValidity({});
      setError(null);
      saveFns.current = {};
    }
  }, [isOpen]);

  // One stable onChange/registerSave pair per tab key, so a tab can list
  // them as effect dependencies without re-running every render.
  const tabKeys = settingsTabs.map(t => t.key).join('|');
  const tabCallbacks = React.useMemo(() => {
    const out: Record<string, Pick<ISettingsTabProps, 'onChange' | 'registerSave'>> = {};
    settingsTabs.forEach(tab => {
      out[tab.key] = {
        onChange: (patch, isValid = true, message) => {
          setTabPatches(prev => ({ ...prev, [tab.key]: patch }));
          setTabValidity(prev => ({ ...prev, [tab.key]: { valid: isValid, message } }));
        },
        registerSave: save => {
          saveFns.current[tab.key] = save;
        },
      };
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabKeys]);

  const onGeneralChange = React.useCallback(
    (_name: string, { clean, isValid }: { clean: Record<string, any>; isValid: boolean }) => {
      const { themeColor, themeMode, ...rest } = clean;
      setGeneralValues({ ...rest, theme: themeKey(themeMode, themeColor) });
      setGeneralValid(isValid);
    },
    [],
  );

  async function save(): Promise<boolean> {
    if (!generalValid) {
      setError('Please fix the highlighted fields on the General tab before saving.');
      return false;
    }
    const invalid = settingsTabs.find(t => tabValidity[t.key] && !tabValidity[t.key].valid);
    if (invalid) {
      setError(tabValidity[invalid.key].message ?? `Please fix the ${invalid.headerText} tab before saving.`);
      return false;
    }
    setError(null);
    setSaving(true);
    try {
      const values = Object.assign({}, generalValues, ...settingsTabs.map(t => tabPatches[t.key] ?? {}));
      await saveSettings(values);
      for (const tab of settingsTabs) {
        await saveFns.current[tab.key]?.();
      }
      return true;
    } catch (e: any) {
      setError(e?.message ?? 'Save failed.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  // Memoized: per-form re-seeds a form whose initialValues object changes.
  const schema = React.useMemo(
    () => ({ ...generalSettingsSchema(), ...(settingsGeneralFields ?? {}) }),
    [settingsGeneralFields],
  );
  const initialValues = React.useMemo(() => generalSettingsValues(settings), [settings]);

  return {
    general: {
      schema,
      initialValues,
      onChange: onGeneralChange,
    },
    tabs: settingsTabs.map(tab => ({
      ...tab,
      props: { settings, isOpen, ...tabCallbacks[tab.key] },
    })),
    save,
    saving,
    error,
  };
}
