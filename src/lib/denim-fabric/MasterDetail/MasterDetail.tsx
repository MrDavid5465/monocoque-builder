// MasterDetail: an optional list | detail pattern for an application's
// content area. Wide and medium screens show both panes; a phone shows one
// at a time, the detail with a back bar to the list. Selection lives in the
// URL (see useDetailRoute), so deep links and the browser's Back button work.
//
// The panes are yours: MasterDetail draws only the frame, a list heading and
// an empty-detail placeholder. Apps that aren't lists (a canvas, a designer)
// don't use it and get the whole content area.
import React from 'react';
import { FontIcon, mergeStyleSets, useTheme } from '@fluentui/react';
import { useNavigate } from 'react-router-dom';
import { FullBleed } from '../SidebarShell/FullBleed';
import { useBreakpoint, useShellLayout } from '../SidebarShell/layout';
import type { IBackTarget } from '../SidebarShell/layout';
import { DrillIn } from '../shared/motion';

export interface MasterDetailProps {
  /** The list (master) pane's content. */
  list: React.ReactNode;
  /** The detail pane's content, rendered while `selected`. */
  detail: React.ReactNode;
  /** Whether a detail is selected; from the URL (useDetailRoute().selected). */
  selected: boolean;
  /** The list's URL, where a phone's back bar goes (useDetailRoute().basePath). */
  listUrl: string;
  /** Heading of the list pane, and the back bar's label on a phone. */
  title?: string;
  /** Controls next to the list heading (an Add button, a filter). */
  listActions?: React.ReactNode;
  /** Detail pane content while nothing is selected. */
  empty?: React.ReactNode;
  /** List pane width in px on wide screens (medium screens use 85% of it). Default 360. */
  listWidth?: number;
  /**
   * Where a phone's back bar goes while a detail is open, when that isn't the
   * list: e.g. from an edit page up to its record. Default `{ label: title,
   * to: listUrl }`.
   */
  back?: IBackTarget;
}

const getStyles = (theme: ReturnType<typeof useTheme>) =>
  mergeStyleSets({
    root: { display: 'flex', height: '100%', minHeight: 0 },
    list: {
      flex: 'none',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      borderRight: `1px solid ${theme.palette.neutralLight}`,
      background: theme.semanticColors.bodyBackground,
    },
    listHeader: {
      flex: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      minHeight: 52,
      padding: '0 12px 0 16px',
      borderBottom: `1px solid ${theme.palette.neutralLight}`,
    },
    listTitle: { flex: 1, margin: 0, fontSize: theme.fonts.large.fontSize, fontWeight: 600 },
    listBody: { flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 12px 12px' },
    detail: { flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', padding: '8px 24px 24px' },
    narrowPane: { height: '100%', overflow: 'auto', padding: '0 12px 12px', boxSizing: 'border-box' },
    empty: {
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      color: theme.palette.neutralSecondary,
      textAlign: 'center',
    },
    backBar: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      minHeight: 44,
      padding: '0 8px 0 4px',
      border: 0,
      background: 'transparent',
      color: theme.palette.themePrimary,
      font: 'inherit',
      cursor: 'pointer',
      selectors: {
        ':focus-visible': { outline: `2px solid ${theme.palette.themePrimary}`, outlineOffset: -2 },
      },
    },
  });

export const MasterDetail: React.FC<MasterDetailProps> = ({
  list,
  detail,
  selected,
  listUrl,
  title,
  listActions,
  empty,
  listWidth = 360,
  back,
}) => {
  const theme = useTheme();
  const s = React.useMemo(() => getStyles(theme), [theme]);
  const shell = useShellLayout();
  const ownLayout = useBreakpoint();
  const layout = shell?.layout ?? ownLayout;
  const navigate = useNavigate();
  const narrow = layout === 'narrow';
  const backLabel = back?.label ?? title ?? 'Back';
  const backTo = back?.to ?? listUrl;

  // On a phone, inside SidebarShell, the shell's back bar leads to the list
  // while a detail is open (instead of to the menu).
  const setBack = shell?.setBack;
  React.useLayoutEffect(() => {
    if (!setBack || !narrow || !selected) return;
    setBack({ label: backLabel, to: backTo });
    return () => setBack(null);
  }, [setBack, narrow, selected, backLabel, backTo]);

  // On a phone the list stays mounted (hidden) under an open detail, so its
  // page, sort and filters are still there on the way back. The pane
  // scrolls both, so the list's scroll position is put aside meanwhile.
  const paneRef = React.useRef<HTMLDivElement>(null);
  const listScroll = React.useRef(0);
  React.useLayoutEffect(() => {
    const pane = paneRef.current;
    if (pane && narrow) pane.scrollTop = selected ? 0 : listScroll.current;
  }, [narrow, selected]);

  // Phone drill-in: the detail slides in from the right when it opens (not
  // when the page opens on it), the list from the left on the way back.
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
  }, []);
  const [seenSelected, setSeenSelected] = React.useState(selected);
  const [returns, setReturns] = React.useState(0);
  if (seenSelected !== selected) {
    setSeenSelected(selected);
    if (!selected) setReturns(n => n + 1);
  }

  const header = (title || listActions) && (
    <div className={s.listHeader}>
      {title && <h2 className={s.listTitle}>{title}</h2>}
      {listActions}
    </div>
  );

  if (narrow) {
    return (
      <FullBleed>
        <div
          className={s.narrowPane}
          ref={paneRef}
          onScroll={selected ? undefined : e => (listScroll.current = e.currentTarget.scrollTop)}
        >
          {selected && (
            <DrillIn from="right" animateMount={mounted.current}>
              <div>
                {!shell && (
                  <button type="button" className={s.backBar} onClick={() => navigate(backTo)}>
                    <FontIcon iconName="ChevronLeft" aria-hidden />
                    {backLabel}
                  </button>
                )}
                {detail}
              </div>
            </DrillIn>
          )}
          <DrillIn from="left" animateMount={false} replayKey={returns}>
            <div hidden={selected}>
              {/* Inside SidebarShell the bar above already shows the app's
                  name; keep only the list's own actions. */}
              {shell ? listActions && <div className={s.listHeader}>{listActions}</div> : header}
              {list}
            </div>
          </DrillIn>
        </div>
      </FullBleed>
    );
  }

  const width = layout === 'medium' ? Math.round(listWidth * 0.85) : listWidth;
  return (
    <FullBleed>
      <div className={s.root}>
        <section className={s.list} style={{ width }} aria-label={title}>
          {header}
          <div className={s.listBody}>{list}</div>
        </section>
        <section className={s.detail} aria-live="polite">
          {selected
            ? detail
            : empty ?? (
                <div className={s.empty}>
                  <FontIcon iconName="TouchPointer" style={{ fontSize: 32 }} aria-hidden />
                  <span>Select an item from the list.</span>
                </div>
              )}
        </section>
      </div>
    </FullBleed>
  );
};

export default MasterDetail;
