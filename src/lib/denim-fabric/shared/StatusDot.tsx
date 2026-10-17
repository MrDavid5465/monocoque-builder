// An application's status dot (the core's useAppStatus), drawn the same way
// under every Fluent bar: the sidebar beside each application (and over its
// icon in the rail), the top bar beside each application in the waffle
// panel. A bar exports it under the role name `StatusDot`
// (shared/barContract.ts). Nothing is drawn while the app has no status.
import React from 'react';
import { useTheme } from '@fluentui/react';
import type { ITheme } from '@fluentui/react';
import { useAppStatus } from '../../denim';
import type { IAppStatus } from '../../denim';
import type { StatusDotProps } from './barContract';

const DOT_COLOURS = (theme: ITheme): Record<IAppStatus['tone'], string> => ({
  ok: theme.palette.green,
  warning: theme.palette.yellowDark,
  error: theme.palette.red,
  busy: theme.palette.themePrimary,
  off: theme.palette.neutralTertiary,
});

export interface StatusDotOwnProps extends StatusDotProps {
  /** Pin the dot to the top right of a positioned parent (the sidebar's icon rail). */
  overlay?: boolean;
  /** Extra class (e.g. a margin where the parent has no gap). */
  className?: string;
}

/** The status dot of one application, or nothing while it has no status. */
export const StatusDot: React.FC<StatusDotOwnProps> = ({ app, overlay, className }) => {
  const status = useAppStatus(app);
  const theme = useTheme();
  if (!status) return null;
  const label = status.label ?? status.tone;
  return (
    <span
      role="img"
      aria-label={`${app.name}: ${label}`}
      title={label}
      className={className}
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        flex: 'none',
        background: DOT_COLOURS(theme)[status.tone],
        boxShadow: `0 0 0 2px ${theme.palette.neutralLighterAlt}`,
        ...(overlay ? { position: 'absolute', top: 8, right: 8 } : {}),
      }}
    />
  );
};

export default StatusDot;
