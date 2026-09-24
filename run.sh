#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"

# Use the temporary Node.js installation when this environment has no system Node.js.
if ! command -v node >/dev/null 2>&1 && [[ -x /tmp/node-v24.8.0-linux-x64/bin/node ]]; then
  export PATH="/tmp/node-v24.8.0-linux-x64/bin:$PATH"
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo 'Для запуска установите Node.js 22.12+ и npm.' >&2
  exit 1
fi

if [[ ! -d node_modules ]] || ! npm ls --depth=0 --silent >/dev/null 2>&1; then
  npm ci
fi

exec npm run dev -- "$@"
