import React from 'react';
import ReactiveAdmin from '../../lib/typical-admin-fabric';
import SwitchableList from '../../lib/typical-admin-fabric/SwitchableList';
import GroupEdit from './GroupEdit';
import { GET_DASH_GROUPS, ADD_DASH_GROUP, REMOVE_DASH_GROUP } from '../Telemetry/Groups/queries';

// dispatcher.show/edit/new are structurally required by IDispatcher/ITASchema
// but not actually read — GroupEdit is a fully custom component (name +
// default dashboard + a hand-coded per-car override list) that does its own
// fetching/mutating, same rationale as CarsAdmin's show/edit/new.
// dispatcher.delete IS read directly by typical-admin-fabric's CardList
// (list view) — no companion schemaDefinition.delete key needed.
const dispatcher = { list: GET_DASH_GROUPS, show: GET_DASH_GROUPS, edit: GET_DASH_GROUPS, new: ADD_DASH_GROUP, delete: REMOVE_DASH_GROUP };
const name = { singular: 'Group', plural: 'Groups' };
const groupSchema = {
  name: { label: 'Name' },
  defaultDash: { label: 'Default dashboard' },
};
const schemaDefinition = { list: { columns: groupSchema, buttons: { add: true } }, show: {}, edit: {}, new: {} };

// No natural thumbnail for a group — table view, not the card/thumbnail view
// DashboardsAdmin/CarsAdmin use.
const GroupsAdmin: React.FC = () => (
  <ReactiveAdmin
    dispatcher={dispatcher}
    name={name}
    schemaDefinition={schemaDefinition}
    components={{
      list: (props: any) => (
        <SwitchableList
          {...props}
          titleField="name"
          idField="id"
          // List defaults the result key to `get${name.plural}` — "getGroups"
          // here — but the resolver is `getDashGroups`, so every row was
          // silently dropped and the table rendered headers with no rows.
          // Invisible until this repo actually had a group to list.
          queryResultKey="getDashGroups"
          defaultView="list"
          columnSelectable
          storageKey="groups-columns"
        />
      ),
      show: GroupEdit,
      edit: GroupEdit,
      new: GroupEdit,
    }}
  />
);

export default GroupsAdmin;
