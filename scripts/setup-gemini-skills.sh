#!/usr/bin/env bash
# ------------------------------------------------------------------
# setup-gemini-skills.sh
# Idempotent script: prepares .gemini/ directory with GEMINI.md
# context and skills for ABI Conspector.
# Compatible with macOS and Ubuntu 22.04+.
# ------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GEMINI_DIR="$PROJECT_ROOT/.gemini"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
fail()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# ------- Step 1: Check gemini binary -------
echo ""
echo "=== ABI Conspector — Gemini CLI Setup ==="
echo ""

if command -v gemini &>/dev/null; then
  GEMINI_VERSION=$(gemini --version 2>/dev/null || echo "unknown")
  info "gemini binary found: $GEMINI_VERSION"
else
  fail "gemini binary not found on PATH.
  Install with: npm install -g @anthropic-ai/gemini-cli
  Or see: https://github.com/google-gemini/gemini-cli"
fi

# ------- Step 2: Ensure .gemini directory structure -------
mkdir -p "$GEMINI_DIR/skills/conspector-structure"
mkdir -p "$GEMINI_DIR/skills/conspector-merge"
info "Directory structure ready: $GEMINI_DIR/"

# ------- Step 3: Copy/update GEMINI.md -------
if [ -f "$GEMINI_DIR/GEMINI.md" ]; then
  info "GEMINI.md already exists (skipping overwrite)"
else
  cat > "$GEMINI_DIR/GEMINI.md" << 'HEREDOC'
# ABI Conspector — Gemini Context

You are used as a text processing backend for ABI Conspector, a lecture recording and note-generation application.

You will receive prompts via `--prompt` non-interactive mode. Each prompt asks you to either:
1. **Structure** a diarized transcript JSON into a markdown lecture note, or
2. **Merge** a structured note with a base note into a final Notion-compatible document.

## Hard Rules

- Return **markdown only**, no outer explanations, greetings, or meta-commentary.
- Do **not** invent facts, sources, dates, terms, or speaker claims that are not in the input.
- Preserve uncertainty explicitly in an `Открытые вопросы` section when applicable.
- Keep formatting **Notion-friendly**: headings, lists, quotes, code fences, tables. No exotic markdown.
- Language: **Russian** (unless explicitly stated otherwise in the prompt).
- Do not wrap the output in a markdown code fence — output raw markdown directly.
HEREDOC
  info "Created GEMINI.md"
fi

# ------- Step 4: Copy/update skills -------
SKILL_SRC_DIR="$GEMINI_DIR/skills"

# conspector-structure
cat > "$SKILL_SRC_DIR/conspector-structure/SKILL.md" << 'HEREDOC'
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

## Rules

- Keep source facts intact — do not add external information.
- Collapse transcription noise, repeats, and filler words.
- If confidence is low for a claim, place it in `Открытые вопросы`.
- Use Notion-compatible markdown (headings, lists, quotes, tables).
HEREDOC
info "Updated skill: conspector-structure"

# conspector-merge
cat > "$SKILL_SRC_DIR/conspector-merge/SKILL.md" << 'HEREDOC'
---
name: conspector-merge
description: Merge structured markdown with a base note into a final Notion-compatible merged markdown. Activate when the prompt contains both Structured markdown and Base note markdown.
---

Use this skill when the prompt asks to combine a structured note with a base note.

## Input expectations

- `Structured markdown` block (generated from transcript).
- `Base note markdown` block (possibly empty).

## Output contract

- Markdown only — no explanations outside the document.
- Do not wrap output in a code fence.
- Produce a final merged version in Russian.
- Include section `Схема` with one Mermaid block visualizing the lecture structure.

## Rules

- Preserve facts from both inputs.
- Prefer explicit facts from base note when conflict is unresolved.
- If conflict cannot be resolved, keep both variants and mark uncertainty.
- Keep markdown Notion-compatible (avoid exotic syntax).
- If base note is empty, use structured markdown as the foundation.
HEREDOC
info "Updated skill: conspector-merge"

# ------- Step 5: Validate skills are discoverable -------
echo ""
echo "--- Validation ---"

STRUCTURE_OK=false
MERGE_OK=false

if [ -f "$SKILL_SRC_DIR/conspector-structure/SKILL.md" ]; then
  STRUCTURE_OK=true
  info "conspector-structure/SKILL.md exists"
else
  warn "conspector-structure/SKILL.md missing!"
fi

if [ -f "$SKILL_SRC_DIR/conspector-merge/SKILL.md" ]; then
  MERGE_OK=true
  info "conspector-merge/SKILL.md exists"
else
  warn "conspector-merge/SKILL.md missing!"
fi

# Check .gitignore doesn't exclude .gemini/
if [ -f "$PROJECT_ROOT/.gitignore" ]; then
  if grep -q "^\.gemini" "$PROJECT_ROOT/.gitignore" 2>/dev/null; then
    warn ".gitignore excludes .gemini/ — skills may not be committed to git"
  fi
fi

# ------- Step 6: Summary -------
echo ""
echo "=== Setup Complete ==="
echo ""
echo "  Project root:    $PROJECT_ROOT"
echo "  Gemini dir:      $GEMINI_DIR"
echo "  Skills:"
echo "    - conspector-structure  ($( $STRUCTURE_OK && echo 'OK' || echo 'MISSING' ))"
echo "    - conspector-merge      ($( $MERGE_OK && echo 'OK' || echo 'MISSING' ))"
echo ""
echo "  To switch the pipeline to Gemini CLI, set in .env:"
echo "    CONSPECTOR_LLM_PROVIDER=gemini"
echo "    CONSPECTOR_GEMINI_MODEL=gemini-3-flash-preview"
echo ""
echo "  To test manually:"
echo '    echo "Скажи привет" | gemini --model gemini-3-flash-preview --prompt - --output-format text'
echo ""
