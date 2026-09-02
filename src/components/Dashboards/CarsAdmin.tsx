import React from 'react';
import { useMutation } from '@apollo/client/react';
import { IconButton, getTheme } from '../../lib/denim/lib';
import ReactiveAdmin from '../../lib/typical-admin-fabric';
import SwitchableList from '../../lib/typical-admin-fabric/SwitchableList';
import CarShow from './CarShow';
import CarNew from './CarNew';
import { GET_CARS, ADD_CAR, DELETE_CAR, SET_FAVORITE_CAR, CarRecord } from '../Telemetry/carQueries';

function apiBase() {
  return `http://${window.location.hostname}:9000`;
}

// dispatcher.show/edit/new and schemaDefinition.show/edit/new are structurally
// required by IDispatcher/ITASchema but not actually read here — CarShow/CarNew
// are fully custom components that do their own fetching/mutating, same
// rationale as DashboardsAdmin's show/edit.
const dispatcher = { list: GET_CARS, show: GET_CARS, edit: GET_CARS, new: ADD_CAR, delete: DELETE_CAR };
const name = { singular: 'Car', plural: 'Cars' };
const carSchema = {
  name: { label: 'Name' },
  thumbnail: {
    label: 'Thumbnail',
    onRender: ({ value }: { value?: string }) =>
      value ? `${apiBase()}/thumbnails/${encodeURIComponent(value)}` : undefined,
  },
};
const schemaDefinition = { list: { columns: carSchema, buttons: { add: true } }, show: carSchema, edit: {}, new: {} };

/// Star toggle shown in each car card's header, above the thumbnail.
///
/// Its own component so it can hold the mutation hook — a hook can't be
/// called from inside the `cardActions` render callback.
///
/// Refetches the list rather than relying on cache normalisation: setting a
/// favourite clears the flag on every *other* car too, and the mutation's
/// response only describes the one that was promoted.
const FavoriteStar: React.FC<{ car: CarRecord }> = ({ car }) => {
  const [setFavorite] = useMutation(SET_FAVORITE_CAR, { refetchQueries: [{ query: GET_CARS }] });
  const theme = getTheme();
  const isFavorite = !!car.favorite;

  return (
    <IconButton
      iconProps={{ iconName: isFavorite ? 'FavoriteStarFill' : 'FavoriteStar' }}
      title={isFavorite ? `${car.name} is the default car` : `Make ${car.name} the default car`}
      style={{ color: isFavorite ? theme.palette.themePrimary : undefined }}
      onClick={(e) => {
        // The card navigates on click, so the star must not bubble.
        e.stopPropagation();
        // Clicking the current favourite clears it rather than being a no-op.
        setFavorite({ variables: { id: car.id, favorite: !isFavorite } });
      }}
    />
  );
};

const CarsAdmin: React.FC = () => (
  <ReactiveAdmin
    dispatcher={dispatcher}
    name={name}
    schemaDefinition={schemaDefinition}
    components={{
      list: (props: any) => (
        <SwitchableList
          {...props}
          titleField="name"
          thumbnailField="thumbnail"
          defaultView="card"
          cardActions={(car: CarRecord) => <FavoriteStar car={car} />}
        />
      ),
      show: CarShow,
      edit: CarShow,
      new: CarNew,
    }}
  />
);

export default CarsAdmin;
