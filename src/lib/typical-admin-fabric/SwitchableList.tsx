import React, { useState } from 'react';
import { Stack, IconButton, getTheme } from './lib';
import List from './List';
import CardList from './CardList';
import Links from './Links';
import { IDispatcher, ListSchema, IComponents, Name } from '../typical-admin';
import { ColumnVisibilityStore } from './lib/columnVisibilityStore';

type ViewMode = 'list' | 'card';

const VIEW_STORAGE_PREFIX = 'admin-list-view-';

function readStoredView(name: Name, fallback: ViewMode): ViewMode {
  try {
    const raw = localStorage.getItem(`${VIEW_STORAGE_PREFIX}${name.plural}`);
    return raw === 'list' || raw === 'card' ? raw : fallback;
  } catch {
    return fallback;
  }
}

interface Props {
  dispatcher: IDispatcher;
  name: Name;
  schemaDefinition: ListSchema<any>;
  components?: IComponents;
  pageSize?: number;
  queryResultKey?: string;
  idField?: string;
  // Card-view-only rendering options.
  titleField: string;
  thumbnailField?: string;
  cardWidth?: number;
  thumbnailHeight?: number;
  thumbnailFit?: 'cover' | 'contain';
  defaultView?: ViewMode;
  // List-view-only — forwarded straight through to lib/List, see its own
  // doc comments. Card view has no notion of columns, so these are simply
  // unused there.
  columnSelectable?: boolean;
  storageKey?: string;
  columnVisibilityStore?: ColumnVisibilityStore;
  alwaysVisibleColumns?: string[];
}

// Drop-in for ReactiveAdmin's `list` slot (same contract as List.tsx/CardList.tsx)
// that adds a view-mode toggle between the standard schema-driven table and
// the thumbnail card grid. Owns one shared header (title + Links + toggle)
// and renders whichever inner list with hideHeader, so there's no duplicate
// "Listing X" row when switching views. The choice is remembered per
// section (keyed by name.plural) in localStorage.
const SwitchableList: React.FC<Props> = ({
  dispatcher,
  name,
  schemaDefinition,
  components,
  pageSize,
  queryResultKey,
  idField,
  titleField,
  thumbnailField,
  cardWidth,
  thumbnailHeight,
  thumbnailFit,
  defaultView = 'list',
  columnSelectable,
  storageKey,
  columnVisibilityStore,
  alwaysVisibleColumns,
}) => {
  const theme = getTheme();
  const [view, setView] = useState<ViewMode>(() => readStoredView(name, defaultView));

  const setViewPersisted = (next: ViewMode) => {
    setView(next);
    try { localStorage.setItem(`${VIEW_STORAGE_PREFIX}${name.plural}`, next); } catch { /* storage unavailable */ }
  };

  return (
    <Stack>
      <Stack horizontal horizontalAlign="space-between" verticalAlign="center">
        <h3>Listing {name.plural}</h3>
        <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 4 }}>
          <IconButton
            iconProps={{ iconName: 'BulletedList' }}
            title="List view"
            onClick={() => setViewPersisted('list')}
            style={{ color: view === 'list' ? theme.palette.themePrimary : undefined }}
          />
          <IconButton
            iconProps={{ iconName: 'GridViewMedium' }}
            title="Card view"
            onClick={() => setViewPersisted('card')}
            style={{ color: view === 'card' ? theme.palette.themePrimary : undefined }}
          />
          {components?.links ? (
            React.createElement(components.links, { name, dispatcher })
          ) : (
            <Links name={name} dispatcher={dispatcher} />
          )}
        </Stack>
      </Stack>

      {view === 'card' ? (
        <CardList
          dispatcher={dispatcher}
          name={name}
          schemaDefinition={schemaDefinition.columns}
          components={components}
          pageSize={pageSize}
          queryResultKey={queryResultKey}
          idField={idField}
          titleField={titleField}
          thumbnailField={thumbnailField}
          cardWidth={cardWidth}
          thumbnailHeight={thumbnailHeight}
          thumbnailFit={thumbnailFit}
          hideHeader
        />
      ) : (
        <List
          dispatcher={dispatcher}
          name={name}
          schemaDefinition={schemaDefinition}
          components={components}
          pageSize={pageSize}
          queryResultKey={queryResultKey}
          idField={idField}
          hideHeader
          columnSelectable={columnSelectable}
          storageKey={storageKey}
          columnVisibilityStore={columnVisibilityStore}
          alwaysVisibleColumns={alwaysVisibleColumns}
        />
      )}
    </Stack>
  );
};

export default SwitchableList;
