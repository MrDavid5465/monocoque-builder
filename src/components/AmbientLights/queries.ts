import gql from 'graphql-tag';

// Huenicorn's own web UI — where the actual channel-to-screen-region
// mapping lives. This app deliberately doesn't reimplement that UI (see
// this app's own doc comment); a link out is the whole story until a
// touch-friendly replacement is built as a follow-up.
export const HUENICORN_WEB_UI_URL = 'http://127.0.0.1:8215';

export interface IHuenicornStatus {
  huenicornStatus: {
    running: boolean;
    apiReachable: boolean;
  };
}

export const GET_HUENICORN_STATUS = gql`
  query huenicornStatus {
    huenicornStatus {
      running
      apiReachable
    }
  }
`;

export interface IHuenicornChannels {
  huenicornChannels: Array<{ channelId: number; name: string; active: boolean }>;
}

export const GET_HUENICORN_CHANNELS = gql`
  query huenicornChannels {
    huenicornChannels {
      channelId
      name
      active
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
