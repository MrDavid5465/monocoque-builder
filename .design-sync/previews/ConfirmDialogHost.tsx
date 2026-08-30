import * as React from 'react';
import { ConfirmDialogHost, confirmAsync } from 'denim';

// The host renders nothing until something calls confirmAsync(), so a bare
// <ConfirmDialogHost /> would be an empty card. Each cell mounts the host and
// immediately opens it — that dialog IS the component's visible surface.
//
// Mount this once at the app root; call confirmAsync() from anywhere.

const Opener: React.FC<{ message: string; options?: any }> = ({ message, options }) => {
  React.useEffect(() => {
    void confirmAsync(message, options);
  }, [message, options]);
  return <ConfirmDialogHost />;
};

// The default confirm label is "Delete", so a non-destructive prompt should
// pass its own confirmText.
export const Confirm = () => (
  <Opener
    message="Apply these gamma values to all four channels?"
    options={{ title: 'Apply gamma', confirmText: 'Apply' }}
  />
);

export const Destructive = () => (
  <Opener
    message="Delete the 963 endurance dashboard? This can't be undone."
    options={{ title: 'Delete dashboard', confirmText: 'Delete', danger: true }}
  />
);

export const CustomLabels = () => (
  <Opener
    message="Monocoque is still driving. Stop it before switching profiles?"
    options={{ title: 'Stop Monocoque', confirmText: 'Stop and switch', cancelText: 'Keep running' }}
  />
);
