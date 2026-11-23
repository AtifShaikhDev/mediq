-- Restrict doctor reads to visits assigned to their own staff account.
-- Preserve the broader existing staff access for Admin, Receptionist and Nurse.

drop policy if exists "Staff read permitted profiles" on public.staff_profiles;
create policy "Staff read permitted profiles" on public.staff_profiles
for select to authenticated
using (user_id = (select auth.uid()) or public.current_staff_role() = 'Admin');

drop policy if exists "Staff read patients" on public.patients;
create policy "Staff read patients" on public.patients
for select to authenticated
using (
  public.current_staff_role() in ('Admin', 'Receptionist', 'Nurse')
  or (
    public.current_staff_role() = 'Doctor'
    and exists (
      select 1 from public.visits v
      where v.patient_id = patients.id
        and v.doctor_user_id = (select auth.uid())
    )
  )
);

drop policy if exists "Staff read visits" on public.visits;
create policy "Staff read visits" on public.visits
for select to authenticated
using (
  public.current_staff_role() in ('Admin', 'Receptionist', 'Nurse')
  or (public.current_staff_role() = 'Doctor' and doctor_user_id = (select auth.uid()))
);

drop policy if exists "Staff read queue" on public.queue_records;
create policy "Staff read queue" on public.queue_records
for select to authenticated
using (
  public.current_staff_role() in ('Admin', 'Receptionist', 'Nurse')
  or (
    public.current_staff_role() = 'Doctor'
    and exists (
      select 1 from public.visits v
      where v.id = queue_records.visit_id
        and v.doctor_user_id = (select auth.uid())
    )
  )
);

create or replace function public.call_next_patient(p_department_id uuid)
returns table(queue_record_id uuid, visit_id uuid, token text, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  actor_id uuid := auth.uid();
  role_name text := public.current_staff_role();
  today_kolkata date := (now() at time zone 'Asia/Kolkata')::date;
  next_record public.queue_records%rowtype;
begin
  if actor_id is null or role_name is null
     or role_name not in ('Admin', 'Receptionist', 'Doctor', 'Nurse') then
    raise exception 'Staff role is not permitted to call queue patients' using errcode = '42501';
  end if;

  if role_name = 'Doctor' and not exists (
    select 1 from public.staff_profiles sp
    where sp.user_id = actor_id and sp.active = true
      and sp.role = 'Doctor' and sp.department_id = p_department_id
  ) then
    raise exception 'Doctors can only call patients in their assigned department' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_department_id::text || ':' || today_kolkata::text, 0)
  );

  if exists (
    select 1 from public.queue_records qr
    join public.visits v on v.id = qr.visit_id
    where qr.department_id = p_department_id
      and qr.queue_date = today_kolkata
      and qr.status = 'Serving'
      and (role_name <> 'Doctor' or v.doctor_user_id = actor_id)
  ) then
    raise exception 'Complete the current visit before calling another patient' using errcode = '55000';
  end if;

  select qr.* into next_record
  from public.queue_records qr
  join public.visits v on v.id = qr.visit_id
  where qr.department_id = p_department_id
    and qr.queue_date = today_kolkata
    and qr.status = 'Waiting'
    and (role_name <> 'Doctor' or v.doctor_user_id = actor_id)
  order by
    case qr.priority when 'red' then 1 when 'yellow' then 2 when 'green' then 3 else 4 end,
    qr.created_at, qr.id
  for update of qr skip locked
  limit 1;

  if not found then
    raise exception 'No patients are waiting for this doctor in this department' using errcode = 'P0002';
  end if;

  update public.queue_records qr
  set status = 'Serving', called_at = now(), updated_by = actor_id
  where qr.id = next_record.id;

  return query select next_record.id, next_record.visit_id, next_record.token, 'Serving'::text;
end
$function$;

create or replace function public.complete_queue_record(p_queue_record_id uuid)
returns table(queue_record_id uuid, token text, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  actor_id uuid := auth.uid();
  role_name text := public.current_staff_role();
  completed_record public.queue_records%rowtype;
begin
  if actor_id is null or role_name is null
     or role_name not in ('Admin', 'Doctor', 'Nurse') then
    raise exception 'Staff role is not permitted to complete visits' using errcode = '42501';
  end if;

  update public.queue_records qr
  set status = 'Completed', completed_at = now(), updated_by = actor_id
  where qr.id = p_queue_record_id
    and qr.status = 'Serving'
    and (
      role_name <> 'Doctor'
      or exists (
        select 1 from public.visits v
        where v.id = qr.visit_id and v.doctor_user_id = actor_id
      )
    )
  returning qr.* into completed_record;

  if not found then
    raise exception 'Serving queue record was not found for this doctor' using errcode = 'P0002';
  end if;

  return query select completed_record.id, completed_record.token, 'Completed'::text;
end
$function$;
