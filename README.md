# ABI Conspector (Desktop MVP v3)

Electron desktop app for lecture note processing:

1. `normalize_audio` (ffmpeg -> flac mono 16k)
2. `stt_diarization` (STT v2: `Groq chunking` primary + `whisper.cpp` fallback)
3. `codex_structure` (`codex exec`)
4. `merge` (`codex exec`)
5. `render_html`
6. `notion_writeback` (optional)

## Desktop controls

- `Начать запись` / `Стоп`
- `Добавить аудио файл`
- `Профиль Codex (low|medium|high)`
- `Название подстраницы Notion` (ручной ввод, без `prompt()`)
- `Открыть HTML`, `Открыть merged.md`, `Повторить задачу`, `Комбинировать с Notion`
- `Очистить упавшие`

## Install

```bash
npm install
```

## Unified launcher (`run.sh`)

```bash
chmod +x run.sh
./run.sh
```

Interactive launcher provides one menu for:

- bootstrap dependencies
- preflight
- desktop start
- web start (accounts/roles/shared view)
- Ubuntu web stack start (Docker + Nginx)

Non-interactive mode:

```bash
./run.sh --bootstrap
./run.sh --bootstrap-web
./run.sh --preflight
./run.sh --preflight-strict
./run.sh --desktop
./run.sh --desktop-real
./run.sh --web
./run.sh --ubuntu-web-stack
```

## Unified bootstrap (macOS + Ubuntu)

```bash
scripts/bootstrap.sh
```

Ubuntu with Docker/Nginx web stack:

```bash
scripts/bootstrap.sh --ubuntu-web
```

## Required runtime for real workers

- Node.js 24+
- `ffmpeg`, `ffprobe`
- `codex` CLI
- `whisper.cpp` binary + model file
- Groq API key (if `CONSPECTOR_STT_PRIMARY=groq`)

## Environment variables

### STT v2

- `CONSPECTOR_STT_MODE=real|mock` (default: `real`)
- `CONSPECTOR_STT_PRIMARY=groq|whispercpp` (default: `groq`)
- `CONSPECTOR_STT_FALLBACK=whispercpp|none` (default: `whispercpp`)
- `CONSPECTOR_STT_TIMEOUT_SEC=1800`
- `CONSPECTOR_STT_LANGUAGE=ru`
- `CONSPECTOR_STT_FALLBACK_TO_MOCK=true|false` (default: `false`, recommended for production)

Groq:

- `CONSPECTOR_GROQ_API_KEY=...` (or `GROQ_API_KEY`)
- `CONSPECTOR_GROQ_MODEL=whisper-large-v3-turbo`
- `CONSPECTOR_GROQ_MAX_FILE_MB=25`
- `CONSPECTOR_GROQ_CHUNK_MIN=18`

whisper.cpp:

- `CONSPECTOR_WHISPERCPP_BIN=/abs/path/to/whisper-cli`
- `CONSPECTOR_WHISPERCPP_MODEL_PATH=/abs/path/to/ggml-*.bin`
- `CONSPECTOR_WHISPERCPP_THREADS=2`
- `CONSPECTOR_WHISPER_MODEL=base` (metadata label only)

### Codex workers

- `CONSPECTOR_CODEX_MODE=real|mock`
- `CONSPECTOR_CODEX_FULL_AUTO=true|false`
- `CONSPECTOR_CODEX_MODEL=<optional>`
- `CONSPECTOR_CODEX_EFFORT=low|medium|high`
- `CONSPECTOR_CODEX_TIMEOUT_SEC=600`
- `CONSPECTOR_CODEX_WORKDIR=/path/to/workdir`
- `CONSPECTOR_SOURCE_NOTE_PATH=/path/to/base_note.md`
- `CONSPECTOR_CODEX_FALLBACK_TO_MOCK=true|false`

### Notion writeback

- `CONSPECTOR_NOTION_MODE=off|real`
- `NOTION_TOKEN=...`
- `CONSPECTOR_NOTION_ROOT_PAGE_ID=<root id for nested pages>`
- UI field `Название подстраницы Notion` is required for manual target selection.
- If page is not found under root, writeback fails with suggestions (no auto-create, no root fallback).
- Notion API integration is supported on both macOS and Linux.

### Web mode (accounts and roles)

- `CONSPECTOR_WEB_PORT=8787`
- `CONSPECTOR_WEB_DB_PATH=/abs/path/to/web.db` (optional)
- `CONSPECTOR_WEB_SESSION_DAYS=30`
- `CONSPECTOR_ADMIN_EMAILS=admin1@example.com,admin2@example.com`

Behavior:

- Any user can register/login and view shared conspects list.
- Admin users (email in `CONSPECTOR_ADMIN_EMAILS`) can:
  - list users
  - trigger Notion writeback manually (`recordingId + pageTitle`).

### Resilience

- `CONSPECTOR_NOTION_SOFT_FAIL=true|false`
- `CONSPECTOR_HTML_SOFT_FAIL=true|false`
- `CONSPECTOR_PREFLIGHT_STRICT=true|false`

## Preflight

```bash
npm run preflight
```

## Start

```bash
npm start
```

## Start web mode

```bash
npm run start:web
```

## Real launch

```bash
npm run start:real
```

## Tests

```bash
npm test
```
