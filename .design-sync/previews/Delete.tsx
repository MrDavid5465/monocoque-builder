import * as React from 'react';
import { gql } from '@apollo/client';
import { MockedProvider } from '@apollo/client/testing/react';
import { Delete } from 'denim';

// ReactiveAdmin's delete slot: a single destructive button that opens a
// confirmation before firing the mutation. Statically it is just the button —
// the confirmation opens on click.

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
const car = { id: '1', name: 'Porsche 963', class: 'LMDh', year: 2023 };
const name = { singular: 'Car', plural: 'Cars' };

const REMOVE_CAR = gql`
  mutation removeCar($id: ID!) {
    removeCar(id: $id) {
      id
    }
  }
`;

export const DeleteButton = () => (
  <MockedProvider mocks={[]} addTypename={false}>
    <Delete dispatcher={{ list: GET_CARS, show: GET_CAR, delete: REMOVE_CAR }} id="1" name={name} />
  </MockedProvider>
);
