import gql from 'graphql-tag';

export interface ShiftLightProfile { id: string; name: string; car?: string | null; game?: string | null; carId?: string | null; }

const n = { singular: 'ShiftLightProfile', plural: 'ShiftLightProfiles' };
const fields = `id name car game carId`;

export const GET_PROFILES    = gql`query get${n.plural} { get${n.plural} { ${fields} } }`;
export const GET_PROFILE     = gql`query get${n.singular}($id: String!) { get${n.singular}(id: $id) { ${fields} } }`;
export const ADD_PROFILE     = gql`mutation add${n.singular}($values: ${n.singular}Input!) { add${n.singular}(values: $values) { ${fields} } }`;
export const UPDATE_PROFILE  = gql`mutation update${n.singular}($id: String!, $update: ${n.singular}Input!) { update${n.singular}(id: $id, update: $update) { ${fields} } }`;
export const REMOVE_PROFILE  = gql`mutation remove${n.singular}($id: String!) { remove${n.singular}(id: $id) { id } }`;
export const PROFILE_CHANGED = gql`subscription shiftLightProfileChanged { shiftLightProfileChanged { operationName value { ${fields} } } }`;

export const profileResultKey    = 'getShiftLightProfiles';
export const addProfileResultKey = 'addShiftLightProfile';
export const STORAGE_KEY         = 'shift_light_active_profile';
