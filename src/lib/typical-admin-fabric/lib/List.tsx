import React, { useState } from 'react';
import Field from './templates/Fabric';
import {
  getStyle,
  Stack,
  IndexableObject,
  DetailsList,
  SelectionMode,
  IconButton,
  Icon,
} from '.';
import ListControls, { ListButtonConfig } from './ListControls';
import { ColumnVisibilityStore, localStorageColumnVisibilityStore } from './columnVisibilityStore';
import { IColumn, CheckboxVisibility } from '@fluentui/react';
import { matchSorter } from 'match-sorter';
// import { CSVLink } from 'react-csv';
import { DisplaySchema } from '../../typical-admin';

interface Props {
  items: Array<any>;
  schema: DisplaySchema<any>;
  onSelect?: (values: any) => void;
  name: string;
  csvHeaders?: Array<{ label: string; key: string }>;
  pageSize?: number;
  // Opts in to a "Columns" picker (checkbox Form, one checkbox per schema
  // key) letting the user hide/show columns — off by default so every
  // existing caller renders exactly as before.
  columnSelectable?: boolean;
  // Namespace for the saved hidden-column set; only read/used when
  // columnSelectable is true. Falls back to `name`, but callers should pass
  // an explicit key since `name` isn't guaranteed unique across every List
  // instance in the app.
  storageKey?: string;
  // Where the hidden-column set is persisted — defaults to localStorage.
  // Swap in a different implementation (e.g. a backend-backed one) without
  // touching any of the selection/filtering logic below.
  columnVisibilityStore?: ColumnVisibilityStore;
  // Schema keys that can never be hidden (e.g. an identity column).
  alwaysVisibleColumns?: string[];
  // Renders a grid-level "Add" control (see ListControls) when provided —
  // undefined means the caller's schema didn't opt in (ListSchema.buttons.add),
  // so nothing renders. The wrapper List.tsx computes this from dispatcher.new
  // + navigate; this component just renders whatever it's handed.
  onAdd?: () => void;
  // Arbitrary grid-level actions beyond add/columns (see ListControls).
  customButtons?: ListButtonConfig[];
}

const List: React.FC<Props> = ({
  items,
  schema,
  onSelect,
  name,
  csvHeaders: _csvHeaders,
  pageSize,
  columnSelectable,
  storageKey,
  columnVisibilityStore = localStorageColumnVisibilityStore,
  alwaysVisibleColumns,
  onAdd,
  customButtons,
}) => {
  const [filters, setFilters] = useState<IndexableObject>({});
  const [sort, setSort] = useState<IndexableObject>({});
  let filteredItems = items;
  const style = getStyle();
  const [page, setPage] = useState(0);

  const resolvedStorageKey = storageKey ?? name;
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    () => (columnSelectable ? columnVisibilityStore.readHidden(resolvedStorageKey) : new Set())
  );
  const pickableKeys = Object.keys(schema).filter(k => !(alwaysVisibleColumns ?? []).includes(k));
  const visibleCount = pickableKeys.filter(k => !hiddenColumns.has(k)).length + (alwaysVisibleColumns?.length ?? 0);
  const totalCount = Object.keys(schema).length;
  const columnSelectSchema = pickableKeys.reduce((acc, k) => {
    acc[k] = { type: 'checkbox', label: (schema as any)[k].label };
    return acc;
  }, {} as Record<string, any>);
  function handleSelect(item?: any) {
    onSelect && onSelect(item);
  }
  function handleChange(name: string, value: any) {
    setPage(0);
    setFilters({ ...filters, [name]: value });
  }
  function handleSort(
    _: React.MouseEvent<HTMLElement, MouseEvent>,
    column: IColumn
  ) {
    switch (sort[column.key]) {
      case '':
        setSort({ [column.key]: 'asc' });
        break;
      case 'asc':
        setSort({ [column.key]: 'des' });
        break;
      case 'des':
        setSort({ [column.key]: '' });
        break;
      default:
        setSort({ [column.key]: 'asc' });
        break;
    }
  }
  // Only referenced by the commented-out CSV export block below — commented
  // out alongside it (rather than deleted) to keep it available if that's
  // reactivated; a live-but-unreferenced function fails `tsc --noEmit`.
  // function toCSV(schema: DisplaySchema<any>, items: any[]) {
  //   return items.map((i) => {
  //     const item = { ...i };
  //     Object.entries(schema).forEach(([k, v]: any) => {
  //       item[k] = v.onRender ? v.onRender({ value: i[k], values: i }) : i[k];
  //     });
  //     return item;
  //   });
  // }
  Object.entries(filters).forEach(([name, value]) => {
    if (value !== '' && !(name.includes('_gt') || name.includes('_lt'))) {
      filteredItems = matchSorter(filteredItems, value, { keys: [name] });
    } else if (name.includes('_gt') || name.includes('_lt')) {
      filteredItems = filteredItems.filter((i) => {
        const itemValue = i[name.split('_')[0]];
        return name.split('_')[1] === 'gt'
          ? itemValue >= value
          : itemValue < value;
      });
    }
  });
  Object.entries(sort).forEach(([name, value]: any) => {
    if (value !== '' && value !== undefined) {
      filteredItems = filteredItems.sort((a: any, b: any) =>
        value === 'asc'
          ? a[name] > b[name]
            ? 1
            : -1
          : a[name] < b[name]
          ? 1
          : -1
      );
    }
  });
  return (
    <>
      <Stack horizontal tokens={{ childrenGap: '0.77em' }}>
        {Object.entries(schema)
          .filter(([, s]: any) => s.options && s.options.filterable)
          .map(([k, v]: any, i: number) =>
            v.options.options ? (
              <Field
                key={`${i}`}
                className={style.sm}
                label={v.label}
                errors={[]}
                type={'select'}
                onChange={handleChange}
                name={k}
                value={filters[k]}
                options={v.options.options.map((p: any) => ({
                  text: p.text || '',
                  value: p.value || '',
                }))}
              />
            ) : v.options.filterType && v.options.filterType === 'dateRange' ? (
              React.createElement(
                () => (
                  <>
                    <Field
                      key={`${i}_gt`}
                      className={style.sm}
                      label={`${v.label} start`}
                      errors={[]}
                      type={'text'}
                      onChange={handleChange}
                      name={`${k}_gt`}
                      value={filters[`${k}_gt`]}
                    />
                    <Field
                      key={`${i}_lt`}
                      className={style.sm}
                      label={`${v.label} end`}
                      errors={[]}
                      type={'text'}
                      onChange={handleChange}
                      name={`${k}_lt`}
                      value={filters[`${k}_lt`]}
                    />
                  </>
                ),
                { key: i }
              )
            ) : (
              <Field
                key={i}
                className={style.sm}
                label={v.label}
                errors={[]}
                type={'text'}
                onChange={handleChange}
                name={k}
                value={filters[k]}
              />
            )
          )}
      </Stack>
      <Stack>
        {/* {csvHeaders && (
          <Stack horizontal>
            <strong>{name}</strong>:{' '}
            <CSVLink
              className={style.link}
              headers={csvHeaders}
              data={toCSV(schema, filteredItems)}
              filename={`${name}.csv`}
            >
              <Icon iconName={'Download'} />
            </CSVLink>
          </Stack>
        )} */}

        <div style={{ position: 'relative', paddingTop: (columnSelectable || onAdd || customButtons?.length) ? 36 : 0 }}>
          <ListControls
            columnSelectable={columnSelectable}
            visibleCount={visibleCount}
            totalCount={totalCount}
            columnSelectSchema={columnSelectSchema}
            initialValues={Object.fromEntries(pickableKeys.map(k => [k, !hiddenColumns.has(k)]))}
            pickableKeys={pickableKeys}
            onColumnsChange={(nextHidden) => {
              setHiddenColumns(nextHidden);
              columnVisibilityStore.writeHidden(resolvedStorageKey, nextHidden);
            }}
            onAdd={onAdd}
            customButtons={customButtons}
          />
          <DetailsList
            onActiveItemChanged={handleSelect}
            onRenderRow={(props: any, defaultRender: any) => {
              return handleSelect !== null && handleSelect !== undefined ? (
                <div style={{ cursor: 'pointer' }}>{defaultRender(props)}</div>
              ) : (
                defaultRender(props)
              );
            }}
            items={
              pageSize
                ? filteredItems.slice(page * pageSize, (page + 1) * pageSize)
                : filteredItems
            }
            checkboxVisibility={CheckboxVisibility.hidden}
            selectionMode={
              !handleSelect ? SelectionMode.none : SelectionMode.single
            }
            columns={Object.entries(schema)
              .filter(([k]) => !columnSelectable || (alwaysVisibleColumns ?? []).includes(k) || !hiddenColumns.has(k))
              .map(([k, v]: any) => {
                const col: IColumn = {
                  key: k,
                  name: v.label,
                  minWidth: v.options?.minWidth ?? 100,
                  maxWidth: v.options?.maxWidth ?? 200,
                  isMultiline: true,
                  isResizable: true,
                  isFiltered: filters[k] !== '' && filters[k] !== undefined,
                  onColumnClick: handleSort,
                  isSorted: sort[k] && sort[k] !== '',
                  isSortedDescending: sort[k] && sort[k] === 'des',
                };

                col.onRender = (values) =>
                  v.onRender ? v.onRender({ values, value: values[k] }) : values[k];
                return col;
              })}
          />
        </div>
        {pageSize && (
          <Stack horizontal horizontalAlign={'end'} verticalAlign={'center'}>
            <IconButton disabled={page === 0} onClick={() => setPage(page - 1)}>
              <Icon iconName={'Remove'} />
            </IconButton>
            <IconButton
              disabled={filteredItems.length - page * pageSize <= pageSize}
              onClick={() => setPage(page + 1)}
            >
              <Icon iconName={'Add'} />
            </IconButton>
            Page {page + 1} of{' '}
            {filteredItems.length % pageSize
              ? Math.floor(filteredItems.length / pageSize) + 1
              : Math.floor(filteredItems.length / pageSize)}
          </Stack>
        )}
      </Stack>
    </>
  );
};
export default List;
