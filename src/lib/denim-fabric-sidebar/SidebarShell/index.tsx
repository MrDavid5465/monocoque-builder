// SidebarShell: a configuration-app layout. Applications are listed in a
// sidebar under group headings; the content area belongs to the active
// application (which may opt into MasterDetail's list | detail panes).
//
//   wide   (>= 1200px): sidebar | content. Collapsible to an icon rail.
//   medium (>= 700px):  icon rail | content; the full sidebar opens over it.
//   narrow (phone):     one screen at a time with a back bar:
//                       menu (at "/") -> application -> detail.
//
// There are no global action buttons: each application owns its own UI.
import React from 'react';
import { Link } from 'react-router-dom';
import { FontIcon, Panel, PanelType, mergeStyles, mergeStyleSets, useTheme } from '@fluentui/react';
import type { IPanelStyleProps, IPanelStyles, ITheme } from '@fluentui/react';
import {
  DenimProvider,
  DenimRoutes,
  DenimShellProps,
  OPTIONAL_APPLICATION_FIELDS,
  splitShellProps,
  useDenim,
  useNav,
  useReducedMotion,
} from '../../denim';
import { Splash } from '../../denim-fabric/shared/Splash';
import { SettingsDialog } from '../../denim-fabric/shared/SettingsDialog';
import { FluentThemeRoot, useFluentTheme } from '../../denim-fabric/shared/theme';
import DenimLogo from '../../denim-fabric/shared/Logo';
import { PerfProfiler, perfAnimStart, perfCommitted, perfStart } from '../../denim-fabric/shared/perf';
import { DrillIn, ShellMotionProvider } from '../../denim-fabric/shared/motion';
import {
  DEFAULT_BREAKPOINTS,
  IBackTarget,
  ShellLayoutContext,
  useBreakpoint,
  useGoUp,
} from '../../denim-fabric/shared/layout';
import type { ShellProps } from '../../denim-fabric/shared/shell';
import { useSidebarSlide } from './slide';
import { Sidebar, TOUCH } from './Sidebar';

/** The sidebar's props: the shared ShellProps (it ignores `Controls` and `ExternalApps`). */
export type SidebarShellProps = ShellProps;

type OwnProps = Omit<ShellProps, keyof DenimShellProps>;

const COLLAPSED_KEY = 'denim-sidebar-collapsed';
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};

// The medium layout's overlay: the sidebar is the whole panel, so no Fluent
// header strip, and the sidebar (not the panel) scrolls, so its footer stays
// on screen. Fluent's own slide (and its scrim's fade) is kept: with the
// shell's re-renders gone (ShellBody and routes are memoized) it measures
// smooth. Under reduced motion there is none, and the panel hides at once
// on close instead of staying up for Fluent's 200ms close timer.
const overlayLayout: Partial<IPanelStyles> = {
  commands: { display: 'none' },
  navigation: { display: 'none' },
  contentInner: { height: '100%' },
  scrollableContent: { height: '100%', overflow: 'hidden' },
  content: { padding: 0, height: '100%' },
};
const overlayPanelStyles = () => overlayLayout;
const overlayPanelStylesReduced = ({ isOpen }: IPanelStyleProps): Partial<IPanelStyles> => ({
  ...overlayLayout,
  root: !isOpen && { visibility: 'hidden' },
  overlay: { animation: 'none' },
  main: { animation: 'none' },
});

/** Full sidebar width, and the icon rail's. The wide panel slides by the difference. */
const FULL_WIDTH = 264;
const RAIL_WIDTH = 60;

const getShellStyles = (theme: ITheme, narrow: boolean) =>
  mergeStyleSets({
    root: {
      display: 'flex',
      flexDirection: narrow ? 'column' : 'row',
      height: '100dvh',
      width: '100%',
      overflow: 'hidden',
      background: theme.semanticColors.bodyBackground,
      color: theme.semanticColors.bodyText,
    },
    side: { flex: 'none', height: '100%', position: 'relative' },
    // The wide layout's full panel and rail, positioned in the side column
    // so both can be there during a slide without changing its width.
    sidePanel: { position: 'absolute', top: 0, left: 0, height: '100%', width: FULL_WIDTH },
    sideRail: { position: 'absolute', top: 0, left: 0, height: '100%', width: RAIL_WIDTH, zIndex: 1 },
    menuScreen: { flex: 1, minHeight: 0 },
    main: {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      overflow: 'auto',
      boxSizing: 'border-box',
      position: 'relative',
      // FullBleed and MasterDetail read this to cancel the padding.
      ['--denim-content-padding' as any]: narrow ? '12px' : '20px',
      padding: 'var(--denim-content-padding)',
    },
    page: { height: '100%' },
    bar: {
      flex: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      minHeight: 52,
      padding: '0 8px 0 4px',
      background: theme.palette.neutralLighterAlt,
      borderBottom: `1px solid ${theme.palette.neutralLight}`,
    },
    back: {
      minWidth: TOUCH,
      height: TOUCH,
      padding: '0 8px 0 4px',
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      border: 0,
      borderRadius: 4,
      background: 'transparent',
      color: theme.palette.themePrimary,
      font: 'inherit',
      fontSize: theme.fonts.mediumPlus.fontSize,
      cursor: 'pointer',
      selectors: {
        ':hover': { background: theme.palette.neutralLighter },
        ':focus-visible': { outline: `2px solid ${theme.palette.themePrimary}`, outlineOffset: -2 },
      },
    },
    barTitle: {
      flex: 1,
      textAlign: 'right',
      fontWeight: 600,
      fontSize: theme.fonts.mediumPlus.fontSize,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      paddingRight: 8,
    },
    pills: {
      flex: 'none',
      display: 'flex',
      gap: 8,
      overflowX: 'auto',
      padding: '8px 12px',
      borderBottom: `1px solid ${theme.palette.neutralLight}`,
    },
    pill: {
      flex: 'none',
      display: 'flex',
      alignItems: 'center',
      minHeight: TOUCH,
      padding: '0 16px',
      borderRadius: TOUCH / 2,
      border: `1px solid ${theme.palette.neutralQuaternary}`,
      color: theme.palette.neutralPrimary,
      textDecoration: 'none',
      selectors: {
        ':focus-visible': { outline: `2px solid ${theme.palette.themePrimary}`, outlineOffset: 2 },
      },
    },
    pillActive: {
      background: theme.palette.themePrimary,
      borderColor: theme.palette.themePrimary,
      color: theme.palette.white,
    },
  });

const SidebarLayout: React.FC<OwnProps> = ({
  title,
  Brand,
  Logo = DenimLogo,
  themes,
  SidebarFooter,
  breakpoints = DEFAULT_BREAKPOINTS,
  welcome,
}) => {
  const { status, RootComponent } = useDenim();
  const nav = useNav();
  const themeKey = useFluentTheme(themes);
  const layout = useBreakpoint(breakpoints);
  const goUp = useGoUp();
  const [collapsed, setCollapsed] = React.useState(readCollapsed);
  const [overlayOpen, setOverlayOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [back, setBack] = React.useState<IBackTarget | null>(null);
  const layoutContext = React.useMemo(() => ({ layout, backBar: true, setBack, goUp }), [layout, goUp]);

  // The overlay only exists on medium screens.
  React.useEffect(() => {
    if (layout !== 'medium') setOverlayOpen(false);
  }, [layout]);

  // Stable callbacks: ShellBody is memoized, so opening Settings (state
  // here) doesn't re-render the sidebar and the whole page under it.
  const toggleCollapsed = React.useCallback(() => {
    perfStart('sidebar-toggle');
    setCollapsed(c => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1');
      } catch {
        // storage unavailable: the choice just isn't remembered
      }
      return !c;
    });
  }, []);
  const openSettings = React.useCallback(() => {
    perfStart('settings-open');
    setSettingsOpen(true);
  }, []);
  const closeSettings = React.useCallback(() => {
    perfStart('settings-close');
    setSettingsOpen(false);
  }, []);
  React.useEffect(() => perfCommitted('sidebar-toggle'), [collapsed]);
  React.useEffect(() => perfCommitted(settingsOpen ? 'settings-open' : 'settings-close'), [settingsOpen]);

  if (status !== 'ready') {
    return RootComponent ? (
      <FluentThemeRoot themeKey={themeKey} themes={themes}>
        <RootComponent />
      </FluentThemeRoot>
    ) : (
      <Splash Icon={Logo} statusText={status === 'waiting' ? 'Waiting for server…' : undefined} />
    );
  }

  return (
    <FluentThemeRoot themeKey={themeKey} themes={themes}>
      <ShellMotionProvider>
      <ShellLayoutContext.Provider value={layoutContext}>
        <ShellBody
          layout={layout}
          showChrome={nav.showChrome}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          overlayOpen={overlayOpen}
          setOverlayOpen={setOverlayOpen}
          openSettings={openSettings}
          back={back}
          title={title}
          Brand={Brand}
          SidebarFooter={SidebarFooter}
          welcome={welcome}
        />
        <PerfProfiler id="settings-dialog">
          <SettingsDialog isOpen={settingsOpen} onDismiss={closeSettings} />
        </PerfProfiler>
      </ShellLayoutContext.Provider>
      </ShellMotionProvider>
    </FluentThemeRoot>
  );
};

interface BodyProps {
  layout: 'wide' | 'medium' | 'narrow';
  showChrome: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  overlayOpen: boolean;
  setOverlayOpen: (open: boolean) => void;
  openSettings: () => void;
  back: IBackTarget | null;
  title?: string;
  Brand?: React.FC<any>;
  SidebarFooter?: React.FC<any>;
  welcome?: React.ReactNode;
}

// Memoized: SidebarLayout re-renders for Settings and theme state that the
// body doesn't use.
const ShellBody: React.FC<BodyProps> = React.memo(function ShellBody({
  layout,
  showChrome,
  collapsed,
  onToggleCollapsed,
  overlayOpen,
  setOverlayOpen,
  openSettings,
  back,
  title,
  Brand,
  SidebarFooter,
  welcome,
}) {
  const theme = useTheme();
  const nav = useNav();
  const { RootComponent } = useDenim();
  const narrow = layout === 'narrow';
  const s = React.useMemo(() => getShellStyles(theme, narrow), [theme, narrow]);
  const { goUp } = React.useContext(ShellLayoutContext)!;

  // One element for the life of the layout, so toggling the sidebar or the
  // overlay re-renders the sidebar only, not the page in the content area.
  const routes = React.useMemo(
    () => (
      <PerfProfiler id="shell-content">
        <DenimRoutes
          welcome={welcome ?? <h1>Choose an application from the menu.</h1>}
          wrap={content => <div className={s.page}>{content}</div>}
        />
      </PerfProfiler>
    ),
    [welcome, s.page],
  );
  const reduced = useReducedMotion();
  const openOverlay = React.useCallback(() => {
    perfStart('overlay-open');
    if (!reduced) perfAnimStart('overlay-open', { untilIdle: true });
    setOverlayOpen(true);
  }, [setOverlayOpen, reduced]);
  const closeOverlay = React.useCallback(() => {
    perfStart('overlay-close');
    if (!reduced) perfAnimStart('overlay-close', { untilIdle: true });
    setOverlayOpen(false);
  }, [setOverlayOpen, reduced]);
  React.useEffect(() => perfCommitted(overlayOpen ? 'overlay-open' : 'overlay-close'), [overlayOpen]);

  // Phone drill-in animates panes that mount after the shell's first render
  // (not the page the app opened on, nor after a theme change's remount).
  const shellMounted = React.useRef(false);
  React.useEffect(() => {
    shellMounted.current = true;
  }, []);

  // The wide sidebar's slide (see slide.ts): the panel and the page move
  // together, and the layout changes once, when they arrive.
  const sideRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const railRef = React.useRef<HTMLDivElement>(null);
  const mainRef = React.useRef<HTMLElement>(null);
  const { layoutCollapsed, sliding } = useSidebarSlide({
    collapsed,
    enabled: layout === 'wide' && !reduced,
    delta: FULL_WIDTH - RAIL_WIDTH,
    panelRef,
    railRef,
    mainRef,
  });
  const toggleHadFocus = React.useRef(false);
  const onToggle = React.useCallback(() => {
    toggleHadFocus.current = !!sideRef.current?.contains(document.activeElement);
    onToggleCollapsed();
  }, [onToggleCollapsed]);
  // The toggle that was pressed may be in the panel that just left: keep
  // focus on the toggle that is there now.
  React.useEffect(() => {
    if (!toggleHadFocus.current) return;
    toggleHadFocus.current = false;
    sideRef.current
      ?.querySelector<HTMLElement>(`button[aria-label="${collapsed ? 'Expand menu' : 'Collapse menu'}"]`)
      ?.focus();
  }, [collapsed]);
  // Kiosk routes and landing pages: content only.
  if (!showChrome) {
    return <div className={s.root}><main className={s.main}>{routes}</main></div>;
  }

  const sidebarProps = { title, Brand, onOpenSettings: openSettings, Footer: SidebarFooter };

  if (narrow) {
    const app = nav.activeApp;
    // The menu is its own screen on a phone: "/" (and any non-application
    // URL) shows it, unless the app has a RootComponent for "/".
    if (!app && !RootComponent) {
      return (
        <div className={s.root}>
          <DrillIn from="left" animateMount={shellMounted.current}>
            <div className={s.menuScreen}>
              <Sidebar variant="screen" {...sidebarProps} />
            </div>
          </DrillIn>
        </div>
      );
    }
    const target = back ?? { label: 'Menu', to: '/' };
    const links = app?.links ?? [];
    return (
      <div className={s.root}>
        <div className={s.bar}>
          <button type="button" className={s.back} onClick={() => goUp(target.to)}>
            <FontIcon iconName="ChevronLeft" aria-hidden style={{ width: 24, textAlign: 'center', fontSize: 14 }} />
            <span>{target.label}</span>
          </button>
          <span className={s.barTitle}>{app?.name}</span>
        </div>
        {app && !back && links.length > 1 && (
          <div className={s.pills} role="navigation" aria-label={`${app.name} pages`}>
            {links.map(l => {
              const active = nav.isLinkActive(app, l.path);
              return (
                <Link
                  key={l.path}
                  to={nav.linkUrl(app, l)}
                  // One merged class: with two, which wins depends on the order
                  // Fluent inserted the rules, which a theme change reshuffles.
                  className={mergeStyles(s.pill, active && s.pillActive)}
                  aria-current={active ? 'page' : undefined}
                >
                  {l.text}
                </Link>
              );
            })}
          </div>
        )}
        <DrillIn from="right" animateMount={shellMounted.current}>
          <main className={s.main}>{routes}</main>
        </DrillIn>
      </div>
    );
  }

  if (layout === 'medium') {
    return (
      <div className={s.root}>
        <div className={s.side} style={{ width: RAIL_WIDTH }}>
          <PerfProfiler id="shell-sidebar">
            <Sidebar variant="rail" {...sidebarProps} onToggle={openOverlay} toggleLabel="Expand menu" />
          </PerfProfiler>
        </div>
        <main className={s.main}>{routes}</main>
        <Panel
          isOpen={overlayOpen}
          isLightDismiss
          hasCloseButton={false}
          type={PanelType.customNear}
          customWidth="300px"
          onDismiss={closeOverlay}
          onRenderNavigation={() => null}
          styles={reduced ? overlayPanelStylesReduced : overlayPanelStyles}
          aria-label="Menu"
        >
          <Sidebar
            variant="full"
            {...sidebarProps}
            onToggle={closeOverlay}
            toggleLabel="Close menu"
            onNavigate={closeOverlay}
            onOpenSettings={() => {
              setOverlayOpen(false);
              openSettings();
            }}
          />
        </Panel>
      </div>
    );
  }

  // Wide. Both the rail and the full panel are positioned in the side
  // column, whose width is the layout's: the rail while collapsed, the
  // panel while expanded, both while sliding (the rail on top, fading).
  return (
    <div className={s.root}>
      <div
        ref={sideRef}
        className={s.side}
        style={{ width: layoutCollapsed ? RAIL_WIDTH : FULL_WIDTH, zIndex: sliding ? 2 : undefined }}
      >
        {(!layoutCollapsed || sliding) && (
          <div ref={panelRef} className={s.sidePanel}>
            <PerfProfiler id="shell-sidebar">
              <Sidebar variant="full" {...sidebarProps} onToggle={onToggle} toggleLabel="Collapse menu" />
            </PerfProfiler>
          </div>
        )}
        {(layoutCollapsed || sliding) && (
          <div ref={railRef} className={s.sideRail}>
            <PerfProfiler id="shell-sidebar">
              <Sidebar variant="rail" {...sidebarProps} onToggle={onToggle} toggleLabel="Expand menu" />
            </PerfProfiler>
          </div>
        )}
      </div>
      <main ref={mainRef} className={s.main}>
        {routes}
      </main>
    </div>
  );
});

/**
 * The sidebar shell. Takes every <DenimProvider> prop plus its own. When the
 * app list comes from the backend it also selects `group` and `icon`
 * (pass `applicationFields=""` if your backend lacks them).
 */
export const SidebarShell: React.FC<ShellProps> = props => {
  const [core, own] = splitShellProps(props);
  return (
    <DenimProvider applicationFields={OPTIONAL_APPLICATION_FIELDS} {...core}>
      <SidebarLayout {...own} />
    </DenimProvider>
  );
};

export default SidebarShell;
