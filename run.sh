#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/.env"
ENV_TEMPLATE="$ROOT_DIR/.env.example"
DEFAULT_WHISPER_BIN="$ROOT_DIR/tools/whisper.cpp/build/bin/whisper-cli"
DEFAULT_WHISPER_MODEL="$ROOT_DIR/models/ggml-base.bin"

OS_NAME="$(uname -s)"
mkdir -p "$ROOT_DIR/logs"
case "$OS_NAME" in
  Darwin)
    PLATFORM_LABEL="macOS"
    ;;
  Linux)
    PLATFORM_LABEL="Linux"
    ;;
  *)
    echo "Unsupported OS: $OS_NAME"
    exit 1
    ;;
esac

print_header() {
  cat <<MSG

ABI Conspector launcher
Platform: $PLATFORM_LABEL
Notion API integration is available on both macOS and Linux.

MSG
}

node_major_version() {
  if ! command -v node >/dev/null 2>&1; then
    echo "0"
    return
  fi
  local raw
  raw="$(node -v 2>/dev/null || true)"
  raw="${raw#v}"
  echo "${raw%%.*}"
}

node_runtime_ok() {
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi
  if ! command -v npm >/dev/null 2>&1; then
    return 1
  fi
  local major
  major="$(node_major_version)"
  if [[ ! "$major" =~ ^[0-9]+$ ]]; then
    return 1
  fi
  (( major >= 24 ))
}

print_node_runtime_status() {
  local node_v="missing"
  local npm_v="missing"
  if command -v node >/dev/null 2>&1; then
    node_v="$(node -v 2>/dev/null || echo "unknown")"
  fi
  if command -v npm >/dev/null 2>&1; then
    npm_v="$(npm -v 2>/dev/null || echo "unknown")"
  fi
  echo "Node runtime status: node=${node_v}, npm=${npm_v} (required: Node.js >=24)"
}

install_node_runtime_ubuntu() {
  echo
  echo "Installing Node.js 24.x + npm for Ubuntu..."
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
  print_node_runtime_status
}

ensure_node_runtime_linux() {
  if node_runtime_ok; then
    return
  fi

  print_node_runtime_status
  echo "This action requires node/npm, but runtime is not ready."
  if ask_yes_no "Install Node.js 24.x now (Ubuntu/apt)?" "y"; then
    install_node_runtime_ubuntu
    if ! node_runtime_ok; then
      echo "Node runtime is still not ready."
      echo "Fallback option:"
      echo "  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
      echo "  source ~/.bashrc"
      echo "  nvm install 24 && nvm use 24"
      exit 1
    fi
  else
    echo "Skipped Node.js installation. Please install Node.js >=24 and npm, then retry."
    exit 1
  fi
}

ensure_node_runtime_if_needed() {
  local reason="${1:-command}"
  if [[ "$OS_NAME" == "Linux" ]]; then
    ensure_node_runtime_linux
    return
  fi

  if node_runtime_ok; then
    return
  fi

  print_node_runtime_status
  echo "Cannot run \"$reason\" without Node.js >=24 and npm."
  echo "Install Node.js manually for $PLATFORM_LABEL and retry."
  exit 1
}

ensure_env_file() {
  if [[ -f "$ENV_FILE" ]]; then
    return
  fi
  if [[ -f "$ENV_TEMPLATE" ]]; then
    cp "$ENV_TEMPLATE" "$ENV_FILE"
    echo "Created $ENV_FILE from .env.example"
    return
  fi
  : >"$ENV_FILE"
  echo "Created empty $ENV_FILE"
}

ensure_npm_deps() {
  if [[ -d "$ROOT_DIR/node_modules" ]]; then
    return
  fi
  echo "node_modules not found. Running npm install..."
  npm install --production=false
  echo "npm install complete."
}

normalize_project_path_value() {
  local value="$1"
  value="$(strip_outer_quotes "$value")"
  if [[ -z "$value" ]]; then
    printf ''
    return
  fi

  if [[ "$value" == "/path/to/workdir" ]]; then
    printf '%s' "$ROOT_DIR"
    return
  fi

  local suffix=''
  if [[ "$value" == *"/abi_conspector"* ]]; then
    suffix="${value#*"/abi_conspector"}"
    printf '%s' "${ROOT_DIR}${suffix}"
    return
  fi

  if [[ "$value" == "\$HOME/abi_conspector"* ]]; then
    suffix="${value#"\$HOME/abi_conspector"}"
    printf '%s' "${ROOT_DIR}${suffix}"
    return
  fi

  if [[ "$value" == "~/"* ]]; then
    printf '%s' "${HOME}/${value#"~/"}"
    return
  fi

  if [[ "$value" != /* && "$value" != "" ]]; then
    printf '%s' "${ROOT_DIR}/${value}"
    return
  fi

  printf '%s' "$value"
}

run_fix_env_paths() {
  local mode="${1:-verbose}"
  ensure_env_file

  local updated=0
  local keys=(
    "CONSPECTOR_WHISPERCPP_BIN"
    "CONSPECTOR_WHISPERCPP_MODEL_PATH"
    "CONSPECTOR_STT_PYTHON"
    "CONSPECTOR_STT_SCRIPT"
    "CONSPECTOR_CODEX_WORKDIR"
    "CONSPECTOR_GEMINI_WORKDIR"
  )

  for key in "${keys[@]}"; do
    local fallback=''
    case "$key" in
      CONSPECTOR_WHISPERCPP_BIN) fallback="$DEFAULT_WHISPER_BIN" ;;
      CONSPECTOR_WHISPERCPP_MODEL_PATH) fallback="$DEFAULT_WHISPER_MODEL" ;;
      CONSPECTOR_STT_PYTHON) fallback="$ROOT_DIR/.venv-stt/bin/python" ;;
      CONSPECTOR_STT_SCRIPT) fallback="$ROOT_DIR/scripts/run_stt_diarization.py" ;;
      CONSPECTOR_CODEX_WORKDIR) fallback="$ROOT_DIR" ;;
      CONSPECTOR_GEMINI_WORKDIR) fallback="$ROOT_DIR" ;;
      *) fallback='' ;;
    esac

    local current
    current="$(get_env_value "$key" "$fallback")"
    local normalized
    normalized="$(normalize_project_path_value "$current")"
    if [[ "$current" != "$normalized" || -z "$(get_env_value "$key" "")" ]]; then
      set_env_value "$key" "$normalized"
      updated=$((updated + 1))
      if [[ "$mode" != "quiet" ]]; then
        echo "Updated $key=$normalized"
      fi
    fi
  done

  if [[ "$mode" != "quiet" ]]; then
    if [[ "$updated" -eq 0 ]]; then
      echo "No path placeholders found. .env path variables already look good."
    else
      echo "Path auto-fix completed. Updated variables: $updated"
      echo "Run ./run.sh --env-doctor to verify all environment variables."
    fi
  fi
}

strip_outer_quotes() {
  local value="$1"
  if [[ "${#value}" -ge 2 && "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "${#value}" -ge 2 && "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

read_env_raw_value() {
  local key="$1"
  if [[ ! -f "$ENV_FILE" ]]; then
    printf ''
    return
  fi
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    printf ''
    return
  fi
  printf '%s' "${line#*=}"
}

get_env_value() {
  local key="$1"
  local fallback="${2:-}"
  local raw
  raw="$(strip_outer_quotes "$(read_env_raw_value "$key")")"
  if [[ -n "$raw" ]]; then
    printf '%s' "$raw"
    return
  fi
  printf '%s' "$fallback"
}

format_env_value() {
  local value="$1"
  value="${value//$'\n'/ }"
  if [[ "$value" =~ [[:space:]#] ]]; then
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    printf '"%s"' "$value"
    return
  fi
  printf '%s' "$value"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local formatted
  formatted="$(format_env_value "$value")"
  local tmp_file
  tmp_file="$(mktemp)"
  if [[ -f "$ENV_FILE" && "$(grep -E "^${key}=" "$ENV_FILE" || true)" != "" ]]; then
    awk -v k="$key" -v v="$formatted" 'BEGIN { re = "^" k "=" } $0 ~ re { print k "=" v; next } { print }' "$ENV_FILE" >"$tmp_file"
  else
    if [[ -f "$ENV_FILE" ]]; then
      cat "$ENV_FILE" >"$tmp_file"
    fi
    printf "%s=%s\n" "$key" "$formatted" >>"$tmp_file"
  fi
  mv "$tmp_file" "$ENV_FILE"
}

read_prompt() {
  local label="$1"
  local default_value="$2"
  local input=''
  read -r -p "$label [$default_value]: " input
  if [[ -z "$input" ]]; then
    input="$default_value"
  fi
  printf '%s' "$input"
}

read_secret_prompt() {
  local label="$1"
  local current_value="$2"
  local masked_hint="empty"
  if [[ -n "$current_value" ]]; then
    masked_hint="set"
  fi
  local input=''
  read -r -s -p "$label (currently $masked_hint; Enter to keep): " input
  echo
  if [[ -z "$input" ]]; then
    input="$current_value"
  fi
  printf '%s' "$input"
}

ask_yes_no() {
  local label="$1"
  local default_answer="$2"
  local prompt_suffix='y/N'
  if [[ "${default_answer,,}" == "y" ]]; then
    prompt_suffix='Y/n'
  fi
  local input=''
  read -r -p "$label [$prompt_suffix]: " input
  local normalized="${input,,}"
  if [[ -z "$normalized" ]]; then
    normalized="${default_answer,,}"
  fi
  [[ "$normalized" == "y" || "$normalized" == "yes" || "$normalized" == "1" || "$normalized" == "true" ]]
}

pick_from_choices() {
  local label="$1"
  local default_value="$2"
  shift 2
  local choices=("$@")
  local selected=''
  while true; do
    read -r -p "$label [$default_value]: " selected
    selected="${selected:-$default_value}"
    selected="${selected,,}"
    for item in "${choices[@]}"; do
      if [[ "$selected" == "$item" ]]; then
        printf '%s' "$selected"
        return
      fi
    done
    echo "Allowed values: ${choices[*]}"
  done
}

run_configure_env() {
  ensure_env_file
  run_fix_env_paths "quiet"
  echo
  echo "=== .env setup wizard ==="
  echo "File: $ENV_FILE"
  echo "Project root detected: $ROOT_DIR"
  echo

  local stt_primary_default
  stt_primary_default="$(get_env_value "CONSPECTOR_STT_PRIMARY" "groq")"
  local stt_primary
  stt_primary="$(pick_from_choices "STT primary (groq|whispercpp)" "$stt_primary_default" "groq" "whispercpp")"

  local stt_fallback_default
  stt_fallback_default="$(get_env_value "CONSPECTOR_STT_FALLBACK" "whispercpp")"
  if [[ "$stt_primary" == "whispercpp" && "$stt_fallback_default" != "none" ]]; then
    stt_fallback_default="none"
  fi
  local stt_fallback
  stt_fallback="$(pick_from_choices "STT fallback (whispercpp|none)" "$stt_fallback_default" "whispercpp" "none")"

  set_env_value "CONSPECTOR_STT_MODE" "real"
  set_env_value "CONSPECTOR_STT_PRIMARY" "$stt_primary"
  set_env_value "CONSPECTOR_STT_FALLBACK" "$stt_fallback"
  set_env_value "CONSPECTOR_STT_LANGUAGE" "$(read_prompt "STT language" "$(get_env_value "CONSPECTOR_STT_LANGUAGE" "ru")")"
  set_env_value "CONSPECTOR_STT_TIMEOUT_SEC" "$(read_prompt "STT timeout sec" "$(get_env_value "CONSPECTOR_STT_TIMEOUT_SEC" "1800")")"

  if [[ "$stt_primary" == "groq" ]]; then
    local groq_key_current
    groq_key_current="$(get_env_value "CONSPECTOR_GROQ_API_KEY" "")"
    local groq_key
    groq_key="$(read_secret_prompt "Groq API key" "$groq_key_current")"
    set_env_value "CONSPECTOR_GROQ_API_KEY" "$groq_key"
  fi
  set_env_value "CONSPECTOR_GROQ_MODEL" "$(read_prompt "Groq model" "$(get_env_value "CONSPECTOR_GROQ_MODEL" "whisper-large-v3-turbo")")"
  set_env_value "CONSPECTOR_GROQ_MAX_FILE_MB" "$(read_prompt "Groq max file size MB" "$(get_env_value "CONSPECTOR_GROQ_MAX_FILE_MB" "25")")"
  set_env_value "CONSPECTOR_GROQ_CHUNK_MIN" "$(read_prompt "Groq chunk length (minutes)" "$(get_env_value "CONSPECTOR_GROQ_CHUNK_MIN" "18")")"

  set_env_value "CONSPECTOR_WHISPERCPP_BIN" "$(read_prompt "whisper.cpp binary path" "$(normalize_project_path_value "$(get_env_value "CONSPECTOR_WHISPERCPP_BIN" "$DEFAULT_WHISPER_BIN")")")"
  set_env_value "CONSPECTOR_WHISPERCPP_MODEL_PATH" "$(read_prompt "whisper.cpp model path" "$(normalize_project_path_value "$(get_env_value "CONSPECTOR_WHISPERCPP_MODEL_PATH" "$DEFAULT_WHISPER_MODEL")")")"
  set_env_value "CONSPECTOR_WHISPERCPP_THREADS" "$(read_prompt "whisper.cpp threads" "$(get_env_value "CONSPECTOR_WHISPERCPP_THREADS" "2")")"
  set_env_value "CONSPECTOR_WHISPER_MODEL" "$(read_prompt "Whisper label (metadata)" "$(get_env_value "CONSPECTOR_WHISPER_MODEL" "base")")"

  set_env_value "CONSPECTOR_CODEX_MODE" "real"

  local llm_provider_default
  llm_provider_default="$(get_env_value "CONSPECTOR_LLM_PROVIDER" "codex")"
  local llm_provider
  llm_provider="$(pick_from_choices "LLM provider (codex|gemini)" "$llm_provider_default" "codex" "gemini")"
  set_env_value "CONSPECTOR_LLM_PROVIDER" "$llm_provider"

  if [[ "$llm_provider" == "codex" ]]; then
    set_env_value "CONSPECTOR_CODEX_EFFORT" "$(pick_from_choices "Codex effort (low|medium|high)" "$(get_env_value "CONSPECTOR_CODEX_EFFORT" "medium")" "low" "medium" "high")"
    set_env_value "CONSPECTOR_CODEX_TIMEOUT_SEC" "$(read_prompt "Codex timeout sec" "$(get_env_value "CONSPECTOR_CODEX_TIMEOUT_SEC" "600")")"
    set_env_value "CONSPECTOR_CODEX_WORKDIR" "$(read_prompt "Codex workdir" "$(normalize_project_path_value "$(get_env_value "CONSPECTOR_CODEX_WORKDIR" "$ROOT_DIR")")")"
    set_env_value "CONSPECTOR_CODEX_MODEL" "$(read_prompt "Codex model override (empty = default)" "$(get_env_value "CONSPECTOR_CODEX_MODEL" "")")"
  fi

  if [[ "$llm_provider" == "gemini" ]]; then
    local gemini_mode_default
    gemini_mode_default="$(get_env_value "CONSPECTOR_GEMINI_MODE" "real")"
    set_env_value "CONSPECTOR_GEMINI_MODE" "$(pick_from_choices "Gemini mode (real|mock)" "$gemini_mode_default" "real" "mock")"
    set_env_value "CONSPECTOR_GEMINI_TIMEOUT_SEC" "$(read_prompt "Gemini timeout sec" "$(get_env_value "CONSPECTOR_GEMINI_TIMEOUT_SEC" "600")")"
    set_env_value "CONSPECTOR_GEMINI_WORKDIR" "$(read_prompt "Gemini workdir" "$(normalize_project_path_value "$(get_env_value "CONSPECTOR_GEMINI_WORKDIR" "$ROOT_DIR")")")"
    set_env_value "CONSPECTOR_GEMINI_MODEL" "$(read_prompt "Gemini model (empty = default)" "$(get_env_value "CONSPECTOR_GEMINI_MODEL" "")")"
    set_env_value "CONSPECTOR_GEMINI_SANDBOX" "$(pick_from_choices "Gemini sandbox (true|false)" "$(get_env_value "CONSPECTOR_GEMINI_SANDBOX" "false")" "true" "false")"
  fi

  local notion_default='n'
  if [[ "$(get_env_value "CONSPECTOR_NOTION_MODE" "off")" == "real" ]]; then
    notion_default='y'
  fi
  if ask_yes_no "Enable Notion writeback?" "$notion_default"; then
    set_env_value "CONSPECTOR_NOTION_MODE" "real"
    local notion_token_current
    notion_token_current="$(get_env_value "NOTION_TOKEN" "")"
    set_env_value "NOTION_TOKEN" "$(read_secret_prompt "Notion token" "$notion_token_current")"
    set_env_value "CONSPECTOR_NOTION_ROOT_PAGE_ID" "$(read_prompt "Notion root page id" "$(get_env_value "CONSPECTOR_NOTION_ROOT_PAGE_ID" "")")"
    set_env_value "CONSPECTOR_NOTION_SOFT_FAIL" "$(pick_from_choices "Notion soft fail (true|false)" "$(get_env_value "CONSPECTOR_NOTION_SOFT_FAIL" "true")" "true" "false")"
  else
    set_env_value "CONSPECTOR_NOTION_MODE" "off"
  fi

  set_env_value "CONSPECTOR_WEB_PORT" "$(read_prompt "Web port" "$(get_env_value "CONSPECTOR_WEB_PORT" "8787")")"
  set_env_value "CONSPECTOR_ADMIN_EMAILS" "$(read_prompt "Admin emails (comma-separated)" "$(get_env_value "CONSPECTOR_ADMIN_EMAILS" "")")"
  set_env_value "CONSPECTOR_STT_FALLBACK_TO_MOCK" "$(pick_from_choices "Allow STT fallback to mock? (true|false)" "$(get_env_value "CONSPECTOR_STT_FALLBACK_TO_MOCK" "false")" "true" "false")"
  set_env_value "CONSPECTOR_CODEX_FALLBACK_TO_MOCK" "$(pick_from_choices "Allow LLM ($llm_provider) fallback to mock? (true|false)" "$(get_env_value "CONSPECTOR_CODEX_FALLBACK_TO_MOCK" "true")" "true" "false")"

  echo
  echo "Saved configuration to: $ENV_FILE"
  echo "Next steps:"
  echo "  1) ./run.sh --preflight"
  echo "  1.1) ./run.sh --env-doctor"
  echo "  2) ./run.sh --desktop-real   (Electron)"
  echo "  3) ./run.sh --web            (browser mode)"
  echo
}

cleanup_legacy_env_vars() {
  if [[ ! -f "$ENV_FILE" ]]; then
    return
  fi

  # Whitelist: every env var actually read by config.js, server.js, or run.sh
  local -a ACTIVE_VARS=(
    # STT
    CONSPECTOR_STT_MODE
    CONSPECTOR_STT_PRIMARY
    CONSPECTOR_STT_FALLBACK
    CONSPECTOR_STT_TIMEOUT_SEC
    CONSPECTOR_STT_LANGUAGE
    CONSPECTOR_STT_FALLBACK_TO_MOCK
    CONSPECTOR_WHISPER_MODEL
    # Groq
    CONSPECTOR_GROQ_API_KEY
    GROQ_API_KEY
    CONSPECTOR_GROQ_MODEL
    CONSPECTOR_GROQ_MAX_FILE_MB
    CONSPECTOR_GROQ_CHUNK_MIN
    # whisper.cpp
    CONSPECTOR_WHISPERCPP_BIN
    CONSPECTOR_WHISPERCPP_MODEL_PATH
    CONSPECTOR_WHISPERCPP_THREADS
    # LLM provider
    CONSPECTOR_LLM_PROVIDER
    # Codex
    CONSPECTOR_CODEX_MODE
    CONSPECTOR_CODEX_FULL_AUTO
    CONSPECTOR_CODEX_MODEL
    CONSPECTOR_CODEX_EFFORT
    CONSPECTOR_CODEX_TIMEOUT_SEC
    CONSPECTOR_CODEX_WORKDIR
    CONSPECTOR_CODEX_FALLBACK_TO_MOCK
    CONSPECTOR_SOURCE_NOTE_PATH
    # Gemini
    CONSPECTOR_GEMINI_MODE
    CONSPECTOR_GEMINI_MODEL
    CONSPECTOR_GEMINI_TIMEOUT_SEC
    CONSPECTOR_GEMINI_WORKDIR
    CONSPECTOR_GEMINI_SANDBOX
    # Notion
    CONSPECTOR_NOTION_MODE
    NOTION_TOKEN
    CONSPECTOR_NOTION_PAGE_ID
    CONSPECTOR_NOTION_PAGE_TITLE
    CONSPECTOR_NOTION_ROOT_PAGE_ID
    CONSPECTOR_NOTION_MERGE_WITH_EXISTING
    CONSPECTOR_NOTION_SOFT_FAIL
    # Web
    CONSPECTOR_WEB_PORT
    CONSPECTOR_WEB_DB_PATH
    CONSPECTOR_WEB_SESSION_DAYS
    CONSPECTOR_DATA_ROOT
    CONSPECTOR_ADMIN_EMAILS
    # Quality
    CONSPECTOR_HTML_SOFT_FAIL
    CONSPECTOR_PREFLIGHT_STRICT
    # Legacy STT (kept for bootstrap.sh compatibility)
    CONSPECTOR_STT_PYTHON
    CONSPECTOR_STT_SCRIPT
  )

  local removed=0
  local tmpfile
  tmpfile="$(mktemp)"

  while IFS= read -r line || [[ -n "$line" ]]; do
    # Keep comments and blank lines
    if [[ "$line" =~ ^[[:space:]]*# ]] || [[ -z "$line" ]]; then
      echo "$line" >> "$tmpfile"
      continue
    fi

    # Extract key (KEY=value)
    local key="${line%%=*}"
    key="${key#"${key%%[! ]*}"}"   # trim leading spaces

    local found=false
    for active in "${ACTIVE_VARS[@]}"; do
      if [[ "$key" == "$active" ]]; then
        found=true
        break
      fi
    done

    if $found; then
      echo "$line" >> "$tmpfile"
    else
      echo "  Removed: $key"
      (( removed++ )) || true
    fi
  done < "$ENV_FILE"

  if (( removed > 0 )); then
    mv "$tmpfile" "$ENV_FILE"
    echo "Cleaned up $removed legacy variable(s) from .env"
  else
    rm -f "$tmpfile"
    echo "No legacy variables found — .env is clean."
  fi
}

run_setup_all() {
  echo
  echo "==> Full server setup (all dependencies)"
  echo

  # 1. Node.js
  ensure_node_runtime_if_needed "setup-all"
  echo "[1/9] Node.js ready: $(node -v)"

  # 2. npm install
  ensure_npm_deps
  echo "[2/9] npm dependencies ready."

  # 3. Bootstrap (ffmpeg, whisper.cpp, model)
  scripts/bootstrap.sh
  echo "[3/9] Bootstrap complete (ffmpeg, whisper.cpp, model)."

  # 4. Configure .env (API keys wizard)
  echo "[4/9] Configuring API keys and environment..."
  run_configure_env

  # 5. Clean up legacy vars
  echo "[5/9] Cleaning up legacy .env variables..."
  cleanup_legacy_env_vars

  # 6. Fix paths
  run_fix_env_paths "silent"
  echo "[6/9] .env paths auto-fixed."

  # 7. Gemini skills
  if [[ -x "$ROOT_DIR/scripts/setup-gemini-skills.sh" ]]; then
    bash "$ROOT_DIR/scripts/setup-gemini-skills.sh"
    echo "[7/9] Gemini CLI skills ready."
  else
    echo "[7/9] Gemini skills setup skipped (script not found)."
  fi

  # 8. Env doctor
  echo "[8/9] Running env doctor..."
  node scripts/env-doctor.js || true

  # 9. Done
  echo
  echo "[9/9] Setup complete!"
  echo "  Run:  ./run.sh --web"
  echo
}

run_bootstrap() {
  local mode="${1:-prompt}"
  ensure_node_runtime_if_needed "bootstrap"
  ensure_npm_deps
  if [[ "$OS_NAME" == "Linux" && "$mode" == "web" ]]; then
    scripts/bootstrap.sh --ubuntu-web
    return
  fi
  if [[ "$OS_NAME" == "Linux" && "$mode" == "prompt" ]]; then
    read -r -p "Enable Ubuntu web stack setup (Docker + Nginx)? [y/N] " answer
    if [[ "${answer,,}" == "y" ]]; then
      scripts/bootstrap.sh --ubuntu-web
      return
    fi
  fi
  scripts/bootstrap.sh
}

run_preflight() {
  ensure_node_runtime_if_needed "preflight"
  ensure_npm_deps
  local mode="${1:-prompt}"
  if [[ "$mode" == "strict" ]]; then
    CONSPECTOR_PREFLIGHT_STRICT=true npm run preflight
    return
  fi
  if [[ "$mode" == "default" ]]; then
    npm run preflight
    return
  fi
  read -r -p "Strict preflight mode? [y/N] " answer
  if [[ "${answer,,}" == "y" ]]; then
    CONSPECTOR_PREFLIGHT_STRICT=true npm run preflight
  else
    npm run preflight
  fi
}

run_desktop() {
  ensure_node_runtime_if_needed "desktop"
  ensure_npm_deps
  npm start
}

run_desktop_real() {
  ensure_node_runtime_if_needed "desktop-real"
  ensure_npm_deps
  npm run start:real
}

run_web() {
  ensure_node_runtime_if_needed "web"
  ensure_npm_deps

  if [[ "$OS_NAME" != "Linux" ]]; then
    # macOS / dev mode — foreground
    npm run start:web
    return
  fi

  # ── Linux production mode ──
  echo
  echo "==> Starting ABI Conspector (production mode)"
  echo

  # 1. Stop previous instance if running
  if [[ -f "$ROOT_DIR/.node.pid" ]]; then
    local old_pid
    old_pid="$(cat "$ROOT_DIR/.node.pid" 2>/dev/null || true)"
    if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
      echo "Stopping previous Node.js instance (PID $old_pid)..."
      kill "$old_pid" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$ROOT_DIR/.node.pid"
  fi

  # 2. Start Node.js backend in background
  echo "[1/3] Starting Node.js backend on port 8787..."
  nohup node -r dotenv/config web/server.js > "$ROOT_DIR/logs/web-server.log" 2>&1 &
  local node_pid=$!
  echo "$node_pid" > "$ROOT_DIR/.node.pid"
  echo "  Node.js PID: $node_pid"
  echo "  Logs: $ROOT_DIR/logs/web-server.log"

  # Wait a moment for Node to start
  sleep 2
  if ! kill -0 "$node_pid" 2>/dev/null; then
    echo "ERROR: Node.js failed to start. Check logs:"
    tail -20 "$ROOT_DIR/logs/web-server.log" 2>/dev/null || true
    return 1
  fi

  # 3. Start Docker + Nginx reverse proxy
  echo "[2/3] Starting Nginx reverse proxy (Docker)..."
  ensure_docker_ready
  CONSPECTOR_WEB_ROOT="$ROOT_DIR/web" \
    docker compose -f "$ROOT_DIR/deploy/ubuntu-web/docker-compose.yml" up -d

  # 4. Done
  local server_ip
  server_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'your-server-ip')"
  echo
  echo "[3/3] ABI Conspector is live!"
  echo
  echo "  Local:    http://localhost:8787"
  echo "  External: http://${server_ip}"
  echo
  echo "  Manage:"
  echo "    Logs:    tail -f $ROOT_DIR/logs/web-server.log"
  echo "    Stop:    ./run.sh --stop-web"
  echo "    Status:  ./run.sh --status-web"
  echo
}

run_tests() {
  ensure_node_runtime_if_needed "test"
  ensure_npm_deps
  npm test
}

run_env_doctor() {
  ensure_node_runtime_if_needed "env-doctor"
  local mode="${1:-readonly}"
  if [[ "$mode" == "write" ]]; then
    node scripts/env-doctor.js --write
    return
  fi
  node scripts/env-doctor.js
}

install_docker_ubuntu() {
  echo "Installing Docker Engine for Ubuntu..."
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  fi
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

ensure_docker_ready() {
  if [[ "$OS_NAME" != "Linux" ]]; then
    if ! command -v docker >/dev/null 2>&1; then
      echo "Docker is required but not installed."
      echo "Install Docker Desktop for macOS: https://docs.docker.com/desktop/install/mac-install/"
      exit 1
    fi
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is not installed."
    if ask_yes_no "Install Docker Engine now (Ubuntu/apt)?" "y"; then
      install_docker_ubuntu
    else
      echo "Docker is required. Install manually and retry."
      exit 1
    fi
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "Docker daemon is not running. Starting..."
    sudo systemctl start docker
    sudo systemctl enable docker
    sleep 2
    if ! docker info >/dev/null 2>&1; then
      echo "Failed to start Docker daemon."
      exit 1
    fi
    echo "Docker daemon started."
  fi

  if ! groups "$USER" | grep -q '\bdocker\b'; then
    echo "Adding $USER to docker group..."
    sudo usermod -aG docker "$USER"
    echo "Added. You may need to log out and back in for group changes to take effect."
  fi
}

run_ubuntu_web_stack() {
  ensure_docker_ready
  docker compose -f deploy/ubuntu-web/docker-compose.yml up -d
  echo "Ubuntu web stack is up."
}

run_setup_gemini() {
  if [[ ! -x "$ROOT_DIR/scripts/setup-gemini-skills.sh" ]]; then
    echo "Error: scripts/setup-gemini-skills.sh not found or not executable."
    exit 1
  fi
  bash "$ROOT_DIR/scripts/setup-gemini-skills.sh"
}

run_stop_web() {
  echo "Stopping ABI Conspector..."

  # Stop Node.js
  if [[ -f "$ROOT_DIR/.node.pid" ]]; then
    local pid
    pid="$(cat "$ROOT_DIR/.node.pid" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      echo "  Node.js (PID $pid) stopped."
    else
      echo "  Node.js was not running."
    fi
    rm -f "$ROOT_DIR/.node.pid"
  else
    echo "  No .node.pid file found."
  fi

  # Stop Docker Nginx
  if command -v docker >/dev/null 2>&1 && docker ps -q -f name=abi-conspector-nginx 2>/dev/null | grep -q .; then
    docker compose -f "$ROOT_DIR/deploy/ubuntu-web/docker-compose.yml" down
    echo "  Nginx container stopped."
  else
    echo "  Nginx container was not running."
  fi

  echo "Done."
}

run_status_web() {
  echo "=== ABI Conspector status ==="
  echo

  # Node.js
  if [[ -f "$ROOT_DIR/.node.pid" ]]; then
    local pid
    pid="$(cat "$ROOT_DIR/.node.pid" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "  Node.js:  RUNNING (PID $pid)"
    else
      echo "  Node.js:  STOPPED (stale PID file)"
    fi
  else
    echo "  Node.js:  STOPPED"
  fi

  # Nginx
  if command -v docker >/dev/null 2>&1 && docker ps -q -f name=abi-conspector-nginx 2>/dev/null | grep -q .; then
    echo "  Nginx:    RUNNING (container abi-conspector-nginx)"
  else
    echo "  Nginx:    STOPPED"
  fi

  # Logs
  if [[ -f "$ROOT_DIR/logs/web-server.log" ]]; then
    echo
    echo "  Last 5 log lines:"
    tail -5 "$ROOT_DIR/logs/web-server.log" | sed 's/^/    /'
  fi
  echo
}

show_menu() {
  cat <<'MSG'
1) Configure .env (wizard)
2) Auto-fix .env template paths (to absolute project path)
3) Env doctor (validate env variables)
4) Bootstrap dependencies
5) Preflight check
6) Start desktop app (Electron)
7) Start desktop app (real mode)
8) Start web app (Linux: full production stack)
9) Run tests
10) Setup Gemini CLI skills
11) FULL SETUP (all deps + env + bootstrap)
12) Stop web app
13) Web app status
14) Exit
MSG
}

run_interactive() {
  print_header
  while true; do
    show_menu
    read -r -p "Choose action [1-14]: " choice
    case "$choice" in
      1) run_configure_env ;;
      2) run_fix_env_paths "verbose" ;;
      3) run_env_doctor "readonly" ;;
      4) run_bootstrap "prompt" ;;
      5) run_preflight "prompt" ;;
      6) run_desktop ;;
      7) run_desktop_real ;;
      8) run_web ;;
      9) run_tests ;;
      10) run_setup_gemini ;;
      11) run_setup_all ;;
      12) run_stop_web ;;
      13) run_status_web ;;
      14) exit 0 ;;
      *) echo "Unknown option: $choice" ;;
    esac
  done
}

print_help() {
  cat <<'MSG'
Usage:
  ./run.sh                 # interactive mode
  ./run.sh --configure-env
  ./run.sh --fix-env-paths
  ./run.sh --env-doctor
  ./run.sh --env-doctor-write
  ./run.sh --bootstrap
  ./run.sh --bootstrap-web
  ./run.sh --preflight
  ./run.sh --preflight-strict
  ./run.sh --desktop
  ./run.sh --desktop-real
  ./run.sh --web               # Linux: full stack; macOS: dev mode
  ./run.sh --stop-web           # stop Node.js + Nginx
  ./run.sh --status-web         # check if running
  ./run.sh --test
  ./run.sh --setup-gemini
  ./run.sh --setup-all          # FULL SETUP: node, npm, bootstrap, env, skills
  ./run.sh --help
MSG
}

if [[ $# -eq 0 ]]; then
  run_interactive
  exit 0
fi

case "${1:-}" in
  --configure-env) run_configure_env ;;
  --fix-env-paths) run_fix_env_paths "verbose" ;;
  --env-doctor) run_env_doctor "readonly" ;;
  --env-doctor-write) run_env_doctor "write" ;;
  --bootstrap) run_bootstrap "default" ;;
  --bootstrap-web) run_bootstrap "web" ;;
  --preflight) run_preflight "default" ;;
  --preflight-strict) run_preflight "strict" ;;
  --desktop) run_desktop ;;
  --desktop-real) run_desktop_real ;;
  --web) run_web ;;
  --stop-web) run_stop_web ;;
  --status-web) run_status_web ;;
  --test) run_tests ;;
  --ubuntu-web-stack) run_ubuntu_web_stack ;;
  --setup-gemini) run_setup_gemini ;;
  --setup-all) run_setup_all ;;
  --help|-h) print_help ;;
  *)
    echo "Unknown argument: $1"
    print_help
    exit 1
    ;;
esac
