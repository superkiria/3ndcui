#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"

# The prototype was verified with this temporary Node.js installation.
if ! command -v node >/dev/null 2>&1 && [[ -x /tmp/node-v24.8.0-linux-x64/bin/node ]]; then
  export PATH="/tmp/node-v24.8.0-linux-x64/bin:$PATH"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo 'Для запуска установите Node.js 22.12+ и npm, затем выполните npm install.' >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  npm ci
fi

exec npm run dev -- "$@"
