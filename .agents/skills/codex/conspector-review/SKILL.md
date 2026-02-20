---
name: conspector-review
description: Review merged conspect for critical structural issues. Returns JSON with find/replace patches.
---

## Core task
Review the merged conspect and find ONLY CRITICAL structural issues.

## What counts as critical:
- Truncated sentences (text cuts off mid-sentence)
- Broken markdown (unclosed code blocks, invalid tables, broken mermaid)
- Duplicate sections with identical content
- Empty sections (heading with no content)
- Terminology conflicts (same term defined differently)

## What to IGNORE:
- Stylistic preferences
- Minor grammar issues

## Output format: ONLY valid JSON, no code fences
If no issues: `{"issues": [], "status": "ok"}`
If issues found:
```
{
  "status": "needs_fixes",
  "issues": [
    {
      "severity": "critical",
      "location": "## Section name",
      "find": "exact text to find",
      "replace": "text to replace with",
      "description": "what is wrong"
    }
  ]
}
```
