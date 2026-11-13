-- All access to submissions and photographs goes through the server function.
-- In particular, anonymous clients must never be able to enumerate pending work.
create table public.submissions (
  id uuid primary key,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  title text not null check (char_length(title) between 1 and 40),
  author text not null check (char_length(author) between 1 and 24),
  cohort text check (cohort is null or cohort ~ '^[0-9]{4}$'),
  theme text not null check (theme in ('people', 'animals', 'plants', 'architecture', 'sky')),
  period text not null check (period in ('morning', 'day', 'dusk', 'night')),
  map_place text,
  place_detail text check (char_length(place_detail) <= 60),
  story text not null default '' check (char_length(story) <= 240),
  object_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp'))
);
create index submissions_public_order on public.submissions (created_at desc) where status = 'approved';
alter table public.submissions enable row level security;
revoke all on public.submissions from anon, authenticated;

-- Explicit allow-list: an authenticated user is not automatically an admin.
create table public.site_admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.site_admins enable row level security;
revoke all on public.site_admins from public, anon, authenticated;
grant select, insert, delete on public.site_admins to service_role;

-- Both pending and approved photos remain private. Public image responses are
-- served only by the server after checking the current approval state.
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('submission-photos', 'submission-photos', false, array['image/jpeg','image/png','image/webp']);

-- A small global testing quota limits damage if the shared invitation leaks.
-- This is not a replacement for provider-level abuse protection.
create schema if not exists private;
create table private.submission_attempts (created_at timestamptz not null default now());
alter table private.submission_attempts enable row level security;
revoke all on schema private from public, anon, authenticated;
revoke all on private.submission_attempts from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert on private.submission_attempts to service_role;
create or replace function public.reserve_submission_slot()
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(728637184);
  if (select count(*) from private.submission_attempts where created_at >= now() - interval '1 day') >= 10 then return false; end if;
  insert into private.submission_attempts default values;
  return true;
end;
$$;
revoke all on function public.reserve_submission_slot() from public, anon, authenticated;
grant execute on function public.reserve_submission_slot() to service_role;
