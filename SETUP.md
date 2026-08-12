# Nilli Studio — Setup Guide

## 1. Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. In the SQL Editor, run `supabase/schema.sql` first, then **every** `supabase/migration_*.sql` / `supabase/add_*.sql` file. Suggested order:

   ```
   schema.sql
   migration_v2.sql
   migration_v3.sql
   migration_task_brief.sql
   migration_release_time.sql
   migration_round_times.sql
   migration_due_date_timestamptz.sql
   migration_task_submission_count.sql
   migration_auto_completed.sql
   migration_episode_archive_tracking.sql
   migration_episode_deliver.sql
   migration_active_last_seen.sql
   migration_password_changed.sql
   migration_quotas.sql
   migration_push_subscriptions.sql
   migration_slack_notifications.sql
   migration_inapp_notifications.sql
   migration_task_notifications.sql
   migration_threaded_comments.sql
   add_comment_attachments.sql
   migration_api_keys.sql
   migration_rls_remaining_tables.sql
   migration_protect_user_management.sql
   migration_task_workflow_rls.sql
   migration_message_notifications_author.sql
   migration_episode_spawn_unique.sql
   migration_batch_b_workflow.sql
   migration_reconstruct_missing_tables.sql
   ```

   Everything is idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE`), so re-running is safe.
3. Copy your project URL and anon key from **Settings → API**

## 2. Environment Variables

Update `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   # API routes + cron
CRON_SECRET=some-random-secret                    # required — cron endpoints refuse to run without it
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...                  # web push (generate: npx web-push generate-vapid-keys)
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
WORKSPACE_TIMEZONE=America/New_York               # optional fallback; canonical value below
```

After setup, set the workspace timezone in the database (used for due dates and "due today" checks):

```sql
UPDATE public.workspace_settings SET timezone = 'America/New_York';
```

## 3. Create Team Accounts

Sign-up is invite-only: admins create accounts from **Settings → Team** (name, email, role, color, temp password). The DB trigger auto-creates each profile on first auth.

To bootstrap the **first admin**:

1. Create the user in Supabase **Auth → Users → Create user** (or sign up once via `/login` if enabled)
2. Promote them in the SQL Editor:

   ```sql
   UPDATE public.users SET role = 'admin' WHERE email = 'you@example.com';
   ```

3. Log in and invite the rest of the team from Settings.

## 4. Slack & Push Notifications (Optional)

- **Slack**: admin connects a workspace bot token in Settings → Notifications; members can add personal webhook URLs in `/profile`.
- **Web push**: needs the VAPID env vars above; members enable it from their profile/browser prompt.

## 5. Deploy to Vercel

```bash
npx vercel
```

Set the same environment variables in your Vercel project settings.

The `vercel.json` cron calls `/api/task-notifications-check` daily at 9:00 UTC (due-today reminders + overdue notices). `CRON_SECRET` must be set — the endpoint refuses to run without it. `/api/overdue-check` (older overlapping checker + unlock safety net) can optionally be added as a second cron entry.

## 6. Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## App Structure

- `/dashboard` — Your personal task list (grouped by status)
- `/calendar` — Monthly calendar of your tasks by due date
- `/board` — Admin/ops: all episodes overview
- `/episodes/[id]` — Full episode with all tracks and tasks
- `/episodes/new` — Admin/ops: create a new project (also via the New Project modal)
- `/settings` — Admin/ops: team, clients, pipeline templates, notifications, API keys
- `/profile` — Your name, avatar, notification prefs

## How it works

1. Admin/ops creates a project → the server route `/api/episodes/create` generates all tasks from the client's pipeline template in one all-or-nothing write
2. Starting (dependency-free) tasks get due dates from the release date; their assignees are notified (in-app + push)
3. Locked tasks unlock automatically when their dependencies are approved — their due date is computed **at that moment** (release date − offset, workspace timezone)
4. Members submit work for review; approvers approve or send back. Tasks without a named approver complete directly
5. When every task on an episode is done/approved, the episode auto-archives (delivered)
6. Optional pipeline triggers auto-spawn follow-up episodes (e.g. "Shorts" pipeline a few days after the main one)
7. A daily cron sends due-today and overdue notifications; an in-cron safety net also unlocks any task that got stuck
