---
name: conspector-structure
description: Convert diarized transcript JSON into a structured Russian markdown lecture note.
---

Use this skill when the prompt asks to transform transcript JSON into a readable lecture note.

## Input expectations

- JSON transcript with diarized segments.
- Fields can include recording id, speaker id, timestamps, and text.

## Output contract

- Markdown only.
- Recommended sections:
  - `Краткое summary`
  - `Ключевые тезисы`
  - `Термины`
  - `Примеры`
  - `Вопросы к экзамену`
  - `TODO`
  - `Открытые вопросы` (only if needed)

## Rules

- Keep source facts intact.
- Do not add external facts.
- Collapse transcription noise, repeats, and filler words.
- If confidence is low for a claim, place it in `Открытые вопросы`.

