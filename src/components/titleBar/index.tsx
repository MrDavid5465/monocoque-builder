import React from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
// import { div } from "../../lib/denim/lib";

export const TitleBar: React.FC = () => {
  const appWindow = getCurrentWindow();

  return (
    <div className="titlebar">
      <div className="title">Monocoque Editor</div>

      <div className="window-controls">
        <button onClick={() => appWindow.minimize()}>–</button>
        <button onClick={() => appWindow.toggleMaximize()}>□</button>
        <button onClick={() => appWindow.close()}>×</button>
      </div>
    </div>
  );
};
export default TitleBar;
