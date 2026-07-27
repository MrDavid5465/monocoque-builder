import React from 'react';
import { Link } from './lib';
import Links from './Links';
import { useQuery, useLocation } from './lib';
import {
  Name,
  IDispatcher,
  ITACallBacks,
  ListSchema,
  IComponents,
} from './';
import Subscriber from './Subscriber';
interface Props {
  dispatcher: IDispatcher;
  // match?: any;
  name: Name;
  schemaDefinition: ListSchema<any>;
  callBacks?: ITACallBacks;
  components?: IComponents;
}

const List: React.FC<Props> = ({
  dispatcher,
  name,
  schemaDefinition,
  components,
}) => {
  const { pathname } = useLocation()
  const queryName = `get${name.plural}`;
  const { data: items, error, loading, refetch } : { data?: any; error?: any; loading?: boolean; refetch?: () => void } = useQuery(dispatcher.list);
  if (error) {
    return <span>{`error: ${error}`}</span>;
  }

  if (loading) {
    return <span>{`loading...`}</span>;
  }

  return (
    <div>
      {dispatcher.subscribe && (
        <Subscriber
          document={dispatcher.subscribe}
          options={{
            onSubscriptionData: refetch,
          }}
        />
      )}
      <h4>Listing </h4>
      <table>
        <thead>
          <tr>
            {Object.entries(schemaDefinition.columns).map(([k, v]: any) => (
              <th key={k}>{v.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items[queryName].map((item: any, i: number) => {
            return (
              <tr key={item.id || i}>
                {Object.entries(schemaDefinition.columns).map(([k]: any) => (
                  <td key={k}>
                    {item[k].onRender
                      ? item[k].onRender({ value: item[k], values: item })
                      : item[k]}
                  </td>
                ))}
                <td>
                  <Link
                    to={`${pathname}/${item.id}/show`}
                    state={item}
                  >
                    {' '}
                    Show
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <hr />
      {components?.links ? (
        React.createElement(components.links, {
          // match,
          name,
          dispatcher,
        })
      ) : (
        <Links name={name} dispatcher={dispatcher} />
      )}
    </div>
  );
};
export default List;
