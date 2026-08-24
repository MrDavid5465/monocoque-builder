import React, { useState } from 'react';
import { Stack, IconButton, Icon, getTheme, ThumbnailCard, useQuery, useMutation, useNavigate, useLocation } from './lib';
import Links from './Links';
import { IDispatcher, DisplaySchema, IComponents, Name } from '../typical-admin';
import Subscriber from '../typical-admin/Subscriber';
import { confirmAsync } from '../denim/components/ConfirmDialog';

interface Props {
  dispatcher: IDispatcher;
  name: Name;
  schemaDefinition: DisplaySchema<any>;
  components?: IComponents;
  pageSize?: number;
  // Schema key rendered as each card's title (through the field's onRender,
  // same as the DetailsList-based default List, if one is defined).
  titleField: string;
  // Schema key holding an image URL for the card thumbnail. Omit for
  // text-only cards (title + actions, no image). Also runs through the
  // field's onRender if defined, same as titleField — lets a schema build a
  // full URL out of a bare filename.
  thumbnailField?: string;
  cardWidth?: number;
  thumbnailHeight?: number;
  // Passed straight through to ThumbnailCard — see its own doc comment.
  thumbnailFit?: 'cover' | 'contain';
  // Overrides the query's result field — defaults to `get${name.plural}`.
  // Needed when the display-plural label doesn't match the actual resolver name.
  queryResultKey?: string;
  // Suppresses the built-in "Listing X" heading + Links row, for callers
  // embedding CardList inline with their own section heading instead of
  // through full ReactiveAdmin routing.
  hideHeader?: boolean;
  // Which item field goes into the show/edit-route URLs — defaults to 'id'.
  // Some records (e.g. dashboards) are keyed by a human-readable name
  // elsewhere in the app; this lets the URL match that convention. Never
  // affects the delete mutation, which always uses the real item.id.
  idField?: string;
}

// Only mounted when dispatcher.delete exists — useMutation must never be
// called with an undefined document, so the mutation lives in a component
// that's conditionally *rendered*, not conditionally *invoked*, mirroring how
// Show.tsx only ever mounts the standalone Delete.tsx when dispatcher.delete
// is set rather than guarding a hook call inline.
const CardDeleteButton: React.FC<{ dispatcher: IDispatcher; name: Name; item: any }> = ({ dispatcher, name, item }) => {
  const [removeItem] = useMutation(dispatcher.delete, {
    refetchQueries: [{ query: dispatcher.list }],
  });
  return (
    <IconButton
      iconProps={{ iconName: 'Delete' }}
      title={`Delete ${name.singular}`}
      onClick={async (e) => {
        e.stopPropagation();
        if (!(await confirmAsync(`Delete this ${name.singular}? This cannot be undone.`, { danger: true }))) return;
        removeItem({ variables: { id: item.id } });
      }}
    />
  );
};

// Drop-in replacement for the DetailsList-based default List — same
// ReactiveAdmin contract (dispatcher/name/schemaDefinition/components), same
// query + live-subscription + Links header, but renders items as a card grid
// (via the shared ThumbnailCard) instead of a table. Pass as
// components={{ list: (props) => <CardList {...props} titleField="name" thumbnailField="thumbnail" /> }}.
const CardList: React.FC<Props> = ({
  dispatcher,
  name,
  schemaDefinition,
  components,
  pageSize,
  titleField,
  thumbnailField,
  cardWidth,
  thumbnailHeight,
  thumbnailFit,
  queryResultKey,
  hideHeader,
  idField,
}) => {
  const theme = getTheme();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const queryName = queryResultKey ?? `get${name.plural}`;
  const { data, error, loading, refetch }: { data?: any; error?: any; loading?: boolean; refetch?: () => void } =
    useQuery(dispatcher.list);

  if (error) {
    return <span>{`error: ${error}`}</span>;
  }
  if (loading) {
    return <span>{`loading...`}</span>;
  }

  const items: any[] = data?.[queryName] ?? [];
  const pageItems = pageSize ? items.slice(page * pageSize, (page + 1) * pageSize) : items;
  const titleSchema = (schemaDefinition as any)[titleField];
  const thumbnailSchema = thumbnailField ? (schemaDefinition as any)[thumbnailField] : undefined;

  return (
    <Stack>
      {dispatcher.subscribe && (
        <Subscriber
          document={dispatcher.subscribe}
          options={{ onSubscriptionData: () => refetch && refetch() }}
        />
      )}
      {!hideHeader && (
        <Stack horizontal horizontalAlign="space-between" verticalAlign="center">
          <h3>Listing {name.plural}</h3>
          {components?.links ? (
            React.createElement(components.links, { name, dispatcher })
          ) : (
            <Links name={name} dispatcher={dispatcher} />
          )}
        </Stack>
      )}

      <Stack horizontal wrap tokens={{ childrenGap: 16 }}>
        {pageItems.map((item) => {
          const title = titleSchema?.onRender
            ? titleSchema.onRender({ value: item[titleField], values: item })
            : item[titleField];
          const thumbnailUrl = thumbnailField
            ? (thumbnailSchema?.onRender
                ? thumbnailSchema.onRender({ value: item[thumbnailField], values: item })
                : item[thumbnailField])
            : undefined;
          const routeId = item[idField ?? 'id'];
          return (
            <ThumbnailCard
              key={item.id}
              width={cardWidth}
              thumbnailHeight={thumbnailHeight}
              fit={thumbnailFit}
              title={String(title ?? '')}
              thumbnailUrl={thumbnailUrl}
              onThumbnailClick={() => navigate(`${pathname}/${routeId}/show`)}
              actions={
                (dispatcher.edit || dispatcher.delete) ? (
                  <>
                    {dispatcher.edit && (
                      <IconButton
                        iconProps={{ iconName: 'Settings' }}
                        title={`Edit ${name.singular}`}
                        onClick={(e) => { e.stopPropagation(); navigate(`${pathname}/${routeId}/edit`); }}
                      />
                    )}
                    {dispatcher.delete && <CardDeleteButton dispatcher={dispatcher} name={name} item={item} />}
                  </>
                ) : undefined
              }
            />
          );
        })}
      </Stack>

      {pageItems.length === 0 && (
        <span style={{ opacity: 0.6, padding: '1em 0' }}>No {name.plural.toLowerCase()} yet.</span>
      )}

      {pageSize && items.length > pageSize && (
        <Stack horizontal horizontalAlign="end" verticalAlign="center" style={{ marginTop: '0.5em' }}>
          <IconButton disabled={page === 0} onClick={() => setPage(page - 1)}>
            <Icon iconName="Remove" />
          </IconButton>
          <IconButton
            disabled={items.length - page * pageSize <= pageSize}
            onClick={() => setPage(page + 1)}
          >
            <Icon iconName="Add" />
          </IconButton>
          <span style={{ color: theme.palette.neutralSecondary, fontSize: '0.85em' }}>
            Page {page + 1} of{' '}
            {items.length % pageSize ? Math.floor(items.length / pageSize) + 1 : Math.floor(items.length / pageSize)}
          </span>
        </Stack>
      )}
    </Stack>
  );
};

export default CardList;
