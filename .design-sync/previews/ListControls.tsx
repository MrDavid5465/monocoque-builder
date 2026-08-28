import * as React from 'react';
import { ListControls } from 'denim';

// The floating toolbar that sits over a List's grid. It is
// `position: absolute; top: 4; right: 4`, so it expects a
// `position: relative` ancestor — List provides that. Each cell here supplies
// its own relative frame with a stand-in grid behind it, which is the only
// way the toolbar reads as a toolbar rather than two icons in space.
//
// Everything it renders is an IconButton: counts appear in the Columns
// tooltip (`Columns (3/5)`), not as visible text. The column-picker panel
// itself opens on click, so it can't appear in a static preview.

const columnSelectSchema = {
  name: { type: 'checkbox', label: 'Car' },
  class: { type: 'checkbox', label: 'Class' },
  year: { type: 'checkbox', label: 'Year' },
  laps: { type: 'checkbox', label: 'Laps' },
};
const pickableKeys = ['name', 'class', 'year', 'laps'];
const allVisible = { name: true, class: true, year: true, laps: true };

// Stand-in for the grid the toolbar floats over.
const Frame: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      position: 'relative',
      width: 460,
      height: 140,
      border: '1px solid #edebe9',
      borderRadius: 4,
      background: '#fff',
    }}
  >
    <div style={{ display: 'flex', gap: 24, padding: '10px 12px', fontWeight: 600, fontSize: 12 }}>
      <span>Car</span>
      <span>Class</span>
      <span>Year</span>
      <span>Laps</span>
    </div>
    <div style={{ padding: '0 12px', fontSize: 12, opacity: 0.55, lineHeight: '22px' }}>
      <div>Porsche 963</div>
      <div>Ferrari SF-24</div>
      <div>Corvette Z06 GT3.R</div>
    </div>
    {children}
  </div>
);

export const WithAddButton = () => (
  <Frame>
    <ListControls
      visibleCount={4}
      totalCount={4}
      pickableKeys={pickableKeys}
      columnSelectSchema={columnSelectSchema}
      initialValues={allVisible}
      onColumnsChange={() => undefined}
      onAdd={() => undefined}
    />
  </Frame>
);

export const WithColumnPicker = () => (
  <Frame>
    <ListControls
      columnSelectable
      visibleCount={2}
      totalCount={4}
      pickableKeys={pickableKeys}
      columnSelectSchema={columnSelectSchema}
      initialValues={{ ...allVisible, year: false, laps: false }}
      onColumnsChange={() => undefined}
      onAdd={() => undefined}
    />
  </Frame>
);

// customButtons take {key, label, icon, onClick} — `icon` is a Fluent icon
// name. `danger` tints it red for destructive actions.
export const CustomActions = () => (
  <Frame>
    <ListControls
      columnSelectable
      visibleCount={4}
      totalCount={4}
      pickableKeys={pickableKeys}
      columnSelectSchema={columnSelectSchema}
      initialValues={allVisible}
      onColumnsChange={() => undefined}
      onAdd={() => undefined}
      customButtons={[
        { key: 'refresh', label: 'Reload devices', icon: 'Refresh', onClick: () => undefined },
        { key: 'export', label: 'Export CSV', icon: 'Download', onClick: () => undefined },
        { key: 'clear', label: 'Remove all', icon: 'Delete', danger: true, onClick: () => undefined },
      ]}
    />
  </Frame>
);
