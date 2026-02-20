---
name: conspector-structure
description: Convert diarized transcript JSON into an exhaustive, detailed Russian markdown lecture note. Activate when the prompt contains Transcript JSON or diarized transcript data.
---

Use this skill when the prompt asks to transform transcript JSON into a complete lecture note.

## Core principle

**Create an EXHAUSTIVE, DETAILED lecture note — NOT a brief summary.** The goal is to produce a document that fully replaces attending the lecture. A student who reads only this note must understand the topic as deeply as if they attended the full lecture.

## Input expectations

- JSON transcript with diarized segments.
- Fields can include recording id, speaker id, timestamps, and text.

## Output contract

- Markdown only — no explanations outside the document.
- Do not wrap output in a code fence.
- Write as if a diligent student is taking continuous, detailed, natural notes — no metadata headers, no recording IDs, no source file names.
- **CRITICAL**: Preserve EVERY substantive fact, argument, example, and explanation from the transcript. Do NOT reduce to bullet-point summaries. Write full paragraphs where the lecturer gave explanations.
- Recommended structure:
  1. `# Заголовок темы` (main topic from lecture content)
  2. Detailed body organized by logical themes/subtopics (`## Section`, `### Subsection`)
  3. `## Ключевые термины` (with definitions in a table)
  4. `## Примеры` (if the lecturer gave examples)
  5. `## Вопросы к экзамену`
  6. `## Открытые вопросы` (only if transcript contains ambiguities)

## Detail level expectations

- For EACH topic discussed by the lecturer, write 2-5 detailed paragraphs capturing the full argument, not just the conclusion.
- When the lecturer explains reasoning or logic, preserve the CHAIN of reasoning, not just the final point.
- When the lecturer gives examples, describe them in full with context.
- When the lecturer refers to sources, authors, or works — include all mentioned names and details.
- When the lecturer makes digressions or contextual remarks that aid understanding — include them.

## Visual formatting rules

Use these markdown features to make the output visually rich when rendered to HTML:

### Callout blocks
Use GitHub-style alert blocks for key concepts and emphasis:
- `> [!NOTE]` — for supplementary context or definitions
- `> [!IMPORTANT]` — for critical concepts the student must remember
- `> [!TIP]` — for exam tips or memory aids
- `> [!WARNING]` — for common mistakes or misconceptions

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
- Collapse transcription noise, repeats, and filler words — but KEEP all substantive content.
- If confidence is low for a claim, place it in `Открытые вопросы`.
- Use Notion-compatible markdown (headings, lists, quotes, tables).
- **NEVER summarize or reduce content. The output should be LONGER than a typical summary, not shorter.**
