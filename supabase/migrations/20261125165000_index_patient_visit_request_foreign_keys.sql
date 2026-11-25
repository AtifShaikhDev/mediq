-- Add covering indexes for patient visit request foreign keys flagged by the database advisor.
create index if not exists patient_visit_requests_department_id_idx
  on public.patient_visit_requests (department_id);
create index if not exists patient_visit_requests_doctor_user_id_idx
  on public.patient_visit_requests (doctor_user_id);
create index if not exists patient_visit_requests_queue_record_id_idx
  on public.patient_visit_requests (queue_record_id);
create index if not exists patient_visit_requests_reviewed_by_idx
  on public.patient_visit_requests (reviewed_by);
create index if not exists patient_visit_requests_visit_id_idx
  on public.patient_visit_requests (visit_id);
