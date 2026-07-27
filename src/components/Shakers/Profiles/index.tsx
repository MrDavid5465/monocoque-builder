import React from 'react';
import ReactiveAdmin from '../../../lib/typical-admin-fabric';
import dispatcher, { name } from './queries';
import ProfilesList from './ProfilesList';

const profileSchema = {
  list: {
    columns: {
      name: { label: 'Name' },
      car: { label: 'Car' },
      game: { label: 'Game' },
    },
  },
  new: {
    name: { type: 'text', label: 'Name', required: true },
    car: { type: 'text', label: 'Car (optional)' },
    game: { type: 'text', label: 'Game (optional)' },
  },
  show: {
    name: { label: 'Name' },
    car: { label: 'Car' },
    game: { label: 'Game' },
  },
  edit: {
    name: { type: 'text', label: 'Name', required: true },
    car: { type: 'text', label: 'Car (optional)' },
    game: { type: 'text', label: 'Game (optional)' },
  },
};

const ProfilesAdmin: React.FC = () => (
  <ReactiveAdmin
    dispatcher={dispatcher}
    name={name}
    schemaDefinition={profileSchema}
    components={{ list: ProfilesList }}
  />
);

export default ProfilesAdmin;
