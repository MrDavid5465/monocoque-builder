// The waffle panel: every application and its links, with Settings in the
// footer.
import React, { useState } from 'react';
import { DefaultButton, INavLink, Nav, Panel, PanelType } from '@fluentui/react';
import { useNavigate } from 'react-router-dom';
import { useApplications, useNav } from '../../denim';
import { SettingsDialog } from '../shared/SettingsDialog';

interface Props {
  isOpen: boolean;
  dismissPanel: () => void;
  ExternalApps?: React.FC<any>;
}

export const AppNavBar: React.FC<Props> = ({ isOpen, dismissPanel, ExternalApps }) => {
  const navigate = useNavigate();
  const nav = useNav();
  const { applications, ready } = useApplications();
  const [modalOpen, setModalOpen] = useState(false);

  const links: INavLink[] = ready
    ? applications.map(app => ({
        name: app.name,
        url: nav.appUrl(app),
        isExpanded: nav.isAppActive(app),
        // The active app's key is the current URL, so the Nav highlights the
        // app itself only when no link below it matches.
        key: nav.isAppActive(app) ? nav.pathname : nav.appUrl(app),
        links: (app.links ?? []).map(l => ({
          name: l.text,
          url: nav.linkUrl(app, l),
          key: `/${app.path}/${l.path}`,
        })),
      }))
    : [{ name: 'Loading...', url: '', key: 'loading', disabled: true }];

  return (
    <Panel
      isLightDismiss
      customWidth={'20.94em'}
      type={PanelType.customNear}
      isOpen={isOpen}
      onDismiss={dismissPanel}
      closeButtonAriaLabel="Close"
      onRenderFooterContent={() => (
        <>
          <DefaultButton onClick={() => setModalOpen(true)}>Settings</DefaultButton>
          <SettingsDialog isOpen={modalOpen} onDismiss={() => setModalOpen(false)} />
        </>
      )}
    >
      {ExternalApps && <ExternalApps />}

      <h2>Applications</h2>
      <Nav
        selectedKey={nav.pathname}
        groups={[{ links }]}
        onLinkClick={(ev?: any, item?: INavLink) => {
          ev?.preventDefault();
          item && navigate(item.url);
          dismissPanel();
        }}
        isOnTop={false}
      />
    </Panel>
  );
};

export default AppNavBar;
