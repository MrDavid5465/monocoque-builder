import gql from 'graphql-tag';

export interface ConnectedClient {
  id: string;
  name?: string;
  lastSeen: string;
}

export const HEARTBEAT_CLIENT = gql`
  mutation heartbeatClient($id: String!, $name: String) {
    heartbeatClient(id: $id, name: $name) {
      id
      name
      lastSeen
    }
  }
`;

export const GET_CONNECTED_CLIENTS = gql`
  query getConnectedClients {
    getConnectedClients {
      id
      name
      lastSeen
    }
  }
`;

export const REGISTER_CAR = gql`
  mutation registerCar($name: String!) {
    registerCar(name: $name)
  }
`;

export const REGISTER_TRACK = gql`
  mutation registerTrack($name: String!) {
    registerTrack(name: $name)
  }
`;
