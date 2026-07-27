import gql from 'graphql-tag';

export interface SoundDeviceProfile {
  id: string;
  name: string;
  car?: string | null;
  game?: string | null;
  carId?: string | null;
}

const fields = `id name car game carId`;

export const name = { singular: 'SoundDeviceProfile', plural: 'SoundDeviceProfiles' };

export const GET_PROFILES = gql`query getSoundDeviceProfiles { getSoundDeviceProfiles { ${fields} } }`;
export const GET_PROFILE  = gql`query getSoundDeviceProfile($id: String!) { getSoundDeviceProfile(id: $id) { ${fields} } }`;
export const ADD_PROFILE  = gql`mutation addSoundDeviceProfile($values: SoundDeviceProfileInput!) { addSoundDeviceProfile(values: $values) { ${fields} } }`;
export const UPDATE_PROFILE = gql`mutation updateSoundDeviceProfile($id: String!, $update: SoundDeviceProfileInput!) { updateSoundDeviceProfile(id: $id, update: $update) { ${fields} } }`;
export const REMOVE_PROFILE = gql`mutation removeSoundDeviceProfile($id: String!) { removeSoundDeviceProfile(id: $id) { id } }`;
export const PROFILE_CHANGED = gql`subscription soundDeviceProfileChanged { soundDeviceProfileChanged { operationName value { ${fields} } } }`;

export const dispatcher = {
  list: GET_PROFILES,
  show: GET_PROFILE,
  new: ADD_PROFILE,
  edit: UPDATE_PROFILE,
  delete: REMOVE_PROFILE,
  subscribe: PROFILE_CHANGED,
};

export default dispatcher;
