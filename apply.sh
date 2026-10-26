#!/usr/bin/env bash
# Thin entry point: node apply/apply.mjs with the same arguments.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null || { echo "node (>= 22) not found on PATH" >&2; exit 1; }
exec node "$root/apply/apply.mjs" "$@"
