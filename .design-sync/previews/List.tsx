import * as React from 'react';
import { List } from 'denim';

// The presentational list: it takes `items` you already have. (The
// Apollo-bound CRUD screen that fetches its own rows is ListScreen.)
// `schema` keys map to columns; a field's `onRender` transforms the cell
// value, which is how the app builds URLs and formats numbers.

const cars = [
  { id: '1', name: 'Porsche 963', class: 'LMDh', year: 2023, laps: 412 },
  { id: '2', name: 'Ferrari SF-24', class: 'F1', year: 2024, laps: 168 },
  { id: '3', name: 'Corvette Z06 GT3.R', class: 'GT3', year: 2024, laps: 96 },
  { id: '4', name: 'Porsche 911 GT1', class: 'GT1', year: 1997, laps: 54 },
  { id: '5', name: 'Volkswagen Golf MK7', class: 'TCR', year: 2017, laps: 231 },
];

const carSchema = {
  name: { label: 'Car' },
  class: { label: 'Class' },
  year: { label: 'Year' },
  laps: { label: 'Laps' },
};

export const Basic = () => <List name="cars" items={cars} schema={carSchema} />;

// Opt-in "Columns" picker — off by default, so it needs its own cell to be
// visible at all.
export const ColumnSelectable = () => (
  <List name="carsSelectable" items={cars} schema={carSchema} columnSelectable />
);

// onRender is where a schema formats a cell rather than the caller
// pre-formatting the rows.
export const RenderedCells = () => (
  <List
    name="sessions"
    items={[
      { id: 'a', track: 'Silverstone', best: 87.412, valid: true },
      { id: 'b', track: 'Monza', best: 101.883, valid: true },
      { id: 'c', track: 'Spa-Francorchamps', best: 138.204, valid: false },
    ]}
    schema={{
      track: { label: 'Track' },
      best: {
        label: 'Best lap',
        onRender: ({ value }: { value?: number }) =>
          value == null
            ? ''
            : `${Math.floor(value / 60)}:${(value % 60).toFixed(3).padStart(6, '0')}`,
      },
      valid: {
        label: 'Valid',
        onRender: ({ value }: { value?: boolean }) => (value ? 'Yes' : 'No'),
      },
    }}
  />
);

export const Empty = () => <List name="carsEmpty" items={[]} schema={carSchema} />;
