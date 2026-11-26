-- Secure self-registration for new patient portal accounts.
-- Existing patient records are never linked by matching user-entered details.
-- Possible duplicates are directed to hospital Admin for verification.


create table if not exists public.patient_account_link_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  age smallint not null check (age between 0 and 120),
  gender text not null check (gender in ('Female','Male','Non-binary','Prefer not to say')),
  mobile text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  linked_patient_id uuid references public.patients(id),
  review_note text
);

create unique index if not exists patient_account_link_requests_one_pending_per_user
  on public.patient_account_link_requests(user_id) where status = 'pending';
create index if not exists patient_account_link_requests_pending_created
  on public.patient_account_link_requests(created_at) where status = 'pending';

alter table public.patient_account_link_requests enable row level security;
revoke all on public.patient_account_link_requests from public, anon, authenticated;

create or replace function public.register_new_patient_account(
  p_full_name text,
  p_age integer,
  p_gender text,
  p_mobile text
)
returns table(registration_status text, patient_id uuid, patient_code text)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  actor_id uuid := auth.uid();
  normalized_mobile text;
  created_patient_id uuid;
  created_patient_code text;
begin
  if actor_id is null then
    raise exception 'Please sign in before completing patient registration.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = actor_id and u.email_confirmed_at is not null) then
    raise exception 'Please confirm your email address before completing patient registration.' using errcode = '42501';
  end if;
  if exists (select 1 from public.patient_accounts pa where pa.user_id = actor_id) then
    raise exception 'This login is already connected to a patient record.' using errcode = '23505';
  end if;
  if p_full_name is null or length(trim(p_full_name)) not between 1 and 120
     or p_age is null or p_age not between 0 and 120
     or p_gender is null or p_gender not in ('Female','Male','Non-binary','Prefer not to say')
     or p_mobile is null or length(trim(p_mobile)) not between 7 and 30 then
    raise exception 'Enter a valid name, age, gender and mobile number.' using errcode = '22023';
  end if;

  normalized_mobile := regexp_replace(trim(p_mobile), '[^0-9]', '', 'g');
  if length(normalized_mobile) < 7 or length(normalized_mobile) > 15 then
    raise exception 'Enter a valid mobile number.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('patient-self-register:' || normalized_mobile, 0));

  if exists (
    select 1 from public.patients p
    where regexp_replace(p.mobile, '[^0-9]', '', 'g') = normalized_mobile
       or (length(regexp_replace(p.mobile, '[^0-9]', '', 'g')) >= 10
           and length(normalized_mobile) >= 10
           and right(regexp_replace(p.mobile, '[^0-9]', '', 'g'), 10) = right(normalized_mobile, 10))
  ) then
    insert into public.patient_account_link_requests(user_id, full_name, age, gender, mobile)
    values (actor_id, trim(p_full_name), p_age, p_gender, trim(p_mobile))
    on conflict (user_id) where status = 'pending' do nothing;
    return query select 'review_required'::text, null::uuid, null::text;
    return;
  end if;

  insert into public.patients(full_name, age, gender, mobile, created_by)
  values (trim(p_full_name), p_age, p_gender, trim(p_mobile), actor_id)
  returning id, patients.patient_code into created_patient_id, created_patient_code;

  insert into public.patient_accounts(patient_id, user_id, linked_by)
  values (created_patient_id, actor_id, null);

  return query select 'created'::text, created_patient_id, created_patient_code;
end;
$function$;

create or replace function public.get_my_patient_account_link_request()
returns table(request_status text, requested_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
  select r.status, r.created_at
  from public.patient_account_link_requests r
  where r.user_id = auth.uid()
  order by r.created_at desc
  limit 1
$function$;

create or replace function public.admin_list_patient_account_link_requests()
returns table(
  request_id uuid,
  patient_name text,
  patient_age smallint,
  patient_gender text,
  patient_mobile text,
  patient_email text,
  requested_at timestamptz,
  candidates jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
begin
  if public.current_staff_role() is distinct from 'Admin' then
    raise exception 'Only active Admin users can review patient account requests.' using errcode = '42501';
  end if;

  return query
  select r.id, r.full_name, r.age, r.gender, r.mobile, u.email::text, r.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'patient_code', p.patient_code,
        'full_name', p.full_name, 'mobile', p.mobile
      ) order by p.created_at desc)
      from public.patients p
      where regexp_replace(p.mobile, '[^0-9]', '', 'g') = regexp_replace(r.mobile, '[^0-9]', '', 'g')
         or (length(regexp_replace(p.mobile, '[^0-9]', '', 'g')) >= 10
             and length(regexp_replace(r.mobile, '[^0-9]', '', 'g')) >= 10
             and right(regexp_replace(p.mobile, '[^0-9]', '', 'g'), 10) = right(regexp_replace(r.mobile, '[^0-9]', '', 'g'), 10))
    ), '[]'::jsonb)
  from public.patient_account_link_requests r
  join auth.users u on u.id = r.user_id
  where r.status = 'pending'
  order by r.created_at asc
  limit 200;
end;
$function$;

create or replace function public.admin_review_patient_account_link_request(
  p_request_id uuid,
  p_decision text,
  p_patient_id uuid default null,
  p_review_note text default null
)
returns table(request_status text, patient_code text)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  req public.patient_account_link_requests%rowtype;
  patient_mobile text;
  patient_code_value text;
  normalized_request_mobile text;
  normalized_patient_mobile text;
begin
  if public.current_staff_role() is distinct from 'Admin' then
    raise exception 'Only active Admin users can review patient account requests.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve','reject') then
    raise exception 'Choose approve or reject.' using errcode = '22023';
  end if;

  select * into req
  from public.patient_account_link_requests
  where id = p_request_id and status = 'pending'
  for update;
  if not found then raise exception 'This request is no longer pending.' using errcode = 'P0002'; end if;

  if p_decision = 'reject' then
    update public.patient_account_link_requests
    set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(),
        review_note = nullif(left(trim(coalesce(p_review_note,'')),500),'')
    where id = req.id;
    return query select 'rejected'::text, null::text;
    return;
  end if;

  if p_patient_id is null then raise exception 'Select the verified hospital patient record.' using errcode = '22023'; end if;

  select p.mobile, p.patient_code into patient_mobile, patient_code_value
  from public.patients p where p.id = p_patient_id;
  if not found then raise exception 'Selected patient record was not found.' using errcode = 'P0002'; end if;

  normalized_request_mobile := regexp_replace(req.mobile, '[^0-9]', '', 'g');
  normalized_patient_mobile := regexp_replace(patient_mobile, '[^0-9]', '', 'g');
  if not (
    normalized_request_mobile = normalized_patient_mobile
    or (length(normalized_request_mobile) >= 10 and length(normalized_patient_mobile) >= 10
        and right(normalized_request_mobile,10) = right(normalized_patient_mobile,10))
  ) then
    raise exception 'Selected record mobile number does not match this request. Verify and correct the hospital record first.' using errcode = '22023';
  end if;

  if not exists (select 1 from auth.users u where u.id = req.user_id and u.email_confirmed_at is not null) then
    raise exception 'The patient must confirm their email before account linking.' using errcode = '42501';
  end if;
  if exists (select 1 from public.patient_accounts pa where pa.patient_id = p_patient_id or pa.user_id = req.user_id) then
    raise exception 'This patient record or login is already linked.' using errcode = '23505';
  end if;

  insert into public.patient_accounts(patient_id, user_id, linked_by)
  values (p_patient_id, req.user_id, auth.uid());

  update public.patient_account_link_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(),
      linked_patient_id = p_patient_id,
      review_note = nullif(left(trim(coalesce(p_review_note,'')),500),'')
  where id = req.id;

  return query select 'approved'::text, patient_code_value;
end;
$function$;

revoke all on function public.register_new_patient_account(text, integer, text, text) from public, anon;
revoke all on function public.get_my_patient_account_link_request() from public, anon;
revoke all on function public.admin_list_patient_account_link_requests() from public, anon, authenticated;
revoke all on function public.admin_review_patient_account_link_request(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.register_new_patient_account(text, integer, text, text) to authenticated;
grant execute on function public.get_my_patient_account_link_request() to authenticated;
grant execute on function public.admin_list_patient_account_link_requests() to authenticated;
grant execute on function public.admin_review_patient_account_link_request(uuid, text, uuid, text) to authenticated;
