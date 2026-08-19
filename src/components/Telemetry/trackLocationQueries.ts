import gql from 'graphql-tag';

export interface TrackLocationRecord {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  // JSON array of raw telemetry track-id strings, e.g. '["ks_nordschleife"]'.
  rawTrackIds: string;
}

const TRACK_LOCATION_FIELDS = `
  id
  name
  latitude
  longitude
  rawTrackIds
`;

export const GET_TRACK_LOCATIONS = gql`
  query getTrackLocations {
    getTrackLocations { ${TRACK_LOCATION_FIELDS} }
  }
`;

export const ADD_TRACK_LOCATION = gql`
  mutation addTrackLocation($values: TrackLocationInput!) {
    addTrackLocation(values: $values) { id }
  }
`;

export const UPDATE_TRACK_LOCATION = gql`
  mutation updateTrackLocation($id: String!, $update: TrackLocationInput!) {
    updateTrackLocation(id: $id, update: $update) { id }
  }
`;

export const REMOVE_TRACK_LOCATION = gql`
  mutation removeTrackLocation($id: String!) {
    removeTrackLocation(id: $id) { id }
  }
`;

export interface GeocodeResult {
  displayName: string;
  latitude: number;
  longitude: number;
}

// Free-text geocode search (OpenStreetMap Nominatim, proxied through our own
// backend) for filling in latitude/longitude without a paid mapping API —
// see graphql/track_geocode.rs.
export const SEARCH_TRACK_LOCATIONS = gql`
  query searchTrackLocations($query: String!) {
    searchTrackLocations(query: $query) {
      displayName
      latitude
      longitude
    }
  }
`;
