import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// Canvas only imports from types and its own utils — no Apollo/Tauri/denim
// But it does use ResizeObserver and RAF (both mocked in setup.ts)

import Canvas from '../components/Telemetry/DashboardDesigner/Canvas';
import { DashboardConfig, ComponentNode } from '../types/dashboard';

const dashboard: DashboardConfig = {
  name: 'test',
  baseDashType: 'sprite',
  path: '/test',
  canvasWidth: 1280,
  canvasHeight: 720,
  dayNight: false,
  neckFx: false,
  components: [],
  kioskExitButton: { x: 9999, y: 9999, opacity: 0 },
};

const baseProps = {
  dashboard,
  sprites: [],
  selectedId: null,
  onSelect: vi.fn(),
  onUpdate: vi.fn(),
  kioskMode: false,
  activeTool: 'transform' as const,
};

function node(overrides: Partial<ComponentNode>): ComponentNode {
  return { id: 'n', type: 'static-sprite', name: 'n', x: 0, y: 0, ...overrides };
}

// ─── Canvas smoke tests ───────────────────────────────────────────────────────

describe('Canvas', () => {
  it('renders without crashing with empty components', () => {
    render(<Canvas {...baseProps} />);
    // The canvas root div is always rendered
    expect(document.body).toBeTruthy();
  });

  it('renders in kiosk mode without crashing', () => {
    render(<Canvas {...baseProps} kioskMode />);
    expect(document.body).toBeTruthy();
  });

  it('renders with telemetry data without crashing', () => {
    render(<Canvas {...baseProps} telemetryData={{ rpm: 3000, speed: 120 }} />);
    expect(document.body).toBeTruthy();
  });

  it('renders a text-gauge component', () => {
    const n = node({ type: 'text-gauge', format: 'integer', fontSize: 24, color: '#fff' });
    const dash = { ...dashboard, components: [n] };
    render(<Canvas {...baseProps} dashboard={dash} telemetryData={{ rpm: 5000 }} />);
    expect(document.body).toBeTruthy();
  });

  it('renders a group component with children', () => {
    const child = node({ id: 'child', type: 'static-sprite' });
    const group = node({ id: 'grp', type: 'group', children: [child] });
    const dash = { ...dashboard, components: [group] };
    render(<Canvas {...baseProps} dashboard={dash} />);
    expect(document.body).toBeTruthy();
  });

  it('accepts globalSteerMaxDeg prop without crashing', () => {
    render(<Canvas {...baseProps} globalSteerMaxDeg={450} />);
    expect(document.body).toBeTruthy();
  });
});
