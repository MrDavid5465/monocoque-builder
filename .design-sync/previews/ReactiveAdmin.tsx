import * as React from 'react';
import { gql } from '@apollo/client';
import { MockedProvider } from '@apollo/client/testing/react';
import { ReactiveAdmin, SwitchableList } from 'denim';

// THE composition unit. An app renders one of these with a `dispatcher` (gql
// documents per slot) and a `schemaDefinition` (fields per screen), and gets
// the whole list/show/new/edit router — no CRUD written by hand.
//
// Ported from this app's own CarsAdmin screen, which is the canonical usage.
// At the list route it renders the list slot; navigating to a row's /show or
// /new swaps in those slots automatically.

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
const ADD_CAR = gql`
  mutation addCar($values: CarInput!) {
    addCar(values: $values) {
      id
    }
  }
`;

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

const mocks = [{ request: { query: GET_CARS }, result: { data: { getCars: cars } }, delay: 0 }];
const name = { singular: 'Car', plural: 'Cars' };
const dispatcher = { list: GET_CARS, show: GET_CARS, edit: GET_CARS, new: ADD_CAR, delete: GET_CARS };

const carSchema = {
  name: { label: 'Car' },
  class: { label: 'Class' },
  year: { label: 'Year' },
};

// The whole screen from a schema: columns for the list, fields for show/edit/new.
const schemaDefinition = {
  list: { columns: carSchema, buttons: { add: true } },
  show: carSchema,
  edit: { name: { type: 'text', label: 'Car' }, class: { type: 'text', label: 'Class' } },
  new: { name: { type: 'text', label: 'Car' }, class: { type: 'text', label: 'Class' } },
};

export const CrudScreen = () => (
  <MockedProvider mocks={mocks} addTypename={false}>
    <ReactiveAdmin dispatcher={dispatcher} name={name} schemaDefinition={schemaDefinition} />
  </MockedProvider>
);

// The override contract: name only the slot you're replacing and the rest
// stay generated. Here the list slot becomes a SwitchableList; show/new/edit
// are untouched.
export const WithListSlotOverridden = () => (
  <MockedProvider mocks={mocks} addTypename={false}>
    <ReactiveAdmin
      dispatcher={dispatcher}
      name={name}
      schemaDefinition={schemaDefinition}
      components={{
        list: (props: any) => (
          <SwitchableList {...props} titleField="name" thumbnailField="thumbnail" defaultView="card" />
        ),
      }}
    />
  </MockedProvider>
);
