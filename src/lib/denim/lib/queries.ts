import gql from 'graphql-tag';

export interface IApplication {
  name: string;
  path: string;
  defaultRoute: string;
  frontEnd: string;
  links: Array<ILink>;
}
export interface ILink {
  path: string;
  text: string;
}
const GAMEPAD_MAPPINGS_FRAGMENT = gql`
  fragment GamepadMappingsFields on AppSettings {
    gamepadMappings {
      id
      name
      mappingType
      index
    }
  }
`;

const MY = gql`
  query my {
    my {
      applications {
        path
        defaultRoute
        name
        links {
          path
          text
        }
        frontEnd
      }
      settings {
        launchPage
        theme
        fontSize
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
        simdDebugCommand
        monocoqueDebugCommand
        huenicornDebugCommand
        debugBuild
        ...GamepadMappingsFields
      }
    }
  }
  ${GAMEPAD_MAPPINGS_FRAGMENT}
`;
const UPDATE_SETTINGS = gql`
  mutation updateSettings($settings: AppSettingsInput) {
    updateSettings(settings: $settings) {
      settings {
        launchPage
        theme
        fontSize
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
        simdDebugCommand
        monocoqueDebugCommand
        huenicornDebugCommand
        debugBuild
        ...GamepadMappingsFields
      }
    }
  }
  ${GAMEPAD_MAPPINGS_FRAGMENT}
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

export interface IUserSettingInput {
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
  /** Dev-build overrides, used instead of the commands above in a debug
   *  build and ignored in a release build - see service_commands.rs. */
  simdDebugCommand?: string;
  monocoqueDebugCommand?: string;
  huenicornDebugCommand?: string;
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
  /** Dev-build overrides, used instead of the commands above in a debug
   *  build and ignored in a release build - see service_commands.rs. */
  simdDebugCommand?: string;
  monocoqueDebugCommand?: string;
  huenicornDebugCommand?: string;
  /** Read-only: true when the backend serving this is a debug build, i.e.
   *  the dev commands above are the ones actually in effect. */
  debugBuild?: boolean;
}
export interface IAppNav {
  text: string;
  path: string;
  roles: Array<string>;
}

export interface IUser {
  applications: Array<IApplication>;
  settings: Partial<ISettings>;
}

export interface IMy {
  my: Partial<IUser>;
}
export interface IFile {
  id: string;
  name: string;
  fileId: string;
  file: string;
  thumbnail: string;
  type: string;
}
const UPLOAD = gql`
  mutation uploadFile($name: String!, $file: String!, $type: String!) {
    uploadFile(name: $name, file: $file, type: $type) {
      id
      name
      thumbnail
    }
  }
`;

const GET_FILE = gql`
  query getFile($id: String!) {
    getFileBase64(id: $id) {
      id
      fileId
      name
      file
    }
  }
`;

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
  getFile: GET_FILE,
  upload: UPLOAD
};

export default dispatcher;
