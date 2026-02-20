---
name: conspector-review
description: Review merged conspect for critical structural issues. Returns JSON with find/replace patches.
---

## Core task
Review the merged conspect and find ONLY CRITICAL structural issues.

## What counts as critical:
- Truncated sentences
- Broken markdown (unclosed code blocks, invalid tables, broken mermaid)
- Duplicate sections with identical content
- Empty sections
- Terminology conflicts

## Output: ONLY valid JSON, no code fences
If no issues: `{"issues": [], "status": "ok"}`
If issues:
```
{"status": "needs_fixes", "issues": [{"severity": "critical", "location": "...", "find": "...", "replace": "...", "description": "..."}]}
```
