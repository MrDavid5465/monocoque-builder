// useSettingsForm: only changed values are saved, and a tab that loads its
// own data holds Save and contributes nothing until it is ready.
//
// Needs vitest, jsdom and @testing-library/react (run from an app that has
// them, e.g. `npx vitest run src/lib/denim`). An app without them excludes
// `src/lib/**/__tests__` from its tsconfig.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { DenimContext } from '../DenimProvider';
import type { IDenimContext } from '../DenimProvider';
import { changedSettings, sameSettingValue, useSettingsForm } from '../settingsForm';
import type { ISettingsForm } from '../settingsForm';
import type { ISettingsTab, ISettingsTabProps } from '../lib/settingsExtensions';

const SAVED = {
  launchPage: '',
  theme: 'dark-red',
  fontSize: 1,
  reduceMotion: false,
  steer: 900,
  deviceMap: { __typename: 'DeviceMap', abc: 'Rig PC', other: 'Laptop' },
};

function setup(opts: { tabs?: ISettingsTab[]; generalFields?: Record<string, any> } = {}) {
  const saveSettings = vi.fn(async (_values: Record<string, any>) => {});
  const ctx = {
    settings: SAVED,
    saveSettings,
    settingsTabs: opts.tabs ?? [],
    settingsGeneralFields: opts.generalFields,
  } as unknown as IDenimContext;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DenimContext.Provider value={ctx}>{children}</DenimContext.Provider>
  );
  const hook = renderHook(() => useSettingsForm(true), { wrapper });
  return { hook, saveSettings, wrapper };
}

const pick = (values: Record<string, any>, keys: string[]) =>
  Object.fromEntries(Object.entries(values).filter(([k]) => keys.includes(k)));

// What per-form's Form reports for the General tab: its schema's fields,
// from the starting values (theme split in two), plus any edits.
const reportGeneral = (form: ISettingsForm, edits: Record<string, any> = {}) =>
  act(() =>
    form.general.onChange('userSettings', {
      clean: { ...pick(form.general.initialValues, Object.keys(form.general.schema)), ...edits },
      isValid: true,
    }),
  );

describe('sameSettingValue / changedSettings', () => {
  it('ignores __typename and treats null, undefined and "" alike', () => {
    expect(sameSettingValue({ __typename: 'X', a: 1 }, { a: 1 })).toBe(true);
    expect(sameSettingValue(null, '')).toBe(true);
    expect(sameSettingValue(undefined, '')).toBe(true);
    expect(sameSettingValue([{ id: 1, __typename: 'M' }], [{ id: 1 }])).toBe(true);
    expect(sameSettingValue({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameSettingValue(0, '')).toBe(false);
    expect(sameSettingValue(false, undefined)).toBe(false);
  });
  it('keeps only the changed members', () => {
    expect(changedSettings({ a: 1, b: 'x', c: '' }, { a: 1, b: 'y' })).toEqual({ b: 'x' });
  });
});

describe('useSettingsForm: General', () => {
  it('sends nothing when nothing changed', async () => {
    const { hook, saveSettings } = setup();
    await reportGeneral(hook.result.current);
    let ok = false;
    await act(async () => {
      ok = await hook.result.current.save();
    });
    expect(ok).toBe(true);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('sends only the changed fields', async () => {
    const { hook, saveSettings } = setup();
    await reportGeneral(hook.result.current, { themeMode: 'light', fontSize: 1 });
    await act(async () => {
      await hook.result.current.save();
    });
    expect(saveSettings).toHaveBeenCalledWith({ theme: 'light-red' });
  });

  it('maps a stored value to a field and back (read / write)', async () => {
    const generalFields = {
      deviceName: {
        type: 'text',
        label: 'Device name',
        read: (_key: string, settings: any) => settings.deviceMap?.abc ?? '',
        write: (key: string, values: Record<string, any>, settings: any) => ({
          deviceMap: { ...settings.deviceMap, abc: values[key] },
        }),
      },
    };
    const { hook, saveSettings } = setup({ generalFields });
    const form = hook.result.current;
    expect(form.general.initialValues.deviceName).toBe('Rig PC');
    // The mapping is the core's: per-form never sees read/write.
    expect(form.general.schema.deviceName).toEqual({ type: 'text', label: 'Device name' });

    // Unchanged: the written deviceMap equals the saved one (__typename aside).
    await reportGeneral(form);
    await act(async () => {
      await hook.result.current.save();
    });
    expect(saveSettings).not.toHaveBeenCalled();

    await reportGeneral(hook.result.current, { deviceName: 'Sim Rig' });
    await act(async () => {
      await hook.result.current.save();
    });
    expect(saveSettings).toHaveBeenCalledTimes(1);
    const sent = saveSettings.mock.calls[0][0];
    expect(Object.keys(sent)).toEqual(['deviceMap']);
    expect(sent.deviceMap).toMatchObject({ abc: 'Sim Rig', other: 'Laptop' });
  });
});

describe('useSettingsForm: a tab that loads its data', () => {
  // A tab whose data arrives when the test says so. It reports its whole
  // form (as a per-form tab does) in an effect after declaring readiness.
  function makeTab() {
    const control: { props?: ISettingsTabProps; saveRan: number } = { saveRan: 0 };
    const LoadingTab: React.FC<ISettingsTabProps & { ready?: boolean; steer?: number }> = props => {
      control.props = props;
      return null;
    };
    const tab: ISettingsTab = { key: 'dash', headerText: 'Dashboards', Component: LoadingTab, loads: true };
    return { tab, control };
  }

  it('holds Save while open and not ready, drops early patches, skips registerSave', async () => {
    const { tab, control } = makeTab();
    const { hook, saveSettings, wrapper } = setup({ tabs: [tab] });
    const formTab = () => hook.result.current.tabs[0];
    const Tab = formTab().Component;
    const mounted = render(<Tab {...formTab().props} />, { wrapper });
    expect(hook.result.current.loading.map(t => t.key)).toEqual(['dash']);

    // Seeded before its data arrived: an empty value, which must never be saved.
    act(() => {
      control.props!.onChange({ steer: '' });
      control.props!.registerSave(() => {
        control.saveRan++;
      });
    });
    let ok = true;
    await act(async () => {
      ok = await hook.result.current.save();
    });
    expect(ok).toBe(false);
    expect(hook.result.current.error).toMatch(/Dashboards/);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(control.saveRan).toBe(0);

    // The data arrives: unchanged values send nothing, the save callback runs.
    act(() => {
      control.props!.setReady(true);
      control.props!.onChange({ steer: 900 });
    });
    expect(hook.result.current.loading).toEqual([]);
    await act(async () => {
      ok = await hook.result.current.save();
    });
    expect(ok).toBe(true);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(control.saveRan).toBe(1);

    // An edit sends just that value.
    act(() => control.props!.onChange({ steer: 540 }));
    await act(async () => {
      await hook.result.current.save();
    });
    expect(saveSettings).toHaveBeenCalledWith({ steer: 540 });
    mounted.unmount();
  });

  it('does not hold Save once the loading tab is closed (unmounted)', async () => {
    const { tab, control } = makeTab();
    const { hook, saveSettings, wrapper } = setup({ tabs: [tab] });
    const Tab = hook.result.current.tabs[0].Component;
    const mounted = render(<Tab {...hook.result.current.tabs[0].props} />, { wrapper });
    act(() => control.props!.onChange({ steer: '' }));
    expect(hook.result.current.loading).toHaveLength(1);
    mounted.unmount();
    expect(hook.result.current.loading).toEqual([]);
    let ok = false;
    await act(async () => {
      ok = await hook.result.current.save();
    });
    expect(ok).toBe(true);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('drops a ready tab\'s patch when it goes back to loading', async () => {
    const { tab, control } = makeTab();
    const { hook, saveSettings, wrapper } = setup({ tabs: [tab] });
    const Tab = hook.result.current.tabs[0].Component;
    const mounted = render(<Tab {...hook.result.current.tabs[0].props} />, { wrapper });
    act(() => {
      control.props!.setReady(true);
      control.props!.onChange({ steer: 540 });
      control.props!.setReady(false);
      control.props!.setReady(true);
    });
    await act(async () => {
      await hook.result.current.save();
    });
    expect(saveSettings).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it('a tab without `loads` is ready from the start', async () => {
    const control: { props?: ISettingsTabProps } = {};
    const Plain: React.FC<ISettingsTabProps> = props => {
      control.props = props;
      return null;
    };
    const { hook, saveSettings, wrapper } = setup({ tabs: [{ key: 'p', headerText: 'Plain', Component: Plain }] });
    const Tab = hook.result.current.tabs[0].Component;
    render(<Tab {...hook.result.current.tabs[0].props} />, { wrapper });
    expect(hook.result.current.loading).toEqual([]);
    act(() => control.props!.onChange({ steer: 900, fontSize: 1.29 }));
    await act(async () => {
      await hook.result.current.save();
    });
    expect(saveSettings).toHaveBeenCalledWith({ fontSize: 1.29 });
  });
});
