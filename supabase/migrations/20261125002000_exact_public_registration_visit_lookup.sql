-- Resolve the exact visit created by a public registration idempotency key.
-- This lookup is restricted to the service-role Edge Function.
create or replace function public.get_public_registration_visit(p_idempotency_key uuid)
returns table(patient_id uuid, visit_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Public registration is not available to this role' using errcode = 'PT403';
  end if;

  return query
  select p.id, pr.visit_id
  from private.public_registration_requests pr
  join public.patients p on p.patient_code = pr.patient_code
  where pr.idempotency_key = p_idempotency_key
    and pr.visit_id is not null
  limit 1;
end;
$function$;

revoke all on function public.get_public_registration_visit(uuid) from public, anon, authenticated;
grant execute on function public.get_public_registration_visit(uuid) to service_role;
