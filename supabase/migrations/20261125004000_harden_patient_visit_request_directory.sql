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
