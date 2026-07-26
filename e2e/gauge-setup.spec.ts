import { test, expect, Page } from '@playwright/test';
import { mockGraphQL, gotoDesigner } from './helpers/mock-gql';
import { ALL_GAUGE_TYPES_ELEMENTS } from './fixtures/gauge-dashboards';

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/** Collects every browser console error message for the duration of a test. */
function trackConsoleErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return () => errors;
}

/** Assert that no "Maximum update depth exceeded" React error appeared. */
function assertNoMaxDepth(errors: string[]) {
  const hits = errors.filter((e) => e.includes('Maximum update depth'));
  expect(hits, `React maximum update depth errors:\n${hits.join('\n')}`).toHaveLength(0);
}

/** Set up GQL mock + navigate to designer, returning an errors getter. */
async function openDesigner(page: Page, elements?: string) {
  const getErrors = trackConsoleErrors(page);
  await mockGraphQL(page, { elements });
  await gotoDesigner(page);
  // A few more queries (cars, dash-pans, sprite sync) resolve just after the
  // "Loading dashboard..." indicator hides, each triggering its own
  // re-render — clicking immediately risks racing one of those and hitting
  // a momentarily-detached node.
  await page.waitForTimeout(500);
  return getErrors;
}

/** Open the ComponentPicker (right panel) — types like "Text Gauge" only
 * render once this is open; it starts closed (ObjectExplorer's `pickerOpen`
 * state defaults to false). */
async function openComponentPicker(page: Page) {
  await page.click('button[title="Add component"]');
}

// ────────────────────────────────────────────────────────────────
// Freeform gauges — click the type label then click "+ Add {Label}"
// ────────────────────────────────────────────────────────────────

const FREEFORM_TYPES: Array<[string, string]> = [
  ['text-gauge',           'Text Gauge'],
  ['arc-gauge-face',       'Arc Gauge Face'],
  ['sprite-arc-gauge-face', 'Sprite Arc Gauge Face'],
  ['graph-bar-gauge',      'Graph Bar Gauge'],
  ['flag-display',         'Flag Display'],
  ['flag-display-sprite',  'Flag Display (Sprite)'],
  ['button-control',       'Button Control'],
  ['slider-control',       'Slider Control'],
  ['encoder-control',      'Encoder Control'],
  ['group',                'Group'],
];

for (const [, label] of FREEFORM_TYPES) {
  test(`add freeform type: ${label}`, async ({ page }) => {
    const getErrors = await openDesigner(page);

    // Select the type in ComponentPicker (right panel)
    await openComponentPicker(page);
    await page.click(`text=${label}`);
    // Click the freeform add button that appears below the type list
    await page.click(`button:has-text("+ Add ${label}")`);

    // Allow React to settle through any pending update cycles
    await page.waitForTimeout(300);

    assertNoMaxDepth(getErrors());

    // The UI should still be intact — the canvas area is always present
    await expect(page.locator('#root')).toBeAttached();
  });
}

// ────────────────────────────────────────────────────────────────
// Sprite gauges — click the type label then click the "Add" button
// next to the mock sprite that syncDashboardFiles returns.
// ────────────────────────────────────────────────────────────────

const SPRITE_TYPES: string[] = [
  'Static Sprite',
  'Needle Gauge',
  'Bar Gauge',
  'Sprite Bar Gauge',
  'Sprite Text Gauge',
  'GIF Gauge',
];

for (const label of SPRITE_TYPES) {
  test(`add sprite type: ${label}`, async ({ page }) => {
    const getErrors = await openDesigner(page);

    // Select the sprite type in ComponentPicker to see the sprite list
    await openComponentPicker(page);
    await page.click(`text=${label}`);

    // "Add" button appears next to the mock sprite "test-sprite"
    // (the title attribute is "Add as <Label>" — use that to scope if needed)
    await page.click(`button[title="Add as ${label}"]`);

    await page.waitForTimeout(300);

    assertNoMaxDepth(getErrors());
    await expect(page.locator('#root')).toBeAttached();
  });
}

// ────────────────────────────────────────────────────────────────
// Canvas rendering — load a pre-configured dashboard containing
// all 16 component types and verify the designer renders without
// a maximum update depth error.
// ────────────────────────────────────────────────────────────────

test('pre-configured canvas with all gauge types renders without React errors', async ({ page }) => {
  const getErrors = await openDesigner(page, ALL_GAUGE_TYPES_ELEMENTS);

  // Wait for the canvas to populate (nodes are rendered into the designer area)
  await page.waitForTimeout(500);

  assertNoMaxDepth(getErrors());

  // The canvas area should contain rendered node elements
  await expect(page.locator('#root')).toBeAttached();
});

// ────────────────────────────────────────────────────────────────
// Panel interaction — opening the ObjectExplorer properties forms
// was the original repro path for the max-depth bug.
// ────────────────────────────────────────────────────────────────

test('opening ObjectExplorer dashboard properties does not error', async ({ page }) => {
  const getErrors = await openDesigner(page);

  // The "Dashboard" row in ObjectExplorer opens the DashboardPropertiesPanel,
  // which contains several <Form> components whose onChange fired on mount and
  // amplified unstable reference issues.
  await page.click('text=Dashboard');
  await page.waitForTimeout(300);

  assertNoMaxDepth(getErrors());
});

test('adding a node then editing its name field does not error', async ({ page }) => {
  const getErrors = await openDesigner(page);

  // Add a text-gauge (this selects it via addNode's setSelectedId, but the
  // picker itself stays open — ObjectExplorer's pickerOpen/propertiesOpen
  // are separate state, only handleNodeClick flips propertiesOpen). Close
  // the picker and click the new node in the tree to actually open its
  // properties panel, matching the real user flow.
  await openComponentPicker(page);
  await page.click('text=Text Gauge');
  await page.click('button:has-text("+ Add Text Gauge")');
  await page.click('button[title="Close"]');
  await page.waitForTimeout(200);
  // New node's default name is its schema label ("Text Gauge"), not its
  // type slug — see ComponentPicker's addNode: `name: schema.label`. The
  // picker is closed by now so this only matches the tree row.
  await page.click('text=Text Gauge');
  await page.waitForTimeout(200);

  // The node's properties panel opens with a Name input field; type into it
  const nameInput = page.locator('input[type="text"]').first();
  await nameInput.fill('my-text-gauge');
  await page.waitForTimeout(200);

  assertNoMaxDepth(getErrors());
});
