import React from 'react';
import { getStyle, getTheme } from '../../lib';

interface Props {
  Icon: React.FC<any>;
  // Shown below the logo once the initial load has actually failed (not
  // during the normal brief first-fetch) — see App's useHealthPoll call.
  // Undefined/empty renders nothing, so this stays a no-op for every other
  // caller of this component.
  statusText?: string;
}

const Index: React.FC<Props> = ({ Icon, statusText }) => {
  const style = getStyle();
  const theme = getTheme();
  return (
    <div className={style.splashScreen}>
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

export default Index;
