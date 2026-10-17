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

/**
 * A General-tab field's mapping between the stored settings and the field,
 * for a value that isn't stored under the field's own key or in the field's
 * own shape (e.g. this device's name, stored inside a `deviceMap` object).
 * Put `read` and/or `write` on a `settingsGeneralFields` entry, beside its
 * per-form keys. They follow per-form's converter convention, `(key,
 * values, ...)`: per-form's own `converter` (if any) still turns the
 * field's raw input into its submitted value first; `write` then maps that
 * value to what is saved. The core strips both before handing the schema
 * to the form.
 */
export interface ISettingsFieldMapping {
  /** The field's starting value from the saved settings. Default `settings[key]`. */
  read?: (key: string, settings: IDenimSettings) => any;
  /**
   * The settings patch to save for the field's submitted value
   * (`values[key]`; `values` is the whole General form, converted).
   * Default `{ [key]: values[key] }`. Only the keys whose value differs
   * from the saved settings are sent.
   */
  write?: (key: string, values: Record<string, any>, settings: IDenimSettings) => Record<string, any>;
}

const MAPPING_KEYS = ['read', 'write'] as const;

/** The General form's starting values: the settings, with `theme` split in two, and each mapped field's `read`. */
export const generalSettingsValues = (settings: IDenimSettings, fields?: Record<string, any>) => {
  const values: Record<string, any> = {
    ...settings,
    themeMode: parseThemeKey(settings.theme).mode,
    themeColor: parseThemeKey(settings.theme).color,
  };
  Object.entries(fields ?? {}).forEach(([key, field]) => {
    if (typeof field?.read === 'function') values[key] = field.read(key, settings);
  });
  return values;
};

// Equal for saving purposes: deep, ignoring Apollo's `__typename`, and with
// null, undefined and '' the same (per-form reports an unset field as '').
const isBlank = (v: unknown) => v === null || v === undefined || v === '';
export function sameSettingValue(a: unknown, b: unknown): boolean {
  if (isBlank(a) && isBlank(b)) return true;
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = (o: object) => Object.keys(o).filter(k => k !== '__typename' && !isBlank((o as any)[k]));
  const ka = keys(a);
  const kb = keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => sameSettingValue((a as any)[k], (b as any)[k]));
}

/** The members of `values` that differ from `saved` (sameSettingValue). */
export function changedSettings(values: Record<string, any>, saved: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  Object.entries(values).forEach(([k, v]) => {
    if (!sameSettingValue(v, saved[k])) out[k] = v;
  });
  return out;
}

type SaveFn = (() => void | Promise<void>) | undefined;

export interface ISettingsFormTab extends ISettingsTab {
  /** Pass these to `Component`. */
  props: ISettingsTabProps;
}

export interface ISettingsForm {
  general: {
    /** per-form schema: Denim's fields plus `settingsGeneralFields` (without their `read`/`write`). */
    schema: Record<string, any>;
    initialValues: Record<string, any>;
    /** Wire to per-form's `onChange(name, { clean, isValid })`. */
    onChange: (name: string, state: { clean: Record<string, any>; isValid: boolean }) => void;
  };
  /**
   * The extension tabs, each with the props to render its Component with.
   * Render THIS Component (it tracks whether the tab is mounted, for
   * `loading`), not the one in `settingsTabs`.
   */
  tabs: ISettingsFormTab[];
  /**
   * Validates, then saves only what changed: General's values and every
   * ready tab's patch, compared with the saved settings, in ONE save (none
   * at all when nothing changed), then every ready tab's registerSave
   * callback. Refuses while a tab is loading. Resolves true on success.
   */
  save: () => Promise<boolean>;
  saving: boolean;
  /**
   * The open tabs still loading their data (`setReady(false)`, or
   * `loads: true` and not ready yet). Hold Save while it isn't empty:
   * `save()` refuses then.
   */
  loading: ISettingsTab[];
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

  // Readiness: a tab with `loads: true` starts not ready, any tab can say
  // so with setReady(false). Read synchronously (a ref) by onChange, so a
  // patch reported while the tab's data hadn't arrived is dropped, never
  // saved; mirrored in state so the dialog re-renders to hold Save.
  const tabsRef = React.useRef(settingsTabs);
  React.useLayoutEffect(() => {
    tabsRef.current = settingsTabs;
  }, [settingsTabs]);
  const readyRef = React.useRef<Record<string, boolean>>({});
  const [readyState, setReadyState] = React.useState<Record<string, boolean>>({});
  const [mounted, setMounted] = React.useState<Record<string, boolean>>({});
  const isReady = (key: string) =>
    readyRef.current[key] ?? !tabsRef.current.find(t => t.key === key)?.loads;

  React.useEffect(() => {
    if (isOpen) {
      setTabPatches({});
      setTabValidity({});
      setError(null);
      saveFns.current = {};
    }
  }, [isOpen]);

  // One stable onChange/registerSave/setReady set per tab key, so a tab can
  // list them as effect dependencies without re-running every render.
  const tabKeys = settingsTabs.map(t => t.key).join('|');
  const tabCallbacks = React.useMemo(() => {
    const out: Record<string, Pick<ISettingsTabProps, 'onChange' | 'registerSave' | 'setReady'>> = {};
    settingsTabs.forEach(tab => {
      const dropPatch = () => {
        setTabPatches(({ [tab.key]: _p, ...rest }) => rest);
        setTabValidity(({ [tab.key]: _v, ...rest }) => rest);
      };
      out[tab.key] = {
        onChange: (patch, isValid = true, message) => {
          if (!isReady(tab.key)) return;
          setTabPatches(prev => ({ ...prev, [tab.key]: patch }));
          setTabValidity(prev => ({ ...prev, [tab.key]: { valid: isValid, message } }));
        },
        registerSave: save => {
          saveFns.current[tab.key] = save;
        },
        setReady: ready => {
          if (isReady(tab.key) === ready) return;
          readyRef.current[tab.key] = ready;
          setReadyState(prev => ({ ...prev, [tab.key]: ready }));
          // Whatever it reported before its data went away is stale.
          if (!ready) dropPatch();
        },
      };
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabKeys]);

  // Each tab's Component, wrapped to know whether it is mounted: a loading
  // tab holds Save only while it is open (a tab control may unmount it).
  const tabComponents = React.useMemo(() => {
    const out: Record<string, React.ComponentType<ISettingsTabProps>> = {};
    settingsTabs.forEach(tab => {
      const Tracked: React.FC<ISettingsTabProps> = props => {
        React.useEffect(() => {
          setMounted(prev => ({ ...prev, [tab.key]: true }));
          return () => setMounted(prev => ({ ...prev, [tab.key]: false }));
        }, []);
        const Component = tabsRef.current.find(t => t.key === tab.key)?.Component ?? tab.Component;
        return React.createElement(Component, props);
      };
      Tracked.displayName = `SettingsTab(${tab.key})`;
      out[tab.key] = Tracked;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabKeys]);

  // Each mapped General field's `write`, by key.
  const mappings = React.useMemo(() => {
    const out: Record<string, ISettingsFieldMapping> = {};
    Object.entries(settingsGeneralFields ?? {}).forEach(([key, field]) => {
      if (field && (field.read || field.write)) out[key] = { read: field.read, write: field.write };
    });
    return out;
  }, [settingsGeneralFields]);

  const onGeneralChange = React.useCallback(
    (_name: string, { clean, isValid }: { clean: Record<string, any>; isValid: boolean }) => {
      setGeneralValues(clean);
      setGeneralValid(isValid);
    },
    [],
  );

  // General's form values as settings: theme joined back, mapped fields written.
  function generalPatch(): Record<string, any> {
    if (!Object.keys(generalValues).length) return {};
    const { themeColor, themeMode, ...rest } = generalValues;
    const out: Record<string, any> = { theme: themeKey(themeMode, themeColor) };
    Object.entries(rest).forEach(([key, value]) => {
      const write = mappings[key]?.write;
      if (write) Object.assign(out, write(key, rest, settings));
      else out[key] = value;
    });
    return out;
  }

  const loading = settingsTabs.filter(t => mounted[t.key] && !(readyState[t.key] ?? !t.loads));

  async function save(): Promise<boolean> {
    if (loading.length) {
      setError(`Wait for the ${loading.map(t => t.headerText).join(', ')} tab to load before saving.`);
      return false;
    }
    if (!generalValid) {
      setError('Please fix the highlighted fields on the General tab before saving.');
      return false;
    }
    const readyTabs = settingsTabs.filter(t => isReady(t.key));
    const invalid = readyTabs.find(t => tabValidity[t.key] && !tabValidity[t.key].valid);
    if (invalid) {
      setError(tabValidity[invalid.key].message ?? `Please fix the ${invalid.headerText} tab before saving.`);
      return false;
    }
    setError(null);
    setSaving(true);
    try {
      // The saved theme, normalised the way the form joins it, so an
      // unusual stored key doesn't count as a change.
      const parsed = parseThemeKey(settings.theme);
      const saved = { ...settings, theme: themeKey(parsed.mode, parsed.color) };
      const values = changedSettings(
        Object.assign({}, generalPatch(), ...readyTabs.map(t => tabPatches[t.key] ?? {})),
        saved,
      );
      if (Object.keys(values).length) await saveSettings(values);
      for (const tab of readyTabs) {
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
  const schema = React.useMemo(() => {
    const extra: Record<string, any> = {};
    Object.entries(settingsGeneralFields ?? {}).forEach(([key, field]) => {
      const rest = { ...field };
      MAPPING_KEYS.forEach(k => delete rest[k]);
      extra[key] = rest;
    });
    return { ...generalSettingsSchema(), ...extra };
  }, [settingsGeneralFields]);
  const initialValues = React.useMemo(
    () => generalSettingsValues(settings, settingsGeneralFields),
    [settings, settingsGeneralFields],
  );

  return {
    general: {
      schema,
      initialValues,
      onChange: onGeneralChange,
    },
    tabs: settingsTabs.map(tab => ({
      ...tab,
      Component: tabComponents[tab.key],
      props: { settings, isOpen, ...tabCallbacks[tab.key] },
    })),
    save,
    saving,
    loading,
    error,
  };
}
