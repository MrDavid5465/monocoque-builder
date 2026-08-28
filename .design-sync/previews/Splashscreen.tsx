import * as React from 'react';
import { Splashscreen, Logo } from 'denim';

// Shown while the app's first fetch is in flight. `statusText` only appears
// once that load has actually failed — it stays empty during the normal
// brief startup, so the two states are worth separate cells.

export const Loading = () => <Splashscreen Icon={Logo} />;

export const LoadFailed = () => (
  <Splashscreen Icon={Logo} statusText="Can't reach the server — retrying…" />
);
