-- Patient ID card application and Admin approval workflow.
create table if not exists public.patient_id_card_applications (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null unique references public.patients(id) on delete cascade,
  submitted_by uuid not null references auth.users(id),
  blood_group text check (blood_group is null or blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown')),
  date_of_birth date,
  emergency_contact_name text,
  emergency_contact_phone text,
  address text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  card_qr_id uuid not null default gen_random_uuid() unique,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  constraint patient_id_card_review_state check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status in ('approved','rejected') and reviewed_by is not null and reviewed_at is not null)
  )
);

create index if not exists patient_id_card_applications_status_submitted_idx
  on public.patient_id_card_applications(status, submitted_at desc);

alter table public.patient_id_card_applications enable row level security;
revoke all on public.patient_id_card_applications from anon, public;
grant select, insert, update on public.patient_id_card_applications to authenticated;

drop policy if exists "Patients read own ID card application" on public.patient_id_card_applications;
create policy "Patients read own ID card application"
  on public.patient_id_card_applications for select to authenticated
  using (exists (
    select 1 from public.patient_accounts pa
    where pa.patient_id = patient_id_card_applications.patient_id
      and pa.user_id = (select auth.uid())
  ));

drop policy if exists "Patients submit own ID card application" on public.patient_id_card_applications;
create policy "Patients submit own ID card application"
  on public.patient_id_card_applications for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and exists (
      select 1 from public.patient_accounts pa
      where pa.patient_id = patient_id_card_applications.patient_id
        and pa.user_id = (select auth.uid())
    )
  );

drop policy if exists "Patients resubmit rejected ID card application" on public.patient_id_card_applications;
create policy "Patients resubmit rejected ID card application"
  on public.patient_id_card_applications for update to authenticated
  using (
    status = 'rejected'
    and exists (
      select 1 from public.patient_accounts pa
      where pa.patient_id = patient_id_card_applications.patient_id
        and pa.user_id = (select auth.uid())
    )
  )
  with check (
    submitted_by = (select auth.uid())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and exists (
      select 1 from public.patient_accounts pa
      where pa.patient_id = patient_id_card_applications.patient_id
        and pa.user_id = (select auth.uid())
    )
  );

create or replace function public.review_patient_id_card_application(
  p_application_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns table(application_id uuid, status text, reviewed_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text := public.current_staff_role();
begin
  if actor_id is null or coalesce(actor_role, '') <> 'Admin' then
    raise exception 'Only an active Admin can review patient ID cards.' using errcode = '42501';
  end if;
  if p_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected.' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and nullif(trim(coalesce(p_rejection_reason,'')), '') is null then
    raise exception 'A reason is required when rejecting an application.' using errcode = '22023';
  end if;

  return query
  update public.patient_id_card_applications a
  set status = p_decision,
      reviewed_by = actor_id,
      reviewed_at = now(),
      rejection_reason = case when p_decision = 'rejected' then left(trim(p_rejection_reason), 500) else null end
  where a.id = p_application_id
    and a.status = 'pending'
  returning a.id, a.status, a.reviewed_at;

  if not found then
    raise exception 'Pending patient ID card application not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.review_patient_id_card_application(uuid,text,text) from public, anon;
grant execute on function public.review_patient_id_card_application(uuid,text,text) to authenticated, service_role;
