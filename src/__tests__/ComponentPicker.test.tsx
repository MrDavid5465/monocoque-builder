import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@apollo/client/react', () => ({
  useQuery: vi.fn().mockReturnValue({ data: undefined, loading: false }),
}));

vi.mock('../lib/denim/lib', () => ({
  Stack: ({ children, horizontal, ...rest }: any) =>
    horizontal ? <div data-dir="h" {...rest}>{children}</div> : <div {...rest}>{children}</div>,
  IconButton: ({ onClick, title, iconProps }: any) => (
    <button onClick={onClick} title={title} aria-label={iconProps?.iconName}>{iconProps?.iconName}</button>
  ),
  PrimaryButton: ({ onClick, title, children }: any) => (
    <button onClick={onClick} title={title}>{children}</button>
  ),
  DefaultButton: ({ onClick, title, children }: any) => (
    <button onClick={onClick} title={title}>{children}</button>
  ),
  Icon: ({ iconName }: any) => <span>{iconName}</span>,
  getTheme: () => ({
    palette: {
      neutralLight: '#ccc',
      neutralLighter: '#eee',
      neutralQuaternaryAlt: '#ddd',
      themePrimary: '#0078d4',
      neutralTertiary: '#999',
    },
  }),
}));

import ComponentPicker from '../components/Telemetry/DashboardDesigner/ComponentPicker';
import { DashboardConfig } from '../types/dashboard';

const dashboard: DashboardConfig = {
  name: 'test',
  baseDashType: 'sprite',
  path: '/test',
  canvasWidth: 1280,
  canvasHeight: 720,
  dayNight: false,
  neckFx: false,
  components: [],
  kioskExitButton: { x: 0, y: 0, opacity: 1 },
};

const defaultProps = {
  sprites: [],
  dashboard,
  selectedId: null,
  templates: [],
  onAdd: vi.fn(),
  onRemoveTemplate: vi.fn(),
  onClose: vi.fn(),
};

// ─── ComponentPicker ──────────────────────────────────────────────────────────

describe('ComponentPicker', () => {
  it('renders "Add Component" header', () => {
    render(<ComponentPicker {...defaultProps} />);
    expect(screen.getByText('Add Component')).toBeInTheDocument();
  });

  it('shows New and My tabs', () => {
    render(<ComponentPicker {...defaultProps} />);
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('My')).toBeInTheDocument();
  });

  it('shows template count in My tab when templates present', () => {
    const template = {
      id: 't1', name: 'Speed Gauge', gaugeType: 'needle' as const,
      component: { id: 'n', type: 'needle-gauge' as const, name: 'n', x: 0, y: 0 },
    };
    render(<ComponentPicker {...defaultProps} templates={[template]} />);
    expect(screen.getByText('My (1)')).toBeInTheDocument();
  });

  it('shows all component type labels including gif-gauge', () => {
    render(<ComponentPicker {...defaultProps} />);
    expect(screen.getByText('Static Sprite')).toBeInTheDocument();
    expect(screen.getByText('Needle Gauge')).toBeInTheDocument();
    expect(screen.getByText('Bar Gauge')).toBeInTheDocument();
    expect(screen.getByText('Text Gauge')).toBeInTheDocument();
    expect(screen.getByText('Group')).toBeInTheDocument();
    expect(screen.getByText('Button Control')).toBeInTheDocument();
    expect(screen.getByText('Slider Control')).toBeInTheDocument();
    expect(screen.getByText('Encoder Control')).toBeInTheDocument();
    expect(screen.getByText('GIF Gauge')).toBeInTheDocument();
    expect(screen.getByText('Arc Gauge Face')).toBeInTheDocument();
    expect(screen.getByText('Sprite Arc Gauge Face')).toBeInTheDocument();
  });

  it('shows "No images yet" message when sprites are empty', () => {
    render(<ComponentPicker {...defaultProps} />);
    expect(screen.getByText(/No images yet/)).toBeInTheDocument();
  });

  it('switches to My tab on click', async () => {
    render(<ComponentPicker {...defaultProps} />);
    await userEvent.click(screen.getByText('My'));
    expect(screen.getByText(/Select a group/)).toBeInTheDocument();
  });

  it('shows "Adding to: canvas root" placement hint', () => {
    render(<ComponentPicker {...defaultProps} />);
    expect(screen.getByText('Adding to: canvas root')).toBeInTheDocument();
  });

  it('shows freeform Add button when Group type is selected', async () => {
    render(<ComponentPicker {...defaultProps} />);
    await userEvent.click(screen.getByText('Group'));
    expect(screen.getByText('+ Add Group')).toBeInTheDocument();
  });

  it('calls onAdd when freeform Add button clicked', async () => {
    const onAdd = vi.fn();
    render(<ComponentPicker {...defaultProps} onAdd={onAdd} />);
    await userEvent.click(screen.getByText('Group'));
    await userEvent.click(screen.getByText('+ Add Group'));
    expect(onAdd).toHaveBeenCalledOnce();
    const [node, parentId] = onAdd.mock.calls[0];
    expect(node.type).toBe('group');
    expect(parentId).toBeNull();
  });

  it('shows sprite list when sprites are provided for sprite-based type', () => {
    const sprites = [{ file: 'needle.png', label: 'Needle', thumbnail: '', id: 's1' }];
    render(<ComponentPicker {...defaultProps} sprites={sprites} />);
    expect(screen.getByText('Needle')).toBeInTheDocument();
  });

  it('calls onAdd with correct type when Add sprite button clicked', async () => {
    const onAdd = vi.fn();
    const sprites = [{ file: 'dial.png', label: 'Dial', thumbnail: '', id: 's2' }];
    render(<ComponentPicker {...defaultProps} sprites={sprites} onAdd={onAdd} />);
    // Static sprite is default active type — click its Add button
    await userEvent.click(screen.getByText('Add'));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onAdd.mock.calls[0][0].type).toBe('static-sprite');
    expect(onAdd.mock.calls[0][0].file).toBe('dial.png');
  });
});
