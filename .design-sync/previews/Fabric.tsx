import * as React from 'react';
import { Fabric } from 'denim';

// per-form's field renderer — one switch over `type` covering every field
// kind. Form passes this as FormWrapper's `Template`, so you rarely render it
// directly; these cells exist to show what each `type` produces.
//
// Anything unmatched falls through to a plain TextField, which is why
// `type: 'password'` renders as ordinary text here.

const noop = () => undefined;

export const TextField = () => (
  <Fabric type="text" name="trackName" label="Track name" value="Silverstone" onChange={noop} />
);

export const Checkbox = () => (
  <Fabric type="checkbox" name="enabled" label="Enabled" value={true} onChange={noop} />
);

export const Slider = () => (
  <Fabric
    type="slider"
    name="intensity"
    label="Tint intensity"
    value={0.3}
    min={0}
    max={1}
    step={0.05}
    onChange={noop}
  />
);

export const Select = () => (
  <Fabric
    type="select"
    name="channel"
    label="Primary channel"
    value="1"
    options={[
      { text: 'Hue color lamp 1', value: '0' },
      { text: 'Hue color lamp 2', value: '1' },
      { text: 'Hue lightstrip 1', value: '3' },
    ]}
    onChange={noop}
  />
);

export const WithValidationError = () => (
  <Fabric
    type="text"
    name="trackName"
    label="Track name"
    value=""
    errors={['This field is required']}
    touched
    onChange={noop}
  />
);
