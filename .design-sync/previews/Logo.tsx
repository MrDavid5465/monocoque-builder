import * as React from 'react';
import { Logo } from 'denim';

// The brand mark. Takes style/className/onClick and nothing else, so the
// variants are just sizing.

export const Default = () => <Logo style={{ width: 96, height: 96 }} />;

export const Small = () => <Logo style={{ width: 32, height: 32 }} />;

export const OnDarkSurface = () => (
  <div style={{ background: '#201f1e', padding: 24, display: 'inline-block' }}>
    <Logo style={{ width: 64, height: 64, filter: 'invert(1)' }} />
  </div>
);
