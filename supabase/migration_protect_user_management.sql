-- Migration: Close the users-table privilege-escalation hole, and make the
-- Settings page's team-management actions actually work.
--
-- Background
-- ──────────
-- The only UPDATE policy on public.users was "Users can update own profile"
-- (auth.uid() = id), with no column restriction. Two consequences:
--
--   1. SECURITY HOLE: any logged-in member could update their OWN row's
--      `role` column to 'admin' straight from the browser console:
--        supabase.from('users').update({ role: 'admin' }).eq('id', myId)
--      Full admin powers in one call. Same trick reactivates a deactivated
--      account (`active: true`) or rewrites identity fields (email/username).
--
--   2. BROKEN FEATURE: the Settings page lets admins change other users'
--      roles and deactivate/reactivate accounts — but those updates run
--      through the browser client on OTHER people's rows, which the old
--      policy rejects. Supabase returns "0 rows updated, no error", the UI
--      shows a success toast, and nothing actually changed. Silent failure.
--
-- Fix
-- ───
--   A. New policy: admins may update any user row (restores the intended
--      Settings behavior; matches the admin-only UI and admin-only API).
--   B. Column-guard trigger: for ordinary logged-in users (JWT role
--      'authenticated', not an admin), protected columns are frozen even on
--      their own row. Profile fields (name, avatar_color, avatar_url,
--      slack_webhook_url, password_changed, etc.) remain self-editable.
--      Service-role API calls and direct SQL (dashboard, migrations) are
--      unaffected.
--
-- Run this in the Supabase SQL Editor.

-- ─── A. Admins can update any user ──────────────────────────────────────────

CREATE POLICY "Admins can update any user"
  ON public.users
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- ─── B. Column guard for non-admin callers ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.protect_user_protected_columns()
RETURNS trigger AS $$
DECLARE
  jwt_role text;
  caller_is_admin boolean;
BEGIN
  -- Who is calling? NULL means direct SQL (Supabase dashboard, migrations,
  -- psql) — always allow. 'service_role' is the server's admin client, which
  -- bypasses RLS by design — allow. Only police ordinary user sessions.
  jwt_role := current_setting('request.jwt.claims', true)::json ->> 'role';
  IF jwt_role IS NULL OR jwt_role <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  -- Admins may manage any user (role changes, deactivate/reactivate).
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO caller_is_admin;

  IF caller_is_admin THEN
    RETURN NEW;
  END IF;

  -- Everyone else: protected columns must not change — even on your own row.
  -- Everything not listed here (name, avatar_color, avatar_url,
  -- slack_webhook_url, password_changed, last_seen_at, ...) stays editable.
  IF NEW.role         IS DISTINCT FROM OLD.role
     OR NEW.active    IS DISTINCT FROM OLD.active
     OR NEW.email     IS DISTINCT FROM OLD.email
     OR NEW.username  IS DISTINCT FROM OLD.username
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'These profile fields can only be changed by an admin';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_protect_user_protected_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_user_protected_columns();

NOTIFY pgrst, 'reload schema';
