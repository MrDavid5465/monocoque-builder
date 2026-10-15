import React from 'react';
import { AdminMasterDetail } from '../../lib/denim-fabric';
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

// Module level: AdminMasterDetail memoizes on them.
const labels = { singular: 'Dashboard group', plural: 'Dashboard groups' };
const listColumns = ['name', 'defaultDash'];
const listProps = { queryResultKey: 'getDashGroups', idField: 'id', columnSelectable: true, storageKey: 'groups-columns' };

// List | detail (denim-fabric's AdminMasterDetail): the list stays on screen
// beside the open record, and GroupEdit renders show/edit/new in the detail
// pane (a phone shows one pane at a time, with a back bar). Selection is the
// URL, so deep links (/dashboards/groups/<id>/show) keep working.
// queryResultKey: List defaults it to `get${name.plural}`, which is not the
// resolver's name here (it rendered an empty table once for that reason).
const GroupsAdmin: React.FC = () => (
  <AdminMasterDetail
    dispatcher={dispatcher}
    name={name}
    labels={labels}
    schemaDefinition={schemaDefinition}
    listColumns={listColumns}
    listProps={listProps}
    components={{
      show: GroupEdit,
      edit: GroupEdit,
      new: GroupEdit,
    }}
  />
);

export default GroupsAdmin;
