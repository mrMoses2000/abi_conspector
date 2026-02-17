# ABI Conspector — AGENTS.md (Project + Handoff)

This file is for any follow-up AI coding agent (including Claude 4.6 Opus Thinking) to continue the project without re-discovery overhead.

Last updated: 2026-02-17
Main branch in progress: `codex/plan-v3-impl`

## 1) Project Goal

Build a robust lecture processing app that:
1. records/imports audio,
2. transcribes it (Groq primary, whisper.cpp fallback),
3. structures/merges notes via Codex CLI,
4. renders final HTML/MD,
5. optionally writes back into Notion target subpage by title.

## 2) Current Stage Snapshot

Status: **working MVP v3 + web mode + env automation**, not fully production-hardened yet.

Implemented (already in repo):
- Import pipeline + normalize (`ffmpeg` -> mono flac).
- STT router:
  - `groq` chunked transcription primary,
  - `whispercpp` fallback,
  - optional mock fallback policy.
- Codex structuring/merge integration.
- Notion nested subpage resolution by title under root page.
- Notion merge-with-existing + backup + logs.
- Desktop queue/progress + selected job actions.
- Web mode:
  - register/login/session,
  - user/admin role split,
  - shared conspects list,
  - admin manual Notion writeback.
- `run.sh` launcher:
  - OS-aware behavior (macOS/Linux),
  - interactive `.env` wizard,
  - Ubuntu Node.js 24 runtime auto-install prompt,
  - `.env` template path auto-fix,
  - env diagnostics (`env doctor`).
- Documentation pack in `docs/*.md` (RU).

Recent commits (top):
- `83cad79` env path auto-fix + env doctor
- `240ef09` README translated to RU (commands kept in English)
- `7f31cc4` Ubuntu Node/npm runtime auto-check/install in run.sh
- `aaa73ad` Codex CLI SSH guide
- `4610626` runbook + causal logic docs
- `ec5d6d6` web API hardening + web integration tests

## 3) Key Files / Modules

Core runtime:
- `src/main/pipeline/mergePipeline.js`
- `src/main/pipeline/mergeQueue.js`
- `src/main/db/database.js`
- `src/main/config.js`

STT:
- `src/main/workers/sttWorker.js`
- `src/main/workers/sttGroqChunkedWorker.js`
- `src/main/workers/sttWhisperCppWorker.js`
- `src/main/audio/ffmpeg.js`

Notion:
- `src/main/workers/notionWorker.js`

Codex:
- `src/main/workers/codexWorker.js`

Desktop UI:
- `src/renderer/index.html`
- `src/renderer/app.js`

Web mode:
- `web/server.js`
- `web/public/index.html`
- `web/public/app.js`
- `web/public/styles.css`

Ops / tooling:
- `run.sh`
- `scripts/bootstrap.sh`
- `scripts/preflight.js`
- `scripts/env-doctor.js`

## 4) How to Validate Project Quickly

Run from project root:

```bash
./run.sh --fix-env-paths
./run.sh --env-doctor
./run.sh --preflight-strict
npm test
npm run smoke:import
```

If env doctor finds safe fixable values:

```bash
./run.sh --env-doctor-write
```

## 5) Known Open Areas (Next Work Candidates)

Priority P1:
- Add explicit “Notion connectivity check” action in GUI (token/root access/subpage list preview).
- Add server process supervision docs/templates (`systemd`) for production Linux.
- Improve preflight/env-doctor consistency (share one rule source to avoid drift).

Priority P2:
- Add Electron E2E tests (UI click flow and status transitions).
- Add integration tests for `run.sh` flows (`--configure-env`, `--fix-env-paths`).
- Improve long-file progress granularity and ETA estimation in desktop/web UI.

Priority P3:
- Refine HTML visual presentation (separate visual task brief exists in `docs/visual-agent-brief.md`).
- Add optional provider abstraction for Gemini CLI alongside Codex CLI.

## 6) Notion Requirements (Must Not Break)

- `CONSPECTOR_NOTION_MODE=real` + `NOTION_TOKEN` required for real writeback.
- `CONSPECTOR_NOTION_ROOT_PAGE_ID` used for nested page lookup.
- User manually enters subpage title in UI.
- If page not found in root:
  - fail controlled with suggestions,
  - do not auto-create pages silently,
  - do not write into wrong/root page.

## 7) Environment & Secrets Rules

- Never commit `.env` or secrets.
- Keep docs and scripts commands in English; explanatory prose can be Russian.
- Prefer absolute project paths in `.env` (`run.sh --fix-env-paths` handles template placeholders).

## 8) Local Skills (for note generation prompts)

Local project skills are in `.agents/skills/*/SKILL.md`.

Use:
- `conspector-structure` when prompt includes transcript-to-note transformation.
- `conspector-merge` when prompt includes merging structured notes with a base note.

Trigger hints:
- If prompt contains `Transcript JSON` or `diarized transcript`, apply `conspector-structure`.
- If prompt contains both `Structured markdown` and `Base note markdown`, apply `conspector-merge`.

Hard rules for these generation tasks:
- Return markdown only, no outer explanations.
- Do not invent facts, sources, dates, terms, or speaker claims.
- Preserve uncertainty explicitly in an `Открытые вопросы` section.
- Keep formatting simple and Notion-friendly (headings, lists, quotes, code fences, tables).
