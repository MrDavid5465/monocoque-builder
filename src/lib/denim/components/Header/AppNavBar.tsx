import React, { useState } from "react";
import { Panel, PanelType, Nav, DefaultButton } from "./lib";
import { IUser, ISettings } from "../../lib/queries";
import Settings from "./Settings";
import { INavLink } from "@fluentui/react";
import { useLocation, useNavigate } from "react-router-dom";
import { getCurrentApp } from "../../lib";
interface Props {
  my: Partial<IUser>;
  isOpen: boolean;
  dismissPanel: () => any;
  ExternalApps?: React.FC<any>;
}

export const AppNavBar: React.FC<Props> = ({
  my,
  isOpen,
  dismissPanel,
  ExternalApps,
}) => {
  const { pathname } = useLocation()
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const openGroup = getCurrentApp();
  function openModal() {
    setModalOpen(true);
  }
  function dismissModal() {
    setModalOpen(false);
  }
  const applications: Array<INavLink> = my.applications
    ? my.applications.map(app => ({
        name: `${app.name}`,
        groupData: {
          url: (app.defaultRoute && `/${app.path}`) || `/${app.path}`
        },
        isExpanded: app.path === openGroup,
        url: (app.defaultRoute && `/${app.path}`) || `/${app.path}`,
        key:
          app.path === getCurrentApp()
            ? pathname
            : `/${app.path}`,
        links:
          app.links &&
          app.links
            // .filter(l => {
            //   return (
            //     app.roles &&
            //     app.roles.filter(r => {
            //       return (
            //         my.groups &&
            //         my.groups.filter(g => {
            //           return r.groupNames.includes(g.name);
            //         }).length > 0 &&
            //         l.roles.includes(r.name)
            //       );
            //     }).length > 0
            //   );
            // })
            .map(l => ({
              name: l.text,
              url: `/${app.path}/${l.path}`,
              key: `/${app.path}/${l.path}`
            }))
      }))
    : [{ name: "Loading...", url: "", key: "loading", disabled: true }];
  const settings: Partial<ISettings> = my.settings ? my.settings : {};
  return (
    <Panel
      isLightDismiss
      customWidth={"20.94em"}
      type={PanelType.customNear}
      isOpen={isOpen}
      onDismiss={dismissPanel}
      closeButtonAriaLabel="Close"
      onRenderFooterContent={() => (
        <>
          <DefaultButton onClick={openModal}>Settings</DefaultButton>
          <Settings
            isOpen={modalOpen}
            dismissModal={dismissModal}
            settings={settings}
          />
        </>
      )}
    >
      {ExternalApps && <ExternalApps />}

      <h2>Applications</h2>
      <Nav
        selectedKey={pathname}
        groups={[
          {
            links: applications
          }
        ]}
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
