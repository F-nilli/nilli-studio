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

Core tables: `users`, `episodes`, `tasks`, `comments`, `notifications`, `api_keys`, `clients`, `task_templates`, `workspace_settings`, `task_history`, `pipeline_triggers`, `episode_images`, `comment_reactions`, `comment_reads`, `activity_log`, `message_notifications`, `push_subscriptions`, `user_quotas`

- Episodes carry `client_key`/`client_label` snapshots from the `clients` table (not FKs)
- Tasks have `dep_task_ids: uuid[]` — ids of other rows in `tasks` on the same episode. `template_task_id` is the seq number within the pipeline template; `due_days` carries the template's days-before-release offset
- **Episode creation is server-side and all-or-nothing**: `POST /api/episodes/create` (admin/ops only) via `lib/episodeCreate.ts` — dep wiring happens in ONE bulk insert; on task failure the episode row is deleted again. Pipeline auto-spawn (`/api/episodes/check-triggers`) uses the same creator
- **Unlocking** has ONE implementation: `lib/unlock.ts` (used by `/api/tasks/unlock-deps` and the cron safety net in `/api/overdue-check`), plus the `trg_unlock_dependent_tasks` DB trigger as lowest-level safety net. Locked tasks have no due date; it is computed **at unlock time** (release date − `due_days`, at release time, in the workspace timezone)
- `api_keys` stores only a SHA-256 hash (`key_hash`) + non-secret `key_prefix`; the plaintext key is shown once at creation and never persisted. RLS is enabled with no policies — only reachable via the service-role client.

**Task status flow:** `locked → in_progress → in_review → approved | revision → done` (`approved` tasks count as complete for unlocking; `done` is the no-approval completion path). `ready` exists in the DB check constraint as a reserved future stage but is not used by the flow today.

Tasks with `requires_approval: true` must be approved (by their named approver, or admin) before dependents unlock. The `guard_task_update` DB trigger enforces the workflow and freezes structural columns for non-admin/ops callers; updates issued by other triggers (depth ≥ 2) are system actions and pass.

## Roles

Defined in `lib/types.ts`: `admin`, `ops_manager`, `member`
- admin only: manage team (`canManageTeam`), analytics (`canAccessAnalytics`), delete episodes
- admin + ops_manager: manage clients/templates (`canManageClients`), edit dates (`canEditDates`), approve (`canApprove`), see all episodes (`canSeeAllEpisodes`), settings (`canAccessSettings`), create projects (`canCreateProject`)

## Templates

Pipelines live in the **`task_templates` table** (per client + `template_name`; NULL name = 'Default'). Episodes are generated from them server-side by `/api/episodes/create`; each task copies `due_days` so its due date can be computed when it unlocks.

## Notifications

1. **In-app** — `notifications` table + Supabase Realtime
2. **Slack** — per-user webhook in profile, sent via `lib/slack.ts` (Block Kit)
3. **Web Push** — VAPID keys, `lib/push.ts`, `/api/push/`

Cron jobs (Vercel, `vercel.json`): `/api/task-notifications-check` runs daily 9:00 UTC (due-today + overdue notices). `/api/overdue-check` also exists (older overlapping checker + unlock safety net) and can be added to `vercel.json` if wanted. Both refuse to run unless `CRON_SECRET` is set and presented as a Bearer token. Day boundaries ("due today") are computed in the workspace timezone: `workspace_settings.timezone`, falling back to the `WORKSPACE_TIMEZONE` env var, then UTC.

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
| `lib/episodeCreate.ts` | Server-side all-or-nothing episode + task creation |
| `lib/unlock.ts` | The single unlock implementation (deps met → in_progress + due date) |
| `lib/deliver.ts` | Episode delivery/archive + its notifications |
| `lib/push.ts` | Web-push sender (VAPID) |
| `lib/rateLimit.ts` | In-memory fixed-window rate limiter for API routes |
| `lib/apiKeys.ts` | API key generation, hashing, validation |
| `lib/utils.ts` | Date/timezone helpers, status labels/colors, `cn()` |
| `supabase/schema.sql` + `supabase/migration_*.sql` | DB schema. `schema.sql` covers the core tables; everything since is a dated migration — run all of them for a fresh setup (see SETUP.md) |

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
CRON_SECRET
NEXT_PUBLIC_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
WORKSPACE_TIMEZONE   # optional fallback; canonical value is workspace_settings.timezone
```

## CLAUDE.md Maintenance

Keep this file under 200 lines. When making significant changes to this codebase — new routes, new tables, new notification channels, new clients/templates, role changes, or new environment variables — update the relevant section of this file. Remove outdated entries rather than appending.
