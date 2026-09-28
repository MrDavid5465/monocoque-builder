import React from 'react';
import Links from './Links';
import Delete from './Delete';
import { useQuery, useParams } from './lib';
import {
  Name,
  IDispatcher,
  ITACallBacks,
  DisplaySchema,
  IComponents,
} from './';
import Subscriber from './Subscriber';

interface Props {
  dispatcher: IDispatcher;
  name: Name;
  schemaDefinition: DisplaySchema<any>;
  callBacks?: ITACallBacks;
  components?: IComponents;
}

const Show: React.FC<Props> = ({
  dispatcher,
  name,
  schemaDefinition,
  callBacks,
  components,
}) => {
  const { id } = useParams();
  const queryName = `get${name.singular}`;
  const { data, error, loading, refetch } : { data?: any; error?: any; loading?: boolean; refetch?: () => void } = useQuery(dispatcher.show, {
    variables: { id },
  });

  if (error) {
    return <span>{`error: ${error}`}</span>;
  }

  if (loading) {
    return <span>{`loading...`}</span>;
  }

  return (
    <div>
      {(dispatcher.subscribe || dispatcher.subscribeToOne) && (
        <Subscriber
          document={dispatcher.subscribeToOne || dispatcher.subscribe}
          options={{
            variables:
              (dispatcher.subscribeToOne !== undefined && { id }) || {},
            onData: () => refetch(),
          }}
        />
      )}
      <h4>Showing {name.singular}</h4>
      {Object.entries(schemaDefinition).map(([k, v]: any) => {
        return (
          <p key={k}>
            <strong>{v.label}</strong>:{' '}
            {v.onRender
              ? v.onRender({
                  value: data[queryName][k],
                  values: data[queryName],
                })
              : data[queryName][k]}
          </p>
        );
      })}
      {dispatcher.delete &&
        (components?.delete ? (
          React.createElement(components.delete, {
            id,
            name,
            dispatcher,
            callBacks,
          })
        ) : (
          <Delete
            id={id}
            name={name}
            dispatcher={dispatcher}
            callBacks={callBacks}
          />
        ))}
      <hr />
      {components?.links ? (
        React.createElement(components.links, {
          name,
          dispatcher,
        })
      ) : (
        <Links name={name} dispatcher={dispatcher} />
      )}
    </div>
  );
};
export default Show;
