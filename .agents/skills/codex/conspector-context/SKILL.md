---
name: conspector-context
description: Generate or update context.md navigation map for a subject's accumulated lecture notes.
---

## Core principle
`context.md` is a compact navigation map (~4000 words max), NOT a full conspect.

## Input
- `Page markdown` — new lecture page
- `Existing context.md` — previous context (may be empty)
- `Page number`

## Output: complete updated `context.md` with:

1. `# Контекст предмета: [название]`
2. `## Оглавление по страницам` — for EACH page: `### Страница N — [тема]` + bullet points
3. `## Ключевые термины` — table: Термин | Определение | Страница
4. `## Сквозные темы` — cross-page themes, cause-effect chains
5. `## Хронология` — timeline (if applicable)

## Rules
- Max 4000 words. Preserve ALL existing entries, ADD from new page.
- No full paragraphs — only summaries, terms, structure.
- Notion-compatible markdown. No code fence wrapper.
