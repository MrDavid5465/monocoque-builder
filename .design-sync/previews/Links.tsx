import * as React from 'react';
import { gql } from '@apollo/client';
import { Links, Routes, Route, useNavigate } from 'denim';

// The contextual action row ReactiveAdmin puts beside a screen's heading.
// It branches entirely on the CURRENT ROUTE — /show, /edit, /new, or the
// list — and on which documents the dispatcher carries, so each cell has to
// put itself on the matching route.
//
// Navigating the shell's router (never nesting a second one — react-router
// throws on that and the card goes blank).

const Q = gql`
  query getCars {
    getCars {
      id
    }
  }
`;
const name = { singular: 'Car', plural: 'Cars' };
const full = { list: Q, show: Q, edit: Q, new: Q, delete: Q };

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

export const OnShowRoute = () => (
  <AtRoute to="/cars/1/show" path="/cars/:id/show">
    <Links name={name} dispatcher={full} />
  </AtRoute>
);

export const OnEditRoute = () => (
  <AtRoute to="/cars/1/edit" path="/cars/:id/edit">
    <Links name={name} dispatcher={full} />
  </AtRoute>
);

export const OnListRoute = () => (
  <AtRoute to="/cars" path="/cars">
    <Links name={name} dispatcher={full} />
  </AtRoute>
);

// Without an `edit` document the edit affordance disappears — the dispatcher's
// shape gates behaviour, not just which mutation fires.
export const NoEditDocument = () => (
  <AtRoute to="/cars/1/show" path="/cars/:id/show">
    <Links name={name} dispatcher={{ list: Q, show: Q }} />
  </AtRoute>
);
