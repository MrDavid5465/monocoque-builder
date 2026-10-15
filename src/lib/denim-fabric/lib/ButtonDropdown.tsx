import React from 'react';
import { PrimaryButton, DefaultButton } from '@fluentui/react';

export const ButtonDropdown: React.FC<any> = ({
  value,
  menuActions,
  color,
  ...props
}) => {
  const actions = {
    items: menuActions.map((a: any) => ({ text: a.value, ...a })),
  };
  switch (color) {
    case 'primary':
      return (
        <PrimaryButton split menuProps={actions} text={value} {...props} />
      );

    default:
      return (
        <DefaultButton split menuProps={actions} text={value} {...props} />
      );
  }
};
