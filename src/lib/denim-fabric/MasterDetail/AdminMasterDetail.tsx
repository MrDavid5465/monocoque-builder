// A ReactiveAdmin screen in MasterDetail: typical-admin-fabric's List in the
// list pane and its show/new/edit slots in the detail pane. Same props as
// ReactiveAdmin, plus a few for the list pane.
import React from 'react';
import { useLocation } from 'react-router-dom';
import { mergeStyles, useTheme } from '@fluentui/react';
import ReactiveAdmin from '../../typical-admin-fabric';
import List from '../../typical-admin-fabric/List';
import Links from '../../typical-admin-fabric/Links';
import { label, resolveLabels } from '../../typical-admin';
import type { IComponents, IDispatcher, ITACallBacks, ITALabels, ITASchema, Name } from '../../typical-admin';
import { useLayout } from '../shared/layout';
import { MasterDetail } from './MasterDetail';
import { useDetailRoute } from './useDetailRoute';
import { useReducedMotion } from '../../denim';
import { SlidingIndicator } from '../shared/motion';

export interface AdminMasterDetailProps {
  dispatcher: IDispatcher;
  name: Name;
  schemaDefinition: ITASchema;
  /** Slot overrides for the detail pane (show, new, edit, delete, links). */
  components?: Omit<IComponents, 'list'>;
  callBacks?: ITACallBacks;
  pageSize?: number;
  /**
   * Display text, separate from `name`'s GraphQL stems (typical-admin's
   * labels.ts). Here the readable defaults always apply: "Devices",
   * "Device", "Edit device", "New device". Override any of them, or set
   * `singular`/`plural` when the type name doesn't read well.
   */
  labels?: ITALabels;
  /** Heading of the list pane. Default the list heading (`labels.plural`). */
  title?: string;
  /** Compact list: only these columns of `schemaDefinition.list.columns`. */
  listColumns?: string[];
  /** Extra props for typical-admin-fabric's List (queryResultKey, idField, columnSelectable, ...). */
  listProps?: Record<string, any>;
  /** Detail pane content while nothing is selected. */
  empty?: React.ReactNode;
  listWidth?: number;
}

const NoList: React.FC = () => null;

export const AdminMasterDetail: React.FC<AdminMasterDetailProps> = ({
  dispatcher,
  name,
  schemaDefinition,
  components,
  callBacks,
  pageSize = 20,
  labels: labelsProp,
  title,
  listColumns,
  listProps,
  empty,
  listWidth,
}) => {
  const route = useDetailRoute();
  const { pathname } = useLocation();
  const narrow = useLayout() === 'narrow';
  const labels = React.useMemo(() => labelsProp ?? {}, [labelsProp]);
  const l = resolveLabels(name, labels);

  // The selected row's highlight is one indicator behind the rows that
  // slides to the next selection, and the only thing drawing it. Rows are
  // transparent unless hovered (their white is the pane's own background);
  // the selected row is transparent even hovered, so the row just clicked
  // doesn't show the selection before the indicator gets there. Other rows
  // keep Fluent's hover colour, and Fluent's separators and focus outline
  // still draw on top.
  const theme = useTheme();
  const reduced = useReducedMotion();
  const rowsRef = React.useRef<HTMLDivElement>(null);
  const rowsClass = React.useMemo(
    () =>
      mergeStyles({
        position: 'relative',
        isolation: 'isolate',
        selectors: {
          '& .ms-DetailsRow:not(:hover), & .ms-DetailsRow.is-selected, & .ms-DetailsRow.is-selected:hover': {
            background: 'transparent',
          },
          // Fluent fades rows in when they mount (page, sort, filter).
          ...(reduced ? { '& .ms-DetailsRow': { animation: 'none' } } : {}),
        },
      }),
    [reduced],
  );
  const indicatorClass = React.useMemo(
    () => mergeStyles({ background: theme.palette.neutralLight }),
    [theme],
  );

  const listSchema = React.useMemo(() => {
    if (!listColumns) return schemaDefinition.list;
    const columns: Record<string, any> = {};
    listColumns.forEach(k => {
      const col = (schemaDefinition.list.columns as Record<string, any>)[k];
      if (col) columns[k] = col;
    });
    return { ...schemaDefinition.list, columns };
  }, [schemaDefinition.list, listColumns]);

  // On a phone the back bar above the detail (the shell's, or MasterDetail's
  // own) already goes up a level, so the slots' own back arrow is dropped;
  // Edit and Delete stay. A `links` override gets `hideBack` too.
  const detailComponents = React.useMemo(() => {
    const own = { ...components, list: NoList };
    if (!narrow) return own;
    const LinksSlot = components?.links ?? Links;
    const NoBackLinks: React.FC<any> = props => <LinksSlot {...props} hideBack />;
    return { ...own, links: NoBackLinks };
  }, [components, narrow]);

  // The edit page's "up" is its record, not the list.
  const back =
    route.id && /\/edit\/?$/.test(pathname)
      ? { label: l.singular, to: `${route.basePath}/${encodeURIComponent(route.id)}/show` }
      : undefined;

  return (
    <MasterDetail
      title={title ?? label(l, 'listHeading')}
      selected={route.selected}
      listUrl={route.basePath}
      back={back}
      empty={empty}
      listWidth={listWidth}
      list={
        // Opens rows on click (so a row can be reopened after its detail
        // closed) and highlights the one in the URL. The list stays mounted,
        // keeping its page, sort and filters.
        <div className={rowsClass} ref={rowsRef}>
        <SlidingIndicator
          containerRef={rowsRef}
          selector=".ms-DetailsRow.is-selected"
          className={indicatorClass}
          perfName="list-selection"
        />
        <List
          dispatcher={dispatcher}
          name={name}
          schemaDefinition={listSchema}
          pageSize={pageSize}
          hideHeader
          basePath={route.basePath}
          labels={labels}
          selectOnClick
          selectedKey={route.id ?? null}
          {...listProps}
        />
        </div>
      }
      detail={
        <ReactiveAdmin
          dispatcher={dispatcher}
          name={name}
          schemaDefinition={schemaDefinition}
          components={detailComponents}
          callBacks={callBacks}
          labels={labels}
        />
      }
    />
  );
};

export default AdminMasterDetail;
