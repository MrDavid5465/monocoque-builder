import gql from 'graphql-tag';

const RECORDING_FIELDS = `
  id
  name
  createdAt
  durationMs
  frameCount
  sampleRateHz
  car
`;

export const GET_RECORDINGS = gql`
  query getRecordings {
    getRecordings { ${RECORDING_FIELDS} }
  }
`;

// RecordingFrame's own field list — every flat TelemetryFrame field plus
// the 32 flattened tyre columns (`<fl|fr|rl|rr><Field>`), matching
// src-tauri/src/typiql_types.rs's RecordingFrame struct, camelCased at the
// GraphQL boundary same as every other field in this schema.
const RECORDING_FRAME_FIELDS = `
  frameIndex
  simStatus
  simon
  car
  track
  driver
  tyreCompound
  gLat
  gLon
  gVert
  heading
  pitch
  roll
  speed
  rpm
  maxRpm
  idleRpm
  gear
  maxGears
  throttle
  brake
  clutch
  steering
  handbrake
  abs
  brakeBias
  fuel
  fuelCapacity
  turboBoost
  turboPct
  flTemp flPressure flSlipRatio flSlipAngle flWear flBrakeTemp flRps flDiameter
  frTemp frPressure frSlipRatio frSlipAngle frWear frBrakeTemp frRps frDiameter
  rlTemp rlPressure rlSlipRatio rlSlipAngle rlWear rlBrakeTemp rlRps rlDiameter
  rrTemp rrPressure rrSlipRatio rrSlipAngle rrWear rrBrakeTemp rrRps rrDiameter
  airTemp
  trackTemp
  airDensity
  lap
  position
  numLaps
  numCars
  courseFlag
  lapIsValid
  inPit
  currentLapSeconds
  lastLapSeconds
  sector1Time
  sector2Time
`;

// Metadata only — cheap, used for the chart page header and to size the
// window slider (recording.frameCount) without ever fetching frame data.
export const GET_RECORDING = gql`
  query getRecording($id: String!) {
    getRecording(id: $id) { ${RECORDING_FIELDS} }
  }
`;

// Fetches only the requested frame-index window via getRecordingFrames'
// standard generated filter args (frameIndexGte/frameIndexLte — free from
// the same macro-generated CRUD every other typiql type gets) — this is
// the actual point of the DuckDB migration: a chart viewing a 500-frame
// window of a 10,000-frame recording should touch ~500 rows, not all of
// them. Fetching the *whole* relation up front (`getRecording(id) { frames
// { ... } }`) defeats that — measured ~5MB/1.5s for a full fetch on a
// 4582-frame recording vs ~570KB/0.2s for a 500-frame window.
export const GET_RECORDING_FRAMES_WINDOW = gql`
  query getRecordingFramesWindow($recordingId: String!, $lo: Int!, $hi: Int!) {
    getRecordingFrames(recordingId: $recordingId, frameIndexGte: $lo, frameIndexLte: $hi) {
      ${RECORDING_FRAME_FIELDS}
    }
  }
`;

export const START_RECORDING = gql`
  mutation startRecording($name: String!, $sampleRateHz: Float!) {
    startRecording(name: $name, sampleRateHz: $sampleRateHz) { ${RECORDING_FIELDS} }
  }
`;

export const STOP_RECORDING = gql`
  mutation stopRecording {
    stopRecording { ${RECORDING_FIELDS} }
  }
`;

export const PLAY_RECORDING = gql`
  mutation playRecording($id: String!) {
    playRecording(id: $id)
  }
`;

export const STOP_PLAYBACK = gql`
  mutation stopPlayback {
    stopPlayback
  }
`;

export const IMPORT_RECORDING = gql`
  mutation importRecording($name: String!, $sampleRateHz: Float!, $car: String, $framesJson: String!) {
    importRecording(name: $name, sampleRateHz: $sampleRateHz, car: $car, framesJson: $framesJson) { ${RECORDING_FIELDS} }
  }
`;

// Permanently deletes every frame outside [lo, hi] and reindexes what's
// kept to start at 0 — see crop_recording's own doc comment in
// graphql/recording.rs for why reindexing matters (window sliders/export
// numbering/duration all derive from frame_index starting at 0).
export const CROP_RECORDING = gql`
  mutation cropRecording($id: String!, $lo: Int!, $hi: Int!) {
    cropRecording(id: $id, lo: $lo, hi: $hi) { ${RECORDING_FIELDS} }
  }
`;

export const REMOVE_RECORDING = gql`
  mutation removeRecording($id: String!) {
    removeRecording(id: $id) { id }
  }
`;

export const RECORDING_STATUS = gql`
  query recordingStatus {
    recordingStatus { isRecording isPlaying recordingId playingId }
  }
`;

// Full-field live TelemetryFrame subscription, scoped to this feature only
// — the shared TELEMETRY_SUB (Telemetry/queries.ts, used by gauge bindings
// elsewhere) intentionally omits several fields those consumers never
// needed. Adding them there would ripple into every existing subscriber;
// this is a separate subscription against the same `telemetry` field
// instead, selecting every TelemetryFrame field so the live recording
// preview can flatten a frame the same way RECORDING_FRAME_FIELDS does.
export const RECORDING_LIVE_TELEMETRY_SUB = gql`
  subscription recordingLiveTelemetry {
    telemetry {
      simStatus
      simon
      car
      track
      driver
      tyreCompound
      gLat
      gLon
      gVert
      heading
      pitch
      roll
      speed
      rpm
      maxRpm
      idleRpm
      gear
      maxGears
      throttle
      brake
      clutch
      steering
      handbrake
      abs
      brakeBias
      fuel
      fuelCapacity
      turboBoost
      turboPct
      tyres {
        temp
        pressure
        slipRatio
        slipAngle
        wear
        brakeTemp
        rps
        diameter
      }
      airTemp
      trackTemp
      airDensity
      lap
      position
      numLaps
      numCars
      courseFlag
      lapIsValid
      inPit
      currentLapSeconds
      lastLapSeconds
      sector1Time
      sector2Time
    }
  }
`;

export interface RecordingRow {
  id: string;
  name: string;
  createdAt: string;
  durationMs: number;
  frameCount: number;
  sampleRateHz: number;
  car?: string | null;
}
