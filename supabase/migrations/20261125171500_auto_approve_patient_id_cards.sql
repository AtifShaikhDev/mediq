-- Automatically approve cards submitted by the authenticated, linked patient.
alter table public.patient_id_card_applications
  add column if not exists approval_source text not null default 'admin';

alter table public.patient_id_card_applications
  drop constraint if exists patient_id_card_review_state;
alter table public.patient_id_card_applications
  add constraint patient_id_card_review_state check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null and approval_source = 'admin')
    or (status = 'approved' and reviewed_at is not null and approval_source in ('admin','automatic')
        and ((approval_source = 'admin' and reviewed_by is not null) or (approval_source = 'automatic' and reviewed_by is null)))
    or (status = 'rejected' and reviewed_by is not null and reviewed_at is not null and approval_source = 'admin')
  );

create or replace function public.guard_patient_id_card_application_update()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if current_user = 'postgres' or public.current_staff_role() = 'Admin' then
    return new;
  end if;
  if auth.uid() is null or old.status <> 'rejected' or old.submitted_by <> auth.uid()
    or new.patient_id is distinct from old.patient_id
    or new.submitted_by is distinct from old.submitted_by
    or new.card_qr_id is distinct from old.card_qr_id
    or new.submitted_at is distinct from old.submitted_at
    or new.reviewed_by is not null or new.reviewed_at is null
    or new.status <> 'approved' or new.approval_source <> 'automatic'
    or new.rejection_reason is not null
    or not exists (select 1 from public.patient_accounts pa
      where pa.patient_id = old.patient_id and pa.user_id = auth.uid()) then
    raise exception 'Only the linked patient may resubmit a rejected card application for automatic approval.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop function if exists public.submit_patient_id_card_application(uuid,text,date,text,text,text);
create or replace function public.submit_patient_id_card_application(
  p_blood_group text default null,
  p_date_of_birth date default null,
  p_emergency_contact_name text default null,
  p_emergency_contact_phone text default null,
  p_address text default null
)
returns table(application_id uuid, status text, card_qr_id uuid, submitted_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  actor_id uuid := auth.uid();
  linked_patient_id uuid;
  existing_application public.patient_id_card_applications%rowtype;
begin
  if actor_id is null then
    raise exception 'Sign in to submit a patient ID card application.' using errcode = '42501';
  end if;

  select pa.patient_id into linked_patient_id
  from public.patient_accounts pa
  where pa.user_id = actor_id
  limit 1 for update;

  if linked_patient_id is null then
    raise exception 'This login is not linked to a patient record. Contact the hospital.' using errcode = '42501';
  end if;

  if p_blood_group is not null
    and p_blood_group not in ('A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown') then
    raise exception 'Choose a valid blood group.' using errcode = '22023';
  end if;

  select a.* into existing_application
  from public.patient_id_card_applications a
  where a.patient_id = linked_patient_id
  for update;

  if found and existing_application.status = 'approved' then
    return query select existing_application.id, existing_application.status,
      existing_application.card_qr_id, existing_application.submitted_at;
    return;
  end if;

  if found then
    update public.patient_id_card_applications a
    set blood_group = p_blood_group,
      date_of_birth = p_date_of_birth,
      emergency_contact_name = nullif(trim(coalesce(p_emergency_contact_name,'')), ''),
      emergency_contact_phone = nullif(trim(coalesce(p_emergency_contact_phone,'')), ''),
      address = nullif(trim(coalesce(p_address,'')), ''),
      status = 'approved', reviewed_by = null, reviewed_at = now(),
      approval_source = 'automatic', rejection_reason = null
    where a.id = existing_application.id
    returning a.id, a.status, a.card_qr_id, a.submitted_at
    into application_id, status, card_qr_id, submitted_at;
  else
    insert into public.patient_id_card_applications (
      patient_id, submitted_by, blood_group, date_of_birth,
      emergency_contact_name, emergency_contact_phone, address,
      status, reviewed_by, reviewed_at, rejection_reason, approval_source
    ) values (
      linked_patient_id, actor_id, p_blood_group, p_date_of_birth,
      nullif(trim(coalesce(p_emergency_contact_name,'')), ''),
      nullif(trim(coalesce(p_emergency_contact_phone,'')), ''),
      nullif(trim(coalesce(p_address,'')), ''),
      'approved', null, now(), null, 'automatic'
    )
    returning id, patient_id_card_applications.status,
      patient_id_card_applications.card_qr_id, patient_id_card_applications.submitted_at
    into application_id, status, card_qr_id, submitted_at;
  end if;
  return next;
end;
$function$;

revoke all on function public.submit_patient_id_card_application(text,date,text,text,text) from public, anon;
grant execute on function public.submit_patient_id_card_application(text,date,text,text,text) to authenticated, service_role;

drop policy if exists "Patients resubmit rejected ID card application" on public.patient_id_card_applications;
create policy "Patients resubmit rejected ID card application"
on public.patient_id_card_applications for update to authenticated
using (status = 'rejected' and exists (
  select 1 from public.patient_accounts pa
  where pa.patient_id = patient_id_card_applications.patient_id and pa.user_id = (select auth.uid())
))
with check (
  submitted_by = (select auth.uid()) and status = 'approved'
  and approval_source = 'automatic' and reviewed_by is null and reviewed_at is not null
  and exists (select 1 from public.patient_accounts pa
    where pa.patient_id = patient_id_card_applications.patient_id and pa.user_id = (select auth.uid()))
);

create index if not exists patient_id_card_applications_reviewed_by_idx
  on public.patient_id_card_applications(reviewed_by);
create index if not exists patient_id_card_applications_submitted_by_idx
  on public.patient_id_card_applications(submitted_by);
