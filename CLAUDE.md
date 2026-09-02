# Monocoque Builder

Tauri + React + Vite desktop app for sim-racing dashboards, with a Rust/axum
backend exposing GraphQL via the `typiql` macro crate.

## Skills — check these before starting

`.claude/skills/` holds project-specific skills. They are tracked in git, so
they travel with the repo. Read the relevant one **before** doing the work, not
after getting stuck.

| Skill | Reach for it when |
|---|---|
| `playwright-verify` | You need to see what the app actually does. Drives the real UI in Chromium using the Playwright already installed here — routes, clicks, screenshots, console errors. **Use this instead of concluding live browser verification isn't possible.** |
| `typiql-api` | Adding or changing any backend data type (`src-tauri/src/typiql_types.rs`, `graphql/*.rs`) — when typiql's CRUD/relation codegen applies vs. a hand-written resolver. |
| `reactive-admin` | Building a CRUD screen. Covers the dispatcher slots and the `components` override contract. |
| `form-schema` | Writing/reviewing any `SchemaDefinition<T>`. Includes a validator script — run it. |
| `list-schema` | Writing/reviewing a `list: { columns: {...} }` or a `List`/`CardList` call site. |
| `hand-rolled-components` | Before hand-rolling any new component with inline styles. |
| `completing-prs` | Landing a PR — which CI gates actually matter, and what merging triggers. |

A concrete cost of not checking: a whole session was spent concluding the
browser couldn't be driven, three wrong explanations were given for a UI bug,
and a Playwright probe was eventually hand-rolled — while `playwright-verify`
sat unread. When a UI bug survives one attempted fix, drive the app.

## Build and test

The crate is **`monocoque-builder`** (renamed from `typiql`). Scope every cargo
command — an unscoped run picks up crates under `.claude/worktrees/` and fails
confusingly:

```bash
cd src-tauri
cargo build -p monocoque-builder --no-default-features --features duckdb-bundled
cargo test  -p monocoque-builder --bins
cargo fmt   -p monocoque-builder
```

`--no-default-features` matters: `custom-protocol` is on by default and leaves
`cargo run` stuck on the splashscreen.

Frontend: `npx tsc --noEmit -p tsconfig.json` and `npx vitest run`.

**`e2e/*.spec.ts` fail under vitest.** They're Playwright specs caught by
vitest's glob — pre-existing, not a regression. Everything else should pass.

## Gotchas that have cost real time

- **Some files are CRLF** (`typical-admin-fabric/lib/templates/Fabric.tsx`,
  `lib/denim/components/index.tsx`). Rewriting one wholesale converts it to LF
  and turns a 30-line change into a 900-line diff. Match on a normalised copy,
  write the original endings back, and check `git diff --stat` before
  committing.
- **Hand-written resolvers must publish their own change events.** The typiql
  macro auto-publishes for generated CRUD; reaching for `adapter.update/add/
  remove` bypasses that, and the write becomes invisible to every live
  consumer. See `set_car_photo` / `night_clock.rs` for the pattern.
- **Live updates go through one hub.** `LiveUpdatesProvider` at the app root
  owns the single `dashboardUpdates` subscription; consumers declare what it
  must carry with `useLiveUpdatesDemand` and listen with `useHubListener`.
  Don't open a new subscription — the browser's per-origin connection limit is
  a real constraint here, and exhausting it silently stalls unrelated requests.
- **Companion services need dev commands.** In a debug build, a missing
  `MONOCOQUE_BUILDER_*_DEV_COMMAND` is a *refusal*, not a fallback, so simd /
  monocoque / huenicorn simply won't start. Copy `.env.local.example` to
  `.env.local` (gitignored, read automatically by `src-tauri/src/dev_env.rs`).
- **`npm run tauri dev` hot-reloads both sides.** Don't hand-manage `cargo run`
  plus a separate vite process, and don't restart to pick up changes.
