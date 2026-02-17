# ABI Conspector (Desktop MVP v3)

Приложение для обработки лекций:

1. `normalize_audio` (`ffmpeg -> flac mono 16k`)
2. `stt_diarization` (STT v2: `Groq chunking` как primary + `whisper.cpp` как fallback)
3. `codex_structure` (`codex exec`)
4. `merge` (`codex exec`)
5. `render_html`
6. `notion_writeback` (опционально)

## Управление в desktop

- `Начать запись` / `Стоп`
- `Добавить аудио файл`
- `Профиль Codex (low|medium|high)`
- `Название подстраницы Notion` (ручной ввод, без `prompt()`)
- `Открыть HTML`, `Открыть merged.md`, `Повторить задачу`, `Комбинировать с Notion`
- `Очистить упавшие`

## Установка

```bash
npm install
```

## Полные руководства (RU)

- `/Users/mosesvasilenko/abi_conspector/docs/SETUP_AND_KEYS_RU.md`
- `/Users/mosesvasilenko/abi_conspector/docs/RUNBOOK_FULL_RU.md`
- `/Users/mosesvasilenko/abi_conspector/docs/CAUSAL_LOGIC_FULL_RU.md`
- `/Users/mosesvasilenko/abi_conspector/docs/CODEX_CLI_SSH_SERVER_RU.md`
- `/Users/mosesvasilenko/abi_conspector/docs/visual-agent-brief.md` (бриф для отдельного ИИ-агента по визуалу)

Что есть в документации:
- пошаговая настройка
- где брать ключи (Groq / Notion / Codex / HF legacy)
- диагностика сбоев
- check-list preflight и тестов
- где лежат данные и логи
- подробная причинно-следственная логика системы

## Единый запуск через `run.sh`

```bash
chmod +x run.sh
./run.sh
```

Интерактивное меню включает:
- мастер настройки `.env` (без ручного редактирования файла)
- авто-проверку/предложение установки `Node.js 24 + npm` на Ubuntu
- установку зависимостей
- preflight
- запуск desktop режима
- запуск web режима (аккаунты/роли)
- запуск Ubuntu web stack (`Docker + Nginx`)

Непосредственные опции:

```bash
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
```

## Bootstrap для macOS/Ubuntu

```bash
scripts/bootstrap.sh
```

Для Ubuntu с web stack:

```bash
scripts/bootstrap.sh --ubuntu-web
```

## Что нужно для real-режима

- Node.js `24+`
- `ffmpeg`, `ffprobe`
- `codex` CLI
- бинарь `whisper.cpp` (`whisper-cli`) и модель `ggml-*.bin`
- Groq API key (если `CONSPECTOR_STT_PRIMARY=groq`)

## Основные переменные окружения

## STT v2

- `CONSPECTOR_STT_MODE=real|mock` (по умолчанию `real`)
- `CONSPECTOR_STT_PRIMARY=groq|whispercpp` (по умолчанию `groq`)
- `CONSPECTOR_STT_FALLBACK=whispercpp|none` (по умолчанию `whispercpp`)
- `CONSPECTOR_STT_TIMEOUT_SEC=1800`
- `CONSPECTOR_STT_LANGUAGE=ru`
- `CONSPECTOR_STT_FALLBACK_TO_MOCK=true|false` (рекомендуется `false` для production)

Groq:
- `CONSPECTOR_GROQ_API_KEY=...` (или `GROQ_API_KEY`)
- `CONSPECTOR_GROQ_MODEL=whisper-large-v3-turbo`
- `CONSPECTOR_GROQ_MAX_FILE_MB=25`
- `CONSPECTOR_GROQ_CHUNK_MIN=18`

whisper.cpp:
- `CONSPECTOR_WHISPERCPP_BIN=/abs/path/to/whisper-cli`
- `CONSPECTOR_WHISPERCPP_MODEL_PATH=/abs/path/to/ggml-*.bin`
- `CONSPECTOR_WHISPERCPP_THREADS=2`
- `CONSPECTOR_WHISPER_MODEL=base` (метка модели в метаданных)

## Codex workers

- `CONSPECTOR_CODEX_MODE=real|mock`
- `CONSPECTOR_CODEX_FULL_AUTO=true|false`
- `CONSPECTOR_CODEX_MODEL=<optional>`
- `CONSPECTOR_CODEX_EFFORT=low|medium|high`
- `CONSPECTOR_CODEX_TIMEOUT_SEC=600`
- `CONSPECTOR_CODEX_WORKDIR=/path/to/workdir`
- `CONSPECTOR_SOURCE_NOTE_PATH=/path/to/base_note.md`
- `CONSPECTOR_CODEX_FALLBACK_TO_MOCK=true|false`

## Notion writeback

- `CONSPECTOR_NOTION_MODE=off|real`
- `NOTION_TOKEN=...`
- `CONSPECTOR_NOTION_ROOT_PAGE_ID=<root page id для вложенных страниц>`
- target выбирается через поле `Название подстраницы Notion` в GUI
- если page не найдена в root, возвращается controlled error + suggestions
- интеграция Notion работает и на macOS, и на Linux

## Web режим (аккаунты и роли)

- `CONSPECTOR_WEB_PORT=8787`
- `CONSPECTOR_WEB_DB_PATH=/abs/path/to/web.db` (опционально)
- `CONSPECTOR_WEB_SESSION_DAYS=30`
- `CONSPECTOR_ADMIN_EMAILS=admin1@example.com,admin2@example.com`

Поведение:
- любой зарегистрированный пользователь видит общий список конспектов
- admin (email из `CONSPECTOR_ADMIN_EMAILS`) дополнительно может:
  - смотреть пользователей
  - запускать ручной Notion writeback (`recordingId + pageTitle`)

## Политики устойчивости

- `CONSPECTOR_NOTION_SOFT_FAIL=true|false`
- `CONSPECTOR_HTML_SOFT_FAIL=true|false`
- `CONSPECTOR_PREFLIGHT_STRICT=true|false`

## Проверки и запуск

Preflight:

```bash
npm run preflight
```

Тесты:

```bash
npm test
```

Desktop запуск:

```bash
npm start
```

Desktop real:

```bash
npm run start:real
```

Web запуск:

```bash
npm run start:web
```
