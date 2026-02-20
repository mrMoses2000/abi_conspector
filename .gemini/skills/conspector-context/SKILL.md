---
name: conspector-context
description: Generate or update a context/navigation file for a subject's accumulated lecture notes. Activate when the prompt asks to build or update context.md from a lecture page.
---

Use this skill to create or update the subject-level context file (`context.md`).

## Core principle

`context.md` is a **compact navigation map** of all processed lectures — NOT a full conspect. It must stay under 4000 words so it fits as context input for future LLM calls.

## Input expectations

- `Page markdown` — the newly created full lecture page
- `Existing context.md` — previous context (may be empty for first page)
- `Page number` — which page this is (e.g., "Страница 3")

## Output contract

- Markdown only — no explanations outside the document.
- Do not wrap output in a code fence.
- Output the COMPLETE updated `context.md` (not a diff).

## Required sections

### 1. `# Контекст предмета: [название]`
Title from the overall subject.

### 2. `## Оглавление по страницам`
For EACH page (including the new one), a subsection:
```
### Страница N — [краткое название темы]
- Тема 1: краткое описание (1 строка)
- Тема 2: краткое описание
- Ключевые моменты: ...
```

### 3. `## Ключевые термины`
Table of ALL unique terms across ALL pages:
```
| Термин | Определение | Страница |
|--------|-------------|----------|
```

### 4. `## Сквозные темы`
Themes that span multiple pages — cause-effect chains, recurring concepts.

### 5. `## Хронология`
Timeline of events mentioned across all pages (if applicable).

## Rules

- **Keep it COMPACT**: max 4000 words. This file will be fed to LLM alongside a full transcript.
- When updating: preserve ALL existing entries, ADD new ones from the new page.
- Do NOT include full paragraphs of content — only summaries, terms, and structural info.
- Use Notion-compatible markdown.
