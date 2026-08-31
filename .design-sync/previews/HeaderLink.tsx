import * as React from 'react';
import { HeaderLink } from 'denim';

// A nav link for the app header. Two things about it drive this preview:
// it renders a react-router <Link> (so it needs a router — the preview shell
// provides one), and its text is WHITE because it is only ever used on the
// theme-blue header bar. Rendered on a white card it is invisible, so every
// cell supplies the bar it belongs on.

const Bar: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      background: '#0078d4',
      padding: '0 12px',
      height: 44,
      width: 460,
    }}
  >
    {children}
  </div>
);

export const Inactive = () => (
  <Bar>
    <HeaderLink to="/telemetryadmin">Telemetry</HeaderLink>
  </Bar>
);

export const Active = () => (
  <Bar>
    <HeaderLink to="/shakers" active>
      Shakers
    </HeaderLink>
  </Bar>
);

// How they read as a set — the only way they're actually used.
export const InANavRow = () => (
  <Bar>
    <HeaderLink to="/telemetryadmin">Telemetry</HeaderLink>
    <HeaderLink to="/shakers" active>
      Shakers
    </HeaderLink>
    <HeaderLink to="/ambientlights">Ambient Lights</HeaderLink>
  </Bar>
);
