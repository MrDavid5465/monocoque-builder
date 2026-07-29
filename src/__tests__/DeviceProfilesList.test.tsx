import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DeviceProfilesList, { DeviceProfilesListConfig } from '../components/shared/DeviceProfilesList';
import { DocumentNode } from 'graphql';

const navigateMock = vi.fn();

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => ({ pathname: '/shakers/profiles' }),
  };
});

const useQueryMock = vi.fn();
vi.mock('@apollo/client/react', () => ({
  useQuery: (...args: any[]) => useQueryMock(...args),
  useMutation: vi.fn().mockReturnValue([vi.fn().mockResolvedValue({}), { loading: false }]),
  useSubscription: vi.fn().mockReturnValue({ data: undefined }),
}));

vi.mock('../lib/denim/lib', () => ({
  getTheme: () => ({
    palette: {
      themePrimary: '#0078d4', themeSecondary: '#2b88d8', redDark: '#a4262c',
      neutralPrimary: '#323130', neutralTertiaryAlt: '#c8c6c4',
      neutralLight: '#edebe9', neutralLighter: '#f3f2f1',
    },
  }),
}));

const fakeDoc = {} as DocumentNode;

const baseConfig: DeviceProfilesListConfig = {
  getProfilesQuery: fakeDoc,
  removeProfileMutation: fakeDoc,
  profileChangedSubscription: fakeDoc,
  profilesResultKey: 'getProfiles',
  getDevicesQuery: fakeDoc,
  createDeviceMutation: fakeDoc,
  removeDeviceMutation: fakeDoc,
  deviceChangedSubscription: fakeDoc,
  devicesResultKey: 'getDevices',
  liveToInput: (rec: any, profileId: string | null) => ({ ...rec, profileId }),
  storageKey: 'test-profile',
};

beforeEach(() => {
  vi.clearAllMocks();
  useQueryMock.mockReturnValue({ data: undefined, loading: false });
  navigateMock.mockReset();
});

describe('DeviceProfilesList', () => {
  it('renders the Profiles heading', () => {
    render(<DeviceProfilesList {...baseConfig} />);
    expect(screen.getByText('Profiles')).toBeTruthy();
  });

  it('shows an "Add" button', () => {
    render(<DeviceProfilesList {...baseConfig} />);
    expect(screen.getByTitle('Add')).toBeTruthy();
  });

  it('navigates to /new when "Add" is clicked', () => {
    render(<DeviceProfilesList {...baseConfig} />);
    fireEvent.click(screen.getByTitle('Add'));
    expect(navigateMock).toHaveBeenCalledWith('/shakers/profiles/new');
  });

  it('shows an empty-state message when profiles data is empty', () => {
    render(<DeviceProfilesList {...baseConfig} />);
    expect(screen.getByText(/No profiles yet/)).toBeTruthy();
  });

  it('shows profile rows when profiles data is populated', () => {
    useQueryMock.mockImplementation((query: DocumentNode) => {
      if (query === fakeDoc) {
        return { data: { getProfiles: [{ id: 'p1', name: 'Test Profile', car: 'BMW', game: 'iRacing' }] }, loading: false };
      }
      return { data: undefined, loading: false };
    });
    render(<DeviceProfilesList {...baseConfig} />);
    expect(screen.getByText('Test Profile')).toBeTruthy();
    expect(screen.getByText('BMW')).toBeTruthy();
    expect(screen.getByText('iRacing')).toBeTruthy();
  });

  it('shows Edit, Load and Delete buttons, disabled until a row is selected', () => {
    useQueryMock.mockReturnValue({
      data: { getProfiles: [{ id: 'p1', name: 'My Profile', car: null, game: null }] },
      loading: false,
    });
    render(<DeviceProfilesList {...baseConfig} />);
    expect(screen.getByTitle('Edit')).toBeTruthy();
    expect(screen.getByTitle('Load')).toBeTruthy();
    expect(screen.getByTitle('Delete')).toBeTruthy();
    expect(screen.getByTitle('Edit').closest('button')).toBeDisabled();
  });

  // Selecting a row (Fluent DetailsList's own click-to-select/
  // onActiveItemChanged mechanism) to enable + target these buttons is
  // exercised via live Playwright verification rather than here — jsdom
  // doesn't reproduce Fluent's FocusZone/selection pointer-event handling
  // closely enough to drive it through simulated DOM events.
});
