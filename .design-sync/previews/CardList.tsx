import * as React from 'react';
import { gql } from '@apollo/client';
import { MockedProvider } from '@apollo/client/testing/react';
import { CardList } from 'denim';

// The card-grid alternative to the table list. Same Apollo-bound contract as
// ListScreen, but each record renders as a ThumbnailCard: `titleField` names
// the schema key used as the card title and `thumbnailField` the one holding
// the image URL (both run through the field's own onRender if it defines one,
// which is how a schema turns a bare filename into a full URL).

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

export const CardGrid = () => (
  <MockedProvider mocks={mocks} addTypename={false}>
    <CardList
      dispatcher={dispatcher}
      name={name}
      schemaDefinition={schemaDefinition.columns}
      titleField="name"
      thumbnailField="thumbnail"
    />
  </MockedProvider>
);

// Omit thumbnailField for text-only cards.
export const TextOnlyCards = () => (
  <MockedProvider mocks={mocks} addTypename={false}>
    <CardList
      dispatcher={dispatcher}
      name={name}
      schemaDefinition={schemaDefinition.columns}
      titleField="name"
    />
  </MockedProvider>
);

export const NarrowCards = () => (
  <MockedProvider mocks={mocks} addTypename={false}>
    <CardList
      dispatcher={dispatcher}
      name={name}
      schemaDefinition={schemaDefinition.columns}
      titleField="name"
      thumbnailField="thumbnail"
      cardWidth={180}
    />
  </MockedProvider>
);
