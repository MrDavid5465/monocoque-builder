import React from 'react';
import { useSubscription } from '@apollo/client/react';
import { DocumentNode } from 'graphql';

interface Props {
  document: DocumentNode;
  options: { variables?: any; onSubscriptionData: () => void };
}

const Subscriber: React.FC<Props> = ({ document, options }) => {
  useSubscription(document, options);
  return <></>;
};

export default Subscriber;
