import gql from 'graphql-tag';

export interface ShiftLightRec {
  id: string;
  deviceKind: string;
  devid: string;
  subtype: string;
  granularity: number;
  config: string;
  devpath?: string | null;
  baud?: number | null;
  profileId?: string | null;
}

const name = { singular: 'MonocoqueShiftLight', plural: 'MonocoqueShiftLights' };
const fields = `id deviceKind devid subtype granularity config devpath baud profileId`;

export const GET_SHIFT_LIGHTS = gql`query get${name.plural} { get${name.plural} { ${fields} } }`;
export const CREATE_SHIFT_LIGHT = gql`mutation add${name.singular}($values: ${name.singular}Input!) { add${name.singular}(values: $values) { id } }`;
export const UPDATE_SHIFT_LIGHT = gql`mutation update${name.singular}($id: String!, $update: ${name.singular}Input!) { update${name.singular}(id: $id, update: $update) { id } }`;
export const REMOVE_SHIFT_LIGHT = gql`mutation remove${name.singular}($id: String!) { remove${name.singular}(id: $id) { id } }`;
export const SHIFT_LIGHT_CHANGED = gql`subscription monocoqueShiftLightChanged { monocoqueShiftLightChanged { operationName value { ${fields} } } }`;
