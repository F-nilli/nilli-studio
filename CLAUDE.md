# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev    # dev server
npm run build  # production build
npm run lint   # ESLint
```

No test suite configured.

## Stack

Next.js 16 (App Router) · React 19 · Supabase (Postgres + Auth + Realtime) · Tailwind CSS v4 · Vercel (deploy + cron)

## Project Purpose

Production management app for Nilli Studio video agency. Manages podcast episode pipelines across 5 clients with dependency-based task unlocking and multi-channel notifications.

## Routing & Auth

- `app/(auth)/` — all protected routes (dashboard, calendar, board, episodes, profile, settings, analytics)
- `app/api/` — API routes (admin, episodes, tasks, notifications, push, slack, cron endpoints). All routes other than the cron endpoints and `app/api/v1/*` require a logged-in session (`supabase.auth.getUser()` check).
- `app/api/v1/` — external read-only API, see **External API** below
- Auth pages (`/login`, `/signup`, etc.) live outside the `(auth)` group
- `middleware.ts` wraps all routes via `lib/supabase/middleware.ts` to refresh sessions

## Supabase Clients

Three clients in `lib/supabase/` — use the right one:
- `client.ts` — browser/client components
- `server.ts` — Server Components and API routes (cookie-based)
- `admin.ts` — service role, for API routes that bypass RLS

## Data Model

Tables: `users`, `episodes`, `tasks`, `comments`, `notifications`, `api_keys`

- Episodes have a `client_key` string (not a FK) mapping to `CLIENT_LABELS` in `lib/constants.ts`
- Tasks have `dep_task_ids: text[]` — these are `template_task_id` strings (e.g. `"long_form_edit"`), not UUIDs
- When a task is approved, siblings whose deps are all `done` unlock: `locked → ready`, due dates computed then
- `api_keys` stores only a SHA-256 hash (`key_hash`) + non-secret `key_prefix`; the plaintext key is shown once at creation and never persisted. RLS is enabled with no policies — only reachable via the service-role client.

**Task status flow:** `locked → ready → in_progress → in_review → approved | revision → done`

Tasks with `requires_approval: true` must be approved by admin/ops_manager before dependents unlock.

## Roles

Defined in `lib/types.ts`: `admin`, `ops_manager`, `member`
- `canManageEpisodes(role)` — admin + ops_manager
- `canApproveTask(role)` — admin + ops_manager
- Only admins can delete episodes or access `/board`

## Templates

`lib/templates.ts` exports `CLIENT_TEMPLATES` — 5 client pipelines:
`brandon_gentile` (3 tasks), `bitcoin_edge` (4), `peruvian_bull` (5), `walker_america` (12), `youre_the_voice` (13)

Each task: `{ id, label, assigneeName, track, deps[], dueDays, note? }`

Tasks are generated from the template when an episode is created.

## Notifications

1. **In-app** — `notifications` table + Supabase Realtime
2. **Slack** — per-user webhook in profile, sent via `lib/slack.ts` (Block Kit)
3. **Web Push** — VAPID keys, `lib/push.ts`, `/api/push/`

Cron jobs (Vercel, `vercel.json`): `/api/overdue-check` and `/api/task-notifications-check` — both protected by `CRON_SECRET` header.

## External API

Read-only API for external developers, versioned under `app/api/v1/`:
- `GET /api/v1` — health check + endpoint list
- `GET /api/v1/episodes` — list episodes (`client_key`, `archived`, `limit`, `offset` query params)
- `GET /api/v1/episodes/[id]` — one episode + its tasks

Auth is via API key: `Authorization: Bearer nilli_live_...`, validated by `lib/apiKeys.ts` against `api_keys.key_hash`. No write endpoints exist. Internal-only fields (notes, footage URLs, approver IDs, dep IDs, etc.) are deliberately excluded from responses — only update the field allowlist in `app/api/v1/episodes/route.ts` and `[id]/route.ts` if a field is genuinely safe for external consumption.

Admins manage keys from Settings → Notifications → API Keys, backed by `app/api/admin/api-keys/` (`GET`/`POST`) and `app/api/admin/api-keys/[id]/` (`DELETE`, soft-revoke via `revoked_at`).

## Key Files

| File | Purpose |
|------|---------|
| `lib/types.ts` | All TS interfaces + role helpers |
| `lib/templates.ts` | Client task pipeline templates |
| `lib/constants.ts` | `TEAM_MEMBERS`, colors, client labels |
| `lib/utils.ts` | Date formatting, status helpers, `cn()` |
| `lib/apiKeys.ts` | API key generation, hashing, validation |
| `supabase/schema.sql` | Full DB schema + RLS policies |

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
CRON_SECRET
NEXT_PUBLIC_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
```

## CLAUDE.md Maintenance

Keep this file under 200 lines. When making significant changes to this codebase — new routes, new tables, new notification channels, new clients/templates, role changes, or new environment variables — update the relevant section of this file. Remove outdated entries rather than appending.
