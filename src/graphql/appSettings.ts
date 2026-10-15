import { gql } from '@apollo/client';
import { buildMyQuery } from '../lib/denim';
import type { IApplication } from '../lib/denim';

// Monocoque Builder's own half of the `my` contract: the AppSettings fields
// beyond Denim's launchPage/theme/fontSize. These used to live in the
// vendored denim's lib/queries.ts; denim is now a generic headless core, so
// they belong to the app.
//
// The shell (SidebarShell, settingsSource="server") and this module build
// their `my` query from the SAME options through denim's buildMyQuery, so
// both documents select exactly the same fields. That matters: neither
// `my` nor `settings` has an id, so two different selections of them would
// overwrite each other in Apollo's cache and each refetch the other forever.
export const SETTINGS_FIELDS = `
  deviceMap
  typiqlDataDir
  steerMaxDeg
  setupComplete
  shakerDspEnabled
  shakerLfeSourceDevice
  shakerLfeLpfHz
  huenicornEnabled
  ambientTintIntensity
  ambientPrimaryChannel
  ambientSaturationBoostDay
  ambientSaturationBoostNight
  ambientChannelGamma {
    channelId
    day
    night
  }
  simdCommand
  monocoqueCommand
  huenicornCommand
  debugBuild
  gamepadMappings {
    id
    name
    mappingType
    index
  }
`;

/** `my.applications` extras: the sidebar's group heading and Fluent icon. */
export const APPLICATION_FIELDS = 'group icon';

export const MY_QUERY_OPTIONS = {
  applications: true,
  settings: true,
  settingsFields: SETTINGS_FIELDS,
  applicationFields: APPLICATION_FIELDS,
};

const MY = buildMyQuery(MY_QUERY_OPTIONS);

const UPDATE_SETTINGS = gql`
  mutation updateSettings($settings: AppSettingsInput) {
    updateSettings(settings: $settings) {
      settings {
        launchPage
        theme
        fontSize
        ${SETTINGS_FIELDS}
      }
    }
  }
`;

export interface GamepadMapping {
  id: string;
  name: string;
  /** "button" or "axis" */
  mappingType: string;
  /** Button 0–31 or axis 0–5 */
  index: number;
}

/** One Huenicorn channel's day/night gamma pair — see ChannelGamma in
 *  src-tauri/src/config_manager/types.rs for what the numbers mean. */
export interface IChannelGamma {
  channelId: number;
  day: number;
  night: number;
}

export interface ISettings {
  launchPage: string;
  theme: string;
  fontSize: number;
  deviceMap: Record<string, string>;
  typiqlDataDir?: string;
  steerMaxDeg?: number;
  setupComplete?: boolean;
  gamepadMappings?: GamepadMapping[];
  shakerDspEnabled?: boolean;
  shakerLfeSourceDevice?: string;
  shakerLfeLpfHz?: number;
  huenicornEnabled?: boolean;
  ambientTintIntensity?: number;
  ambientPrimaryChannel?: number;
  ambientSaturationBoostDay?: number;
  ambientSaturationBoostNight?: number;
  ambientChannelGamma?: IChannelGamma[];
  simdCommand?: string;
  monocoqueCommand?: string;
  huenicornCommand?: string;
  /** Read-only: true when the backend serving this is a debug build, i.e.
   *  the MONOCOQUE_BUILDER_*_DEV_COMMAND env vars are what is in effect. */
  debugBuild?: boolean;
}

export interface IUser {
  applications: Array<IApplication>;
  settings: Partial<ISettings>;
}

export interface IMy {
  my: Partial<IUser>;
}

// Whether the backend can create the virtual gamepad (i.e. open
// /dev/uinput). Deliberately a GraphQL query rather than a Tauri command:
// the backend is the process that would actually open the device, so it's
// the only one that can answer honestly, and going through typiql means the
// browser build gets the same answer as the desktop one. Same reasoning
// already applied to gamepadButton/gamepadAxis — see gamepad.rs.
export const GAMEPAD_UDEV_STATUS = gql`
  query gamepadUdevStatus {
    gamepadUdevStatus
  }
`;

export const SETUP_GAMEPAD_UDEV = gql`
  mutation setupGamepadUdev {
    setupGamepadUdev
  }
`;

const dispatcher = {
  my: MY,
  updateSettings: UPDATE_SETTINGS,
};

export default dispatcher;
