import * as React from 'react';
import { gql } from '@apollo/client';
import { MockedProvider } from '@apollo/client/testing/react';
import { SwitchableList } from 'denim';

// Table view and card view behind one control, sharing a single header. It
// embeds ListScreen (with hideHeader) for the table and CardList for the
// cards; `defaultView` picks which one loads first, which is the variant
// axis worth showing since the toggle itself needs a click.

const GET_CARS = gql`
  query getCars {
    getCars {
      id
      name
      class
      year
      thumbnail
    }
  }
`;

// Inline SVG data URIs keep the card thumbnails self-contained — no network
// fetch during the headless render.
const shot = (bg: string, accent: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">
       <rect width="320" height="180" fill="${bg}"/>
       <path d="M30 140 C 80 50, 240 50, 290 140" stroke="${accent}" stroke-width="12" fill="none"/>
     </svg>`,
  );

const cars = [
  { id: '1', name: 'Porsche 963', class: 'LMDh', year: 2023, thumbnail: shot('#1b3a5c', '#f2c14e') },
  { id: '2', name: 'Ferrari SF-24', class: 'F1', year: 2024, thumbnail: shot('#5c1b1b', '#f2f2f2') },
  { id: '3', name: 'Corvette Z06 GT3.R', class: 'GT3', year: 2024, thumbnail: shot('#23405c', '#e8a33a') },
];

const name = { singular: 'Car', plural: 'Cars' };
const dispatcher = { list: GET_CARS, show: GET_CARS, edit: GET_CARS, new: GET_CARS };
const mocks = [
  { request: { query: GET_CARS }, result: { data: { getCars: cars } }, delay: 0 },
];
const schemaDefinition = {
  columns: {
    name: { label: 'Car' },
    class: { label: 'Class' },
    year: { label: 'Year' },
  },
  buttons: { add: true },
};

export const CardView = () => (
  <MockedProvider mocks={mocks} addTypename={false}>
    <SwitchableList
      dispatcher={dispatcher}
      name={name}
      schemaDefinition={schemaDefinition}
      titleField="name"
      thumbnailField="thumbnail"
      defaultView="card"
    />
  </MockedProvider>
);

export const TableView = () => (
  <MockedProvider mocks={mocks} addTypename={false}>
    <SwitchableList
      dispatcher={dispatcher}
      name={name}
      schemaDefinition={schemaDefinition}
      titleField="name"
      thumbnailField="thumbnail"
      defaultView="table"
    />
  </MockedProvider>
);
