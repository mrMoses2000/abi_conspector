# ABI Conspector (Desktop MVP)

Electron desktop app with real worker pipeline:

1. `normalize_audio` (ffmpeg)
2. `stt_diarization` (Python `whisperx` + diarization)
3. `codex_structure` (`codex exec`)
4. `merge` (`codex exec`)
5. `render_html` (markdown -> styled HTML)
6. `notion_writeback` (Notion API, optional)

The app is configured for fail-safe behavior by default: if STT/Codex real workers fail, pipeline falls back to mock workers and completes with warnings instead of crashing.

## Desktop controls

- `Начать запись` / `Стоп` - real microphone capture via ffmpeg (saved and queued automatically).
- `Добавить аудио файл` - import local audio/video to the same queue.
- `Профиль Codex (low|medium|high)` - GUI switch for runtime `model_reasoning_effort`.
- `Открыть папку данных` - opens managed storage (`audio/transcripts/merged/html`).
- Job actions (for selected row): `Открыть HTML`, `Открыть merged.md`, `Повторить задачу`, `Комбинировать с Notion`.

## Install

```bash
npm install
```

## Required runtime for real workers

- Node.js 24+
- `ffmpeg`, `ffprobe`
- Python 3.11+ with:
  - `whisperx`
  - `torch`
  - `pyannote` stack (for diarization)
- `codex` CLI for structure/merge stages

## Environment variables

### STT / diarization

- `CONSPECTOR_STT_MODE=real|mock` (default: `real`)
- `CONSPECTOR_STT_PYTHON=python3`
- `CONSPECTOR_STT_SCRIPT=/abs/path/to/scripts/run_stt_diarization.py`
- `CONSPECTOR_WHISPER_MODEL=medium`
- `CONSPECTOR_STT_LANGUAGE=ru`
- `CONSPECTOR_STT_DEVICE=cpu|cuda`
- `CONSPECTOR_STT_COMPUTE_TYPE=int8`
- `CONSPECTOR_STT_BATCH_SIZE=8`
- `CONSPECTOR_STT_TIMEOUT_SEC=1800`
- `CONSPECTOR_REQUIRE_DIARIZATION=true|false` (default: `true`)
- `HUGGINGFACE_TOKEN=...` (required if diarization is enabled)
- `CONSPECTOR_STT_FALLBACK_TO_MOCK=true|false` (default: `true`)
- `CONSPECTOR_MIC_DEVICE_INDEX=<int>` (optional, macOS avfoundation audio device index)

### Codex workers

- `CONSPECTOR_CODEX_MODE=real|mock` (default: `real`)
- `CONSPECTOR_CODEX_FULL_AUTO=true|false` (default: `true`)
- `CONSPECTOR_CODEX_MODEL=<model>` (optional)
- `CONSPECTOR_CODEX_EFFORT=low|medium|high` (default: `medium`)
- `CONSPECTOR_CODEX_TIMEOUT_SEC=600`
- `CONSPECTOR_CODEX_WORKDIR=/path/to/workdir`
- `CONSPECTOR_SOURCE_NOTE_PATH=/path/to/base_note.md` (optional)
- `CONSPECTOR_CODEX_FALLBACK_TO_MOCK=true|false` (default: `true`)

By default, real Codex calls now mirror the `abi-paper` style:
- `codex exec --full-auto --skip-git-repo-check --cd <workdir>`
- `-c model_reasoning_effort="<low|medium|high>"`
- output persisted via `--output-last-message <file>`

For project-level Codex behavior, keep `AGENTS.md` and `.agents/skills/*/SKILL.md` inside `CONSPECTOR_CODEX_WORKDIR`.

### Notion writeback (optional)

- `CONSPECTOR_NOTION_MODE=off|real` (default: `off`)
- `NOTION_TOKEN=...`
- `CONSPECTOR_NOTION_PAGE_ID=<page-id>` or
- `CONSPECTOR_NOTION_PAGE_TITLE=<exact-unique-title>`
- `CONSPECTOR_NOTION_SOFT_FAIL=true|false` (default: `true`)

### Resilience controls

- `CONSPECTOR_HTML_SOFT_FAIL=true|false` (default: `true`)
- `CONSPECTOR_PREFLIGHT_STRICT=true|false` (default: `false`)

## Preflight

```bash
npm run preflight
```

Checks required binaries/config for current modes.
By default it is non-blocking (`CONSPECTOR_PREFLIGHT_STRICT=false`): issues are warnings.

## Smoke test (safe, no heavy workers)

```bash
npm run smoke:import
```

Runs the full queue path with STT/Codex in `mock` mode to verify plumbing.

## Start app

```bash
npm start
```

## Full ready sequence (safe mock workers)

```bash
npm run start:ready
```

## Real workers launch

```bash
npm run start:real
```

If preflight fails, install STT python deps and set `HUGGINGFACE_TOKEN`.
Set `CONSPECTOR_PREFLIGHT_STRICT=true` to make preflight blocking.

## Tests

```bash
npm test
```
