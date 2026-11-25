-- Patient self-service visit requests; hospital staff approve before a queue token is created.
create table if not exists public.patient_visit_requests (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  department_id uuid not null references public.departments(id),
  doctor_user_id uuid not null references public.staff_profiles(user_id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  visit_id uuid references public.visits(id) on delete set null,
  queue_record_id uuid references public.queue_records(id) on delete set null,
  constraint patient_visit_requests_review_state_check check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null and visit_id is null and queue_record_id is null)
    or (status = 'rejected' and reviewed_at is not null and reviewed_by is not null and visit_id is null and queue_record_id is null)
    or (status = 'approved' and reviewed_at is not null and reviewed_by is not null and visit_id is not null and queue_record_id is not null)
  )
);

create unique index if not exists patient_visit_requests_one_pending_per_patient_uidx
  on public.patient_visit_requests(patient_id) where status = 'pending';
create index if not exists patient_visit_requests_status_created_idx
  on public.patient_visit_requests(status, created_at desc);

alter table public.patient_visit_requests enable row level security;
revoke all on public.patient_visit_requests from public, anon;
grant select, insert on public.patient_visit_requests to authenticated;

drop policy if exists "Patients create own visit requests" on public.patient_visit_requests;
create policy "Patients create own visit requests"
  on public.patient_visit_requests for insert to authenticated
  with check (
    status = 'pending'
    and reviewed_at is null and reviewed_by is null
    and visit_id is null and queue_record_id is null
    and exists (
      select 1 from public.patient_accounts pa
      where pa.patient_id = patient_visit_requests.patient_id
        and pa.user_id = (select auth.uid())
    )
  );

drop policy if exists "Patients read own visit requests" on public.patient_visit_requests;
create policy "Patients read own visit requests"
  on public.patient_visit_requests for select to authenticated
  using (
    exists (
      select 1 from public.patient_accounts pa
      where pa.patient_id = patient_visit_requests.patient_id
        and pa.user_id = (select auth.uid())
    )
  );

drop policy if exists "Staff read patient visit requests" on public.patient_visit_requests;
create policy "Staff read patient visit requests"
  on public.patient_visit_requests for select to authenticated
  using (public.current_staff_role() = any (array['Admin','Receptionist','Nurse']));

create or replace function public.create_patient_visit_request(
  p_department_id uuid,
  p_doctor_user_id uuid
)
returns table(request_id uuid, request_status text, requested_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  actor_id uuid := auth.uid();
  linked_patient_id uuid;
  department_row public.departments%rowtype;
  doctor_row public.staff_profiles%rowtype;
  new_request_id uuid;
  new_created_at timestamptz;
begin
  if actor_id is null then
    raise exception 'Please sign in to request a visit' using errcode = '42501';
  end if;

  select pa.patient_id into linked_patient_id
  from public.patient_accounts pa
  where pa.user_id = actor_id;
  if linked_patient_id is null then
    raise exception 'Your account is not linked to a hospital patient record' using errcode = '42501';
  end if;

  select * into department_row
  from public.departments
  where id = p_department_id and active = true;
  if not found then
    raise exception 'Please choose an active department' using errcode = '22023';
  end if;

  select * into doctor_row
  from public.staff_profiles
  where user_id = p_doctor_user_id
    and role = 'Doctor'
    and active = true
    and department_id = department_row.id;
  if not found then
    raise exception 'Please choose an active doctor in the selected department' using errcode = '22023';
  end if;

  insert into public.patient_visit_requests(patient_id, department_id, doctor_user_id)
  values (linked_patient_id, department_row.id, doctor_row.user_id)
  returning id, created_at into new_request_id, new_created_at;

  return query select new_request_id, 'pending'::text, new_created_at;
exception
  when unique_violation then
    raise exception 'You already have a visit request awaiting hospital approval' using errcode = 'PT409';
end;
$function$;

create or replace function public.review_patient_visit_request(
  p_request_id uuid,
  p_decision text
)
returns table(request_id uuid, request_status text, visit_id uuid, queue_token text)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  request_row public.patient_visit_requests%rowtype;
  department_row public.departments%rowtype;
  doctor_row public.staff_profiles%rowtype;
  new_visit_id uuid;
  new_queue_id uuid;
  queue_day date := (now() at time zone 'Asia/Kolkata')::date;
  next_number integer;
  new_token text;
begin
  actor_role := public.current_staff_role();
  if actor_id is null or actor_role not in ('Admin', 'Receptionist') then
    raise exception 'Only Admin or Reception can review visit requests' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'Choose approve or reject' using errcode = '22023';
  end if;

  select * into request_row
  from public.patient_visit_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Visit request not found' using errcode = 'PT404';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'This visit request has already been reviewed' using errcode = 'PT409';
  end if;

  if p_decision = 'reject' then
    update public.patient_visit_requests
    set status = 'rejected', reviewed_at = now(), reviewed_by = actor_id
    where id = request_row.id;
    return query select request_row.id, 'rejected'::text, null::uuid, null::text;
    return;
  end if;

  select * into department_row
  from public.departments
  where id = request_row.department_id and active = true;
  if not found then
    raise exception 'The requested department is no longer active' using errcode = '22023';
  end if;

  select * into doctor_row
  from public.staff_profiles
  where user_id = request_row.doctor_user_id
    and role = 'Doctor' and active = true
    and department_id = department_row.id;
  if not found then
    raise exception 'The requested doctor is no longer active in this department' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(department_row.id::text || ':' || queue_day::text, 0));
  select coalesce(max(q.token_number), 0) + 1 into next_number
  from public.queue_records q
  where q.department_id = department_row.id and q.queue_date = queue_day;

  new_token := department_row.code || '-' ||
    lpad(next_number::text, greatest(3, length(next_number::text)), '0');

  insert into public.visits(patient_id, department_id, doctor_user_id, created_by)
  values (request_row.patient_id, department_row.id, doctor_row.user_id, actor_id)
  returning id into new_visit_id;

  insert into public.queue_records(visit_id, department_id, queue_date, token_number, token, created_by)
  values (new_visit_id, department_row.id, queue_day, next_number, new_token, actor_id)
  returning id into new_queue_id;

  update public.patient_visit_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = actor_id,
      visit_id = new_visit_id, queue_record_id = new_queue_id
  where id = request_row.id;

  return query select request_row.id, 'approved'::text, new_visit_id, new_token;
end;
$function$;

revoke all on function public.create_patient_visit_request(uuid, uuid) from public, anon;
revoke all on function public.review_patient_visit_request(uuid, text) from public, anon;
grant execute on function public.create_patient_visit_request(uuid, uuid) to authenticated;
grant execute on function public.review_patient_visit_request(uuid, text) to authenticated;
