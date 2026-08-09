#!/usr/bin/env bash
# Polls a URL until it responds 200 or a timeout elapses. Replaces manually
# re-reading a background `npm run tauri dev` task's log output to spot the
# fixed "Starting API on http://0.0.0.0:9000" readiness string — same check,
# no back-and-forth log reads.
#
# Usage: wait-for-dev-server.sh [url] [timeout_seconds]
set -euo pipefail

url="${1:-http://localhost:1420/}"
timeout="${2:-60}"
elapsed=0
interval=2

until [ "$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null)" = "200" ]; do
  if [ "$elapsed" -ge "$timeout" ]; then
    echo "Timed out after ${timeout}s waiting for $url" >&2
    exit 1
  fi
  sleep "$interval"
  elapsed=$((elapsed + interval))
done

echo "Ready: $url responded 200 after ${elapsed}s"
