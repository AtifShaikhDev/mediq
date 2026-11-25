-- Pin SECURITY DEFINER function search paths to trusted schemas.
alter function public.call_next_patient(uuid) set search_path = pg_catalog, public, pg_temp;
alter function public.complete_queue_record(uuid) set search_path = pg_catalog, public, pg_temp;
alter function public.current_staff_role() set search_path = pg_catalog, public, pg_temp;
alter function public.register_patient(text, integer, text, text, uuid, uuid) set search_path = pg_catalog, public, pg_temp;
alter function public.get_public_hospital_profile() set search_path = pg_catalog, public, pg_temp;
