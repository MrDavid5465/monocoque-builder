import gql from "graphql-tag";

// Merged replacement for the 4 separate per-type subscriptions
// (monocoqueSoundDeviceChanged/shakerChannelChanged/shakerDspChannelChanged/
// lfeChannelChanged) — see ShakerMatrix.tsx's own comment for why. Field
// sets copied from the existing per-type subscriptions in queries.ts/
// channelQueries.ts/dspQueries.ts/lfeQueries.ts respectively, so Apollo's
// normalized cache keeps updating existing entities exactly as it did with
// the 4 standalone subscriptions — no onData handler needed here either.
export const SHAKER_UPDATES = gql`
  subscription shakerUpdates {
    shakerUpdates {
      ... on MonocoqueSoundDeviceChanged {
        operationName
        value { id device effect channelId volume modulation frequency frequencyMax amplitude amplitudeMax profileId dspSlot }
      }
      ... on ShakerChannelChanged {
        operationName
        value { id profileId pan devid channels position }
      }
      ... on ShakerDspChannelChanged {
        operationName
        value { id profileId slot lpfHz fader muted }
      }
      ... on LfeChannelChanged {
        operationName
        value { id profileId channelId fader muted }
      }
    }
  }
`;
