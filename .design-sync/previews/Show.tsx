import * as React from 'react';
import { gql } from '@apollo/client';
import { MockedProvider } from '@apollo/client/testing/react';
import { Show, Routes, Route, useNavigate } from 'denim';

// ReactiveAdmin's read-only detail slot. It takes the record id from the
// route (`useParams`) and fetches `get${name.singular}` — so a preview needs
// both a route carrying an :id and a mock for that query.
//
// Reached directly only when overriding the show slot; normally
// ReactiveAdmin renders it for you.

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

const mocks = [
  { request: { query: GET_CAR, variables: { id: '1' } }, result: { data: { getCar: car } }, delay: 0 },
];
const dispatcher = { list: GET_CARS, show: GET_CAR, edit: GET_CAR, delete: GET_CARS };
const schemaDefinition = {
  name: { label: 'Car' },
  class: { label: 'Class' },
  year: { label: 'Year' },
};

// Puts the card on a route that carries an :id, WITHOUT nesting a second
// Router (react-router throws on that, and the card renders blank). It
// navigates the shell's existing router, then matches with Routes/Route.
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

const AtShowRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AtRoute to="/cars/1/show" path="/cars/:id/show">
    {children}
  </AtRoute>
);

export const Detail = () => (
  <MockedProvider mocks={mocks} addTypename={false}>
    <AtShowRoute>
      <Show dispatcher={dispatcher} name={name} schemaDefinition={schemaDefinition} />
    </AtShowRoute>
  </MockedProvider>
);

// Without an edit document in the dispatcher the Links row drops its edit
// affordance — the dispatcher's shape gates behaviour, not just mutations.
export const ReadOnlyDispatcher = () => (
  <MockedProvider mocks={mocks} addTypename={false}>
    <AtShowRoute>
      <Show
        dispatcher={{ list: GET_CARS, show: GET_CAR }}
        name={name}
        schemaDefinition={schemaDefinition}
      />
    </AtShowRoute>
  </MockedProvider>
);
