# denim-fabric-sidebar

The sidebar for [denim-fabric](https://github.com/MrDavid5465/denim-fabric),
the [Fluent UI v8](https://developer.microsoft.com/en-us/fluentui) skin of
the [Denim](https://github.com/MrDavid5465/denim) app shell. A
configuration-app layout:

- applications listed under group headings, with icons and status dots;
- the active application's links under it (on a phone, in the full-screen
  menu, which is also how you move between an app's pages);
- your always-visible `Controls` and Settings in the sidebar footer (and
  `Controls` in the phone's top bar);
- wide, medium and phone layouts, touch-friendly, with brief motion.

It is one of denim-fabric's interchangeable bars. It exports **exactly the
same members as
[denim-fabric-topbar](https://github.com/MrDavid5465/denim-fabric-topbar)**
(`Shell`, the default export, the role exports `Bar`, `BarNav`, `BarLink`,
`AppSwitcher` and `StatusDot`, and everything from denim-fabric and the
core), so switching bars is an import-path change. An app clones one bar
and ships only that one.

Consumed as source (no build step, no npm package).

## Using with an AI coding agent

Before writing any code with the sidebar, read:

- its skill,
  [`.claude/skills/denim-fabric-sidebar/SKILL.md`](./.claude/skills/denim-fabric-sidebar/SKILL.md);
- denim-fabric's `.claude/skills/denim-fabric/SKILL.md` (master-detail,
  the layout hook, `FullBleed`, theming, the Settings dialog,
  `getStyle()`) and, before changing this bar or writing another,
  `.claude/skills/write-a-denim-skin/SKILL.md`;
- denim's `.claude/skills/denim-app-shell/SKILL.md` (applications, groups
  and icons, routes, settings, status dots, the server contract);
- typical-admin-fabric's `.claude/skills/` (`reactive-admin`,
  `form-schema`, `list-schema`, `hand-rolled-components`,
  `playwright-verify`) and typiql-rs's `.claude/skills/typiql-api`.

Skills in a cloned repository are not loaded automatically unless the agent
was started inside that repository, so open the `SKILL.md` files directly.

## Layout: clone the libraries side by side

The packages import each other by relative path (`../denim`,
`../denim-fabric`, ...), so they must be sibling folders:

```
your-app/src/lib/denim/
your-app/src/lib/denim-fabric/
your-app/src/lib/denim-fabric-sidebar/
your-app/src/lib/typical-admin/
your-app/src/lib/typical-admin-fabric/
your-app/src/lib/per-form/
```

```sh
cd your-app/src/lib
git clone https://github.com/MrDavid5465/denim
git clone https://github.com/MrDavid5465/denim-fabric
git clone https://github.com/MrDavid5465/denim-fabric-sidebar
git clone https://github.com/MrDavid5465/typical-admin
git clone https://github.com/MrDavid5465/typical-admin-fabric
git clone https://github.com/MrDavid5465/per-form
```

(or add them as git submodules at those paths, or copy them in). The peer
npm packages are in denim-fabric's README.

## Minimal setup

`vite.config.ts`, `src/apollo.ts`, `src/main.tsx` and
`src/admin/ProjectsAdmin.tsx` are denim-fabric's
[Minimal setup](https://github.com/MrDavid5465/denim-fabric#minimal-setup),
and `src/admin/DevicesAdmin.tsx` (a ReactiveAdmin screen in list | detail
panes) is in its [Master-detail](https://github.com/MrDavid5465/denim-fabric#master-detail)
section. Then:

**`src/App.tsx`**

```tsx
import Shell from './lib/denim-fabric-sidebar';
import DevicesAdmin from './admin/DevicesAdmin';
import ProjectsAdmin from './admin/ProjectsAdmin';
import LayoutDesigner from './designer/LayoutDesigner';
import About from './About';
import RigControls from './RigControls';
import { useRigStatus } from './rigStatus';

// The sidebar lists my.applications under their `group` headings with their
// `icon`s; applications without a group go under `defaultGroup`.
export default function App() {
  return (
    <Shell
      title="Rig Config"
      settingsSource="server"
      defaultGroup="System"
      useAppStatus={useRigStatus}
      Controls={RigControls}
      components={{
        devices: DevicesAdmin,      // ReactiveAdmin in list | detail panes
        designer: LayoutDesigner,   // not a list: takes the whole content area
        projects: ProjectsAdmin,    // a plain ReactiveAdmin page
        about: About,
      }}
    />
  );
}
```

**`src/rigStatus.ts`**: the status-dot hook (called once per application).

```ts
import { gql } from '@apollo/client';
import { useQuery } from '@apollo/client/react';
import type { IApplication, IAppStatus } from './lib/denim-fabric-sidebar';

const GET_DEVICES = gql`query getDevices { getDevices { id name kind port enabled } }`;

// Devices turns amber while any device is disabled.
export function useRigStatus(app: IApplication): IAppStatus | undefined {
  const isDevices = app.path === 'devices';
  const { data } = useQuery<any>(GET_DEVICES, { skip: !isDevices });
  if (!isDevices || !data) return undefined;
  return data.getDevices.some((d: any) => !d.enabled)
    ? { tone: 'warning', label: 'A device is disabled' }
    : { tone: 'ok', label: 'All devices enabled' };
}
```

**`src/RigControls.tsx`**: always-visible controls: the sidebar's footer
(full, rail and the phone's menu) and the phone's top bar.

```tsx
import { FontIcon, useTheme } from '@fluentui/react';

// Keep it presentational: the bar may mount it twice at once (the rail and
// the panel during the collapse slide). Side effects belong elsewhere.
export default function RigControls() {
  const theme = useTheme();
  return (
    <FontIcon
      iconName="PlugConnected"
      title="Rig connected"
      aria-label="Rig connected"
      style={{ fontSize: 18, color: theme.palette.green }}
    />
  );
}
```

**`src/designer/LayoutDesigner.tsx`**: an application that isn't a list.
`FullBleed` cancels the content padding so it fills the area; it owns its
own toolbar (there are no global Save/Revert buttons), and reports its own
status dot.

```tsx
import { useState } from 'react';
import { DefaultButton, Stack, useTheme } from '@fluentui/react';
import { FullBleed, useReportAppStatus } from '../lib/denim-fabric-sidebar';
import type { IApplication } from '../lib/denim-fabric-sidebar';

export default function LayoutDesigner({ app }: { app: IApplication }) {
  const theme = useTheme();
  const [boxes, setBoxes] = useState([{ x: 40, y: 40 }, { x: 220, y: 120 }]);
  const [dirty, setDirty] = useState(false);
  useReportAppStatus(app.path, dirty ? { tone: 'warning', label: 'Unsaved layout' } : undefined);

  return (
    <FullBleed style={{ display: 'flex', flexDirection: 'column' }}>
      <Stack horizontal tokens={{ childrenGap: 8, padding: 8 }} style={{ borderBottom: `1px solid ${theme.palette.neutralLight}` }}>
        <DefaultButton
          text="Add gauge"
          onClick={() => {
            setBoxes(b => [...b, { x: 40 + b.length * 30, y: 200 }]);
            setDirty(true);
          }}
        />
        <DefaultButton text="Save layout" disabled={!dirty} onClick={() => setDirty(false)} />
      </Stack>
      <div style={{ flex: 1, position: 'relative', backgroundColor: theme.palette.neutralLighterAlt }}>
        {boxes.map((b, i) => (
          <div
            key={i}
            style={{
              position: 'absolute', left: b.x, top: b.y, width: 140, height: 90,
              border: `2px solid ${theme.palette.themePrimary}`, borderRadius: 8,
              background: theme.palette.white, display: 'grid', placeItems: 'center',
            }}
          >
            Gauge {i + 1}
          </div>
        ))}
      </div>
    </FullBleed>
  );
}
```

**`src/About.tsx`**: any plain component; it scrolls inside the content
area with the bar's padding.

```tsx
export default function About() {
  return <p>Rig Config, version 1.</p>;
}
```

### Without a backend app list

Pass `applications` instead; `group` and `icon` are plain fields:

```tsx
const applications: IApplication[] = [
  { name: 'Devices', path: 'devices', defaultRoute: '', frontEnd: 'devices', links: [], group: 'RIG', icon: 'Devices3' },
  { name: 'Designer', path: 'designer', defaultRoute: '', frontEnd: 'designer', links: [], group: 'DASHBOARDS', icon: 'Design' },
  { name: 'About', path: 'about', defaultRoute: '', frontEnd: 'about', links: [], icon: 'Info' },
];
<Shell title="Rig Config" applications={applications} components={...} />
```

With the app list from the backend, the sidebar selects `group icon`; pass
`applicationFields=""` if your backend doesn't have them.

## Props

`Shell` takes denim-fabric's `ShellProps`: every `<DenimProvider>` prop,
plus:

| Prop | What it does here |
|---|---|
| `title` | your product's name, at the top of the sidebar |
| `Brand` | icon next to the title |
| `Logo` | splash-screen logo |
| `themes` | theme builders; default `THEMES` |
| `SidebarFooter` | extra content in the sidebar footer, above Settings (full sidebar and phone menu) |
| `Controls` | always-visible controls: a row at the top of the sidebar footer (full sidebar, icon rail, phone menu) and the right end of the phone's top bar. The bar may mount it twice at once, so keep it presentational |
| `breakpoints` | `{ medium, wide }` in px; default `{ medium: 700, wide: 1200 }` |
| `welcome` | the `/` page on wide/medium screens with no `RootComponent` and no launch page |
| `defaultGroup` (core) | heading for applications without `group` |
| `useAppStatus` (core) | status-dot hook |
| `ExternalApps` | accepted, ignored (the top bar's) |

## How it behaves

| Width | Layout |
|---|---|
| wide (>= 1200px: a desktop, a wide rig touchscreen) | sidebar \| content; inside `MasterDetail`, sidebar \| list \| detail. The sidebar collapses to an icon rail (remembered per browser). |
| medium (>= 700px) | icon rail \| content (list \| detail). The rail's menu button opens the full sidebar over the content. |
| narrow (a phone) | one screen at a time: the menu, then the application (list), then the detail, each with a back bar |

- Groups keep configured order. An `icon` is a Fluent icon name
  (`Devices3`, `ContactCard`, `Design`, `Info`, ...); without one the item
  shows the name's first letter.
- Selection lives in the URL (`/devices/<id>/show`), so deep links, reloads
  and the browser's Back and Forward buttons work at every width. The back
  bar is the browser's Back when that leads to the same place
  (`useShellLayout().goUp`), so it never piles up history. While a
  `MasterDetail` detail is open the back bar leads to the list
  (`useShellLayout().backBar` is true here).
- On a phone, `/` is the menu rather than the launch page (wide and medium
  layouts still redirect `/` to the launch page). On an application's page
  the back bar's "‹ Menu" opens the same full-screen menu over that page's
  URL (a history entry, so the device's Back closes it), with the active
  application's `links` nested under it as in the wide sidebar. The app's
  own entry is its main page; choosing a page or another app navigates and
  closes the menu. The sliding selection marks the current page: the
  current link, or the app on its main page. There is no strip of links
  under the back bar, so the page keeps the screen; and no root link is
  needed in `links`, since the app's entry is its root.
- There are no global action buttons: each application draws its own
  toolbar inside its content (or its panes).
- Content gets 20px padding (12px on a phone) and scrolls; `FullBleed`
  cancels it.
- Touch targets are at least 44px, nothing depends on hover, and keyboard
  focus is visible.
- `/kiosk/<path>` shows the application without the sidebar.

## Motion

On top of denim-fabric's shared motion (the Settings dialog, sliding
selections, the phone drill-in):

| What | How |
|---|---|
| Medium layout's overlay sidebar | Fluent's own `Panel` slide (and its scrim's fade), in and out |
| Wide sidebar collapse/expand | the full panel slides by `264 - 60`px and the content moves with it (`translateX`, same clock and curve), while the icon rail fades over the panel's left end. The layout keeps its starting width during the slide and changes once at the end, in the same frame that drops the transforms. Toggling mid-slide reverses from where it is. (`SidebarShell/slide.ts`: the Web Animations API with the motion tokens, because a motion component computes its keyframes once, at mount.) |
| Selected sidebar item | `SlidingIndicator`: one highlight slides to the new item |
| Phone panes | `DrillIn`: menu to application from the right, back from the left |

"Reduce motion" (the core's device setting) or the OS preference turns all
of it off, Fluent's Panel motion included (the overlay then also hides at
once on close).

## Measuring its interactions

`localStorage.debugPerf = '1'` and a reload (`localStorage.removeItem('debugPerf')`
and a reload turn it off; in a Tauri window, open the inspector with
right-click > Inspect Element). Each interaction then logs lines like:

```
[perf] sidebar-toggle: 4.1ms to commit, 18.0ms to next frame
[perf] commit shell-sidebar update 2.3ms (base 1.9ms)
[perf] anim sidebar-expand: 205ms, 13 frames, 0 long (max 17ms)
```

- The interactions are `sidebar-toggle`, `overlay-open`/`overlay-close`
  and `settings-open`/`settings-close`. "to commit" is the time from the
  click until React has changed the DOM; "to next frame" adds style,
  layout and paint, as far as `requestAnimationFrame` can see them.
- `commit <part>` comes from React Profilers around `shell-sidebar`,
  `shell-content` (the page) and `settings-dialog`; a part that doesn't log
  didn't re-render.
- `anim <name>` is one animation: its length, frames drawn, how many took
  over 32ms, and the worst one; `(interrupted)` means reversed or cut
  short. Names: `sidebar-expand`/`sidebar-collapse`, `sidebar-selection`,
  `list-selection`, `drill-in-right`/`drill-in-left`,
  `overlay-open`/`overlay-close`, `settings-enter`/`settings-exit`.
- Each timing is also a `performance.measure`.

Toggling the sidebar or opening Settings doesn't re-render the page.
Variant and state classes are merged with `mergeStyles` rather than listed
side by side, because which of two Fluent classes wins depends on rule
order, and a theme change reorders the rules.

## Switching to the top bar

Clone denim-fabric-topbar next to it and change the import:

```diff
-import Shell from './lib/denim-fabric-sidebar';
+import Shell from './lib/denim-fabric-topbar';
```

The props stay valid: the top bar uses `Controls` (in its header) and
`ExternalApps`, ignores `title` and `SidebarFooter` (and `group` and
`icon`), and shows status dots in its waffle panel.
Master-detail and full-bleed apps keep working (MasterDetail then draws its
own phone back bar). Then remove this folder.

## Same exports as every bar

`index.ts` is `export * from '../denim-fabric'` plus `Shell`, the default
export and the role exports, the surface defined in denim-fabric's
`shared/barContract.ts`. `parity.check.ts` fails your app's `tsc` if this
bar's exports drift from it; denim-fabric's `scripts/check-bar-parity.mjs`
also compares type-only exports and names a missing role.

The sidebar's building blocks are exported under the role names every bar
uses, each typed with its role's props:

| Role | Here | Its own extra props |
|---|---|---|
| `Bar` | `Sidebar`: the full sidebar; on its own it has its own Settings dialog | `variant` (`full`, `rail`, `screen`), `title`, `onToggle`, `toggleLabel`, `onNavigate`, `onOpenSettings`, `Footer` |
| `BarNav` | `SidebarLinks`: the links listed under an app | none |
| `BarLink` | `SidebarLink` | none |
| `AppSwitcher` | `AppList`: the grouped, scrolling application list with the sliding selection | `rail` |
| `StatusDot` | denim-fabric's shared `StatusDot` | `overlay`, `className` |

For the extra props, import them by name (and `SidebarProps`,
`SidebarVariant`, `AppListProps`) from
`./lib/denim-fabric-sidebar/SidebarShell/Sidebar` when you vary the bar.

## Verification

In a Vite + React + TS app with the packages side by side and a read-only
GraphQL mock: strict `tsc` over the setup above (with denim-fabric's
`DevicesAdmin`); the parity check; groups, icons and status dots; a
ReactiveAdmin list/show/edit in master-detail and `MasterDetail` at 1400px,
900px and 390px with touch (drill-in, the back bar); the wide collapse
slide and the phone drill-in; a full-bleed canvas; Settings; no console
errors. Unchanged pixel for pixel from the sidebar before the bars were
split. After the role exports and `Controls` (2026-10-16): Controls
visible at 1400px (full and collapsed), 900px (rail and overlay) and 390px
(menu and the top bar). After the phone pills were removed (2026-10-17),
at 390px with touch: no strip under the back bar; "‹ Menu" opens the menu
with the active app's pages nested, the selection on the current page;
choosing a page or another app lands there and closes the menu; 44px
targets; 1400px and 900px unchanged. Earlier, before the split: browser Back/Forward, deep links, 44px
targets, visible focus, and the motion frame by frame under 6x CPU
throttling.

## What's in here

| Path | What it is |
|---|---|
| `index.ts` | the bar's exports (the shared surface + `Shell` + default + the role exports) |
| `parity.check.ts` | the export-parity check |
| `SidebarShell/index.tsx` | `SidebarShell` (the `Shell`): the three layouts, the phone back bar (with `Controls`) and menu screen, the layout context |
| `SidebarShell/Sidebar.tsx` | `Sidebar` (full / rail / screen variants), `AppList`, `SidebarLinks`, `SidebarLink`, the sidebar's styles (and a re-export of the shared `StatusDot`) |
| `SidebarShell/slide.ts` | the wide collapse/expand slide |

## License

MIT, see `LICENSE`.
