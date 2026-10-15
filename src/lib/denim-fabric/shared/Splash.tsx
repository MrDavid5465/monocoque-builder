import React from 'react';
import { getStyle } from '../lib';
import { getTheme } from '@fluentui/react';
import DenimLogo, { IconProps } from './Logo';

export interface SplashProps {
  /** The logo, drawn in the theme's foreground colour. */
  Icon?: React.FC<IconProps>;
  /**
   * Shown below the logo once the first load has failed (the core's
   * status "waiting"), not during the normal brief first fetch.
   */
  statusText?: string;
}

/** Full-page splash in the theme colour, shown until the core is ready. */
export const Splash: React.FC<SplashProps> = ({ Icon = DenimLogo, statusText }) => {
  const style = getStyle();
  const theme = getTheme();
  return (
    <div className={style.splashScreen} role="status" aria-live="polite">
      <header className={style.appHeader}>
        <Icon className={style.appLogo} />
        {statusText && (
          <div style={{ marginTop: '1em', fontSize: '0.9em', color: theme.palette.white, opacity: 0.85 }}>
            {statusText}
          </div>
        )}
      </header>
    </div>
  );
};

export default Splash;
