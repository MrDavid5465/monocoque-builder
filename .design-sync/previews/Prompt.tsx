import * as React from 'react';
import { Prompt } from 'denim';

// A yes/no confirmation dialog. It renders nothing while closed, so every
// cell opens it — the open state is the only thing worth showing.

export const Open = () => (
  <Prompt isOpen message="Delete this car and all of its dashboards?" toggle={() => undefined} />
);

export const LongMessage = () => (
  <Prompt
    isOpen
    message="Restarting Monocoque will briefly interrupt shaker output and reload every device profile. Continue?"
    toggle={() => undefined}
  />
);
