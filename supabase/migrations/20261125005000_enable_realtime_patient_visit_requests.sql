-- Enable Supabase Realtime notifications for staff visit-request refreshes.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'patient_visit_requests'
     ) then
    alter publication supabase_realtime add table public.patient_visit_requests;
  end if;
end
$$;
