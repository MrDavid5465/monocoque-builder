import * as React from 'react';
import { ButtonDropdown } from 'denim';

// A Fluent button with an attached menu. `color: 'primary'` picks a
// PrimaryButton, anything else a DefaultButton — that switch is the whole
// variant axis, so both are shown.

export const Primary = () => (
  <ButtonDropdown
    color="primary"
    value="Export"
    menuActions={[
      { value: 'Download CSV' },
      { value: 'Download JSON' },
      { value: 'Copy to clipboard' },
    ]}
  />
);

export const Default = () => (
  <ButtonDropdown
    value="Actions"
    menuActions={[
      { value: 'Duplicate' },
      { value: 'Rename' },
      { value: 'Delete', iconProps: { iconName: 'Delete' } },
    ]}
  />
);

export const SingleAction = () => (
  <ButtonDropdown color="primary" value="Add device" menuActions={[{ value: 'From template' }]} />
);
