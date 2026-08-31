import gql from 'graphql-tag';

export interface AudioSinkInfo {
  name: string;
  description: string;
  channels: number;
}

export interface ShakerDspChannel {
  id: string;
  profileId?: string | null;
  // The row's permanent isolated DSP capture-channel identity (matches
  // MonocoqueSoundDevice.dspSlot) — NOT a physical output channel.
  slot: number;
  lpfHz?: number | null;
  fader: number;
  // Silences this channel in the live filter-chain without discarding the
  // stored fader value — mirrors lpfHz's bypass-via-null pattern.
  muted: boolean;
}

const dspChannelFields = `id profileId slot lpfHz fader muted`;

export const GET_AUDIO_SINKS = gql`
  query getAudioSinks {
    getAudioSinks {
      name
      description
      channels
    }
  }
`;

export const ENABLE_SHAKER_DSP = gql`
  mutation enableShakerDsp {
    enableShakerDsp
  }
`;

/** Rebuilds the running filter-chain in place (no enable/disable flip) —
 *  needed after a device change, which alters the graph itself rather than a
 *  parameter on it. Returns false when DSP isn't on. */
export const RELOAD_SHAKER_DSP = gql`
  mutation reloadShakerDsp {
    reloadShakerDsp
  }
`;

export const DISABLE_SHAKER_DSP = gql`
  mutation disableShakerDsp {
    disableShakerDsp
  }
`;

export const WRITE_MONOCOQUE_CONFIG = gql`
  mutation writeMonocoqueConfig($config: String!) {
    writeMonocoqueConfig(config: $config)
  }
`;

export const RELOAD_MONOCOQUE = gql`
  mutation reloadMonocoque {
    reloadMonocoque
  }
`;

// Live-applies an LPF/fader/mute change to the already-running filter-chain
// — no process restart, no interruption in output. Call right after
// persisting via update/addShakerDspChannel, only while DSP is currently
// enabled.
export const APPLY_DSP_CHANNEL_LIVE = gql`
  mutation applyShakerDspChannelLive($slot: Int!, $lpfHz: Float, $fader: Int!, $muted: Boolean!) {
    applyShakerDspChannelLive(slot: $slot, lpfHz: $lpfHz, fader: $fader, muted: $muted)
  }
`;

export const GET_DSP_CHANNELS = gql`
  query getShakerDspChannels {
    getShakerDspChannels {
      ${dspChannelFields}
    }
  }
`;

export const ADD_DSP_CHANNEL = gql`
  mutation addShakerDspChannel($values: ShakerDspChannelInput!) {
    addShakerDspChannel(values: $values) {
      ${dspChannelFields}
    }
  }
`;

export const UPDATE_DSP_CHANNEL = gql`
  mutation updateShakerDspChannel($id: String!, $update: ShakerDspChannelInput!) {
    updateShakerDspChannel(id: $id, update: $update) {
      ${dspChannelFields}
    }
  }
`;

export const REMOVE_DSP_CHANNEL = gql`
  mutation removeShakerDspChannel($id: String!) {
    removeShakerDspChannel(id: $id) {
      id
    }
  }
`;

export const DSP_CHANNEL_CHANGED = gql`
  subscription shakerDspChannelChanged {
    shakerDspChannelChanged {
      operationName
      value {
        ${dspChannelFields}
      }
    }
  }
`;
