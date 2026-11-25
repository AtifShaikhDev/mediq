-- Harden Admin-only patient account linking against missing/inactive staff roles.
create or replace function public.admin_link_patient_account(
  p_patient_id uuid,
  p_patient_email text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  v_user_id uuid;
begin
  actor_role := public.current_staff_role();
  if actor_id is null or coalesce(actor_role, '') <> 'Admin' then
    raise exception 'Only active hospital admins can link patient accounts'
      using errcode = '42501';
  end if;

  if p_patient_id is null or p_patient_email is null
     or length(trim(p_patient_email)) = 0 then
    raise exception 'A patient and verified account email are required'
      using errcode = '22023';
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(trim(p_patient_email))
    and u.email_confirmed_at is not null
  limit 1;

  if v_user_id is null then
    raise exception 'No verified patient account found for that email';
  end if;

  insert into public.patient_accounts(patient_id, user_id, linked_by)
  values (p_patient_id, v_user_id, actor_id)
  on conflict (patient_id) do update
    set user_id = excluded.user_id,
        linked_by = excluded.linked_by,
        linked_at = now();
end;
$function$;

revoke all on function public.admin_link_patient_account(uuid, text) from public, anon;
grant execute on function public.admin_link_patient_account(uuid, text) to authenticated, service_role;
