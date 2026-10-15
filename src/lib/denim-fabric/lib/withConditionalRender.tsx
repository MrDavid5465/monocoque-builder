import React, { ReactElement } from 'react';

export default function withConditionalRender(
  WrappedComponent: React.FC<any>
): React.FC<any> {
  return function(props: any): ReactElement | null {
    const and: boolean[] = props.and || [true];
    const or: boolean[] = props.or || [true];

    function reduceAnd() {
      return and.reduce((prev, curr) => prev && curr, true);
    }

    function reduceOr() {
      return or.reduce((prev, curr) => prev || curr, true);
    }
    return reduceAnd() && reduceOr()
      ? React.createElement(WrappedComponent, props)
      : null;
  };
}
