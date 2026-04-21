-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Users table (extends Supabase auth.users)
create table public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null unique,
  name text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  avatar_color text not null default '#fbbf24',
  slack_webhook_url text,
  created_at timestamptz not null default now()
);

-- Episodes table
create table public.episodes (
  id uuid default uuid_generate_v4() primary key,
  client_key text not null,
  client_label text not null,
  guest_name text not null,
  release_date date not null,
  footage_url text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

-- Tasks table
create table public.tasks (
  id uuid default uuid_generate_v4() primary key,
  episode_id uuid references public.episodes(id) on delete cascade not null,
  template_task_id integer not null,
  label text not null,
  assignee_id uuid references public.users(id) not null,
  track text not null,
  status text not null default 'locked' check (status in ('locked','ready','in_progress','in_review','approved','revision','done')),
  due_date date,
  note text,
  dep_task_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Comments table
create table public.comments (
  id uuid default uuid_generate_v4() primary key,
  task_id uuid references public.tasks(id) on delete cascade not null,
  author_id uuid references public.users(id) not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- Notifications table
create table public.notifications (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  type text not null,
  title text not null,
  body text not null,
  task_id uuid references public.tasks(id) on delete set null,
  episode_id uuid references public.episodes(id) on delete set null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Indexes
create index idx_tasks_episode_id on public.tasks(episode_id);
create index idx_tasks_assignee_id on public.tasks(assignee_id);
create index idx_tasks_status on public.tasks(status);
create index idx_comments_task_id on public.comments(task_id);
create index idx_notifications_user_id on public.notifications(user_id);
create index idx_notifications_read on public.notifications(user_id, read);

-- Updated_at trigger
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function public.handle_updated_at();

-- Unlock dependent tasks when a task is approved or done
create or replace function public.unlock_dependent_tasks()
returns trigger as $$
begin
  if new.status in ('done', 'approved') and old.status not in ('done', 'approved') then
    update public.tasks
    set status = 'in_progress'
    where episode_id = new.episode_id
      and status = 'locked'
      and array_length(dep_task_ids, 1) > 0
      and not exists (
        select 1
        from unnest(dep_task_ids) as dep_id
        left join public.tasks t2 on t2.id = dep_id
        where t2.id is null or t2.status not in ('done', 'approved')
      );
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_unlock_dependent_tasks
  after update on public.tasks
  for each row execute function public.unlock_dependent_tasks();

-- Auto-create user profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, name, role, avatar_color)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'member'),
    coalesce(new.raw_user_meta_data->>'avatar_color', '#fbbf24')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row Level Security
alter table public.users enable row level security;
alter table public.episodes enable row level security;
alter table public.tasks enable row level security;
alter table public.comments enable row level security;
alter table public.notifications enable row level security;

-- RLS Policies: Users
create policy "Users can view all users" on public.users
  for select using (auth.role() = 'authenticated');

create policy "Users can update own profile" on public.users
  for update using (auth.uid() = id);

-- RLS Policies: Episodes
create policy "Authenticated users can view episodes" on public.episodes
  for select using (auth.role() = 'authenticated');

create policy "Admins can insert episodes" on public.episodes
  for insert with check (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

create policy "Admins can update episodes" on public.episodes
  for update using (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

-- RLS Policies: Tasks
create policy "Authenticated users can view tasks" on public.tasks
  for select using (auth.role() = 'authenticated');

create policy "Authenticated users can insert tasks" on public.tasks
  for insert with check (auth.role() = 'authenticated');

create policy "Authenticated users can update tasks" on public.tasks
  for update using (auth.role() = 'authenticated');

-- RLS Policies: Comments
create policy "Authenticated users can view comments" on public.comments
  for select using (auth.role() = 'authenticated');

create policy "Authenticated users can insert comments" on public.comments
  for insert with check (auth.uid() = author_id);

-- RLS Policies: Notifications
create policy "Users can view own notifications" on public.notifications
  for select using (auth.uid() = user_id);

create policy "Authenticated users can insert notifications" on public.notifications
  for insert with check (auth.role() = 'authenticated');

create policy "Users can update own notifications" on public.notifications
  for update using (auth.uid() = user_id);
