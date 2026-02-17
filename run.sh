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
  set_env_value "CONSPECTOR_CODEX_EFFORT" "$(pick_from_choices "Codex effort (low|medium|high)" "$(get_env_value "CONSPECTOR_CODEX_EFFORT" "medium")" "low" "medium" "high")"
  set_env_value "CONSPECTOR_CODEX_TIMEOUT_SEC" "$(read_prompt "Codex timeout sec" "$(get_env_value "CONSPECTOR_CODEX_TIMEOUT_SEC" "600")")"
  set_env_value "CONSPECTOR_CODEX_WORKDIR" "$(read_prompt "Codex workdir" "$(normalize_project_path_value "$(get_env_value "CONSPECTOR_CODEX_WORKDIR" "$ROOT_DIR")")")"
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
  echo "  1.1) ./run.sh --env-doctor"
  echo "  2) ./run.sh --desktop-real   (Electron)"
  echo "  3) ./run.sh --web            (browser mode)"
  echo
}

run_setup_all() {
  echo
  echo "==> Full server setup (all dependencies)"
  echo

  # 1. Node.js
  ensure_node_runtime_if_needed "setup-all"
  echo "[1/7] Node.js ready: $(node -v)"

  # 2. npm install
  ensure_npm_deps
  echo "[2/7] npm dependencies ready."

  # 3. Bootstrap (ffmpeg, whisper.cpp, model)
  scripts/bootstrap.sh
  echo "[3/7] Bootstrap complete (ffmpeg, whisper.cpp, model)."

  # 4. .env
  ensure_env_file
  echo "[4/7] .env file ready."

  # 5. Fix paths
  run_fix_env_paths "silent"
  echo "[5/7] .env paths auto-fixed."

  # 6. Gemini skills
  if [[ -x "$ROOT_DIR/scripts/setup-gemini-skills.sh" ]]; then
    bash "$ROOT_DIR/scripts/setup-gemini-skills.sh"
    echo "[6/7] Gemini CLI skills ready."
  else
    echo "[6/7] Gemini skills setup skipped (script not found)."
  fi

  # 7. Env doctor
  echo "[7/7] Running env doctor..."
  node scripts/env-doctor.js || true

  echo
  echo "Setup complete! Next steps:"
  echo "  1) Edit .env — add CONSPECTOR_GROQ_API_KEY and choose CONSPECTOR_LLM_PROVIDER"
  echo "  2) Run:  ./run.sh --web"
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
  npm run start:web
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

show_menu() {
  cat <<'MSG'
1) Configure .env (wizard)
2) Auto-fix .env template paths (to absolute project path)
3) Env doctor (validate env variables)
4) Bootstrap dependencies
5) Preflight check
6) Start desktop app (Electron)
7) Start desktop app (real mode)
8) Start web app (accounts/roles/shared view)
9) Run tests
10) Start Ubuntu web stack (Docker + Nginx)
11) Setup Gemini CLI skills
12) FULL SETUP (all deps + env + bootstrap)
13) Exit
MSG
}

run_interactive() {
  print_header
  while true; do
    show_menu
    read -r -p "Choose action [1-13]: " choice
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
      10) run_ubuntu_web_stack ;;
      11) run_setup_gemini ;;
      12) run_setup_all ;;
      13) exit 0 ;;
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
  ./run.sh --web
  ./run.sh --test
  ./run.sh --ubuntu-web-stack
  ./run.sh --setup-gemini
  ./run.sh --setup-all       # FULL SETUP: node, npm, bootstrap, env, skills
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
