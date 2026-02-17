#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/.env"
ENV_TEMPLATE="$ROOT_DIR/.env.example"
DEFAULT_WHISPER_BIN="$ROOT_DIR/tools/whisper.cpp/build/bin/whisper-cli"
DEFAULT_WHISPER_MODEL="$ROOT_DIR/models/ggml-base.bin"

OS_NAME="$(uname -s)"
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
  echo
  echo "=== .env setup wizard ==="
  echo "File: $ENV_FILE"
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

  set_env_value "CONSPECTOR_WHISPERCPP_BIN" "$(read_prompt "whisper.cpp binary path" "$(get_env_value "CONSPECTOR_WHISPERCPP_BIN" "$DEFAULT_WHISPER_BIN")")"
  set_env_value "CONSPECTOR_WHISPERCPP_MODEL_PATH" "$(read_prompt "whisper.cpp model path" "$(get_env_value "CONSPECTOR_WHISPERCPP_MODEL_PATH" "$DEFAULT_WHISPER_MODEL")")"
  set_env_value "CONSPECTOR_WHISPERCPP_THREADS" "$(read_prompt "whisper.cpp threads" "$(get_env_value "CONSPECTOR_WHISPERCPP_THREADS" "2")")"
  set_env_value "CONSPECTOR_WHISPER_MODEL" "$(read_prompt "Whisper label (metadata)" "$(get_env_value "CONSPECTOR_WHISPER_MODEL" "base")")"

  set_env_value "CONSPECTOR_CODEX_MODE" "real"
  set_env_value "CONSPECTOR_CODEX_EFFORT" "$(pick_from_choices "Codex effort (low|medium|high)" "$(get_env_value "CONSPECTOR_CODEX_EFFORT" "medium")" "low" "medium" "high")"
  set_env_value "CONSPECTOR_CODEX_TIMEOUT_SEC" "$(read_prompt "Codex timeout sec" "$(get_env_value "CONSPECTOR_CODEX_TIMEOUT_SEC" "600")")"
  set_env_value "CONSPECTOR_CODEX_WORKDIR" "$(read_prompt "Codex workdir" "$(get_env_value "CONSPECTOR_CODEX_WORKDIR" "$ROOT_DIR")")"
  set_env_value "CONSPECTOR_CODEX_MODEL" "$(read_prompt "Codex model override (empty = default)" "$(get_env_value "CONSPECTOR_CODEX_MODEL" "")")"

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
  set_env_value "CONSPECTOR_CODEX_FALLBACK_TO_MOCK" "$(pick_from_choices "Allow Codex fallback to mock? (true|false)" "$(get_env_value "CONSPECTOR_CODEX_FALLBACK_TO_MOCK" "true")" "true" "false")"

  echo
  echo "Saved configuration to: $ENV_FILE"
  echo "Next steps:"
  echo "  1) ./run.sh --preflight"
  echo "  2) ./run.sh --desktop-real   (Electron)"
  echo "  3) ./run.sh --web            (browser mode)"
  echo
}

run_bootstrap() {
  local mode="${1:-prompt}"
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
  npm start
}

run_desktop_real() {
  ensure_node_runtime_if_needed "desktop-real"
  npm run start:real
}

run_web() {
  ensure_node_runtime_if_needed "web"
  npm run start:web
}

run_tests() {
  ensure_node_runtime_if_needed "test"
  npm test
}

run_ubuntu_web_stack() {
  if [[ "$OS_NAME" != "Linux" ]]; then
    echo "Ubuntu web stack is only available on Linux."
    return
  fi
  docker compose -f deploy/ubuntu-web/docker-compose.yml up -d
  echo "Ubuntu web stack is up."
}

show_menu() {
  cat <<'MSG'
1) Configure .env (wizard)
2) Bootstrap dependencies
3) Preflight check
4) Start desktop app (Electron)
5) Start desktop app (real mode)
6) Start web app (accounts/roles/shared view)
7) Run tests
8) Start Ubuntu web stack (Docker + Nginx)
9) Exit
MSG
}

run_interactive() {
  print_header
  while true; do
    show_menu
    read -r -p "Choose action [1-9]: " choice
    case "$choice" in
      1) run_configure_env ;;
      2) run_bootstrap "prompt" ;;
      3) run_preflight "prompt" ;;
      4) run_desktop ;;
      5) run_desktop_real ;;
      6) run_web ;;
      7) run_tests ;;
      8) run_ubuntu_web_stack ;;
      9) exit 0 ;;
      *) echo "Unknown option: $choice" ;;
    esac
  done
}

print_help() {
  cat <<'MSG'
Usage:
  ./run.sh                 # interactive mode
  ./run.sh --configure-env
  ./run.sh --bootstrap
  ./run.sh --bootstrap-web
  ./run.sh --preflight
  ./run.sh --preflight-strict
  ./run.sh --desktop
  ./run.sh --desktop-real
  ./run.sh --web
  ./run.sh --test
  ./run.sh --ubuntu-web-stack
  ./run.sh --help
MSG
}

if [[ $# -eq 0 ]]; then
  run_interactive
  exit 0
fi

case "${1:-}" in
  --configure-env) run_configure_env ;;
  --bootstrap) run_bootstrap "default" ;;
  --bootstrap-web) run_bootstrap "web" ;;
  --preflight) run_preflight "default" ;;
  --preflight-strict) run_preflight "strict" ;;
  --desktop) run_desktop ;;
  --desktop-real) run_desktop_real ;;
  --web) run_web ;;
  --test) run_tests ;;
  --ubuntu-web-stack) run_ubuntu_web_stack ;;
  --help|-h) print_help ;;
  *)
    echo "Unknown argument: $1"
    print_help
    exit 1
    ;;
esac
