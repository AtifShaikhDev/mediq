-- Keep the public doctor directory limited to active doctor identity and department.
-- The department UUID lets the authenticated patient request RPC bind the selected doctor
-- to the correct active department without requiring broad staff_profiles read access.
drop function if exists public.get_public_doctor_directory();
create function public.get_public_doctor_directory()
returns table(user_id uuid, full_name text, department_name text, department_id uuid)
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $function$
  select sp.user_id, sp.full_name, d.name, d.id
  from public.staff_profiles sp
  join public.departments d on d.id = sp.department_id
  where sp.role = 'Doctor' and sp.active = true and d.active = true
  order by d.name, sp.full_name
$function$;
revoke all on function public.get_public_doctor_directory() from public;
grant execute on function public.get_public_doctor_directory() to anon, authenticated;

-- Patient requests are created only through the validating RPC, never by direct table writes.
revoke insert on public.patient_visit_requests from authenticated;
drop policy if exists "Patients create own visit requests" on public.patient_visit_requests;


-- Enforce a non-null staff role before allowing approval/rejection.
-- This also protects against SQL NULL semantics for patient accounts.
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
  if actor_id is null or actor_role is null or actor_role not in ('Admin', 'Receptionist') then
    raise exception 'Only Admin or Reception can review visit requests' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
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

revoke all on function public.review_patient_visit_request(uuid, text) from public, anon;
grant execute on function public.review_patient_visit_request(uuid, text) to authenticated;
