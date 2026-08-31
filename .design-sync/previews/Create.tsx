import * as React from 'react';
import { gql } from '@apollo/client';
import { MockedProvider } from '@apollo/client/testing/react';
import { Create } from 'denim';

// ReactiveAdmin's "new" slot: a schema-driven form plus a save action. It
// only mutates on submit, so no query mock is needed to render it — the
// form comes straight from schemaDefinition.
//
// Reached directly only when overriding the new slot.

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
const GET_CAR = gql`
  query getCar($id: ID!) {
    getCar(id: $id) {
      id
      name
      class
      year
    }
  }
`;
const _car = { id: '1', name: 'Porsche 963', class: 'LMDh', year: 2023 };
const name = { singular: 'Car', plural: 'Cars' };

const ADD_CAR = gql`
  mutation addCar($values: CarInput!) {
    addCar(values: $values) {
      id
    }
  }
`;
const dispatcher = { list: GET_CARS, show: GET_CAR, new: ADD_CAR };

export const NewRecord = () => (
  <MockedProvider mocks={[]} addTypename={false}>
    <Create
      dispatcher={dispatcher}
      name={name}
      schemaDefinition={{
        name: { type: 'text', label: 'Car', required: true },
        class: { type: 'text', label: 'Class' },
        year: { type: 'number', label: 'Year' },
      }}
    />
  </MockedProvider>
);

export const WithSelectField = () => (
  <MockedProvider mocks={[]} addTypename={false}>
    <Create
      dispatcher={dispatcher}
      name={name}
      schemaDefinition={{
        name: { type: 'text', label: 'Car', required: true },
        class: {
          type: 'select',
          label: 'Class',
          options: [
            { text: 'LMDh', value: 'LMDh' },
            { text: 'GT3', value: 'GT3' },
            { text: 'F1', value: 'F1' },
          ],
        },
        active: { type: 'checkbox', label: 'Active in rotation' },
      }}
    />
  </MockedProvider>
);
