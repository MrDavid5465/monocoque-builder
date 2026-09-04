#!/usr/bin/env bash
set -euo pipefail

# Toggles src-tauri/Cargo.toml (+ regenerates Cargo.lock) between local
# path dependencies on the sibling typiql-rs checkout and the real
# crates.io versions typiql-rs publishes via release-plz.
#
# Usage:
#   scripts/typiql-deps.sh local
#     Switch to path deps against ../../typiql-rs (sibling checkout,
#     same layout CI reproduces via its two-checkout pattern). Marks
#     Cargo.toml/Cargo.lock skip-worktree so day-to-day local dev never
#     shows them as changed in `git status` / `git add`.
#
#   scripts/typiql-deps.sh published [--core VER] [--json-adapter VER] [--duckdb-adapter VER]
#     Switch to real crates.io version pins (fetching each crate's
#     current latest version from crates.io unless overridden), clear
#     skip-worktree, and regenerate Cargo.lock. Run this before
#     committing a real dependency bump.
#
# Caveat: `git update-index --skip-worktree` hides ALL future worktree
# changes to these two files, not just the dependency lines — if you
# need to hand-edit Cargo.toml for an unrelated reason while in `local`
# mode, run `published` first (or git status won't show your edit
# either). Also avoid `git checkout`/`git pull` while skip-worktree is
# set on these paths; switch back to `published` first, since git can
# silently keep your local-mode content across those operations.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$REPO_ROOT/src-tauri/Cargo.toml"

crate_version() {
  curl -sf -H "User-Agent: monocoque-builder-dev-script (david@davidallanscott.ca)" \
    "https://crates.io/api/v1/crates/$1" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["crate"]["max_version"])'
}

usage() {
  echo "Usage: $0 local | published [--core VER] [--json-adapter VER] [--duckdb-adapter VER]" >&2
  exit 1
}

[ $# -ge 1 ] || usage
mode="$1"; shift

case "$mode" in
  local)
    python3 - "$MANIFEST" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path).read()
text = re.sub(
    r'typiql = \{ version = "[^"]+", package = "typiql-core" \}',
    'typiql = { path = "../../typiql-rs/crates/typiql-core", package = "typiql-core" }',
    text)
text = re.sub(
    r'typiql-adapter-json = "[^"]+"',
    'typiql-adapter-json = { path = "../../typiql-rs/crates/typiql-adapter-json" }',
    text)
text = re.sub(
    r'typiql-adapter-duckdb = "[^"]+"',
    'typiql-adapter-duckdb = { path = "../../typiql-rs/crates/typiql-adapter-duckdb" }',
    text)
open(path, 'w').write(text)
PY
    (cd "$REPO_ROOT/src-tauri" && cargo check --quiet)
    git -C "$REPO_ROOT" update-index --skip-worktree src-tauri/Cargo.toml src-tauri/Cargo.lock
    echo "Switched to local path deps (../../typiql-rs). Cargo.toml/Cargo.lock are now skip-worktree."
    ;;

  published)
    core_version=""
    json_version=""
    duckdb_version=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --core) core_version="$2"; shift 2 ;;
        --json-adapter) json_version="$2"; shift 2 ;;
        --duckdb-adapter) duckdb_version="$2"; shift 2 ;;
        *) usage ;;
      esac
    done
    [ -n "$core_version" ] || core_version="$(crate_version typiql-core)"
    [ -n "$json_version" ] || json_version="$(crate_version typiql-adapter-json)"
    [ -n "$duckdb_version" ] || duckdb_version="$(crate_version typiql-adapter-duckdb)"

    git -C "$REPO_ROOT" update-index --no-skip-worktree src-tauri/Cargo.toml src-tauri/Cargo.lock

    python3 - "$MANIFEST" "$core_version" "$json_version" "$duckdb_version" <<'PY'
import re, sys
path, core, jsonv, duckdb = sys.argv[1:5]
text = open(path).read()
text = re.sub(
    r'typiql = \{ path = "[^"]+", package = "typiql-core" \}',
    f'typiql = {{ version = "{core}", package = "typiql-core" }}',
    text)
text = re.sub(
    r'typiql-adapter-json = \{ path = "[^"]+" \}',
    f'typiql-adapter-json = "{jsonv}"',
    text)
text = re.sub(
    r'typiql-adapter-duckdb = \{ path = "[^"]+" \}',
    f'typiql-adapter-duckdb = "{duckdb}"',
    text)
open(path, 'w').write(text)
PY
    (cd "$REPO_ROOT/src-tauri" && cargo check --quiet)
    echo "Switched to published crates.io deps (core=$core_version, json-adapter=$json_version, duckdb-adapter=$duckdb_version)."
    ;;

  *)
    usage
    ;;
esac
