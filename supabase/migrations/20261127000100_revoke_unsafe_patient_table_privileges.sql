-- Remove unnecessary anonymous access and prevent RLS-bypassing table operations.
revoke all privileges on table
  public.doctor_reports,
  public.patient_accounts,
  public.patient_documents,
  public.patient_medical_notes
from anon;

revoke truncate, references, trigger on table
  public.doctor_reports,
  public.patient_accounts,
  public.patient_documents,
  public.patient_medical_notes,
  public.patient_id_card_applications
from anon, authenticated;
