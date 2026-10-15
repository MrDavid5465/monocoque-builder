// The fixed top bar: waffle button, brand, the current application's name,
// its links, and the app's Controls.
import React, { useCallback, useState } from 'react';
import { Icon, IconButton, Stack, getTheme } from '@fluentui/react';
import { useNav } from '../../denim';
import { getStyle } from '../lib';
import { AppNavBar } from './AppNavBar';
import { NavBar } from './NavBar';
import { HeaderLink } from './HeaderLink';

export interface HeaderProps {
  Brand?: React.FC<any>;
  Controls?: React.FC<any>;
  ExternalApps?: React.FC<any>;
}

export const Header: React.FC<HeaderProps> = ({ Brand, Controls, ExternalApps }) => {
  const [isOpen, setIsOpen] = useState(false);
  const nav = useNav();
  const theme = getTheme();
  const style = getStyle();
  const openPanel = useCallback(() => setIsOpen(true), []);
  const dismissPanel = useCallback(() => setIsOpen(false), []);
  return (
    <div
      style={{
        backgroundColor: theme.semanticColors.primaryButtonBackgroundHovered,
        color: theme.palette.themeLighter,
        width: '100vw',
      }}
    >
      <Stack
        horizontal
        horizontalAlign={'space-between'}
        verticalAlign={'center'}
        tokens={{ childrenGap: '0.77em', maxHeight: '3.85em' }}
        style={{
          backgroundColor: theme.semanticColors.primaryButtonBackground,
          color: theme.palette.themeLighter,
          position: 'fixed',
          width: '100vw',
          minWidth: '24.64em',
          zIndex: 1000,
        }}
      >
        <Stack verticalAlign={'center'} horizontal tokens={{ childrenGap: '0.77em' }}>
          <IconButton onClick={openPanel} className={style.headerIconButton} ariaLabel="Applications">
            <Icon iconName={'Waffle'} className={style.waffle} />
          </IconButton>

          {Brand && (
            <Brand
              style={{
                fill: theme.palette.themeLighter,
                height: '2.695em',
                minHeight: '2.695em',
                maxHeight: '2.695em',
                width: '2.695em',
              }}
            />
          )}
          {nav.activeApp ? (
            <HeaderLink to={nav.appUrl(nav.activeApp)}>{nav.activeApp.name}</HeaderLink>
          ) : (
            <HeaderLink to={'/'}>Home</HeaderLink>
          )}
        </Stack>
        <AppNavBar isOpen={isOpen} dismissPanel={dismissPanel} ExternalApps={ExternalApps} />
        <NavBar Controls={Controls} className={style.navBar} />
      </Stack>
    </div>
  );
};

export default Header;
