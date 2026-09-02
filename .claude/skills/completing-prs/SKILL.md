---
name: completing-prs
description: Bring an open PR in this repo to a merged state — verify the right CI gates actually passed (not just "some check is green"), merge with this repo's established method, and know what merging will trigger next (release-please, changelog placement). Use when asked to complete/finish/land/merge a PR, or whether one is ready to merge.
license: MIT
disable-model-invocation: true
---

# Completing a PR in monocoque-builder

"Complete this PR" means: confirm it's actually safe to merge under this
repo's real CI/CD rules (not just "no red X visible"), merge it the way
every prior PR here was merged, and know what that merge sets in motion
afterward. This is a shared-state, hard-to-reverse action — only run this
flow when a human has actually asked for a specific PR to be merged, never
as a side effect of some other task.

## This repo's CI/CD topology

Six workflows, three different roles. Knowing which is which is the whole
point — the `pull_request` trigger alone doesn't tell you if a job is a
merge gate.

| Workflow | Trigger | Role |
|---|---|---|
| `ci.yml` | every PR, push to `master` | **The real merge gate.** `frontend` (eslint, tsc, vitest) + `rust` (cargo fmt --check, clippy -D warnings, cargo test). |
| `integration-test.yml` | every PR, tag push, manual | Builds the real app, smoke-tests it in a disposable Arch container, validates the AUR `PKGBUILD`, runs the Playwright e2e suite. **Explicitly not a required check** — its own header comment says so verbatim: "signal on the PR, not a merge gate, until it's proven reliable." Still genuinely useful signal (and currently green is a good sign) — read it if it failed, just don't treat a failure here as a merge blocker the way a `ci.yml` failure is. |
| `release-please.yml` | push to `master` only | Not part of the PR itself. Fires *after* you merge — opens/updates a version-bump PR if `master` now has unreleased `feat`/`fix` commits; merging *that* PR is what actually tags a release and uploads Linux packages. |
| `flatpak.yml`, `publish-aur.yml` | tag push / manual `workflow_dispatch` only | Never touched by completing an ordinary PR. `publish-aur.yml` is deliberately dispatch-only — nothing here should ever trigger it as a side effect. |
| `bump-typiql-rs-deps.yml` | `repository_dispatch` from the sibling `typiql-rs` repo, or manual | Opens its own PR (`cargo check` already gated before it opens) — completed the same way as any other PR via the steps below, nothing special. |

## Procedure

1. **Read the PR and its checks** — `pull_request_read` with `method: get`
   (gets `mergeable_state`, draft/merged status, base/head) and
   `method: get_check_runs` (the actual per-job CI results for the head
   commit).
2. **Trust `mergeable_state`, but know what it means**: GitHub computes this
   server-side from real branch-protection rules, so it's already the
   authoritative "is this actually blocked" signal — don't re-derive it by
   eyeballing individual check names.
   - `clean` — mergeable, all *required* checks passed. Go ahead.
   - `blocked` — a required check hasn't passed yet, or a required review is
     missing. Don't merge; say what's outstanding.
   - `unstable` — mergeable, but a *non-required* check (i.e.
     `integration-test.yml`) is failing. Worth a look, not a blocker — see
     the table above.
   - `dirty` — real merge conflicts with `master`. Resolve first (fetch,
     merge/rebase `master` into the PR branch, push) — never force through.
3. **Merge with `merge_method: "merge"`** — this repo's entire history is
   real merge commits ("Merge pull request #N from ..."), never squashes.
   Check `git log origin/master --merges --oneline` if you want to reconfirm
   before merging something that looks unusual; don't default to squash just
   because it's a common convention elsewhere — it isn't this repo's.
4. **Say what happens next, don't assume nothing does**:
   - If every commit in the PR is a hidden/non-bumping type per
     `release-please-config.json` (currently: `docs`, `style`, `chore`,
     `refactor`, `test`, `build`, `ci`, `perf`, `revert` are all
     `"hidden": true` and none of those bump version on their own) — merging
     just lands on `master` quietly. No release-please PR appears.
   - If the PR contains any `feat`/`fix` commit, the next push to `master`
     (this merge) makes `release-please.yml` open or update a
     `chore(master): release monocoque-builder X.Y.Z` PR. That PR is not yours
     to merge automatically — merging *it* is a real, deliberate release
     (tags, triggers `build-release`, uploads Linux packages to a public
     GitHub Release). Flag it to the user rather than completing it the same
     way as an ordinary PR, unless they've specifically asked you to ship a
     release.
   - Individual commits keep their own Conventional Commits type even
     through a real (non-squash) merge — release-please parses the commit
     log, not the merge commit's own message, so there's no need to
     "clean up" commit messages into one conventional summary before
     merging here.

## What this skill does not cover

Publishing to the AUR (`publish-aur.yml`) and cutting a Flatpak
(`flatpak.yml`) are separate, deliberate, manually-triggered actions —
completing a PR never fires either. If asked to "ship the release" after a
release-please PR merges, that's a different, bigger request than
completing a PR — confirm scope before doing anything beyond this flow.
