#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "setup-stt-worker.sh is deprecated."
echo "Use scripts/bootstrap.sh for unified macOS/Ubuntu setup."
echo

"$ROOT_DIR/scripts/bootstrap.sh" "$@"

