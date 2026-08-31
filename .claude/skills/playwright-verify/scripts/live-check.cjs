#!/usr/bin/env node
// Drives the already-running Tauri app's web frontend with a real Chromium
// browser via the Playwright install that already lives in this repo's
// node_modules — see ../SKILL.md for the background on why this works and
// what it's for. Deliberately dependency-free beyond @playwright/test so it
// can be copied/adapted inline for one-off checks too.
//
// Usage:
//   node live-check.cjs --path /telemetryadmin --screenshot out.png
//   node live-check.cjs --path /telemetryadmin/dashboards --click "text=MK7" --screenshot after-click.png
//   node live-check.cjs --path /telemetryadmin/test --wait 2000
//
// Flags:
//   --path <hash-path>     Path after the `#`, e.g. /telemetryadmin/dashboards (default: /)
//   --base <url>           Origin to load (default: http://localhost:1420)
//   --screenshot <file>    Save a full-page PNG here (relative paths resolve against cwd)
//   --wait <ms>            Fixed settle time after navigation, before screenshot/eval (default: 1200)
//   --selector <sel>       Wait for this selector to be visible before continuing
//   --click <sel>          Click this selector after the initial wait (text=... or CSS)
//   --eval <js>            Evaluate this JS in-page after everything else, print the result
//   --keep-open            Don't close the browser at the end (leaves it running; you must kill it yourself)

const { chromium } = require('@playwright/test');
const path = require('path');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i++; }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = args.base || 'http://localhost:1420';
  const hashPath = args.path || '/';
  const url = `${base}/#${hashPath.startsWith('/') ? hashPath : `/${hashPath}`}`;

  // Fail fast with a clear message rather than a 30s Playwright timeout if
  // `npm run tauri dev` (or `npm run dev`) isn't actually up.
  try {
    const res = await fetch(base, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`Dev server not reachable at ${base} (${e.message}). Start it with \`npm run tauri dev\` (full app + backend) or \`npm run dev\` (frontend only) first.`);
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(`[pageerror] ${e}`));
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(`[console.error] ${msg.text()}`); });

  console.log(`Navigating to ${url}`);
  // Never use waitUntil:'networkidle' here — the app holds an open GraphQL
  // subscription (dashboardUpdates) that keeps network activity alive
  // indefinitely, so networkidle never fires and navigation times out.
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  if (args.selector) {
    await page.waitForSelector(args.selector, { timeout: 10000 });
  }
  await page.waitForTimeout(Number(args.wait) || 1200);

  if (args.click) {
    await page.click(args.click);
    await page.waitForTimeout(500);
  }

  if (args.eval) {
    const result = await page.evaluate(args.eval);
    console.log('EVAL_RESULT:', JSON.stringify(result));
  }

  console.log('TITLE:', await page.title());
  console.log('CONSOLE_ERRORS:', consoleErrors.length ? JSON.stringify(consoleErrors, null, 2) : '(none)');

  if (args.screenshot) {
    const screenshotPath = path.resolve(process.cwd(), args.screenshot);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('SCREENSHOT:', screenshotPath);
  }

  if (!args['keep-open']) {
    await browser.close();
  } else {
    console.log('--keep-open set: browser left running, PID', browser.process()?.pid);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
