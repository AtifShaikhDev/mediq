import {
  normalizeRegistration,
  RegistrationValidationError,
  type NormalizedRegistration,
} from './validation.ts'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hashPattern = /^[0-9a-f]{64}$/
const maxBodyBytes = 4096

type RpcError = { code?: string | null }
type RpcResult = { data: unknown; error: RpcError | null }

export type PublicRegistrationClient = {
  rpc: (name: string, parameters: Record<string, unknown>) => PromiseLike<RpcResult>
}

export type PublicRegistrationDependencies = {
  getEnv: (name: string) => string | undefined
  createClient: (url: string, key: string) => PublicRegistrationClient
  logError: (message: string, details?: Record<string, unknown>) => void
}

function allowedOrigins(getEnv: PublicRegistrationDependencies['getEnv']) {
  return new Set(
    (getEnv('PUBLIC_REGISTRATION_ORIGINS') || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
}

function responseHeaders(origin: string) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
  })
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'apikey, authorization, content-type, idempotency-key, x-client-info')
  headers.set('Access-Control-Expose-Headers', 'Retry-After')
  return headers
}

function jsonResponse(
  origin: string,
  body: Record<string, unknown>,
  status: number,
  extraHeaders?: HeadersInit,
  includeCors = true,
) {
  const headers = includeCors
    ? responseHeaders(origin)
    : new Headers({
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Vary': 'Origin',
    })
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value))
  return new Response(JSON.stringify(body), { status, headers })
}

function getClientIp(request: Request) {
  return request.headers.get('cf-connecting-ip')?.trim() || ''
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function rpcErrorResponse(
  origin: string,
  code: string | null,
  logError: PublicRegistrationDependencies['logError'],
  includeCors = true,
) {
  if (code === 'PT429') {
    return jsonResponse(
      origin,
      { error: 'Too many registration attempts. Please wait a few minutes and try again.' },
      429,
      { 'Retry-After': '600' },
      includeCors,
    )
  }
  if (code === 'PT409') {
    return jsonResponse(origin, { error: 'This submission key was already used for different details.' }, 409, undefined, includeCors)
  }
  if (code === 'PT400' || code === '22023') {
    return jsonResponse(origin, { error: 'Please check the registration details and try again.' }, 400, undefined, includeCors)
  }
  if (code === 'PT403') {
    return jsonResponse(origin, { error: 'Registration is unavailable.' }, 403, undefined, includeCors)
  }
  logError('Public registration database request failed.', { code: code || 'unknown' })
  return jsonResponse(origin, { error: 'Registration is temporarily unavailable. Please try again later.' }, 503, undefined, includeCors)
}

async function handleRequest(
  request: Request,
  origin: string,
  dependencies: PublicRegistrationDependencies,
) {
  const configuredOrigins = allowedOrigins(dependencies.getEnv)
  const originAllowed = Boolean(origin && configuredOrigins.has(origin))

  if (request.method === 'OPTIONS') {
    if (!originAllowed) {
      return new Response('Origin not allowed.', { status: 403, headers: { 'Cache-Control': 'no-store' } })
    }
    return new Response(null, { status: 204, headers: responseHeaders(origin) })
  }

  const clientIp = getClientIp(request)
  if (!clientIp || clientIp.length > 64) {
    return jsonResponse(
      origin,
      { error: 'Registration is temporarily unavailable.' },
      503,
      undefined,
      originAllowed,
    )
  }

  const supabaseUrl = dependencies.getEnv('SUPABASE_URL')
  const serviceRoleKey = dependencies.getEnv('SUPABASE_SERVICE_ROLE_KEY')
  const fingerprintSecret = dependencies.getEnv('PUBLIC_REGISTRATION_HASH_SECRET')
  if (!supabaseUrl || !serviceRoleKey || !fingerprintSecret || fingerprintSecret.length < 32) {
    dependencies.logError('Public registration is missing server configuration.')
    return jsonResponse(
      origin,
      { error: 'Registration is temporarily unavailable.' },
      503,
      undefined,
      originAllowed,
    )
  }

  let clientFingerprint: string
  try {
    clientFingerprint = await hmacHex(fingerprintSecret, `client-ip:${clientIp}`)
  } catch {
    dependencies.logError('Public registration fingerprinting failed.')
    return jsonResponse(
      origin,
      { error: 'Registration is temporarily unavailable.' },
      503,
      undefined,
      originAllowed,
    )
  }
  if (!hashPattern.test(clientFingerprint)) {
    return jsonResponse(
      origin,
      { error: 'Registration is temporarily unavailable.' },
      503,
      undefined,
      originAllowed,
    )
  }

  const adminClient = dependencies.createClient(supabaseUrl, serviceRoleKey)
  const { error: rateLimitError } = await adminClient.rpc('consume_public_registration_attempt', {
    p_client_fingerprint: clientFingerprint,
  })
  if (rateLimitError) {
    return rpcErrorResponse(origin, rateLimitError.code || null, dependencies.logError, originAllowed)
  }

  if (!originAllowed) {
    return new Response('Origin not allowed.', { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }
  if (request.method !== 'POST') {
    return jsonResponse(origin, { error: 'Method not allowed.' }, 405, { Allow: 'POST, OPTIONS' })
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return jsonResponse(origin, { error: 'Expected a JSON request.' }, 415)
  }
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > maxBodyBytes) {
    return jsonResponse(origin, { error: 'Registration request is too large.' }, 413)
  }

  let rawBody = ''
  const reader = request.body?.getReader()
  if (reader) {
    const bodyBytes = new Uint8Array(maxBodyBytes)
    let totalBytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.byteLength > maxBodyBytes - totalBytes) {
          void reader.cancel().catch(() => {})
          return jsonResponse(origin, { error: 'Registration request is too large.' }, 413)
        }
        bodyBytes.set(value, totalBytes)
        totalBytes += value.byteLength
      }
    } catch {
      return jsonResponse(origin, { error: 'Registration request could not be read.' }, 400)
    } finally {
      reader.releaseLock()
    }
    rawBody = new TextDecoder().decode(bodyBytes.subarray(0, totalBytes))
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return jsonResponse(origin, { error: 'Registration request must contain valid JSON.' }, 400)
  }

  let registration: NormalizedRegistration
  try {
    registration = normalizeRegistration(body)
  } catch (error) {
    if (error instanceof RegistrationValidationError) {
      return jsonResponse(origin, { error: error.message }, 400)
    }
    throw error
  }

  const idempotencyKey = request.headers.get('idempotency-key') || ''
  if (!uuidPattern.test(idempotencyKey)) {
    return jsonResponse(origin, { error: 'A valid submission key is required. Please try again.' }, 400)
  }

  const canonicalPayload = JSON.stringify(registration)
  let requestHash: string
  try {
    requestHash = await hmacHex(fingerprintSecret, `payload:${canonicalPayload}`)
  } catch {
    dependencies.logError('Public registration fingerprinting failed.')
    return jsonResponse(
      origin,
      { error: 'Registration is temporarily unavailable.' },
      503,
      undefined,
      originAllowed,
    )
  }
  if (!hashPattern.test(requestHash)) {
    return jsonResponse(origin, { error: 'Registration is temporarily unavailable.' }, 503)
  }

  const dashboardBytes = new Uint8Array(32)
  crypto.getRandomValues(dashboardBytes)
  const dashboardToken = Array.from(dashboardBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  const dashboardTokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dashboardToken))
  const dashboardTokenHash = Array.from(new Uint8Array(dashboardTokenHashBuffer), (byte) => byte.toString(16).padStart(2, '0')).join('')

  const { data, error } = await adminClient.rpc('register_public_patient', {
    p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash,
    p_client_fingerprint: clientFingerprint,
    p_full_name: registration.fullName,
    p_age: registration.age,
    p_gender: registration.gender,
    p_mobile: registration.mobile,
    p_department_name: registration.department,
    p_doctor_user_id: registration.doctorUserId,
    p_dashboard_token_hash: dashboardTokenHash,
  })

  if (error) return rpcErrorResponse(origin, error.code || null, dependencies.logError)
  const result = Array.isArray(data) ? data[0] : null
  if (!result || typeof result.patient_code !== 'string' || typeof result.token !== 'string') {
    dependencies.logError('Public registration RPC returned an invalid response.')
    return jsonResponse(origin, { error: 'Registration is temporarily unavailable. Please try again later.' }, 503)
  }

  return jsonResponse(origin, { patientId: result.patient_code, token: result.token, dashboardToken }, 201)
}

export function createPublicRegistrationHandler(dependencies: PublicRegistrationDependencies) {
  return async function handlePublicRegistration(request: Request) {
    let origin = ''
    try {
      origin = request.headers.get('origin') || ''
      return await handleRequest(request, origin, dependencies)
    } catch (error) {
      dependencies.logError('Unexpected public registration request failure.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })

      let includeCors = false
      try {
        includeCors = Boolean(origin && allowedOrigins(dependencies.getEnv).has(origin))
      } catch {
        includeCors = false
      }

      return jsonResponse(
        origin,
        { error: 'Registration is temporarily unavailable. Please try again later.' },
        503,
        undefined,
        includeCors,
      )
    }
  }
}
