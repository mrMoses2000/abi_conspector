# ABI Conspector — Visual Redesign Brief for External AI Agent

## Mission
Redesign the project visual layer (web/site UI first) without breaking current functional logic:

- auth (register/login/logout)
- role split (admin/user)
- shared conspects list for all users
- admin-only actions (users list, Notion writeback)
- status/error readability for long STT/merge jobs

Primary target repo:

- `/Users/mosesvasilenko/abi_conspector`

Visual reference repo to analyze:

- `/Users/mosesvasilenko/abi`

## Mandatory context to read before coding

In `abi_conspector`:

- `/Users/mosesvasilenko/abi_conspector/README.md`
- `/Users/mosesvasilenko/abi_conspector/web/server.js`
- `/Users/mosesvasilenko/abi_conspector/web/public/index.html`
- `/Users/mosesvasilenko/abi_conspector/web/public/app.js`
- `/Users/mosesvasilenko/abi_conspector/web/public/styles.css`
- `/Users/mosesvasilenko/abi_conspector/src/renderer/index.html`
- `/Users/mosesvasilenko/abi_conspector/src/renderer/styles.css`

In reference project `abi`:

- `/Users/mosesvasilenko/abi/frontend/src/App.css`
- `/Users/mosesvasilenko/abi/frontend/src/App.jsx`
- `/Users/mosesvasilenko/abi/frontend/src/components/Sidebar.jsx`
- `/Users/mosesvasilenko/abi/frontend/src/pages/Dashboard.jsx`
- `/Users/mosesvasilenko/abi/frontend/src/pages/Upload.jsx`

## Non-negotiable functional constraints

1. Do not change API routes/contracts used by current web client:
   - `/api/auth/*`
   - `/api/conspects*`
   - `/api/admin/*`
2. Do not remove role gates:
   - user: shared view only
   - admin: users list + Notion writeback
3. Do not hide critical runtime status:
   - running/failed/mock fallback warnings must stay visible
4. Keep app usable on desktop and mobile widths.
5. Keep implementation maintainable (no giant monolith CSS if avoidable).

## Required design outcomes

1. Strong, modern visual identity (not generic default UI).
2. Better information hierarchy:
   - auth state
   - current user role
   - conspect processing status
   - actionable errors (especially Notion suggestions)
3. Better table/readability for long filenames and warnings.
4. More explicit admin area separation.
5. Clear loading states and disabled states for actions.

## Technical boundaries

- Current web UI is plain HTML/CSS/JS (no React in this repo).
- You may refactor files in `web/public/*`, but keep JS logic compatible.
- If you introduce additional static assets, place them in `web/public/`.
- Prefer CSS variables/design tokens.

## MCP Context7 requirement

Before coding, use MCP Context7 to fetch authoritative docs/snippets for any external UI tech/pattern you apply (for example, if introducing utility CSS framework patterns, component semantics, or accessibility patterns). Keep references in your implementation notes.

## Deliverables

1. Updated visual implementation in:
   - `/Users/mosesvasilenko/abi_conspector/web/public/index.html`
   - `/Users/mosesvasilenko/abi_conspector/web/public/styles.css`
   - `/Users/mosesvasilenko/abi_conspector/web/public/app.js` (only if needed for UI behavior wiring)
2. Short markdown report:
   - what changed
   - what visual decisions were borrowed/adapted from `/Users/mosesvasilenko/abi`
   - what was verified manually (desktop/mobile, admin/user flows)

## Acceptance checklist

- Login/register works.
- Session restore works.
- User can view shared conspects and open HTML/MD.
- Admin sees users and can trigger Notion writeback.
- Error/suggestion messages are readable and prominent.
- No API contract regressions.
- No console errors on initial load.
