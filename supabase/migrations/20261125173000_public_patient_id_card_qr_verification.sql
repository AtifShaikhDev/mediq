-- Public QR verification reveals only whether an opaque card identifier is currently valid.
create or replace function public.verify_patient_id_card(p_card_qr_id uuid)
returns table(valid boolean)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1
    from public.patient_id_card_applications a
    where a.card_qr_id = p_card_qr_id
      and a.status = 'approved'
  );
$function$;

revoke all on function public.verify_patient_id_card(uuid) from public;
grant execute on function public.verify_patient_id_card(uuid) to anon, authenticated, service_role;
