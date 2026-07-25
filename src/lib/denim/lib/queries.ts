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

const dispatcher = {
  my: MY,
  updateSettings: UPDATE_SETTINGS,
  getFile: GET_FILE,
  upload: UPLOAD
};

export default dispatcher;
