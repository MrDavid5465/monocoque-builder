// The right side of the top bar: the current application's links (wide
// screens), the app's Controls, and a slide-out menu of the same links on
// narrow screens.
import React, { useCallback, useState } from 'react';
import { Icon, IconButton, INavLink, Nav, Panel, PanelType, Stack, getTheme } from '@fluentui/react';
import { useNavigate } from 'react-router-dom';
import { useNav } from '../../denim';
import { getStyle } from '../lib';
import { HeaderLink } from './HeaderLink';

interface Props {
  Controls?: React.FC<any>;
  className: string;
}

export const NavBar: React.FC<Props> = ({ Controls, className }) => {
  const navigate = useNavigate();
  const nav = useNav();
  const app = nav.activeApp;
  const theme = getTheme();
  const style = getStyle();
  const [isNavOpen, setIsNavOpen] = useState(false);
  const openNav = useCallback(() => setIsNavOpen(true), []);
  const dismissNav = useCallback(() => setIsNavOpen(false), []);

  return (
    <Stack className={className}>
      <Stack horizontal horizontalAlign={'end'}>
        {app && (
          <Stack
            className={style.hiddenLgDown}
            verticalAlign={'center'}
            style={{ paddingRight: '0.924em' }}
            horizontal
            tokens={{ childrenGap: '0.77em' }}
          >
            {(app.links ?? []).map(l => (
              <HeaderLink key={l.path} to={nav.linkUrl(app, l)} active={nav.isLinkActive(app, l.path)}>
                {l.text}
              </HeaderLink>
            ))}
          </Stack>
        )}
        {Controls && <Controls />}
      </Stack>
      <Stack horizontal style={{ position: 'absolute', top: '0em', right: '0em' }} className={style.hiddenXlUp}>
        {Controls ? (
          <div onClick={openNav} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <Controls />
          </div>
        ) : (
          <IconButton onClick={openNav} className={style.iconButtonStyle} ariaLabel="Menu">
            <Icon
              iconName={'GlobalNavButton'}
              style={{ fontSize: '1.7em', color: theme.semanticColors.primaryButtonText }}
            />
          </IconButton>
        )}
        <Panel
          isLightDismiss
          onDismiss={dismissNav}
          isOpen={isNavOpen}
          customWidth={'20.94em'}
          type={PanelType.custom}
          closeButtonAriaLabel="Close"
        >
          {app && (
            <Nav
              selectedKey={nav.activeLink ? nav.linkUrl(app, nav.activeLink) : undefined}
              onLinkClick={(ev?: any, item?: INavLink) => {
                ev?.preventDefault();
                item && navigate(item.url);
                dismissNav();
              }}
              groups={[
                {
                  links: (app.links ?? []).map(l => ({
                    name: l.text,
                    url: nav.linkUrl(app, l),
                    key: nav.linkUrl(app, l),
                  })),
                },
              ]}
            />
          )}
        </Panel>
      </Stack>
    </Stack>
  );
};

export default NavBar;
