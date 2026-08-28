import * as React from 'react';
import { gql } from '@apollo/client';
import { MockedProvider } from '@apollo/client/testing/react';
import { Update, Routes, Route, useNavigate } from 'denim';

// ReactiveAdmin's edit slot: fetches the record by the route's :id, seeds a
// schema-driven form with it, and saves through the dispatcher's edit
// mutation. Needs both a route carrying an id and a mock for
// `get${name.singular}`.

const GET_CARS = gql`
  query getCars {
    getCars {
      id
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
const EDIT_CAR = gql`
  mutation updateCar($id: ID!, $values: CarInput!) {
    updateCar(id: $id, values: $values) {
      id
    }
  }
`;

const car = { id: '1', name: 'Porsche 963', class: 'LMDh', year: 2023 };
const name = { singular: 'Car', plural: 'Cars' };
const dispatcher = { list: GET_CARS, show: GET_CAR, edit: EDIT_CAR };
const mocks = [
  { request: { query: GET_CAR, variables: { id: '1' } }, result: { data: { getCar: car } }, delay: 0 },
];

const AtRoute: React.FC<{ to: string; path: string; children: React.ReactNode }> = ({
  to,
  path,
  children,
}) => {
  const navigate = useNavigate();
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    navigate(to, { replace: true });
    setReady(true);
  }, [navigate, to]);
  return ready ? (
    <Routes>
      <Route path={path} element={<>{children}</>} />
    </Routes>
  ) : null;
};

export const EditRecord = () => (
  <MockedProvider mocks={mocks} addTypename={false}>
    <AtRoute to="/cars/1/edit" path="/cars/:id/edit">
      <Update
        dispatcher={dispatcher}
        name={name}
        schemaDefinition={{
          name: { type: 'text', label: 'Car', required: true },
          class: { type: 'text', label: 'Class' },
          year: { type: 'number', label: 'Year' },
        }}
      />
    </AtRoute>
  </MockedProvider>
);

export const WithSelectField = () => (
  <MockedProvider mocks={mocks} addTypename={false}>
    <AtRoute to="/cars/1/edit" path="/cars/:id/edit">
      <Update
        dispatcher={dispatcher}
        name={name}
        schemaDefinition={{
          name: { type: 'text', label: 'Car' },
          class: {
            type: 'select',
            label: 'Class',
            options: [
              { text: 'LMDh', value: 'LMDh' },
              { text: 'GT3', value: 'GT3' },
              { text: 'F1', value: 'F1' },
            ],
          },
        }}
      />
    </AtRoute>
  </MockedProvider>
);
