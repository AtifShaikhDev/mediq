-- Admins can review applications; patients can only resubmit their own rejected request.
drop policy if exists "Admins review ID card applications" on public.patient_id_card_applications;
create policy "Admins review ID card applications"
  on public.patient_id_card_applications for select to authenticated
  using (public.current_staff_role() = 'Admin');

create or replace function public.guard_patient_id_card_application_update()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if public.current_staff_role() = 'Admin' then
    return new;
  end if;
  if auth.uid() is null
    or old.status <> 'rejected'
    or old.submitted_by <> auth.uid()
    or new.patient_id is distinct from old.patient_id
    or new.submitted_by is distinct from old.submitted_by
    or new.card_qr_id is distinct from old.card_qr_id
    or new.submitted_at is distinct from old.submitted_at
    or new.reviewed_by is not null
    or new.reviewed_at is not null
    or new.status <> 'pending'
    or new.rejection_reason is not null then
    raise exception 'Only the owner may resubmit a rejected card application.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_patient_id_card_application_update on public.patient_id_card_applications;
create trigger guard_patient_id_card_application_update
before update on public.patient_id_card_applications
for each row execute function public.guard_patient_id_card_application_update();
