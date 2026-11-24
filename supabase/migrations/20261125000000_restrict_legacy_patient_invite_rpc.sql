-- Restrict legacy token-based patient invitation RPCs.
-- The active patient invitation flow uses the invite-patient Edge Function.
-- Keep service_role access for trusted server-side maintenance only.
REVOKE EXECUTE ON FUNCTION public.claim_patient_account_invite(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_patient_account_invite(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_patient_account_invite(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_patient_account_invite(uuid, text) TO service_role;
