-- Match the database hardening performed in Supabase to the tracked PR migration.
drop policy if exists "Patients and assigned doctors upload documents" on public.patient_documents;
create policy "Patients and assigned doctors upload documents"
on public.patient_documents
for insert
to authenticated
with check (
  uploaded_by = (select auth.uid())
  and (
    (
      visibility = 'patient_visible'
      and exists (
        select 1 from public.patient_accounts pa
        where pa.patient_id = patient_documents.patient_id
          and pa.user_id = (select auth.uid())
      )
    )
    or (
      public.current_staff_role() = 'Doctor'
      and visit_id is not null
      and exists (
        select 1 from public.visits v
        where v.id = patient_documents.visit_id
          and v.patient_id = patient_documents.patient_id
          and v.doctor_user_id = (select auth.uid())
      )
    )
    or public.current_staff_role() = 'Admin'
  )
);

drop policy if exists "Assigned doctors create medical notes" on public.patient_medical_notes;
create policy "Assigned doctors create medical notes"
on public.patient_medical_notes
for insert
to authenticated
with check (
  author_user_id = (select auth.uid())
  and (
    public.current_staff_role() = 'Admin'
    or (
      public.current_staff_role() = 'Doctor'
      and visit_id is not null
      and exists (
        select 1 from public.visits v
        where v.id = patient_medical_notes.visit_id
          and v.patient_id = patient_medical_notes.patient_id
          and v.doctor_user_id = (select auth.uid())
      )
    )
  )
);

drop policy if exists "Authors and admins update medical notes" on public.patient_medical_notes;
create policy "Authors and admins update medical notes"
on public.patient_medical_notes
for update
to authenticated
using (
  public.current_staff_role() = 'Admin'
  or (
    author_user_id = (select auth.uid())
    and public.current_staff_role() = 'Doctor'
  )
)
with check (
  public.current_staff_role() = 'Admin'
  or (
    author_user_id = (select auth.uid())
    and public.current_staff_role() = 'Doctor'
    and visit_id is not null
    and exists (
      select 1 from public.visits v
      where v.id = patient_medical_notes.visit_id
        and v.patient_id = patient_medical_notes.patient_id
        and v.doctor_user_id = (select auth.uid())
    )
  )
);