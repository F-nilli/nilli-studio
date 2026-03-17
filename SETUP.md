# Nilli Studio — Setup Guide

## 1. Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. In the SQL Editor, run the full contents of `supabase/schema.sql`
3. Copy your project URL and anon key from **Settings → API**

## 2. Environment Variables

Update `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   # for overdue-check API
CRON_SECRET=some-random-secret                      # protect the cron endpoint
```

## 3. Create Team Accounts

Sign up each team member at `/signup` using these emails (role + color auto-assigns):

| Name | Email | Role |
|------|-------|------|
| Francis | francis@nillistudio.com | Admin |
| Ali | ali@nillistudio.com | Member |
| Eph | eph@nillistudio.com | Member |
| Abdo | abdo@nillistudio.com | Member |
| Nguyen | nguyen@nillistudio.com | Member |
| Donya | donya@nillistudio.com | Member |
| Zeeshan | zeeshan@nillistudio.com | Member |
| Phil | phil@nillistudio.com | Member |

> **Note:** Use any email domain — the important thing is the name part matching (francis, ali, eph, etc.) OR the exact email match. The signup page auto-detects the role and color.

Alternatively, you can create all accounts via Supabase Auth > Users > Create user, then the database trigger will auto-create their profile with the right metadata if you pass it.

## 4. Slack Webhooks (Optional)

Each team member can set their personal Slack incoming webhook URL in their `/profile` page. To create one:
1. Go to your Slack workspace → Apps → Incoming Webhooks
2. Add a new webhook pointing to your personal DM or a team channel
3. Copy the webhook URL and paste it in your Nilli Studio profile

## 5. Deploy to Vercel

```bash
npx vercel
```

Set the same environment variables in your Vercel project settings.

The `vercel.json` cron job will call `/api/overdue-check` daily at 9am UTC to send overdue notifications. Add `CRON_SECRET` to Vercel env vars.

## 6. Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## App Structure

- `/dashboard` — Your personal task list (grouped by status)
- `/calendar` — Monthly calendar of your tasks by due date
- `/board` — Admin only: all episodes overview + create new episodes
- `/episodes/[id]` — Full episode with all tracks and tasks
- `/episodes/new` — Admin only: create a new episode
- `/profile` — Update your name, avatar color, Slack webhook

## How it works

1. Francis creates an episode → tasks auto-generate from the client template
2. Task due dates are auto-calculated from release date
3. Team members see their ready tasks on their dashboard
4. Click a task → update status, leave comments
5. When a task is submitted for review → Ali/Francis get notified
6. Ali/Francis use the Approve/Send Back modal:
   - **Approve**: set due dates for the next unlocking tasks → notifications fire
   - **Send Back**: set revised due date → editor gets notified
7. Notifications appear in the bell icon + Slack DM
