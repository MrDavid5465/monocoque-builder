import { Page } from '@playwright/test';

// A single sprite returned by syncDashboardFiles — used for sprite-based
// gauge types. Field names must match SYNC_DASHBOARD_FILES's real selection
// set (id/path/filename/url in DashboardDesigner/queries.ts) — useDashboard's
// own effect does `f.filename.split('.')` on every entry with no null guard,
// so a mismatched shape (e.g. the `filepath`/`name`/`fileType` fields this
// used to have) throws and silently unmounts the whole DashboardDesigner
// tree (no error boundary), not just a missing-sprite symptom.
const MOCK_SPRITE = {
  id: 'sprite-e2e-1',
  path: 'test-sprite.svg',
  filename: 'test-sprite.svg',
  url: '/dash-assets/e2e-test/test-sprite.svg',
};

// Matches DashboardEntry's real nested shape (DASHBOARD_ENTRY_FIELDS in
// DashboardDesigner/queries.ts) — entry-level id/name/path plus content only
// reachable via the nested `dashboard` field, per the Location-based rework
// (typiql_types.rs's dumb Dashboard type). A flat shape here silently yields
// `undefined` for every content field once Apollo's cache normalizes it
// against the real query's selection set.
function makeRawDashboardEntry(name: string, elements: string = JSON.stringify({ v: 2, components: [] })) {
  return {
    id: 'e2e-dashboard-1',
    name,
    path: '/e2e-test',
    dashboard: {
      baseDashType: 'freeform',
      canvasWidth: 1280,
      canvasHeight: 720,
      background: null,
      dayNight: false,
      neckFx: false,
      elements,
      kioskX: 1240,
      kioskY: 20,
      kioskOpacity: 0.15,
      thumbnailDay: null,
      thumbnailNight: null,
      groupIds: '[]',
    },
  };
}

function gqlResponse(data: Record<string, unknown>) {
  return JSON.stringify({ data });
}

/**
 * Intercepts all GraphQL HTTP requests for the designer and returns canned
 * responses. Also serves blank SVGs for sprite asset requests so images
 * don't generate 404s.
 *
 * @param elements - Raw `elements` JSON string to embed in the dashboard row.
 *                   Defaults to an empty v2 component list.
 */
export async function mockGraphQL(
  page: Page,
  {
    dashboardName = 'E2E Test',
    elements,
  }: { dashboardName?: string; elements?: string } = {},
) {
  const rawDashboardEntry = makeRawDashboardEntry(dashboardName, elements);

  await page.route('**/typiql/graphql', async (route) => {
    let body: Record<string, unknown> = {};
    try {
      body = route.request().postDataJSON() as Record<string, unknown>;
    } catch {
      // body may be absent for WebSocket-style requests
    }

    const op = (body.operationName as string | undefined) ?? '';

    switch (op) {
      case 'my':
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: gqlResponse({
            my: {
              // The /dashboards/* routes are only registered by Denim
              // (src/lib/denim/components/index.tsx) when a matching entry
              // exists in `my.applications` — mirrors the real app registry
              // built server-side in config_manager/app_config.rs. Without
              // this, every e2e navigation to /dashboards/... silently
              // falls through to the catch-all route and renders whatever
              // DefaultLanding resolves to instead.
              applications: [
                {
                  name: 'Dashboards',
                  path: 'dashboards',
                  defaultRoute: '',
                  frontEnd: 'Dashboards',
                  links: [],
                },
              ],
              // Field set must match MY's real selection (denim/lib/queries.ts)
              // exactly — any gap here makes Apollo's InMemoryCache write an
              // incomplete entry for the `my` query ("Missing field" console
              // warnings), which forces every subsequent cache-first read to
              // fall back to network and briefly flips `loading` back to
              // true — visible as the whole app flashing back to Denim's
              // full-screen Splashscreen mid-test, well after the page
              // otherwise looks settled.
              settings: {
                launchPage: 'dashboards/default',
                theme: 'darkred',
                // A small multiplier (default 1), not a literal px size —
                // src/lib/themes/index.ts computes every themed font/spacing
                // value as `Math.round(N * fontSize)`. The wrong-order-of-
                // magnitude value this had before (14) scaled every em-based
                // size in the app (e.g. denim's headerIconButton at 3.85em)
                // up ~14x, which is what was actually behind the "giant
                // icons" rendering — not a real app bug.
                fontSize: 1,
                deviceMap: {},
                typiqlDataDir: null,
                steerMaxDeg: 400,
                setupComplete: true,
                shakerDspEnabled: false,
                shakerLfeSourceDevice: null,
                shakerLfeLpfHz: 120,
                gamepadMappings: [],
              },
            },
          }),
        });
        break;

      case 'getDashboardEntries':
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: gqlResponse({ getDashboardEntries: [rawDashboardEntry] }),
        });
        break;

      // Filter-based get-one — this is what DashboardDesigner's own
      // useDashboard() hook actually queries by name (GET_DASHBOARD_ENTRY),
      // not the list query above.
      case 'getDashboardEntry':
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: gqlResponse({ getDashboardEntry: rawDashboardEntry }),
        });
        break;

      case 'getDashTemplates':
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: gqlResponse({ getDashTemplates: [] }),
        });
        break;

      case 'syncDashboardFiles':
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: gqlResponse({ syncDashboardFiles: [MOCK_SPRITE] }),
        });
        break;

      case 'heartbeatClient':
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: gqlResponse({
            heartbeatClient: { id: 'e2e', name: 'E2E', lastSeen: new Date().toISOString() },
          }),
        });
        break;

      case 'dashboardUpdates':
        // Subscription over HTTP multipart — respond with an immediately-closed
        // stream so Apollo sees a clean end-of-subscription rather than an error.
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'multipart/mixed; boundary="graphql"' },
          body: [
            '--graphql\r\n',
            'Content-Type: application/json\r\n\r\n',
            JSON.stringify({ hasNext: false, data: { dashboardUpdates: null } }),
            '\r\n--graphql--\r\n',
          ].join(''),
        });
        break;

      default:
        // Mutations (updateDashboard, etc.) — return empty success.
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: gqlResponse({}),
        });
    }
  });

  // Serve blank SVGs for all sprite thumbnail requests so images don't 404.
  const BLANK_SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  for (const pattern of ['**/dash-assets/**', '**/dash-sprites/**']) {
    await page.route(pattern, (route) =>
      route.fulfill({ status: 200, contentType: 'image/svg+xml', body: BLANK_SVG }),
    );
  }
}

/**
 * Navigate to the designer for a named dashboard and wait for it to finish
 * loading. Call mockGraphQL *before* this.
 */
export async function gotoDesigner(page: Page, dashboardName = 'E2E Test') {
  // The old telemetry app's /telemetry/manage/:name route was removed when
  // dashboards moved under ReactiveAdmin (Dashboards/DashboardsAdmin) —
  // the designer now lives at /dashboards/dashboards/:id/edit (idField
  // is the dashboard name, route built by CardList's `${pathname}/${routeId}/edit`).
  await page.goto(`/#/dashboards/dashboards/${encodeURIComponent(dashboardName)}/edit`);
  await page.waitForSelector('text=Loading dashboard...', { state: 'hidden', timeout: 10_000 });
}
