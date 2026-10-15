// TopBarShell: Denim's original look, rebuilt on the headless core. A fixed
// header with the current application's name and links, a waffle panel
// listing every application, and Settings in the panel's footer.
import React from 'react';
import { Stack } from '@fluentui/react';
import {
  DenimProvider,
  DenimRoutes,
  DenimShellProps,
  splitShellProps,
  useDenim,
  useNav,
} from '../../denim';
import { getStyle } from '../lib';
import { Splash } from '../shared/Splash';
import { FluentThemeRoot, useFluentTheme } from '../shared/theme';
import type { ThemeBuilder } from '../themes';
import DenimLogo, { IconProps } from '../shared/Logo';
import { Header } from './Header';

export interface TopBarShellProps extends DenimShellProps {
  /** Theme builders keyed `<mode>-<color>` plus `default`. Defaults to THEMES. */
  themes?: Record<string, ThemeBuilder>;
  /** Splash-screen logo. */
  Logo?: React.FC<IconProps>;
  /** Icon next to the waffle button. */
  Brand?: React.FC<any>;
  /** Right side of the header; on narrow screens it also opens the link menu. */
  Controls?: React.FC<any>;
  /** Extra content at the top of the waffle panel. */
  ExternalApps?: React.FC<any>;
  /** Shown at `/` when there is no RootComponent and no launch page. */
  welcome?: React.ReactNode;
}

type OwnProps = Omit<TopBarShellProps, keyof DenimShellProps>;

const TopBarLayout: React.FC<OwnProps> = ({
  themes,
  Logo = DenimLogo,
  Brand,
  Controls,
  ExternalApps,
  welcome,
}) => {
  const { status, RootComponent } = useDenim();
  const nav = useNav();
  const themeKey = useFluentTheme(themes);

  if (status !== 'ready') {
    // A RootComponent (a public site's homepage) stands in for the splash:
    // it renders real content without needing the backend.
    return RootComponent ? (
      <FluentThemeRoot themeKey={themeKey} themes={themes}>
        <RootComponent />
      </FluentThemeRoot>
    ) : (
      <Splash Icon={Logo} statusText={status === 'waiting' ? 'Waiting for server…' : undefined} />
    );
  }

  const style = getStyle();
  return (
    <FluentThemeRoot themeKey={themeKey} themes={themes}>
      {nav.showChrome && <Header Brand={Brand} Controls={Controls} ExternalApps={ExternalApps} />}
      <DenimRoutes
        welcome={
          welcome ?? (
            <Stack>
              <h1>Welcome, Click the waffle icon to begin!</h1>
            </Stack>
          )
        }
        wrap={(content, { app, kiosk }) => (
          <Stack
            className={style.content}
            style={kiosk || (!app && !nav.showChrome) ? { top: '0em' } : undefined}
          >
            {content}
          </Stack>
        )}
      />
    </FluentThemeRoot>
  );
};

/**
 * The top-bar shell. Takes every <DenimProvider> prop plus its own; a drop-in
 * replacement for the pre-split `<Denim>`.
 */
export const TopBarShell: React.FC<TopBarShellProps> = props => {
  const [core, own] = splitShellProps(props);
  return (
    <DenimProvider {...core}>
      <TopBarLayout {...own} />
    </DenimProvider>
  );
};

export default TopBarShell;
