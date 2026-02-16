#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PY_BIN="${1:-python3.10}"
VENV_PATH="$ROOT_DIR/.venv-stt"

if ! command -v "$PY_BIN" >/dev/null 2>&1; then
  echo "Python not found: $PY_BIN"
  echo "Install Python 3.10/3.11 and rerun: scripts/setup-stt-worker.sh python3.10"
  exit 1
fi

"$PY_BIN" -m venv "$VENV_PATH"
"$VENV_PATH/bin/python" -m pip install --upgrade pip setuptools wheel
"$VENV_PATH/bin/python" -m pip install -r "$ROOT_DIR/requirements-stt.txt"

cat <<MSG

STT worker environment is ready.
Use these exports before launching app:

export CONSPECTOR_STT_PYTHON="$VENV_PATH/bin/python"
export CONSPECTOR_STT_MODE=real
export CONSPECTOR_REQUIRE_DIARIZATION=true
export HUGGINGFACE_TOKEN="<your_token>"
export CONSPECTOR_STT_FALLBACK_TO_MOCK=true

MSG
