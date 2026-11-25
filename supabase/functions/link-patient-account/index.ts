import { createClient } from 'npm:@supabase/supabase-js@2'

const allowedOrigin = 'https://atifshaikhdev.github.io'
const e164Pattern = /^\+[1-9]\d{7,14}$/

function respond(body: Record<string, unknown>, status: number, origin = '') {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
  })
  if (origin === allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin)
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'apikey, authorization, content-type, x-client-info')
  }
  return new Response(JSON.stringify(body), { status, headers })
}

function phoneMatches(recordPhone: string, verifiedPhone: string) {
  const stored = recordPhone.replace(/\D/g, '')
  const verified = verifiedPhone.replace(/\D/g, '')
  if (!stored || !verified) return false
  if (stored === verified) return true
  // Existing MediQ records store Indian mobile numbers without the +91 prefix.
  return stored.length === 10 && verified === '91' + stored
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin') || ''
  if (request.method === 'OPTIONS') {
    if (origin !== allowedOrigin) return new Response('Origin not allowed.', { status: 403 })
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
      'Vary': 'Origin',
    }})
  }
  if (origin !== allowedOrigin) return respond({ error: 'Origin not allowed.' }, 403, origin)
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405, origin)
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return respond({ error: 'Expected a JSON request.' }, 415, origin)
  }

  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return respond({ error: 'Please sign in first.' }, 401, origin)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Patient account linking is missing server configuration.')
    return respond({ error: 'Patient account linking is temporarily unavailable.' }, 503, origin)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const { data: authData, error: authError } = await admin.auth.getUser(token)
  const user = authData?.user
  if (authError || !user || !user.email_confirmed_at) {
    return respond({ error: 'Please confirm your email and sign in again.' }, 401, origin)
  }

  let input: Record<string, unknown>
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid')
    input = body as Record<string, unknown>
  } catch {
    return respond({ error: 'Enter valid patient verification details.' }, 400, origin)
  }

  const action = input.action
  const patientCode = typeof input.patientCode === 'string' ? input.patientCode.trim().toUpperCase() : ''
  if (!patientCode || patientCode.length > 40 || !/^[A-Z0-9-]+$/.test(patientCode)) {
    return respond({ error: 'Enter a valid MediQ Patient ID.' }, 400, origin)
  }

  const { data: userLink, error: userLinkError } = await admin
    .from('patient_accounts').select('patient_id').eq('user_id', user.id).maybeSingle()
  if (userLinkError) {
    console.error('Could not inspect current patient link.', userLinkError.message)
    return respond({ error: 'Could not check your patient account.' }, 503, origin)
  }
  if (userLink) return respond({ error: 'This login is already linked to a patient record.' }, 409, origin)

  if (action === 'begin') {
    if (Object.keys(input).sort().join(',') !== 'action,patientCode,phone') {
      return respond({ error: 'Patient verification details are invalid.' }, 400, origin)
    }
    const phone = typeof input.phone === 'string' ? input.phone.trim() : ''
    if (!e164Pattern.test(phone)) {
      return respond({ error: 'Enter your registered mobile number with country code, for example +91XXXXXXXXXX.' }, 400, origin)
    }

    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { count, error: countError } = await admin.from('patient_link_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('attempted_at', cutoff)
    if (countError) {
      console.error('Could not check patient link rate limit.', countError.message)
      return respond({ error: 'Patient verification is temporarily unavailable.' }, 503, origin)
    }
    if ((count || 0) >= 3) {
      return respond({ error: 'Too many attempts. Please wait 15 minutes before trying again.' }, 429, origin)
    }
    const { error: attemptError } = await admin.from('patient_link_attempts').insert({ user_id: user.id })
    if (attemptError) {
      console.error('Could not record patient link attempt.', attemptError.message)
      return respond({ error: 'Patient verification is temporarily unavailable.' }, 503, origin)
    }

    const { data: patient, error: patientError } = await admin.from('patients')
      .select('id,mobile').eq('patient_code', patientCode).maybeSingle()
    if (patientError) {
      console.error('Could not verify patient details.', patientError.message)
      return respond({ error: 'Patient verification is temporarily unavailable.' }, 503, origin)
    }
    if (!patient || !phoneMatches(patient.mobile, phone)) {
      return respond({ eligible: false }, 200, origin)
    }
    const { data: patientLink, error: patientLinkError } = await admin.from('patient_accounts')
      .select('user_id').eq('patient_id', patient.id).maybeSingle()
    if (patientLinkError) {
      console.error('Could not inspect patient account ownership.', patientLinkError.message)
      return respond({ error: 'Patient verification is temporarily unavailable.' }, 503, origin)
    }
    if (patientLink) return respond({ eligible: false }, 200, origin)
    return respond({ eligible: true }, 200, origin)
  }

  if (action === 'complete') {
    if (Object.keys(input).sort().join(',') !== 'action,patientCode') {
      return respond({ error: 'Patient verification details are invalid.' }, 400, origin)
    }
    if (!user.phone || !user.phone_confirmed_at) {
      return respond({ error: 'Verify the SMS code before linking your patient record.' }, 403, origin)
    }
    const { data: patient, error: patientError } = await admin.from('patients')
      .select('id,mobile').eq('patient_code', patientCode).maybeSingle()
    if (patientError) {
      console.error('Could not complete patient verification.', patientError.message)
      return respond({ error: 'Patient account linking is temporarily unavailable.' }, 503, origin)
    }
    if (!patient || !phoneMatches(patient.mobile, user.phone)) {
      return respond({ error: 'The verified mobile number does not match this patient record.' }, 403, origin)
    }
    const { data: patientLink, error: patientLinkError } = await admin.from('patient_accounts')
      .select('user_id').eq('patient_id', patient.id).maybeSingle()
    if (patientLinkError) {
      console.error('Could not verify patient account ownership.', patientLinkError.message)
      return respond({ error: 'Patient account linking is temporarily unavailable.' }, 503, origin)
    }
    if (patientLink) return respond({ error: 'This patient record is already linked to an account. Contact hospital reception if you need help.' }, 409, origin)

    const { error: insertError } = await admin.from('patient_accounts').insert({
      patient_id: patient.id,
      user_id: user.id,
      linked_by: null,
    })
    if (insertError) {
      console.error('Patient self-link failed.', { code: insertError.code })
      if (insertError.code === '23505') {
        return respond({ error: 'This patient record or login is already linked. Contact hospital reception if you need help.' }, 409, origin)
      }
      return respond({ error: 'Patient account linking failed. Please try again or contact hospital reception.' }, 500, origin)
    }
    return respond({ linked: true }, 200, origin)
  }

  return respond({ error: 'Unknown patient linking action.' }, 400, origin)
})
