import React from "react";
// import '../App.scss';
import "@fluentui/react";
import {
  Fabric,
  getStyle,
  loadTheme,
  Stack,
  Route,
  Routes,
  Navigate,
  useQuery
} from "../lib";
import { Header } from "./Header";
import Splashscreen from "./Splashscreen";
import { IMy } from "../lib/queries";
import dispatcher from "../lib/queries";
import IconSVG, { IconProps } from "../logo";

const THEME_CACHE_KEY = 'denim-theme';

function readThemeCache(): { theme: string; fontSize: number } | null {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeThemeCache(settings: { theme?: string; fontSize?: number }) {
  try {
    if (settings.theme) {
      localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({
        theme: settings.theme,
        fontSize: settings.fontSize ?? 1,
      }));
    }
  } catch {}
}

// Keeps the browser tab favicon in sync with the user's selected theme
// color. Rendered as a data URI rather than reusing /logo.svg because the
// desktop app icon (generated from that static file via `tauri icon`)
// can't be re-colored at runtime, but the favicon can and should track
// whichever of the 12 theme colors is currently active.
const FAVICON_SVG = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">` +
  `<path d="M 24 73 A 32 32 0 1 1 56 73 L 50 62 A 20 20 0 1 0 30 62 Z" fill="${color}"/>` +
  `<path d="M 42 44 L 41 48 L 38 46 L 32 22 Z" fill="${color}"/>` +
  `<circle cx="40" cy="45" r="3" fill="${color}"/>` +
  `</svg>`;

function setFaviconColor(color: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/svg+xml";
  link.href = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG(color))}`;
}

export const setTheme = (theme: any, themes: any) => {
  const key = (theme && theme.theme) || "default";
  const build = themes[key] || themes.default;
  const builtTheme = build(theme.fontSize || 1);
  loadTheme(builtTheme);
  if (builtTheme?.palette?.themePrimary) {
    setFaviconColor(builtTheme.palette.themePrimary);
  }
};

interface Props {
  components?: any;
  RootComponent?: any;
  themes: any;
  Logo?: React.FC<IconProps>;
  Brand?: React.FC<any>;
  Controls?: React.FC<any>;
  ExternalApps?: React.FC<any>;
}
const App: React.FC<Props> = ({
  components = {},
  themes,
  Logo = IconSVG,
  Brand,
  RootComponent,
  Controls,
  ExternalApps
}) => {
  const { loading, data } : { loading?: boolean, data?: IMy } = useQuery(dispatcher.my);
  if (loading || !data) {
    setTheme(readThemeCache() ?? { theme: "default", fontSize: 1 }, themes);
    return <Splashscreen Icon={Logo} />;
  }
  const settings = (data && data.my && data.my.settings) || {};
  writeThemeCache(settings);
  setTheme(settings || { theme: "default", fontSize: 1 }, themes);
  const style = getStyle();
  return (
    <Fabric
      key={`${data && data.my && data.my.settings && data.my.settings.theme}${
        data?.my?.settings?.fontSize
      }`}
      applyTo="body"
    >
      <Routes>
        <Route
          path={"kiosk/*"}
          element={
              <></>
            
          }
        />
        <Route
          path={"*"}
          element={
            <Header
              my={data && data.my}
              Brand={Brand}
              Controls={Controls}
              ExternalApps={ExternalApps}
            />
          }
        />
      </Routes>
      <Routes>
        <Route
          path={"*"}
          //exact
          element={
            <Stack className={style.content}>
              {RootComponent ? (
                <>
                  <RootComponent />
                </>
              ) : data &&
                data.my &&
                data.my.settings &&
                data.my.settings.launchPage ? (
                <Navigate to={`/${data.my.settings.launchPage}`} />
              ) : (
                <Stack>
                  <h1>Welcome, Click the waffle icon to begin!</h1>
                </Stack>
              )}
            </Stack>
          }
        />
        {data &&
          data.my &&
          data.my.applications &&
          data.my.applications.map((app, i) => {
            const Empty: React.FC = () => <Stack />;
            return (
              <Route
                key={i}
                path={`${app.path}/*`}
                element={
                    <Stack className={style.content}>
                      {app.defaultRoute && (
                        <Navigate to={`/${app.path}/${app.defaultRoute}`} />
                      )}
                      {React.createElement(components[app.frontEnd] || Empty, {
                        app
                      })}
                    </Stack>
                  
                }
              />
            );
          })}
        {data &&
          data.my &&
          data.my.applications &&
          data.my.applications.map((app, i) => {
            const Empty: React.FC = () => <Stack />;
            return (
              <Route
                key={i}
                path={`/kiosk/${app.path}`}
                element={
                    <Stack className={style.content} style={{ top: "0em" }}>
                      {app.defaultRoute && (                    
                        <Navigate
                          to={`/kiosk/${app.path}/${app.defaultRoute}`}
                        />
                      )}
                      {React.createElement(components[app.frontEnd] || Empty, {
                        app
                      })}
                    </Stack>
                }
              />
            );
          })}
      </Routes>
    </Fabric>
  );
};

export default App;
