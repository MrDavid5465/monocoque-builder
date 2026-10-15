import gql from "graphql-tag"

export const TELEMETRY_SNAPSHOT = gql`
  query TelemetrySnapshot {
    telemetrySnapshot {
      simStatus
      car
    }
  }
`;
