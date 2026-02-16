---
name: conspector-merge
description: Merge structured markdown with a base note into a final Notion-compatible merged markdown.
---

Use this skill when the prompt asks to combine a structured note with a base note.

## Input expectations

- `Structured markdown` block (generated from transcript).
- `Base note markdown` block (possibly empty).

## Output contract

- Markdown only.
- Produce a final merged version in Russian.
- Include section `Схема` with one Mermaid block.

## Rules

- Preserve facts from both inputs.
- Prefer explicit facts from base note when conflict is unresolved.
- If conflict cannot be resolved, keep both variants and mark uncertainty.
- Keep markdown Notion-compatible (avoid exotic syntax).

