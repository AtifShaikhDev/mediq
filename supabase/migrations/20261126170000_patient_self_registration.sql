-- Secure self-registration for new patient portal accounts.
-- Existing patient records are never linked by matching user-entered details.
-- Possible duplicates are directed to hospital Admin for verification.

create or replace function public.register_new_patient_account(
  p_full_name text,
  p_age integer,
  p_gender text,
  p_mobile text
)
returns table(patient_id uuid, patient_code text)
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
    raise exception 'Please sign in before completing patient registration.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from auth.users u
    where u.id = actor_id and u.email_confirmed_at is not null
  ) then
    raise exception 'Please confirm your email address before completing patient registration.'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.patient_accounts pa where pa.user_id = actor_id
  ) then
    raise exception 'This login is already connected to a patient record.'
      using errcode = '23505';
  end if;

  if p_full_name is null or length(trim(p_full_name)) not between 1 and 120
     or p_age is null or p_age not between 0 and 120
     or p_gender is null or p_gender not in ('Female', 'Male', 'Non-binary', 'Prefer not to say')
     or p_mobile is null or length(trim(p_mobile)) not between 7 and 30 then
    raise exception 'Enter a valid name, age, gender and mobile number.'
      using errcode = '22023';
  end if;

  normalized_mobile := regexp_replace(trim(p_mobile), '[^0-9]', '', 'g');
  if length(normalized_mobile) < 7 or length(normalized_mobile) > 15 then
    raise exception 'Enter a valid mobile number.'
      using errcode = '22023';
  end if;

  -- Serialize registrations sharing the same normalized mobile number.
  perform pg_advisory_xact_lock(hashtextextended('patient-self-register:' || normalized_mobile, 0));

  if exists (
    select 1
    from public.patients p
    where regexp_replace(p.mobile, '[^0-9]', '', 'g') = normalized_mobile
  ) then
    raise exception 'A hospital record may already use this mobile number. Please ask hospital Admin to verify and link your existing record.'
      using errcode = 'PT409';
  end if;

  insert into public.patients(full_name, age, gender, mobile, created_by)
  values (trim(p_full_name), p_age, p_gender, trim(p_mobile), actor_id)
  returning id, patients.patient_code
    into created_patient_id, created_patient_code;

  insert into public.patient_accounts(patient_id, user_id, linked_by)
  values (created_patient_id, actor_id, null);

  return query select created_patient_id, created_patient_code;
end;
$function$;

revoke all on function public.register_new_patient_account(text, integer, text, text) from public, anon;
grant execute on function public.register_new_patient_account(text, integer, text, text) to authenticated;
