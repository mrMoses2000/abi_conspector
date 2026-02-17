#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS_DIR="$ROOT_DIR/tools"
WHISPER_DIR="$TOOLS_DIR/whisper.cpp"
MODEL_DIR="$ROOT_DIR/models"
DEFAULT_MODEL_NAME="${CONSPECTOR_WHISPERCPP_MODEL_NAME:-base}"
DEFAULT_MODEL_FILE="$MODEL_DIR/ggml-${DEFAULT_MODEL_NAME}.bin"

print_step() {
  printf "\n==> %s\n" "$1"
}

ensure_brew() {
  if command -v brew >/dev/null 2>&1; then
    return
  fi
  echo "Homebrew is required on macOS: https://brew.sh"
  exit 1
}

install_macos_deps() {
  print_step "Installing macOS dependencies via brew"
  ensure_brew
  brew install ffmpeg cmake make git pkg-config
}

install_ubuntu_deps() {
  print_step "Installing Ubuntu dependencies via apt"
  sudo apt-get update
  sudo apt-get install -y ffmpeg build-essential cmake git curl pkg-config
}

install_ubuntu_web_deps() {
  print_step "Installing Docker + Compose for Ubuntu web mode"
  sudo apt-get install -y ca-certificates gnupg
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

build_whisper_cpp() {
  print_step "Building whisper.cpp"
  mkdir -p "$TOOLS_DIR"
  if [[ ! -d "$WHISPER_DIR/.git" ]]; then
    git clone https://github.com/ggml-org/whisper.cpp.git "$WHISPER_DIR"
  fi
  git -C "$WHISPER_DIR" pull --ff-only
  cmake -S "$WHISPER_DIR" -B "$WHISPER_DIR/build"
  cmake --build "$WHISPER_DIR/build" --config Release -j"$(getconf _NPROCESSORS_ONLN)"
}

download_model() {
  print_step "Downloading whisper.cpp model (${DEFAULT_MODEL_NAME})"
  mkdir -p "$MODEL_DIR"
  if [[ -f "$DEFAULT_MODEL_FILE" ]]; then
    echo "Model already exists: $DEFAULT_MODEL_FILE"
    return
  fi
  "$WHISPER_DIR/models/download-ggml-model.sh" "$DEFAULT_MODEL_NAME"
  cp "$WHISPER_DIR/models/ggml-${DEFAULT_MODEL_NAME}.bin" "$DEFAULT_MODEL_FILE"
}

print_env_hint() {
  local whisper_bin="$WHISPER_DIR/build/bin/whisper-cli"
  cat <<MSG

Bootstrap completed.

Use these .env values:
CONSPECTOR_STT_MODE=real
CONSPECTOR_STT_PRIMARY=groq
CONSPECTOR_STT_FALLBACK=whispercpp
CONSPECTOR_GROQ_API_KEY=<your_key>
CONSPECTOR_WHISPERCPP_BIN=$whisper_bin
CONSPECTOR_WHISPERCPP_MODEL_PATH=$DEFAULT_MODEL_FILE
CONSPECTOR_STT_FALLBACK_TO_MOCK=false

MSG
}

start_ubuntu_web_stack() {
  print_step "Starting Ubuntu web stack (Nginx)"
  docker compose -f "$ROOT_DIR/deploy/ubuntu-web/docker-compose.yml" up -d
}

main() {
  local with_web=0
  if [[ "${1:-}" == "--ubuntu-web" ]]; then
    with_web=1
  fi

  case "$(uname -s)" in
    Darwin)
      install_macos_deps
      ;;
    Linux)
      install_ubuntu_deps
      if [[ "$with_web" -eq 1 ]]; then
        install_ubuntu_web_deps
      fi
      ;;
    *)
      echo "Unsupported OS: $(uname -s)"
      exit 1
      ;;
  esac

  build_whisper_cpp
  download_model
  print_env_hint

  if [[ "$(uname -s)" == "Linux" && "$with_web" -eq 1 ]]; then
    start_ubuntu_web_stack
  fi
}

main "$@"

