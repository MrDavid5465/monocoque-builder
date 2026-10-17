// Monocoque Builder's fields on denim's General settings tab: this device's
// name and the config directory. Both are global, cross-feature settings
// (see the Settings dialog's scope rule in settingsTabs.tsx).
//
// The device name is edited as one string but stored inside the shared
// `deviceMap` object ({ [appId]: name }), so it maps the stored value with
// the core's `read` / `write` (denim's ISettingsFieldMapping). The core
// saves only what changed: opening Settings and pressing Save rewrites
// neither the device map nor the config directory (the backend's data
// location).
import { useMemo } from 'react';
import { useQuery } from '@apollo/client/react';
import dispatcher, { IMy } from '../../graphql/appSettings';
import { getAppId } from '../../graphql/client';
import type { IDenimSettings } from '../../lib/denim-fabric';

/**
 * The extra General-tab fields, for the shell's `settingsGeneralFields`.
 * A hook because the device-name box offers the names already in use,
 * which come from the saved settings (the same `my` entry the shell reads).
 */
export function useGeneralSettingsFields() {
  const { data } = useQuery<IMy>(dispatcher.my, { fetchPolicy: 'cache-first' });
  const deviceMap = data?.my?.settings?.deviceMap;
  return useMemo(() => {
    const appId = getAppId();
    const names = [...new Set(Object.values(deviceMap ?? {}).filter(n => !!n))];
    return {
      deviceName: {
        type: 'combobox',
        label: 'Device name',
        placeholder: 'Enter or select a name for this device',
        options: names.map(n => ({ text: n, value: n })),
        required: false,
        // This device's entry in the shared map, and back into it.
        read: (_key: string, settings: IDenimSettings) => settings.deviceMap?.[appId] ?? '',
        write: (key: string, values: Record<string, any>, settings: IDenimSettings) => ({
          deviceMap: { ...(settings.deviceMap ?? {}), [appId]: values[key] ?? '' },
        }),
      },
      typiqlDataDir: {
        type: 'text',
        label: 'Config directory',
        placeholder: '~/.config/dashboard-designer',
        required: false,
      },
    };
  }, [deviceMap]);
}
