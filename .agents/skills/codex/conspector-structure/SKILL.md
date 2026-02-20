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
- **CRITICAL**: Preserve EVERY substantive fact, argument, example, and explanation from the transcript. Do NOT reduce to bullet-point summaries. Write full paragraphs where the lecturer gave explanations.
- Recommended structure:
  1. `# Заголовок темы` (main topic from lecture content)
  2. Detailed body organized by logical themes/subtopics (`## Section`, `### Subsection`)
  3. `## Ключевые термины` (with definitions in a table)
  4. `## Примеры` (if the lecturer gave examples)
  5. `## Вопросы к экзамену`
  6. `## Открытые вопросы` (only if transcript contains ambiguities)

## Detail level expectations

- For EACH topic discussed, write 2-5 detailed paragraphs capturing the full argument.
- When the lecturer explains reasoning — preserve the CHAIN of reasoning, not just the conclusion.
- When the lecturer gives examples — describe them fully with context.
- When the lecturer refers to sources, authors, or works — include all names and details.
- When the lecturer makes contextual remarks that aid understanding — include them.

## Visual formatting rules

Use these markdown features:

### Callout blocks
- `> [!NOTE]` — for supplementary context or definitions
- `> [!IMPORTANT]` — for critical concepts the student must remember
- `> [!TIP]` — for exam tips or memory aids
- `> [!WARNING]` — for common mistakes or misconceptions

### Tables
Use markdown tables for comparisons, term glossaries, and structured lists.

### Section separators
Use `---` between major logical sections.

### Key terms
Highlight key terms with **bold** on first mention.

## General rules

- Keep source facts intact — do not add external information.
- Collapse transcription noise, repeats, and filler words — but KEEP all substantive content.
- If confidence is low for a claim, place it in `Открытые вопросы`.
- Use Notion-compatible markdown.
- **NEVER summarize or reduce content. The output should be LONGER than a typical summary.**
