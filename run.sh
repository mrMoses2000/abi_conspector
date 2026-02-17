#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

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
  npm start
}

run_desktop_real() {
  npm run start:real
}

run_web() {
  npm run start:web
}

run_tests() {
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
1) Bootstrap dependencies
2) Preflight check
3) Start desktop app (Electron)
4) Start desktop app (real mode)
5) Start web app (accounts/roles/shared view)
6) Run tests
7) Start Ubuntu web stack (Docker + Nginx)
8) Exit
MSG
}

run_interactive() {
  print_header
  while true; do
    show_menu
    read -r -p "Choose action [1-8]: " choice
    case "$choice" in
      1) run_bootstrap "prompt" ;;
      2) run_preflight "prompt" ;;
      3) run_desktop ;;
      4) run_desktop_real ;;
      5) run_web ;;
      6) run_tests ;;
      7) run_ubuntu_web_stack ;;
      8) exit 0 ;;
      *) echo "Unknown option: $choice" ;;
    esac
  done
}

print_help() {
  cat <<'MSG'
Usage:
  ./run.sh                 # interactive mode
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
