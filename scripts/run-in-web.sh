#!/usr/bin/env sh
# Run npm lifecycle scripts with cwd = web/ (Next + Turbopack resolve from
# process.cwd(); do not add a package.json at the repo root).
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT/web"
exec npm "$@"
