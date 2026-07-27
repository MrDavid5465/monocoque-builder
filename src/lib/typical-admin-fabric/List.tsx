import React from 'react';
import { Stack, Name, useQuery, useLocation, useNavigate } from './lib';
import DetailsList from './lib/List';

import Links from './Links';
import { IDispatcher, ListSchema, IComponents } from '../typical-admin';
import Subscriber from '../typical-admin/Subscriber';
import { ColumnVisibilityStore } from './lib/columnVisibilityStore';

interface Props {
  dispatcher: IDispatcher;
  name: Name;
  schemaDefinition: ListSchema<any>;
  pageSize?: number;
  components?: IComponents;
  // Overrides the query's result field — defaults to `get${name.plural}`.
  // Mirrors CardList's same-named prop, needed when the display-plural label
  // doesn't match the actual resolver name.
  queryResultKey?: string;
  // Suppresses the built-in "Listing X" heading + Links row, for callers
  // (e.g. SwitchableList) embedding this with their own shared header.
  hideHeader?: boolean;
  // Which item field goes into the show-route URL — defaults to 'id'.
  // Mirrors CardList's same-named prop, e.g. for records keyed by a
  // human-readable name elsewhere in the app.
  idField?: string;
  // Passed straight through to ./lib/List — see its own doc comments.
  columnSelectable?: boolean;
  storageKey?: string;
  columnVisibilityStore?: ColumnVisibilityStore;
  alwaysVisibleColumns?: string[];
}

const List: React.FC<Props> = ({
  dispatcher,
  name,
  schemaDefinition,
  pageSize,
  components,
  queryResultKey,
  hideHeader,
  idField,
  columnSelectable,
  storageKey,
  columnVisibilityStore,
  alwaysVisibleColumns,
}) => {
  const {pathname} =  useLocation();
  const navigate = useNavigate();
  const queryName = queryResultKey ?? `get${name.plural}`;
  const { data: items, error, loading, refetch } : { data?: any; error?: any; loading?: boolean; refetch?: () => void } = useQuery(dispatcher.list);
  if (error) {
    return <span>{`error: ${error}`}</span>;
  }

  if (loading) {
    return <span>{`loading...`}</span>;
  }
  return (
    <Stack>
      {dispatcher.subscribe && (
        <Subscriber
          document={dispatcher.subscribe}
          options={{ onSubscriptionData: () => refetch() }}
        />
      )}
      {!hideHeader && (
        <Stack
          horizontal
          horizontalAlign={'space-between'}
          verticalAlign={'center'}
        >
          <h3>Listing {name.plural}</h3>
          {components?.links ? (
            React.createElement(components.links, {
              name,
              dispatcher,
            })
          ) : (
            <Links name={name} dispatcher={dispatcher} />
          )}
        </Stack>
      )}
      <DetailsList
        pageSize={pageSize}
        name={name.plural}
        schema={schemaDefinition.columns}
        onSelect={(item) => {
          navigate(`${pathname}/${item[idField ?? 'id']}/show`, item);
        }}
        items={items[queryName] || []}
        columnSelectable={columnSelectable}
        storageKey={storageKey}
        columnVisibilityStore={columnVisibilityStore}
        alwaysVisibleColumns={alwaysVisibleColumns}
        onAdd={schemaDefinition.buttons?.add && dispatcher.new ? () => navigate(`${pathname}/new`) : undefined}
      />
      <br />
    </Stack>
  );
};
export default List;
