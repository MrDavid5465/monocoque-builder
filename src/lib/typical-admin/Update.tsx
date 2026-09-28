import React, { createRef, useState } from 'react';
import { useMutation, useQuery, Form } from './lib';
import { Name, IDispatcher, ITACallBacks, IComponents } from './';
import Links from './Links';
import { SchemaDefinition } from '../per-form';
import Subscriber from './Subscriber';

interface Props {
  dispatcher: IDispatcher;
  history?: any;
  match?: any;
  name: Name;
  schemaDefinition?: SchemaDefinition<any>;
  callBacks?: ITACallBacks;
  components?: IComponents;
}

const Update: React.FC<Props> = ({
  dispatcher,
  history,
  match,
  name,
  schemaDefinition,
  callBacks,
  components,
}) => {
  const id = match.params.id;
  const queryName = `get${name.singular}`;
  const [isValid, setIsValid] = useState(false);
  const { data, error, loading, refetch } : { data?: any; error?: any; loading?: boolean; refetch?: () => void } = useQuery(dispatcher.show, {
    variables: { id },
  });
  const initialValues = !loading && !error && data && data[queryName];

  const [updateItem] = useMutation(dispatcher.edit, {
    onCompleted: (data: any) => {
      history.push(match.url.replace('edit', 'show'));
      callBacks?.edit?.(data && data[queryName]);
    },
    refetchQueries: [
      { query: dispatcher.show, variables: { id } },
      { query: dispatcher.list },
    ],
  });
  const editRef: React.RefObject<any> = createRef();
  function handleReset() {
    editRef.current.reset();
  }

  if (error) {
    return <span>{`error: ${error}`}</span>;
  }

  if (loading) {
    return <span>{`loading...`}</span>;
  }

  function handleSubmit() {
    editRef.current.isValid &&
      updateItem({ variables: { id, update: editRef.current.submit() } });
  }
  function handleChange() {
    setIsValid(editRef.current.isValid);
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
      <h4>Edit {name.singular}</h4>
      <Form
        ref={editRef}
        name={'update'}
        form={schemaDefinition || {}}
        initialValues={initialValues}
        onChange={handleChange}
      />
      <button onClick={handleReset}>Reset</button>
      <button onClick={handleSubmit} disabled={!isValid}>
        Submit
      </button>
      <hr />
      {components?.links ? (
        React.createElement(components.links, {
          match,
          name,
          dispatcher,
        })
      ) : (
        <Links name={name} dispatcher={dispatcher} />
      )}
    </div>
  );
};
export default Update;
