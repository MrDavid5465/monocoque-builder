import React from 'react';
import { Route, Routes } from './lib';

import Update from './Update';
import List from './List';
import Create from './Create';
import Show from './Show';
import { SchemaDefinition } from '../per-form';

export interface Name {
  singular: string;
  plural: string;
}
export interface Row {
  value: any;
  values: any;
}
export interface DisplayField {
  label: string;
  onRender?: (row: Row) => any;
  options?: any;
}
export type DisplaySchema<T> = {
  [key in keyof T]: DisplayField;
};

export interface IDispatcher {
  list: any;
  new?: any;
  show: any;
  edit?: any;
  delete?: any;
  subscribe?: any;
  subscribeToOne?: any;
}
export interface ListButtons {
  // Explicit opt-in for a grid-level "Add" control (navigates to
  // `${pathname}/new`, requires dispatcher.new) — declared here rather than
  // inferred from dispatcher.new's truthiness the way the page-header Links
  // "+" still is, so a list's grid-level buttons are always exactly what its
  // schema says, not a side effect of which mutations the dispatcher happens
  // to define.
  add?: boolean;
}
export interface ListSchema<T> {
  buttons?: ListButtons;
  columns: DisplaySchema<T>;
}
export interface ITASchema {
  list: ListSchema<any>;
  new?: SchemaDefinition<any>;
  show: DisplaySchema<any>;
  edit?: SchemaDefinition<any>;
}

export interface ITACallBacks {
  new?: (result: any) => void;
  edit?: (result: any) => void;
  delete?: (result: any) => void;
}
export interface IComponents {
  list?: any;
  new?: any;
  show?: any;
  edit?: any;
  delete?: any;
  links?: any;
}

interface Props {
  dispatcher: IDispatcher;
  name: any;
  components?: IComponents;
  schemaDefinition: ITASchema;
  callBacks?: ITACallBacks;
}

const Index: React.FC<Props> = ({
  dispatcher,
  name,
  components = {},
  schemaDefinition,
  callBacks,
}) => {
  // const { pathname } = useLocation()
  return (
    <Routes>
      <Route
        // Wildcard (not exact "/") so a custom list component can render its
        // own nested <Routes> for sub-paths — needed by highly-specialized
        // list overrides (e.g. embedding a whole other router tree) that
        // don't fit the flat list/show/new/edit shape. Still matches bare
        // "/" fine, so this is backward compatible with plain list components
        // that don't use sub-paths.
        path={`/*`}
        element={components.list ? (
            React.createElement(components.list, {
              dispatcher,
              name,
              schemaDefinition: schemaDefinition.list,
              callBacks,
              components,
            })
          ) : (
            <List
              dispatcher={dispatcher}
              name={name}
              schemaDefinition={schemaDefinition.list}
              callBacks={callBacks}
              components={components}
            />
          )
        }
      />

      {dispatcher.new && schemaDefinition.new && (
        <Route
          path={`/new`}
          element={components.new ? (
              React.createElement(components.new, {
                dispatcher,
                name,
                schemaDefinition: schemaDefinition.new,
                callBacks,
                components,
              })
            ) : (
              <Create
                dispatcher={dispatcher}
                name={name}
                schemaDefinition={schemaDefinition.new}
                callBacks={callBacks}
                components={components}
              />
            )
          }
        />
      )}

      <Route
        path={`/:id/show`}
        element={components.show ? (
            React.createElement(components.show, {
              dispatcher,
              name,
              schemaDefinition: schemaDefinition.show,
              callBacks,
              components,
            })
          ) : (
            <Show
              dispatcher={dispatcher}
              name={name}
              schemaDefinition={schemaDefinition.show}
              callBacks={callBacks}
              components={components}
            />
          )
        }
      />

      {dispatcher.edit && schemaDefinition.edit && (
        <Route
          path={`/:id/edit`}
          element={components.edit ? (
              React.createElement(components.edit, {
                dispatcher,
                name,
                schemaDefinition: schemaDefinition.edit,
                callBacks,
                components,
              })
            ) : (
              <Update
                dispatcher={dispatcher}
                name={name}
                schemaDefinition={schemaDefinition.edit}
                callBacks={callBacks}
                components={components}
              />
            )
          }
        />
      )}
    </Routes>
  );
};
export default Index;
