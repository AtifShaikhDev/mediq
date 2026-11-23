import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const publishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || import.meta.env.VITE_SUPABASE_ANON_KEY
)?.trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && publishableKey)
export const supabaseConfigError = isSupabaseConfigured
  ? ''
  : 'Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to your local .env file, then restart Vite.'

const doctorPortalClient = typeof window !== 'undefined' && (
  window.location.pathname.endsWith('/doctor')
  || new URLSearchParams(window.location.search).get('portal') === 'doctor'
)
const supabaseProjectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : 'mediq'

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      ...(doctorPortalClient ? { storageKey: `mediq-${supabaseProjectRef}-doctor-auth-token` } : {}),
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  })
  : null
