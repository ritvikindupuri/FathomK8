#!/bin/sh
set -eu
cd "$(dirname "$0")"

tool_path="${PATH}"
if [ -n "${HOME:-}" ]; then
  tool_path="${HOME}/.local/bin:${PATH}"
fi

missing=""
PATH="$tool_path" command -v helm >/dev/null 2>&1 || missing="${missing} helm"
PATH="$tool_path" command -v kustomize >/dev/null 2>&1 || missing="${missing} kustomize"
if [ -n "$missing" ]; then
  printf 'warning: not on PATH:%s\n' "$missing" >&2
  printf 'warning: demo scans need Helm 3 and Kustomize 5. payments-platform renders with helm; platform-gitops renders with kustomize.\n' >&2
  printf 'warning: a missing binary fails that scan with "spawn <tool> ENOENT". The repository stays on the dashboard with no score.\n' >&2
  printf 'warning: install both, then run ./run.sh again. Copy-paste commands for macOS (brew), Linux, and Windows (winget/choco) are in the README under "Local, without Docker".\n' >&2
fi

if [ ! -d node_modules ]; then
  npm install
fi
exec npm run dev
