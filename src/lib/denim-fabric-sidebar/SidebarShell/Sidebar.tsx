// The sidebar: applications under group headings, each with its icon and
// status dot, the active application's links, the app's Controls and
// Settings in the footer. Three variants: "full" (wide screens, and the
// overlay on medium ones), "rail" (icons only) and "screen" (a phone's
// full-screen menu).
//
// Its parts are the package's role exports (denim-fabric's
// shared/barContract.ts): Sidebar = `Bar`, AppList = `AppSwitcher`,
// SidebarLinks = `BarNav`, SidebarLink = `BarLink`, and denim-fabric's
// shared StatusDot = `StatusDot`.
import React from 'react';
import { Link } from 'react-router-dom';
import { FontIcon, IconButton, mergeStyles, mergeStyleSets, useTheme } from '@fluentui/react';
import type { ITheme } from '@fluentui/react';
import { useApplications, useNav } from '../../denim';
import type { IApplication } from '../../denim';
import { SlidingIndicator } from '../../denim-fabric/shared/motion';
import { SettingsDialog } from '../../denim-fabric/shared/SettingsDialog';
import { StatusDot } from '../../denim-fabric/shared/StatusDot';
import type {
  AppSwitcherProps,
  BarLinkProps,
  BarNavProps,
  BarProps,
} from '../../denim-fabric/shared/barContract';

// Re-exported from here, where it used to live.
export { StatusDot };

export type SidebarVariant = 'full' | 'rail' | 'screen';

export interface SidebarProps extends BarProps {
  /** Default "full". */
  variant?: SidebarVariant;
  /** Heading at the top (your product's name). */
  title?: string;
  /** Shows a collapse/expand button in the header. */
  onToggle?: () => void;
  toggleLabel?: string;
  /** Called after an application or link is chosen (closes an overlay). */
  onNavigate?: () => void;
  /**
   * Opens the Settings dialog. The shell passes it (one dialog for all its
   * sidebars); without it the sidebar has a dialog of its own.
   */
  onOpenSettings?: () => void;
  /** Extra content above the footer's Settings button (full sidebar and phone menu). */
  Footer?: React.FC<any>;
}

export const TOUCH = 44; // minimum touch-target size, px

const buildSidebarStyles = (theme: ITheme) => {
  const { palette, semanticColors } = theme;
  const focus = {
    ':focus-visible': { outline: `2px solid ${palette.themePrimary}`, outlineOffset: -2 },
  };
  return mergeStyleSets({
    root: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      boxSizing: 'border-box',
      background: palette.neutralLighterAlt,
      color: palette.neutralPrimary,
      borderRight: `1px solid ${palette.neutralLight}`,
      overflow: 'hidden',
    },
    // No gap or padding beside the collapse button: its 44px touch target is
    // mostly empty space around a 16px icon already, and the title needs that
    // width ("Monocoque Builder" was cut off by 11px at the default width).
    header: {
      display: 'flex',
      alignItems: 'center',
      minHeight: 56,
      padding: '0 0 0 12px',
      borderBottom: `1px solid ${palette.neutralLight}`,
      flex: 'none',
    },
    railHeader: { justifyContent: 'center', padding: 0 },
    title: {
      flex: 1,
      fontSize: theme.fonts.large.fontSize,
      fontWeight: 600,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    brand: { width: 28, height: 28, fill: palette.themePrimary, flex: 'none', marginRight: 8 },
    // Positioned and isolated: the selection indicator is drawn in here,
    // behind the items (z-index -1), and scrolls with them.
    scroll: {
      flex: 1,
      overflowY: 'auto',
      overflowX: 'hidden',
      padding: '8px 0',
      position: 'relative',
      isolation: 'isolate',
    },
    group: { padding: '4px 0 8px' },
    groupHeading: {
      margin: 0,
      padding: '8px 16px 4px',
      fontSize: theme.fonts.small.fontSize,
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: palette.neutralSecondary,
    },
    groupRule: { margin: '4px 12px', border: 0, borderTop: `1px solid ${palette.neutralLight}` },
    list: { listStyle: 'none', margin: 0, padding: 0 },
    item: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      minHeight: TOUCH,
      padding: '0 12px 0 13px',
      margin: '1px 6px',
      borderRadius: 4,
      borderLeft: '3px solid transparent',
      position: 'relative',
      color: palette.neutralPrimary,
      textDecoration: 'none',
      fontSize: theme.fonts.mediumPlus.fontSize,
      selectors: {
        ':hover': { background: palette.neutralLighter, color: palette.neutralDark },
        ':active': { background: palette.neutralLight },
        ...focus,
      },
    },
    railItem: { justifyContent: 'center', padding: 0, gap: 0, position: 'relative', minWidth: TOUCH },
    // The selected look (background and accent bar) is drawn ONLY by the
    // shared indicator behind the item, which slides between items; the
    // item paints neither, not even hovered (the item under the pointer is
    // the one just clicked, and would show the selection before the
    // indicator arrives). Bold text changes at once.
    itemActive: {
      fontWeight: 600,
      selectors: { ':hover': { background: 'transparent' }, ':active': { background: 'transparent' } },
    },
    indicator: {
      background: palette.neutralLight,
      borderLeft: `3px solid ${palette.themePrimary}`,
      borderRadius: 4,
    },
    icon: { fontSize: 20, width: 24, textAlign: 'center', flex: 'none', color: palette.themePrimary },
    letter: {
      width: 24,
      height: 24,
      lineHeight: '24px',
      borderRadius: 4,
      textAlign: 'center',
      fontWeight: 600,
      flex: 'none',
      background: palette.themeLighter,
      color: palette.themeDarker,
    },
    name: { flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    links: { listStyle: 'none', margin: '0 0 4px', padding: 0 },
    link: {
      display: 'flex',
      alignItems: 'center',
      minHeight: TOUCH,
      padding: '0 12px 0 52px',
      margin: '0 6px',
      borderRadius: 4,
      color: palette.neutralSecondary,
      textDecoration: 'none',
      selectors: {
        ':hover': { background: palette.neutralLighter, color: palette.neutralPrimary },
        ...focus,
      },
    },
    linkActive: { color: palette.themePrimary, fontWeight: 600 },
    // A link the sliding indicator sits behind (the phone menu's current
    // page): like itemActive, it paints no hover of its own.
    linkSelected: {
      selectors: { ':hover': { background: 'transparent' }, ':active': { background: 'transparent' } },
    },
    footer: {
      flex: 'none',
      borderTop: `1px solid ${palette.neutralLight}`,
      padding: 6,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    },
    footerButton: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: 12,
      width: '100%',
      minHeight: TOUCH,
      padding: '0 12px 0 16px',
      textAlign: 'left',
      border: 0,
      borderRadius: 4,
      background: 'transparent',
      color: palette.neutralPrimary,
      font: 'inherit',
      fontSize: theme.fonts.mediumPlus.fontSize,
      cursor: 'pointer',
      selectors: {
        ':hover': { background: palette.neutralLighter },
        ':active': { background: palette.neutralLight },
        ...focus,
      },
    },
    toggle: { width: TOUCH, height: TOUCH, flex: 'none', color: semanticColors.bodyText },
    // The app's Controls: one row at the top of the footer, always shown.
    controls: {
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      minHeight: TOUCH,
      padding: '0 10px 0 16px',
    },
    railControls: { justifyContent: 'center', padding: 0 },
  });
};

// One style set per theme, shared by the sidebar and each of its parts.
const styleCache = new WeakMap<ITheme, ReturnType<typeof buildSidebarStyles>>();
export const getSidebarStyles = (theme: ITheme) => {
  let styles = styleCache.get(theme);
  if (!styles) {
    styles = buildSidebarStyles(theme);
    styleCache.set(theme, styles);
  }
  return styles;
};
const useSidebarStyles = () => getSidebarStyles(useTheme());

const AppIcon: React.FC<{ app: IApplication; className: string; letterClass: string }> = ({
  app,
  className,
  letterClass,
}) =>
  app.icon ? (
    <FontIcon iconName={app.icon} className={className} aria-hidden />
  ) : (
    <span className={letterClass} aria-hidden>
      {app.name.slice(0, 1).toUpperCase()}
    </span>
  );

export interface SidebarLinkProps extends BarLinkProps {
  /** The sliding selection indicator sits behind it (the phone menu's current page). */
  selected?: boolean;
}

/** One link under an application. The package exports it as the role `BarLink`. */
export const SidebarLink: React.FC<SidebarLinkProps> = ({ to, children, active, selected, className, onClick }) => {
  const s = useSidebarStyles();
  return (
    <Link
      to={to}
      className={mergeStyles(s.link, active && s.linkActive, selected && s.linkSelected, className)}
      aria-current={active ? 'page' : undefined}
      data-denim-selected={selected || undefined}
      onClick={onClick}
    >
      {children}
    </Link>
  );
};

export interface SidebarLinksProps extends BarNavProps {
  /** Puts the sliding selection indicator on the current page's link. */
  selectActive?: boolean;
}

/**
 * An application's links (default: the active one's), as listed under it.
 * Nothing when it has none. The package exports it as the role `BarNav`.
 */
export const SidebarLinks: React.FC<SidebarLinksProps> = ({ app: appProp, onNavigate, className, selectActive }) => {
  const s = useSidebarStyles();
  const nav = useNav();
  const app = appProp ?? nav.activeApp;
  if (!app || !(app.links ?? []).length) return null;
  return (
    <ul className={mergeStyles(s.links, className)}>
      {app.links.map(l => {
        const active = nav.isLinkActive(app, l.path);
        return (
          <li key={l.path}>
            <SidebarLink
              to={nav.linkUrl(app, l)}
              active={active}
              selected={selectActive && active}
              onClick={onNavigate}
            >
              {l.text}
            </SidebarLink>
          </li>
        );
      })}
    </ul>
  );
};

export interface AppListProps extends AppSwitcherProps {
  /** Icons only (the rail). */
  rail?: boolean;
  /**
   * The sliding selection marks the current PAGE: the active app's link
   * when one is current, else the app (its main page). Default: the active
   * app, with its current link in bold (the full sidebar). The phone menu
   * uses it, where the app's links are how you move between its pages.
   */
  selectPage?: boolean;
}

/**
 * The applications under their group headings, each with its icon and
 * status dot and, under the active one, its links. It scrolls, and draws the
 * sliding selection. The package exports it as the role `AppSwitcher`.
 */
export const AppList: React.FC<AppListProps> = ({ rail = false, selectPage = false, onNavigate }) => {
  const s = useSidebarStyles();
  const { groups, ready } = useApplications();
  const nav = useNav();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  return (
    <div className={s.scroll} ref={scrollRef}>
      <SlidingIndicator
        containerRef={scrollRef}
        selector="[data-denim-selected]"
        className={s.indicator}
        perfName="sidebar-selection"
      />
      {!ready && <div className={s.groupHeading}>Loading…</div>}
      {groups.map((group, gi) => (
        <div key={group.name} className={s.group} role="group" aria-label={group.name}>
          {rail ? gi > 0 && <hr className={s.groupRule} /> : <h2 className={s.groupHeading}>{group.name}</h2>}
          <ul className={s.list}>
            {group.applications.map(app => {
              const active = nav.isAppActive(app);
              const onLink = selectPage && active && !!nav.activeLink;
              return (
                <li key={app.path}>
                  <Link
                    to={nav.appUrl(app)}
                    className={mergeStyles(s.item, rail && s.railItem, active && s.itemActive)}
                    aria-current={active && !nav.activeLink ? 'page' : undefined}
                    data-denim-selected={(active && !onLink) || undefined}
                    aria-label={rail ? app.name : undefined}
                    title={rail ? app.name : undefined}
                    onClick={onNavigate}
                  >
                    <AppIcon app={app} className={s.icon} letterClass={s.letter} />
                    {!rail && <span className={s.name}>{app.name}</span>}
                    <StatusDot app={app} overlay={rail} />
                  </Link>
                  {!rail && active && <SidebarLinks app={app} onNavigate={onNavigate} selectActive={selectPage} />}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
};

/** The sidebar. The package exports it as the role `Bar`. */
export const Sidebar: React.FC<SidebarProps> = ({
  variant = 'full',
  title,
  Brand,
  Controls,
  onToggle,
  toggleLabel = 'Collapse menu',
  onNavigate,
  onOpenSettings,
  Footer,
}) => {
  const s = useSidebarStyles();
  const rail = variant === 'rail';
  // A dialog of its own only when the shell doesn't provide one.
  const [ownSettingsOpen, setOwnSettingsOpen] = React.useState(false);
  const openSettings = onOpenSettings ?? (() => setOwnSettingsOpen(true));

  // Variants and states are merged into ONE class with mergeStyles, never
  // listed as two class names. Two classes setting the same property are
  // decided by the order Fluent inserted their rules, and a theme change
  // reorders them: a theme-independent class (railItem) keeps its early rule
  // while the themed one (item) gets a new, later rule and wins. That is how
  // the rail's items picked up the full sidebar's padding after a theme
  // change and pushed their icons off-centre.
  return (
    <nav className={s.root} aria-label="Applications">
      <div className={mergeStyles(s.header, rail && s.railHeader)}>
        {!rail && Brand && <Brand className={s.brand} />}
        {!rail && <span className={s.title}>{title}</span>}
        {onToggle && (
          <IconButton
            className={s.toggle}
            iconProps={{ iconName: rail ? 'GlobalNavButton' : 'DoubleChevronLeft8' }}
            ariaLabel={toggleLabel}
            title={toggleLabel}
            onClick={onToggle}
          />
        )}
      </div>

      <AppList rail={rail} selectPage={variant === 'screen'} onNavigate={onNavigate} />

      <div className={s.footer}>
        {Controls && (
          <div className={mergeStyles(s.controls, rail && s.railControls)} data-denim-controls="">
            <Controls />
          </div>
        )}
        {!rail && Footer && <Footer />}
        <button
          type="button"
          className={mergeStyles(s.footerButton, rail && s.railItem)}
          onClick={openSettings}
          aria-label={rail ? 'Settings' : undefined}
          title={rail ? 'Settings' : undefined}
        >
          <FontIcon iconName="Settings" className={s.icon} aria-hidden />
          {!rail && <span className={s.name}>Settings</span>}
        </button>
      </div>
      {!onOpenSettings && <SettingsDialog isOpen={ownSettingsOpen} onDismiss={() => setOwnSettingsOpen(false)} />}
    </nav>
  );
};

export default Sidebar;
