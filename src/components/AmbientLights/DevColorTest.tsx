import React, { useRef, useState } from 'react';
import { Callout, ColorPicker, DirectionalHint, getColorFromString, IColor } from '@fluentui/react';

// Calibration tool, reached at /ambient-lights/dev-color-test — a sub-route
// of the Ambient Lights app itself (see index.tsx's own <Routes>), not a
// separate registered Denim app and not linked from the settings page's own
// UI (has to be navigated to directly). A plain window.location.hash check
// in App.tsx was tried first but only worked on a hard page reload:
// client-side (same-document) hash navigation never re-ran that check,
// since App itself doesn't consume any router hook and so never re-renders
// on a route change, leaving Denim's own routing to redirect away — a real
// <Route> doesn't have that problem. High z-index (not Denim's `/kiosk/`
// route, which only matches an app's exact path, no sub-route wildcard) so
// this fixed, full-viewport fill visually covers the header regardless.
// For comparing a known input against Huenicorn's /api/currentColors and
// the physical bulb while a real dashboard is open and visible elsewhere (a
// second window/monitor, or Huenicorn capturing a different screen than the
// one showing the dash).
//
// Gear button + Callout mirror Canvas.tsx's day/night settings button
// exactly (same position/size/colors) — picking a color here updates the
// fill live, no source edit or reload needed.
const DEFAULT_COLOR = '#6633cc';

export const DevColorTest: React.FC = () => {
  const [color, setColor] = useState<IColor>(() => getColorFromString(DEFAULT_COLOR)!);
  const [showPicker, setShowPicker] = useState(false);
  const gearRef = useRef<HTMLButtonElement>(null);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: `#${color.hex}` }}>
      <button
        ref={gearRef}
        onClick={e => { e.stopPropagation(); setShowPicker(s => !s); }}
        style={{
          position: 'absolute', right: 8, bottom: 8,
          background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 6, width: 40, height: 40, cursor: 'pointer',
          fontSize: 20, color: '#fff', zIndex: 10,
        }}
        title="Pick test color"
      >⚙️</button>
      {showPicker && (
        <Callout
          target={gearRef}
          onDismiss={() => setShowPicker(false)}
          directionalHint={DirectionalHint.topRightEdge}
          setInitialFocus
        >
          <div style={{ padding: '1em' }}>
            <ColorPicker
              color={color}
              onChange={(_ev, newColor) => setColor(newColor)}
              alphaType="none"
            />
          </div>
        </Callout>
      )}
    </div>
  );
};
