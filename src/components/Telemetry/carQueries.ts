import { gql } from '@apollo/client';

export interface CarPhotoRef {
  id: string;
  filename: string;
  url: string; // server-relative, e.g. /360-photos/{id}.png — prefix with apiBase()
}

export interface CarRecord {
  id: string;
  name: string;
  carIds: string; // JSON-serialized string[]
  dayPhoto?: CarPhotoRef;
  nightPhoto?: CarPhotoRef;
  thumbnail?: string;
  /** Which installed AC car the 360° capture loads. Falls back to carIds[0]. */
  captureCarId?: string | null;
  /** The stand-in car dashboards fall back to when they have no car of their
   *  own. Exactly one car carries this. */
  favorite?: boolean;
}

export function parseCarIds(car: { carIds?: string } | undefined | null): string[] {
  try {
    const parsed = JSON.parse(car?.carIds ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const CAR_FIELDS = `id name carIds captureCarId favorite dayPhoto { id filename url } nightPhoto { id filename url } thumbnail`;

/// Makes one car the favourite, clearing the flag from all others. Pass
/// `favorite: false` to clear it without promoting another.
export const SET_FAVORITE_CAR = gql`
  mutation setFavoriteCar($id: String!, $favorite: Boolean) {
    setFavoriteCar(id: $id, favorite: $favorite) { ${'id name favorite'} }
  }
`;

export const GET_CARS = gql`
  query getCars {
    getCars { ${CAR_FIELDS} }
  }
`;

export const ADD_CAR = gql`
  mutation addCar($values: CarInput!) {
    addCar(values: $values) { ${CAR_FIELDS} }
  }
`;

export const UPDATE_CAR = gql`
  mutation updateCar($id: String!, $update: CarInput!) {
    updateCar(id: $id, update: $update) { ${CAR_FIELDS} }
  }
`;

export const DELETE_CAR = gql`
  mutation deleteCar($id: String!) {
    deleteCar(id: $id)
  }
`;

/// Change events for a single Car, for the `subscribeToOne` pattern (see
/// typical-admin-fabric's Update.tsx). Lets a page react to writes it didn't
/// make itself — notably an automated 360° capture, which runs detached from
/// any request and so has no mutation response to update the cache from.
export const CAR_CHANGED = gql`
  subscription carChanged($id: String) {
    carChanged(id: $id) { operationName }
  }
`;

export const SYNC_CAR_PHOTOS = gql`
  query syncCarPhotos($id: String!) {
    syncCarPhotos(id: $id) { ${CAR_FIELDS} }
  }
`;

const PHOTO_MUTATION_RESULT_FIELDS = `id dayPhoto { id filename url } nightPhoto { id filename url }`;

export const UPLOAD_CAR_PHOTO = gql`
  mutation uploadCarPhoto($id: String!, $filename: String!, $data: String!) {
    uploadCarPhoto(id: $id, filename: $filename, data: $data) { ${PHOTO_MUTATION_RESULT_FIELDS} }
  }
`;

export const UPLOAD_CAR_PHOTO_NIGHT = gql`
  mutation uploadCarPhotoNight($id: String!, $filename: String!, $data: String!) {
    uploadCarPhotoNight(id: $id, filename: $filename, data: $data) { ${PHOTO_MUTATION_RESULT_FIELDS} }
  }
`;

export const DELETE_CAR_PHOTO_NIGHT = gql`
  mutation deleteCarPhotoNight($id: String!) {
    deleteCarPhotoNight(id: $id) { ${PHOTO_MUTATION_RESULT_FIELDS} }
  }
`;

export const UPLOAD_CAR_THUMBNAIL = gql`
  mutation uploadCarThumbnail($id: String!, $data: String!) {
    uploadCarThumbnail(id: $id, data: $data) { id thumbnail }
  }
`;

export interface AcCarOption {
  id: string;
  name: string;
  brand?: string | null;
}

export interface AcCaptureSupport {
  available: boolean;
  reason?: string | null;
  installPath?: string | null;
  cars: AcCarOption[];
}

/// Whether capture is possible on this machine, and what's installed to
/// capture. Also backfills KnownCar server-side, so the Game car IDs picker
/// offers every installed car rather than only ones seen in telemetry.
export const AC_CAPTURE_SUPPORT = gql`
  query acCaptureSupport {
    acCaptureSupport {
      available
      reason
      installPath
      cars { id name brand }
    }
  }
`;

export interface CarCaptureStatus {
  running: boolean;
  carId?: string | null;
  stage: string;
  lastError?: string | null;
  lastCompletedCarId?: string | null;
}

/// Kicks off an automated day+night 360° capture in Assetto Corsa. Returns
/// as soon as the run has started — it takes minutes, so progress is read
/// from CAR_CAPTURE_STATUS rather than awaited here.
export const CAPTURE_CAR_PHOTOS_360 = gql`
  mutation captureCarPhotos360($id: String!, $trackId: String) {
    captureCarPhotos360(id: $id, trackId: $trackId)
  }
`;

/// Polled (only while a capture is running) rather than subscribed to. This
/// app has hit the browser's ~6-connections-per-origin limit before by
/// holding too many subscriptions open at once — see the shakerUpdates
/// resolver — so a short-lived poll is preferred to a permanent connection
/// for something used this rarely.
export const CAR_CAPTURE_STATUS = gql`
  query carCaptureStatus {
    carCaptureStatus { running carId stage lastError lastCompletedCarId }
  }
`;
