-- Make public self-registration document attachments safely retryable.
alter table public.patient_documents
  add column if not exists registration_idempotency_key uuid,
  add column if not exists registration_file_index integer,
  add column if not exists file_sha256 text;

drop index if exists public.patient_documents_registration_idempotency_file_uidx;

create unique index if not exists patient_documents_registration_idempotency_index_uidx
  on public.patient_documents (registration_idempotency_key, registration_file_index)
  where registration_idempotency_key is not null;

alter table public.patient_documents
  add constraint patient_documents_file_sha256_format
  check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$');
