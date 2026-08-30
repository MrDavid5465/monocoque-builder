import gql from 'graphql-tag';

// Huenicorn's own web UI — kept only as a fallback escape hatch now that
// ChannelMapper.tsx/AdvancedHuenicornSettings.tsx embed the real
// channel-to-screen-region mapping and capture settings in-app (touch-
// friendly, unlike this raw link).
export const HUENICORN_WEB_UI_URL = 'http://127.0.0.1:8215';

export interface IHuenicornStatus {
  huenicornStatus: {
    running: boolean;
    apiReachable: boolean;
    installed: boolean;
  };
}

export const GET_HUENICORN_STATUS = gql`
  query huenicornStatus {
    huenicornStatus {
      running
      apiReachable
      installed
    }
  }
`;

export interface IHuenicornChannel {
  channelId: number;
  name: string;
  active: boolean;
  /** Live value, used to seed the day/night gamma sliders — see
   *  ChannelInfo.gamma_factor in src-tauri/src/huenicorn.rs. */
  gammaFactor: number;
  /** This channel's current screen-capture region, normalized 0..1 —
   *  see ChannelUVs in src-tauri/src/huenicorn.rs. */
  uvAX: number;
  uvAY: number;
  uvBX: number;
  uvBY: number;
}

export interface IHuenicornChannels {
  huenicornChannels: IHuenicornChannel[];
}

export const GET_HUENICORN_CHANNELS = gql`
  query huenicornChannels {
    huenicornChannels {
      channelId
      name
      active
      gammaFactor
      uvAX
      uvAY
      uvBX
      uvBY
    }
  }
`;

export const START_HUENICORN = gql`
  mutation startHuenicorn {
    startHuenicorn
  }
`;

export const STOP_HUENICORN = gql`
  mutation stopHuenicorn {
    stopHuenicorn
  }
`;

// Huenicorn silently reuses the first screen/region picked via the XDG
// portal forever after (a "restoreToken" it persists into its own config) —
// this stops it, clears that token, and restarts it so the picker shows up
// again for a deliberate reselection. See reset_screen_selection's own doc
// comment in src-tauri/src/huenicorn.rs.
export const RESET_HUENICORN_SCREEN_SELECTION = gql`
  mutation resetHuenicornScreenSelection {
    resetHuenicornScreenSelection
  }
`;

// Corner index convention matches Huenicorn's own Imaging::UVCorner enum —
// see set_channel_uv's doc comment in src-tauri/src/huenicorn.rs.
export enum UVCorner {
  TopLeft = 0,
  TopRight = 1,
  BottomLeft = 2,
  BottomRight = 3,
}

export interface ISetChannelUV {
  setChannelUv: { uvAX: number; uvAY: number; uvBX: number; uvBY: number };
}

export const SET_CHANNEL_UV = gql`
  mutation setChannelUv($channelId: Int!, $corner: Int!, $x: Float!, $y: Float!) {
    setChannelUv(channelId: $channelId, corner: $corner, x: $x, y: $y) {
      uvAX
      uvAY
      uvBX
      uvBY
    }
  }
`;

export interface ISetChannelActive {
  setChannelActive: IHuenicornChannel[];
}

export const SET_CHANNEL_ACTIVE = gql`
  mutation setChannelActive($channelId: Int!, $active: Boolean!) {
    setChannelActive(channelId: $channelId, active: $active) {
      channelId
      name
      active
      gammaFactor
      uvAX
      uvAY
      uvBX
      uvBY
    }
  }
`;

export const SAVE_HUENICORN_PROFILE = gql`
  mutation saveHuenicornProfile {
    saveHuenicornProfile
  }
`;

export interface ISubsampleCandidate {
  x: number;
  y: number;
}

export interface IHuenicornDisplayInfo {
  huenicornDisplayInfo: {
    x: number;
    y: number;
    subsampleWidth: number;
    subsampleResolutionCandidates: ISubsampleCandidate[];
    selectedRefreshRate: number;
    maxRefreshRate: number;
    selectedTransitionSmoothing: number;
  } | null;
}

export const GET_HUENICORN_DISPLAY_INFO = gql`
  query huenicornDisplayInfo {
    huenicornDisplayInfo {
      x
      y
      subsampleWidth
      subsampleResolutionCandidates {
        x
        y
      }
      selectedRefreshRate
      maxRefreshRate
      selectedTransitionSmoothing
    }
  }
`;

export interface IHuenicornInterpolationInfo {
  huenicornInterpolationInfo: {
    current: number;
    available: Array<{ name: string; value: number }>;
  } | null;
}

export const GET_HUENICORN_INTERPOLATION_INFO = gql`
  query huenicornInterpolationInfo {
    huenicornInterpolationInfo {
      current
      available {
        name
        value
      }
    }
  }
`;

export interface IHuenicornEntertainmentConfigs {
  huenicornEntertainmentConfigs: {
    configs: Array<{ id: string; name: string }>;
    currentId: string;
  } | null;
}

export const GET_HUENICORN_ENTERTAINMENT_CONFIGS = gql`
  query huenicornEntertainmentConfigs {
    huenicornEntertainmentConfigs {
      configs {
        id
        name
      }
      currentId
    }
  }
`;

export const SET_HUENICORN_SUBSAMPLE_WIDTH = gql`
  mutation setHuenicornSubsampleWidth($width: Int!) {
    setHuenicornSubsampleWidth(width: $width) {
      x
      y
      subsampleWidth
      subsampleResolutionCandidates {
        x
        y
      }
      selectedRefreshRate
      maxRefreshRate
      selectedTransitionSmoothing
    }
  }
`;

export const SET_HUENICORN_REFRESH_RATE = gql`
  mutation setHuenicornRefreshRate($hz: Int!) {
    setHuenicornRefreshRate(hz: $hz)
  }
`;

export const SET_HUENICORN_INTERPOLATION = gql`
  mutation setHuenicornInterpolation($value: Int!) {
    setHuenicornInterpolation(value: $value)
  }
`;

export const SET_HUENICORN_TRANSITION_SMOOTHING = gql`
  mutation setHuenicornTransitionSmoothing($value: Float!) {
    setHuenicornTransitionSmoothing(value: $value)
  }
`;

export const SET_HUENICORN_ENTERTAINMENT_CONFIGURATION = gql`
  mutation setHuenicornEntertainmentConfiguration($id: String!) {
    setHuenicornEntertainmentConfiguration(id: $id) {
      channelId
      name
      active
      gammaFactor
      uvAX
      uvAY
      uvBX
      uvBY
    }
  }
`;
