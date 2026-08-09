---
name: playwright-verify
description: Launch/drive this app (Tauri + React + Vite) in a real Chromium browser via the Playwright already installed in this repo — navigate routes, click through flows, screenshot, and check console errors. Use this instead of concluding live browser verification isn't possible here.
license: MIT
---

# Playwright live verification for typiql-tauri

This app is a Tauri desktop app, but its entire React frontend is *also* a plain
web page served by Vite — Tauri's native window is just a webview pointed at
that same page. That means you do **not** need to control the native desktop
window (no Tauri/Electron driver, no screen automation) to verify UI changes.
Point a normal headless Chromium at the Vite dev server and it renders and
behaves identically, hitting the same real backend.

**Playwright and its Chromium binary are already installed** in this
container (`@playwright/test` is a devDependency, browsers are cached under
`~/.cache/ms-playwright`). If a previous attempt concluded "no browser
automation tool is available," that was wrong — it just didn't check for
this. Verify with `npx playwright --version` (project root) before doing
anything else if in doubt.

## Prerequisites

1. `npm run tauri dev` (full app + Rust backend on port 9000 + Vite on port
   1420) or at minimum `npm run dev` (Vite only, port 1420) must already be
   running. If you're not sure, just try `live-check.cjs` — it does its own
   reachability check against the same URL and fails fast with a clear
   message if the dev server isn't up, instead of a 30s Playwright timeout.
   If it isn't running yet, start `npm run tauri dev` in the background
   (`run_in_background`), then run:
   ```bash
   .claude/skills/playwright-verify/scripts/wait-for-dev-server.sh
   ```
   instead of re-reading the background task's log yourself to spot
   `Starting API on http://0.0.0.0:9000` — it polls `http://localhost:1420/`
   and returns as soon as it's actually ready (60s timeout, override with a
   second arg).
2. Run everything from inside the `typiql/` project directory (where
   `package.json` and `node_modules` live) — Node's `require()` resolution
   needs a `node_modules` in an ancestor directory of the script. Scripts
   under `.claude/skills/playwright-verify/scripts/` already satisfy this.
   If you write an ad hoc script elsewhere (e.g. the scratchpad), either move
   it under the repo first or run it with
   `NODE_PATH=<repo>/node_modules node yourscript.js`.

## The bundled driver

`scripts/live-check.cjs` is a generic, reusable driver — prefer it over
writing a new one-off script each time:

```bash
# Screenshot a route
node .claude/skills/playwright-verify/scripts/live-check.cjs \
  --path /telemetryadmin/dashboards --screenshot /tmp/dashboards.png

# Click through a flow, then screenshot the result
node .claude/skills/playwright-verify/scripts/live-check.cjs \
  --path /telemetryadmin/dashboards --click "text=MK7" \
  --screenshot /tmp/mk7-open.png

# Just check for console errors on a route, no screenshot needed
node .claude/skills/playwright-verify/scripts/live-check.cjs --path /telemetryadmin/test
```

Run `node .claude/skills/playwright-verify/scripts/live-check.cjs --help`-style
by reading the top of the file for the full flag list (`--path`, `--base`,
`--screenshot`, `--wait`, `--selector`, `--click`, `--eval`, `--keep-open`).

After a screenshot is written, **use the Read tool on the PNG path** — Claude
Code can view images directly. Don't just trust that the screenshot call
succeeded; look at it, the same as you would review any other tool output.

For anything the driver's flags don't cover (typing into a form, multi-step
flows, reading specific text out of the page), write a short throwaway
script following the same shape — copy the top of `live-check.cjs` (the
dev-server-reachability check, the console-error listeners, the
`domcontentloaded` navigation) and add whatever `page.fill()` /
`page.click()` / `page.locator(...).textContent()` calls you need.

## Hard-won gotchas

- **Never use `waitUntil: 'networkidle'`.** This app holds an open GraphQL
  subscription (`dashboardUpdates`, a multipart HTTP stream) essentially
  forever once connected, so the network never goes idle and navigation
  will time out at 30s. Use `waitUntil: 'domcontentloaded'` and then either
  a fixed `page.waitForTimeout(...)` or `page.waitForSelector(...)` for
  something concrete to appear.
- **Routing is hash-based.** URLs look like
  `http://localhost:1420/#/telemetryadmin/dashboards`, not
  `http://localhost:1420/telemetryadmin/dashboards`.
- **`--click "text=..."` can silently no-op.** On card-grid views
  (`CardList.tsx`), the visible title text is often a plain label, not the
  clickable element — the click handler lives on the thumbnail image/tile.
  If a click doesn't navigate, screenshot first to see the actual DOM
  structure, then target the thumbnail container (e.g. an `img` or its
  wrapping `div`) rather than the title text.
- **This drives real data against the real local backend** (port 9000,
  whatever's in `~/.config/dashboard-designer/*.json`) — it is not
  sandboxed. Treat create/delete actions here the same as you would in the
  live desktop app: fine for disposable test records, ask first before
  touching anything that looks like real user data.
- The project *also* has a formal, separate Playwright E2E suite under
  `e2e/*.spec.ts` (run via `npm run test:e2e`, config in
  `playwright.config.ts`) that mocks GraphQL responses
  (`e2e/helpers/mock-gql.ts`) for deterministic regression tests. Use that
  suite when adding a repeatable regression test for a specific feature.
  Use this skill's approach for one-off manual verification against real
  local state — "does the thing I just built actually work" rather than
  "does it keep working forever."
- Known adjacent issue, not fixed by this skill: running plain `npx vitest
  run` from the project root currently also picks up `e2e/*.spec.ts` and
  fails them (they use `@playwright/test`'s `test()`, which errors outside
  its own runner). If you need a clean `vitest` run, target `src/` explicitly
  or ask before changing `vitest.config`'s include/exclude globs.
