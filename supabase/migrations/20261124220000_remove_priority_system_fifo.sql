begin;

create or replace function public.call_next_patient(p_department_id uuid)
returns table (queue_record_id uuid, visit_id uuid, token text, status text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  role_name text := public.current_staff_role();
  today_kolkata date := (now() at time zone 'Asia/Kolkata')::date;
  next_record public.queue_records%rowtype;
begin
  if actor_id is null or role_name is null or role_name not in ('Admin','Receptionist','Doctor','Nurse') then
    raise exception 'Staff role is not permitted to call queue patients' using errcode = '42501';
  end if;
  if role_name = 'Doctor' and not exists (
    select 1 from public.staff_profiles sp
    where sp.user_id = actor_id and sp.active = true and sp.role = 'Doctor' and sp.department_id = p_department_id
  ) then
    raise exception 'Doctors can only call patients in their assigned department' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_department_id::text || ':' || today_kolkata::text, 0));
  if exists (
    select 1 from public.queue_records qr join public.visits v on v.id = qr.visit_id
    where qr.department_id = p_department_id and qr.queue_date = today_kolkata and qr.status = 'Serving'
      and (role_name <> 'Doctor' or v.doctor_user_id = actor_id)
  ) then
    raise exception 'Complete the current visit before calling another patient' using errcode = '55000';
  end if;
  select qr.* into next_record
  from public.queue_records qr join public.visits v on v.id = qr.visit_id
  where qr.department_id = p_department_id and qr.queue_date = today_kolkata and qr.status = 'Waiting'
    and (role_name <> 'Doctor' or v.doctor_user_id = actor_id)
  order by qr.created_at, qr.id
  for update of qr skip locked limit 1;
  if not found then
    raise exception 'No patients are waiting for this doctor in this department' using errcode = 'P0002';
  end if;
  update public.queue_records qr set status = 'Serving', called_at = now(), updated_by = actor_id where qr.id = next_record.id;
  return query select next_record.id, next_record.visit_id, next_record.token, 'Serving'::text;
end
$$;

create or replace function public.sync_public_queue_display()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  department_row public.departments%rowtype;
  configured_hospital_name text;
  active_date date;
  serving_token text;
  waiting_token text;
begin
  select * into department_row from public.departments where id = new.department_id;
  select hospital_name into configured_hospital_name from public.hospital_settings where id = true;
  active_date := (now() at time zone 'Asia/Kolkata')::date;
  select token into serving_token from public.queue_records
    where department_id = new.department_id and queue_date = active_date and status = 'Serving' limit 1;
  select token into waiting_token from public.queue_records
    where department_id = new.department_id and queue_date = active_date and status = 'Waiting'
    order by created_at, id limit 1;
  insert into public.public_queue_display (
    department_id, hospital_name, department_name, department_code, now_serving_token, next_token, updated_at
  ) values (
    department_row.id, configured_hospital_name, department_row.name, department_row.code, serving_token, waiting_token, now()
  )
  on conflict (department_id) do update set
    hospital_name = excluded.hospital_name, department_name = excluded.department_name,
    department_code = excluded.department_code, now_serving_token = excluded.now_serving_token,
    next_token = excluded.next_token, updated_at = excluded.updated_at;
  return new;
end
$$;

drop trigger if exists update_public_queue_display on public.queue_records;
create trigger update_public_queue_display after insert or update of status, called_at, completed_at
on public.queue_records for each row execute function public.sync_public_queue_display();

drop function if exists public.set_queue_priority(uuid, text);
drop index if exists public.queue_waiting_order_idx;
alter table public.queue_records drop column if exists priority;
create index queue_waiting_order_idx on public.queue_records (department_id, queue_date, status, created_at, id);

commit;