-- Limit self-service patient account-link attempts without exposing patient records.
create table if not exists public.patient_link_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index if not exists patient_link_attempts_user_time_idx
  on public.patient_link_attempts(user_id, attempted_at desc);

alter table public.patient_link_attempts enable row level security;
revoke all on table public.patient_link_attempts from public, anon, authenticated;
grant all on table public.patient_link_attempts to service_role;
