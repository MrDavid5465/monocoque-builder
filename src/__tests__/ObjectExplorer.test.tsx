import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ComponentPicker (rendered when the + button is clicked) uses useQuery from @apollo/client/react
vi.mock('@apollo/client/react', () => ({
  useQuery: vi.fn().mockReturnValue({ data: undefined, loading: false }),
}));

// ObjectExplorer uses useQuery (for dash groups) — mock the denim lib
vi.mock('../lib/denim/lib', () => ({
  Stack: ({ children, horizontal, ...rest }: any) =>
    horizontal ? <div data-dir="h" {...rest}>{children}</div> : <div {...rest}>{children}</div>,
  IconButton: ({ onClick, title, iconProps }: any) => (
    <button onClick={onClick} title={title}>{iconProps?.iconName}</button>
  ),
  Icon: ({ iconName }: any) => <span>{iconName}</span>,
  PrimaryButton: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
  Form: ({ children, onChange: _onChange }: any) => <div data-testid="form">{children}</div>,
  getTheme: () => ({
    palette: {
      neutralLight: '#ccc', neutralLighter: '#eee', neutralQuaternaryAlt: '#ddd',
      themePrimary: '#0078d4', neutralTertiary: '#999', neutralSecondary: '#666',
      white: '#fff', neutralDark: '#111',
    },
    semanticColors: { bodyText: '#000', bodyBackground: '#fff' },
  }),
  useQuery: vi.fn().mockReturnValue({ data: undefined, loading: false }),
}));

import ObjectExplorer from '../components/Telemetry/DashboardDesigner/ObjectExplorer';
import { DashboardConfig } from '../types/dashboard';

const dashboard: DashboardConfig = {
  name: 'My Dashboard',
  baseDashType: 'sprite',
  path: '/test',
  canvasWidth: 1280,
  canvasHeight: 720,
  dayNight: false,
  neckFx: false,
  components: [],
  kioskExitButton: { x: 0, y: 0, opacity: 1 },
};

const baseProps = {
  dashboard,
  sprites: [],
  selectedId: null,
  onSelect: vi.fn(),
  onUpdate: vi.fn(),
  onUpdateDashboard: vi.fn(),
  onDelete: vi.fn(),
  onDeleteDashboard: vi.fn(),
  onFlip: vi.fn(),
  isDirty: false,
  onSave: vi.fn(),
  onMoveNode: vi.fn(),
  onSaveTemplate: vi.fn(),
  onGenerateThumbnails: vi.fn().mockResolvedValue(new Map()),
  sequenceConfig: { type: 'sweep' as const, params: { durationMs: 1000, peak: 1, holdMs: 500, loop: true } },
  onSequenceConfigChange: vi.fn(),
  playing: false,
  onTogglePlay: vi.fn(),
  onPreviewTelemetry: vi.fn(),
  templates: [],
  onAdd: vi.fn(),
  onRemoveTemplate: vi.fn(),
};

// ─── ObjectExplorer smoke tests ───────────────────────────────────────────────

describe('ObjectExplorer', () => {
  it('renders without crashing', () => {
    render(<ObjectExplorer {...baseProps} />);
    expect(document.body).toBeTruthy();
  });

  it('shows the dashboard name in the panel header', () => {
    render(<ObjectExplorer {...baseProps} />);
    expect(screen.getByText('My Dashboard')).toBeInTheDocument();
  });

  it('shows Save button when properties panel is open', () => {
    render(<ObjectExplorer {...baseProps} />);
    // Properties panel is hidden by default; click the Dashboard row to open it
    fireEvent.click(screen.getByText('Dashboard'));
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('Save button is disabled when not dirty', () => {
    render(<ObjectExplorer {...baseProps} isDirty={false} />);
    fireEvent.click(screen.getByText('Dashboard'));
    expect(screen.getByText('Save')).toBeDisabled();
  });

  it('Save button is enabled when dirty', () => {
    render(<ObjectExplorer {...baseProps} isDirty />);
    fireEvent.click(screen.getByText('Dashboard'));
    expect(screen.getByText('Save')).not.toBeDisabled();
  });

  it('shows the component picker in place of the tree when + is clicked', () => {
    render(<ObjectExplorer {...baseProps} />);
    fireEvent.click(screen.getByTitle('Add component'));
    expect(screen.getByText('Add Component')).toBeInTheDocument();
    expect(screen.queryByText('My Dashboard')).not.toBeInTheDocument();
  });

  it('returns to the normal explorer view when the picker is closed', () => {
    render(<ObjectExplorer {...baseProps} />);
    fireEvent.click(screen.getByTitle('Add component'));
    fireEvent.click(screen.getByTitle('Close'));
    expect(screen.getByText('My Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Add Component')).not.toBeInTheDocument();
  });
});
