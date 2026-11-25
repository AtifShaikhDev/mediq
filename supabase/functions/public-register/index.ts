import { createClient } from 'npm:@supabase/supabase-js@2'
import { createPublicRegistrationHandler } from './handler.ts'

const registrationHandler = createPublicRegistrationHandler({
  getEnv: (name) => Deno.env.get(name),
  createClient: (url, key) => {
    const client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
    return {
      rpc: async (name, parameters) => {
        const { data, error } = await client.rpc(name, parameters)
        return { data, error: error ? { code: error.code } : null }
      },
      findPatientVisit: async (patientCode) => {
        const { data: patient, error: patientError } = await client.from('patients').select('id').eq('patient_code', patientCode).single()
        if (patientError || !patient) return null
        const { data: visit, error: visitError } = await client.from('visits').select('id').eq('patient_id', patient.id).order('arrived_at', { ascending: false }).limit(1).single()
        if (visitError || !visit) return null
        return { patientId: patient.id, visitId: visit.id }
      },
      uploadPatientFile: async (patientId, visitId, file, idempotencyKey) => {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180) || 'medical-document'
        const storagePath = `${patientId}/${crypto.randomUUID()}-${safeName}`
        const storage = client.storage.from('patient-medical-records')
        const { error: uploadError } = await storage.upload(storagePath, file, { contentType: file.type, upsert: false })
        if (uploadError) throw uploadError
        const { error: metadataError } = await client.from('patient_documents').insert({
          patient_id: patientId, visit_id: visitId, uploaded_by: null, registration_idempotency_key: idempotencyKey, file_name: file.name,
          mime_type: file.type, file_size_bytes: file.size, storage_path: storagePath, visibility: 'patient_visible',
        })
        if (metadataError) {
          await storage.remove([storagePath])
          throw metadataError
        }
      },
    }
  },
  logError: (message, details) => console.error(message, details),
})

export async function handlePublicRegistration(request: Request) {
  try {
    return await registrationHandler(request)
  } catch (error) {
    console.error('Unhandled public registration request failure.', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })

    let origin = ''
    let originAllowed = false
    try {
      origin = request.headers.get('origin') || ''
      originAllowed = Boolean(
        origin
        && (Deno.env.get('PUBLIC_REGISTRATION_ORIGINS') || '')
          .split(',')
          .map((allowedOrigin) => allowedOrigin.trim())
          .includes(origin),
      )
    } catch {
      originAllowed = false
    }

    const headers = new Headers({
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Vary': 'Origin',
    })
    if (originAllowed) headers.set('Access-Control-Allow-Origin', origin)
    return new Response(
      JSON.stringify({ error: 'Registration is temporarily unavailable. Please try again later.' }),
      { status: 503, headers },
    )
  }
}

if (import.meta.main) {
  Deno.serve(handlePublicRegistration)
}
