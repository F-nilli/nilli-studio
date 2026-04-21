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
- `app/api/` — API routes (admin, episodes, tasks, notifications, push, slack, cron endpoints)
- Auth pages (`/login`, `/signup`, etc.) live outside the `(auth)` group
- `middleware.ts` wraps all routes via `lib/supabase/middleware.ts` to refresh sessions

## Supabase Clients

Three clients in `lib/supabase/` — use the right one:
- `client.ts` — browser/client components
- `server.ts` — Server Components and API routes (cookie-based)
- `admin.ts` — service role, for API routes that bypass RLS

## Data Model

Tables: `users`, `episodes`, `tasks`, `comments`, `notifications`

- Episodes have a `client_key` string (not a FK) mapping to `CLIENT_LABELS` in `lib/constants.ts`
- Tasks have `dep_task_ids: text[]` — these are `template_task_id` strings (e.g. `"long_form_edit"`), not UUIDs
- When a task is approved, siblings whose deps are all `done` unlock: `locked → ready`, due dates computed then

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

## Key Files

| File | Purpose |
|------|---------|
| `lib/types.ts` | All TS interfaces + role helpers |
| `lib/templates.ts` | Client task pipeline templates |
| `lib/constants.ts` | `TEAM_MEMBERS`, colors, client labels |
| `lib/utils.ts` | Date formatting, status helpers, `cn()` |
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
