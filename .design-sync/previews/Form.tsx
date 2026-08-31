import * as React from 'react';
import { Form } from 'denim';

// Schema-driven form. Every field kind below is one case in the field
// renderer's switch (see Fabric) — the schema decides what renders, the
// component is never composed field-by-field.
//
// The schemas here are ported from this app's own screens (the ambient
// lighting settings panel and a device profile form) rather than invented,
// so the shapes are ones the library actually receives.

export const SettingsForm = () => (
  <Form
    name="ambientLightsSettings"
    form={{
      huenicornEnabled: { type: 'checkbox', label: 'Auto-launch when driving' },
      ambientTintIntensity: {
        type: 'slider',
        label: 'Tint intensity',
        min: 0,
        max: 1,
        step: 0.05,
      },
      ambientPrimaryChannel: {
        type: 'select',
        label: 'Primary channel (drives 360° tint)',
        options: [
          { text: 'First active channel', value: '' },
          { text: 'Hue color lamp 1', value: '0' },
          { text: 'Hue color lamp 2', value: '1' },
          { text: 'Hue lightstrip 1', value: '3' },
        ],
      },
      ambientSaturationBoost: {
        type: 'slider',
        label: 'Color vividness',
        min: 1,
        max: 6,
        step: 0.5,
      },
    }}
    initialValues={{
      huenicornEnabled: true,
      ambientTintIntensity: 0.3,
      ambientPrimaryChannel: '1',
      ambientSaturationBoost: 2,
    }}
  />
);

export const TextAndNumberFields = () => (
  <Form
    name="deviceProfile"
    form={{
      name: { type: 'text', label: 'Profile name', required: true },
      device: { type: 'text', label: 'Output device' },
      channels: { type: 'number', label: 'Channels' },
      notes: { type: 'textarea', label: 'Notes' },
    }}
    initialValues={{
      name: 'Rear shakers — endurance',
      device: 'Surround (analog 4.0)',
      channels: 4,
      notes: 'Lower gain on kerbs; full range on road texture.',
    }}
  />
);

export const RadioAndToggles = () => (
  <Form
    name="displayOptions"
    form={{
      view: {
        type: 'radio',
        label: 'Default view',
        options: [
          { text: 'Table', value: 'table' },
          { text: 'Cards', value: 'card' },
        ],
      },
      showThumbnails: { type: 'checkbox', label: 'Show thumbnails' },
      compact: { type: 'checkbox', label: 'Compact rows' },
    }}
    initialValues={{ view: 'card', showThumbnails: true, compact: false }}
  />
);

// A blank new-record form. Note the required field renders no error here:
// per-form surfaces validation only after a field is touched or submitted,
// so the error state can't be captured in a static preview.
export const NewRecord = () => (
  <Form
    name="newTrack"
    form={{
      trackName: { type: 'text', label: 'Track name', required: true },
      latitude: { type: 'number', label: 'Latitude' },
      longitude: { type: 'number', label: 'Longitude' },
    }}
    initialValues={{ trackName: '', latitude: 52.0786, longitude: -1.0169 }}
  />
);
