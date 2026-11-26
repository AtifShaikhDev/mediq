-- Add indexes for foreign-key lookups on patient account link review metadata.
-- These indexes support joins and deletes/updates on referenced patient/staff rows.
create index if not exists patient_account_link_requests_linked_patient_id_idx
  on public.patient_account_link_requests (linked_patient_id);

create index if not exists patient_account_link_requests_reviewed_by_idx
  on public.patient_account_link_requests (reviewed_by);
