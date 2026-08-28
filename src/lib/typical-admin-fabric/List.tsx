import React from 'react';
import { Stack, IconButton, Name, useQuery, useMutation, useLocation, useNavigate } from './lib';
import DetailsList from './lib/List';

import Links from './Links';
import { IDispatcher, ListSchema, IComponents } from '../typical-admin';
import Subscriber from '../typical-admin/Subscriber';
import { ColumnVisibilityStore } from './lib/columnVisibilityStore';
import { confirmAsync } from '../denim/components/ConfirmDialog';

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

// Per-row delete, the table-view counterpart to CardList's CardDeleteButton.
//
// Deliberately NOT lib/List's `rowButtons` toolbar mechanism, which acts on
// "the selected row": this List wires DetailsList's onActiveItemChanged to
// navigate to the show route, so a single click leaves the page before any
// toolbar button can be used. rowButtons only works for grids that don't
// navigate on select (the Shakers device lists). It's also the better fit
// here regardless — with two identically-named rows, "delete the selected
// one" is exactly the ambiguity the user is trying to resolve.
//
// Mounted only when dispatcher.delete exists, so useMutation is never called
// with an undefined document — the guard is on what is *rendered*, not on
// whether a hook runs.
const DeleteCell: React.FC<{ dispatcher: IDispatcher; name: Name; item: any }> = ({ dispatcher, name, item }) => {
  const [removeItem] = useMutation(dispatcher.delete, {
    refetchQueries: [{ query: dispatcher.list }],
  });
  // Typed structurally: Fluent's IButtonProps hands these handlers its own
  // union-typed MouseEvent/FocusEvent, and only the one method is needed.
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <IconButton
      iconProps={{ iconName: 'Delete' }}
      title={`Delete ${name.singular}`}
      // Both handlers: stopping the click alone still lets the row take focus
      // first, and focus is what drives onActiveItemChanged — i.e. the row
      // would navigate out from under the confirm dialog.
      onMouseDown={stop}
      onFocus={stop}
      onClick={async (e) => {
        e.stopPropagation();
        if (!(await confirmAsync(`Delete this ${name.singular}? This cannot be undone.`, { danger: true }))) return;
        removeItem({ variables: { id: item.id } });
      }}
    />
  );
};

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

  // The `get${name.plural}` default silently yields an empty list whenever
  // the display plural doesn't match the real resolver name — it shipped
  // broken twice that way (Groups wanted getDashGroups, Templates wanted
  // getDashTemplates), each invisible until the collection was non-empty,
  // because "no rows" looks exactly like "nothing here yet". Name the
  // mismatch instead of rendering a convincing empty table.
  if (import.meta.env?.DEV && items && items[queryName] === undefined) {
    const available = Object.keys(items).filter(k => !k.startsWith('__'));
    // eslint-disable-next-line no-console
    console.error(
      `[typical-admin] List for "${name.plural}" read no field "${queryName}" off the query result. ` +
      `Available: ${available.join(', ') || '(none)'}. ` +
      `Pass queryResultKey="${available[0] ?? '...'}" — the list is rendering empty, not failing.`,
    );
  }

  // Delete was reachable from the card view (CardList's per-card button) and
  // from the default Show page (Show.tsx mounts Delete.tsx), but not from
  // this table view — so an admin that defaults to `list` AND supplies a
  // custom `show` component had a fully wired dispatcher.delete and no way
  // to invoke it. That's exactly GroupsAdmin, which is how two identically
  // named dash groups became undeletable from the UI.
  const columns = dispatcher.delete
    ? {
      ...schemaDefinition.columns,
      __delete: {
        label: '',
        onRender: ({ values }: any) => <DeleteCell dispatcher={dispatcher} name={name} item={values} />,
      },
    }
    : schemaDefinition.columns;

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
              hideAdd: !!schemaDefinition.buttons?.add,
            })
          ) : (
            <Links
              name={name}
              dispatcher={dispatcher}
              hideAdd={!!schemaDefinition.buttons?.add}
            />
          )}
        </Stack>
      )}
      <DetailsList
        pageSize={pageSize}
        name={name.plural}
        schema={columns}
        onSelect={(item) => {
          navigate(`${pathname}/${item[idField ?? 'id']}/show`, item);
        }}
        items={items[queryName] || []}
        columnSelectable={columnSelectable}
        storageKey={storageKey}
        columnVisibilityStore={columnVisibilityStore}
        onAdd={schemaDefinition.buttons?.add && dispatcher.new ? () => navigate(`${pathname}/new`) : undefined}
        // The delete column is an action, not data — it must never be one of
        // the columns the column-picker can hide.
        alwaysVisibleColumns={
          dispatcher.delete ? [...(alwaysVisibleColumns ?? []), '__delete'] : alwaysVisibleColumns
        }
      />
      <br />
    </Stack>
  );
};
export default List;
