---
name: conspector-structure
description: Convert diarized transcript JSON into a structured Russian markdown lecture note. Activate when the prompt contains Transcript JSON or diarized transcript data.
---

Use this skill when the prompt asks to transform transcript JSON into a readable lecture note.

## Input expectations

- JSON transcript with diarized segments.
- Fields can include recording id, speaker id, timestamps, and text.

## Output contract

- Markdown only — no explanations outside the document.
- Do not wrap output in a code fence.
- Recommended sections:
  - `Краткое summary`
  - `Ключевые тезисы`
  - `Термины`
  - `Примеры`
  - `Вопросы к экзамену`
  - `TODO`
  - `Открытые вопросы` (only if transcript contains ambiguities)

## Visual formatting rules

Use these markdown features to make the output visually rich when rendered to HTML:

### Callout blocks
Use GitHub-style alert blocks for key concepts and emphasis:
- `> [!NOTE]` — for supplementary context or definitions
- `> [!IMPORTANT]` — for critical concepts the student must remember
- `> [!TIP]` — for exam tips or memory aids
- `> [!WARNING]` — for common mistakes or misconceptions

Example:
```
> [!IMPORTANT]
> Бог не имеет начала бытия — это один из ключевых тезисов патристики.
```

### Tables
Use markdown tables for comparisons, term glossaries, and structured lists:
```
| Термин | Определение |
|--------|-------------|
| Ипостась | Способ бытия природы |
```

### Section separators
Use `---` between major logical sections for visual breathing room.

### Key terms
Highlight key terms with **bold** on first mention in a section.

## General rules

- Keep source facts intact — do not add external information.
- Collapse transcription noise, repeats, and filler words.
- If confidence is low for a claim, place it in `Открытые вопросы`.
- Use Notion-compatible markdown (headings, lists, quotes, tables).
