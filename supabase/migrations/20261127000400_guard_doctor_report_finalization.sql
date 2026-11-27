-- Prevent report authors from changing clinical content during finalization
-- or modifying a report after it has been finalized. Admins retain correction
-- capability through the existing administrative role check.
create or replace function public.guard_doctor_report_finalization()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if public.current_staff_role() = 'Admin' then
    return new;
  end if;

  if old.status <> 'draft' then
    raise exception 'Finalized doctor reports cannot be changed.' using errcode = '42501';
  end if;

  if old.author_user_id is distinct from (select auth.uid())
     or new.author_user_id is distinct from old.author_user_id
     or new.patient_id is distinct from old.patient_id
     or new.visit_id is distinct from old.visit_id then
    raise exception 'A doctor report cannot be reassigned.' using errcode = '42501';
  end if;

  if new.status = 'draft' then
    if new.finalized_at is not null then
      raise exception 'A draft report cannot have a finalization timestamp.' using errcode = '23514';
    end if;
  elsif new.status = 'finalized' then
    if new.finalized_at is null
       or new.report_title is distinct from old.report_title
       or new.examination is distinct from old.examination
       or new.diagnosis is distinct from old.diagnosis
       or new.treatment_plan is distinct from old.treatment_plan
       or new.follow_up_instructions is distinct from old.follow_up_instructions
       or new.follow_up_date is distinct from old.follow_up_date then
      raise exception 'Finalize the saved draft without changing its clinical content.' using errcode = '23514';
    end if;
  else
    raise exception 'Invalid doctor report status.' using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists doctor_reports_guard_finalization on public.doctor_reports;
create trigger doctor_reports_guard_finalization
before update on public.doctor_reports
for each row execute function public.guard_doctor_report_finalization();

revoke all on function public.guard_doctor_report_finalization() from public, anon, authenticated;
