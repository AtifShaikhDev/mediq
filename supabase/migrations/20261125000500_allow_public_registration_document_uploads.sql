-- Allow trusted server-side public registration uploads without an authenticated uploader.
alter table public.patient_documents
  alter column uploaded_by drop not null,
  add column if not exists registration_idempotency_key uuid;
