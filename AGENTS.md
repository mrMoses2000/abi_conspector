# ABI Conspector — AGENTS.md (Codex)

Goal: produce high-quality, Notion-compatible lecture notes in markdown from diarized transcripts.

## Local skills

Local project skills are in `.agents/skills/*/SKILL.md`.

Use:
- `conspector-structure` when prompt includes transcript-to-note transformation.
- `conspector-merge` when prompt includes merging structured notes with a base note.

## Trigger hints

- If prompt contains `Transcript JSON` or `diarized transcript`, apply `conspector-structure`.
- If prompt contains both `Structured markdown` and `Base note markdown`, apply `conspector-merge`.

## Hard rules

- Return markdown only, no outer explanations.
- Do not invent facts, sources, dates, terms, or speaker claims.
- Preserve uncertainty explicitly in an `Открытые вопросы` section.
- Keep formatting simple and Notion-friendly (headings, lists, quotes, code fences, tables).

