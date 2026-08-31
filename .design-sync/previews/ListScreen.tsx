import * as React from 'react';
import { gql } from '@apollo/client';
import { MockedProvider } from '@apollo/client/testing/react';
import { ListScreen } from 'denim';

// The Apollo-bound list screen — it fetches its own rows, unlike the
// presentational `List`. It reads `get${name.plural}` off the query result
// (override with queryResultKey when the resolver name doesn't match the
// display plural), renders a "Listing {plural}" heading plus the Links row,
// and navigates to `<path>/<id>/show` on row click.
//
// Each cell supplies its own MockedProvider so the query actually resolves;
// the preview shell's provider has no mocks, which would leave this stuck on
// "loading...".

const GET_CARS = gql`
  query getCars {
    getCars {
      id
      name
      class
      year
    }
  }
`;

const cars = [
  { id: '1', name: 'Porsche 963', class: 'LMDh', year: 2023 },
  { id: '2', name: 'Ferrari SF-24', class: 'F1', year: 2024 },
  { id: '3', name: 'Corvette Z06 GT3.R', class: 'GT3', year: 2024 },
];

const mocks = [
  { request: { query: GET_CARS }, result: { data: { getCars: cars } }, delay: 0 },
];
const emptyMocks = [
  { request: { query: GET_CARS }, result: { data: { getCars: [] } }, delay: 0 },
];

const name = { singular: 'Car', plural: 'Cars' };
const dispatcher = { list: GET_CARS, show: GET_CARS, new: GET_CARS, edit: GET_CARS };
const schemaDefinition = {
  columns: {
    name: { label: 'Car' },
    class: { label: 'Class' },
    year: { label: 'Year' },
  },
  buttons: { add: true },
};

export const Populated = () => (
  <MockedProvider mocks={mocks} addTypename={false}>
    <ListScreen dispatcher={dispatcher} name={name} schemaDefinition={schemaDefinition} />
  </MockedProvider>
);

export const NoRows = () => (
  <MockedProvider mocks={emptyMocks} addTypename={false}>
    <ListScreen dispatcher={dispatcher} name={name} schemaDefinition={schemaDefinition} />
  </MockedProvider>
);

// hideHeader drops the built-in heading and Links row, for callers that
// embed this under their own shared header (SwitchableList does exactly this).
export const Embedded = () => (
  <MockedProvider mocks={mocks} addTypename={false}>
    <ListScreen
      dispatcher={dispatcher}
      name={name}
      schemaDefinition={schemaDefinition}
      hideHeader
    />
  </MockedProvider>
);
