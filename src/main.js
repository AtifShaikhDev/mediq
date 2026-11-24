import './style.css'
import {
  callNextPatient,
  completeQueueRecord,
  loadPublicQueue,
  loadPublicRegistrationRetentionStatus,
  loadWorkspace,
  registerPatient as createPatientRecord,
  updateHospitalName,
  updatePatient,
  updateStaffProfile,
  inviteStaffMember,
  loadPatientMedicalRecord,
  createDoctorReport,
  finalizeDoctorReport,
  uploadPatientDocument,
  getPatientDocumentDownloadUrl,
} from './lib/api.js'
import { isSupabaseConfigured, supabase, supabaseConfigError } from './lib/supabase.js'
import { renderPublicRegistration } from './public-registration.js'
import { loadPublicPatientTracking } from './lib/api.js'

let departments = []
const iconPaths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  queue: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  staff: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 11a3 3 0 1 0 0-6M18 14a5 5 0 0 1 3 5v1"/>',
  chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-5 5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.9l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1-.1 1.8Z" transform="translate(-1 -1)"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m18 6-12 12M6 6l12 12"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
}

const icon = (name, className = '') => `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.grid}</svg>`
const pad = (value) => String(value).padStart(2, '0')
const indiaDateFormatter = new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const dateKey = (date = new Date()) => {
  const parts = Object.fromEntries(indiaDateFormatter.formatToParts(date).map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
const state = {
  patients: [],
  queues: [],
  staff: [],
  departmentRows: [],
  profile: null,
  user: null,
  hospital: '',
  loading: true,
  page: 'Dashboard',
  search: '',
  patientFilter: 'All patients',
  departmentFilter: 'All departments',
  modal: null,
  toast: null,
  mobileMenu: false,
  authError: '',
  realtimeStatus: 'connecting',
  publicRows: [],
  publicRegistrationRetention: null,
}
const app = document.querySelector('#app')
const themeStorageKey = 'mediq-theme'
function applyTheme(theme) {
  const selected = theme === 'dark' ? 'dark' : 'light'
  document.documentElement.dataset.theme = selected
  try { globalThis.localStorage.setItem(themeStorageKey, selected) } catch { /* Theme remains active for this page view. */ }
  return selected
}
let currentTheme = 'light'
try { currentTheme = globalThis.localStorage.getItem(themeStorageKey) === 'dark' ? 'dark' : 'light' } catch { currentTheme = 'light' }
applyTheme(currentTheme)

const appBase = import.meta.env.BASE_URL
const doctorPortalUrl = new URL(`${appBase}doctor`, window.location.origin)
doctorPortalUrl.searchParams.set('portal', 'doctor')
const doctorPortalHref = doctorPortalUrl.toString()
const appPath = window.location.pathname.slice(appBase.length - 1).replace(/\/$/, '') || '/'
const isPublicDisplay = appPath === '/display'
const isPublicRegistration = appPath === '/register'
const isPublicPatient = appPath === '/patient'
const isDoctorPortal = window.location.pathname.replace(/\/+$/, '').endsWith('/doctor') || appPath === '/doctor' || new URLSearchParams(window.location.search).get('portal') === 'doctor'
const isPublicRegistrationEnabled = import.meta.env.VITE_PUBLIC_REGISTRATION_ENABLED === 'true'
let workspaceChannel = null
let publicChannel = null
let lastLoadedUserId = null
let workspaceLoadPromise = null
let doctorSignInInitiated = false
let retentionStatusRequestId = 0

function todayPatients() {
  const today = dateKey()
  return state.queues.filter((queue) => queue.queueDate === today)
}

function stats() {
  const today = todayPatients()
  return {
    registered: today.length,
    waiting: today.filter((patient) => patient.status === 'Waiting').length,
    serving: today.filter((patient) => patient.status === 'Serving').length,
    completed: today.filter((patient) => patient.status === 'Completed').length,
  }
}

function averageWait(records) {
  const completedWaits = records
    .filter((record) => record.calledAt)
    .map((record) => Math.max(0, new Date(record.calledAt) - new Date(record.arrivalAt)) / 60000)
  return completedWaits.length
    ? Math.round(completedWaits.reduce((sum, minutes) => sum + minutes, 0) / completedWaits.length)
    : null
}

function sortedQueue(department) {
  return state.queues
    .filter((patient) => patient.department === department && patient.status === 'Waiting' && patient.queueDate === dateKey() && (state.profile?.role !== 'Doctor' || patient.doctorUserId === state.user.id))
    .sort((a, b) => new Date(a.arrivalAt) - new Date(b.arrivalAt))
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function validMobile(value) {
  return /^[0-9+(). -]{7,20}$/.test(value)
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function formatTime(date) {
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(date))
}

function dateLabel() {
  return new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date())
}

function navItem(label, iconName) {
  return `<button class="nav-link ${state.page === label ? 'active' : ''}" data-page="${label}">${icon(iconName)}<span>${label}</span>${label === 'Queue Management' ? `<span class="nav-count">${stats().waiting}</span>` : ''}</button>`
}

function renderShell() {
  if (isDoctorPortal && !doctorSignInInitiated) { renderSignIn(); return }
  app.innerHTML = `
    <aside class="sidebar ${state.mobileMenu ? 'mobile-open' : ''}">
      <a class="brand" href="#" data-page="Dashboard" aria-label="MediQ home">
        <span class="brand-mark">${icon('heart')}</span>
        <span class="brand-copy"><strong>Medi<span>Q</span></strong><small>CARE, IN ORDER</small></span>
      </a>
      <div class="workspace-label">WORKSPACE</div>
      <nav class="primary-nav" aria-label="Main navigation">
        ${navItem('Dashboard', 'grid')}
        ${navItem('Patients', 'users')}
        ${navItem('Queue Management', 'queue')}
        ${navItem('Staff', 'staff')}
        ${navItem('Reports', 'chart')}
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-public">
          <div class="public-icon">${icon('monitor')}</div>
          <strong>Queue display</strong>
          <p>Show live wait times on your lobby screen.</p>
          <button class="text-button" data-action="open-public-display">Open display ${icon('arrow')}</button>
        </div>
        <button class="nav-link ${state.page === 'Settings' ? 'active' : ''}" data-page="Settings">${icon('settings')}<span>Settings</span></button>
        <div class="sidebar-foot"><span class="status-dot"></span> Supabase connected <span class="sidebar-version">${escapeHtml(state.realtimeStatus || 'connecting')}</span></div>
      </div>
    </aside>
    ${state.mobileMenu ? '<button class="mobile-scrim" data-action="close-menu" aria-label="Close navigation"></button>' : ''}
    <section class="app-frame">
      <header class="topbar">
        <button class="icon-button mobile-menu-button" data-action="toggle-menu" aria-label="Toggle navigation">${icon('menu')}</button>
        <div class="breadcrumb"><span>Workspace</span>${icon('chevron')}<strong>${escapeHtml(state.page)}</strong></div>
        <div class="topbar-right">
          <span class="today-label">${dateLabel()}</span>
          <button class="button button-secondary theme-toggle" data-action="toggle-theme" type="button" aria-label="Switch color theme">${currentTheme === 'dark' ? '☀️ Light' : '🌙 Dark'}</button>
          <span class="role-chip">${escapeHtml(state.profile.role)}</span>
          <div class="topbar-divider"></div>
          <div class="user-menu"><span class="avatar avatar-blue">${initials(state.profile.full_name)}</span><div><strong>${escapeHtml(state.profile.full_name)}</strong><small>${escapeHtml(state.profile.email)}</small></div></div>
          <button class="button button-secondary sign-out-button" data-action="sign-out">Sign out</button>
        </div>
      </header>
      <main id="page-content" class="page-content"></main>
      <footer class="app-copyright">© ${new Date().getFullYear()} MediQ — All Rights Reserved.</footer>
    </section>
    <div id="modal-root"></div>
    <div id="toast-root" aria-live="polite"></div>`
  renderPage()
  renderModal()
}

function renderLoading(message = 'Loading MediQ…') {
  app.innerHTML = `<main class="auth-screen"><section class="auth-card"><span class="brand-mark">${icon('heart')}</span><h1>${escapeHtml(message)}</h1><p>Connecting to your hospital workspace.</p><div class="loading-indicator" role="status" aria-label="Loading"></div></section></main>`
}

function renderConfigurationError() {
  app.innerHTML = `<main class="auth-screen"><section class="auth-card"><span class="brand-mark">${icon('heart')}</span><p class="eyebrow">MEDIQ SETUP</p><h1>Connect your Supabase project</h1><p>${escapeHtml(supabaseConfigError)}</p><p class="auth-help">Copy <code>.env.example</code> to <code>.env</code>, add your Supabase project URL and publishable key, then restart Vite. Never use a service-role or secret key in this app.</p></section></main>`
}

function renderSignIn(error = '') {
  const doctorPortal = isDoctorPortal
  app.innerHTML = `<main class="auth-screen"><section class="auth-card auth-card-login"><a class="brand auth-brand" href="${appBase}"><span class="brand-mark">${icon('heart')}</span><span class="brand-copy"><strong>Medi<span>Q</span></strong><small>CARE, IN ORDER</small></span></a><p class="eyebrow">${doctorPortal ? 'DOCTOR PORTAL' : 'STAFF WORKSPACE'}</p><h1>${doctorPortal ? 'Doctor sign in' : 'Welcome back'}</h1><p>${doctorPortal ? 'Sign in with your doctor account to open your assigned dashboard.' : 'Sign in with your hospital staff account.'}</p>${error ? `<div class="auth-error" role="alert">${escapeHtml(error)}</div>` : ''}<form id="sign-in-form" class="auth-form"><label class="form-field"><span>Work email</span><input type="email" name="email" autocomplete="username" required placeholder="you@hospital.com"></label><label class="form-field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required minlength="8" placeholder="Enter your password"></label><button class="button button-primary auth-submit" type="submit">Sign in</button></form><p class="auth-help">Staff accounts are provisioned by your MediQ administrator. Contact your administrator if you need access.</p></section></main>`
}

function renderProfileMissing() {
  app.innerHTML = `<main class="auth-screen"><section class="auth-card"><span class="brand-mark">${icon('heart')}</span><p class="eyebrow">STAFF SETUP</p><h1>Staff profile not found</h1><p>Your account is authenticated, but it does not have an active MediQ staff profile. Ask an administrator to provision your profile before signing in.</p><button class="button button-secondary auth-submit" data-action="sign-out">Sign out</button></section></main>`
}

function renderConnectionError(error) {
  app.innerHTML = `<main class="auth-screen"><section class="auth-card"><span class="brand-mark">${icon('heart')}</span><p class="eyebrow">CONNECTION ISSUE</p><h1>Couldn’t load your workspace</h1><p>${escapeHtml(error.message || 'An unexpected connection error occurred.')}</p><div class="auth-actions"><button class="button button-primary" data-action="retry-workspace">Try again</button><button class="button button-secondary" data-action="sign-out">Sign out</button></div></section></main>`
}

async function loadSignedInWorkspace(user, force = false) {
  if (isDoctorPortal && !doctorSignInInitiated) { renderSignIn(); return }
  if (!force && state.profile && state.user?.id === user.id) return
  if (workspaceLoadPromise && state.user?.id === user.id) return workspaceLoadPromise
  state.loading = true
  state.user = user
  renderLoading()
  workspaceLoadPromise = loadWorkspace(supabase, user)
    .then((workspace) => {
      if (!workspace.profile) {
        state.profile = null
        lastLoadedUserId = null
        stopWorkspaceRealtime()
        renderProfileMissing()
        return
      }

      // Keep the Doctor portal and the hospital staff portal isolated by role.
      // Supabase Auth sessions are shared across tabs on the same origin, so
      // the active account must be checked on every portal load.
      const signedInRole = workspace.profile.role
      const wrongPortalRole = isDoctorPortal
        ? signedInRole !== 'Doctor'
        : signedInRole === 'Doctor'
      if (wrongPortalRole) {
        state.loading = false
        state.profile = null
        state.authError = isDoctorPortal
          ? 'This account is not a Doctor account. Please sign in with your doctor credentials.'
          : 'This is a Doctor account. Please open the Doctor Portal using the Doctor QR code.'
        lastLoadedUserId = null
        stopWorkspaceRealtime()
        renderSignIn(state.authError)
        return
      }

      state.profile = workspace.profile
      state.patients = workspace.patients
      state.queues = workspace.queues
      state.staff = workspace.staff
      state.departmentRows = workspace.departments
      state.hospital = workspace.hospital
      departments = workspace.departments.map((department) => department.name)
      state.loading = false
      state.authError = ''
      lastLoadedUserId = user.id
      renderShell()
      subscribeWorkspaceRealtime()
    })
    .catch((error) => {
      state.loading = false
      renderConnectionError(error)
    })
    .finally(() => { workspaceLoadPromise = null })
  return workspaceLoadPromise
}

function stopWorkspaceRealtime() {
  if (workspaceChannel && supabase) supabase.removeChannel(workspaceChannel)
  workspaceChannel = null
}

function subscribeWorkspaceRealtime() {
  if (!supabase || workspaceChannel) return
  let refreshTimer
  workspaceChannel = supabase.channel('mediq-staff-workspace')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_records' }, () => {
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => loadSignedInWorkspace(state.user, true), 150)
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, () => {
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => loadSignedInWorkspace(state.user, true), 150)
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_profiles' }, () => {
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => loadSignedInWorkspace(state.user, true), 150)
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'hospital_settings' }, () => {
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => loadSignedInWorkspace(state.user, true), 150)
    })
    .subscribe((status) => {
      state.realtimeStatus = status === 'SUBSCRIBED' ? 'live' : status.toLowerCase()
      const version = document.querySelector('.sidebar-version')
      if (version) version.textContent = state.realtimeStatus
      if (status === 'SUBSCRIBED' && state.user) {
        window.clearTimeout(refreshTimer)
        refreshTimer = window.setTimeout(() => loadSignedInWorkspace(state.user, true), 100)
      }
    })
}

async function renderPatientDashboard() {
  document.body.classList.add('public-registration-page')
  const accessToken = new URLSearchParams(window.location.search).get('access') || ''
  app.innerHTML = `<main class="public-route"><section class="auth-card"><h1>Patient Dashboard</h1><p>Loading your queue…</p><div class="loading-indicator"></div></section></main>`
  if (!accessToken) {
    const renderPatientAccount = async (message = '') => {
      const { data: sessionData } = await supabase.auth.getSession()
      const session = sessionData.session
      if (!session) {
        app.innerHTML = `<main class="public-route"><section class="auth-card"><span class="brand-mark">${icon('heart')}</span><p class="eyebrow">MEDIQ PATIENT PORTAL</p><h1>Patient account</h1><p>Sign in with your hospital-provided account or create an account to access linked medical reports.</p>${message ? '<p class="form-guidance" role="status">' + escapeHtml(message) + '</p>' : ''}<form id="patient-account-login" class="modal-form"><label class="form-field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label><label class="form-field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label><button class="button button-primary" type="submit">Sign in</button></form><div class="patient-account-divider">New to MediQ?</div><form id="patient-account-signup" class="modal-form"><label class="form-field"><span>Full name</span><input name="fullName" required maxlength="120"></label><label class="form-field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label><label class="form-field"><span>Create password</span><input name="password" type="password" minlength="8" autocomplete="new-password" required></label><button class="button button-secondary" type="submit">Create patient account</button></form><p class="caption">Creating an account does not automatically link an existing hospital record. Ask hospital reception to verify and link your patient profile.</p><a href="${appBase}patient?register=1">Register a visit without an account</a></section></main>`
        return
      }
      const { data: link, error: linkError } = await supabase.from('patient_accounts').select('patient_id').eq('user_id', session.user.id).maybeSingle()
      if (linkError) throw linkError
      if (!link?.patient_id) {
        app.innerHTML = `<main class="public-route"><section class="auth-card"><h1>Account awaiting hospital link</h1><p>Your account is signed in, but it has not yet been linked to a verified MediQ patient record. Please contact hospital reception.</p><button class="button button-secondary" data-action="patient-signout" type="button">Sign out</button></section></main>`
        return
      }
      const [patientResult, reportsResult, visitsResult] = await Promise.all([
        supabase.from('patients').select('id,patient_code,full_name,age,gender').eq('id', link.patient_id).single(),
        supabase.from('doctor_reports').select('id,report_title,diagnosis,examination,treatment_plan,follow_up_instructions,follow_up_date,finalized_at,created_at').eq('patient_id', link.patient_id).eq('status', 'finalized').order('finalized_at', { ascending: false }),
        supabase.from('visits').select('id,status,arrived_at,department:departments(name)').eq('patient_id', link.patient_id).order('arrived_at', { ascending: false }).limit(20),
      ])
      if (patientResult.error) throw patientResult.error
      if (reportsResult.error) throw reportsResult.error
      if (visitsResult.error) throw visitsResult.error
      const patient = patientResult.data
      const reports = reportsResult.data || []
      const visits = visitsResult.data || []
      app.innerHTML = `<main class="public-route"><section class="auth-card patient-account-dashboard"><div class="modal-heading"><div><p class="eyebrow">PRIVATE PATIENT PORTAL</p><h1>Welcome, ${escapeHtml(patient.full_name)}</h1><p>${escapeHtml(patient.patient_code || '')}</p></div><button class="button button-secondary" data-action="patient-signout" type="button">Sign out</button></div><h2>My details</h2><p>Age: ${patient.age} · ${escapeHtml(patient.gender)}</p><h2>My visit history</h2>${visits.map(v => '<article class="medical-record-item"><strong>' + escapeHtml(v.department?.name || 'Hospital visit') + '</strong><p>' + escapeHtml(v.status) + ' · ' + escapeHtml(new Date(v.arrived_at).toLocaleDateString()) + '</p></article>').join('') || '<p>No visit history available.</p>'}<h2>Finalized doctor reports</h2>${reports.map(r => '<article class="medical-record-item"><strong>' + escapeHtml(r.report_title) + '</strong><p><b>Diagnosis:</b> ' + escapeHtml(r.diagnosis || 'Not recorded') + '</p><p><b>Examination:</b> ' + escapeHtml(r.examination || 'Not recorded') + '</p><p><b>Treatment plan:</b> ' + escapeHtml(r.treatment_plan || 'Not recorded') + '</p><p><b>Instructions:</b> ' + escapeHtml(r.follow_up_instructions || 'Not recorded') + '</p><small>Finalized ' + escapeHtml(new Date(r.finalized_at).toLocaleDateString()) + '</small><button class="button button-secondary button-small" data-action="download-report-pdf" data-id="' + escapeHtml(r.id) + '">Print / Save PDF</button></article>').join('') || '<p>No finalized reports are available yet.</p>'}</section></main>`
    }
    if (new URLSearchParams(window.location.search).get('register') === '1') {
      renderPublicRegistration(app, icon, supabase, isPublicRegistrationEnabled)
      return
    }
    try { await renderPatientAccount() } catch (error) {
      app.innerHTML = '<main class="public-route"><section class="auth-card"><h1>Patient portal unavailable</h1><p>' + escapeHtml(error.message) + '</p><button class="button button-secondary" onclick="location.reload()">Try again</button></section></main>'
    }
    return
  }
  if (!/^[0-9a-f]{64}$/.test(accessToken)) {
    app.innerHTML = `<main class="public-route"><section class="auth-card"><h1>Tracking link unavailable</h1><p>This private dashboard link is invalid. Please scan the hospital’s Patient Dashboard QR code to register again.</p><a class="button button-primary" href="${appBase}patient">Open Patient Dashboard</a></section></main>`
    return
  }
  const render = async () => {
    const row = await loadPublicPatientTracking(supabase, accessToken)
    app.innerHTML = `<main class="public-route patient-dashboard-route"><div class="public-registration-shell patient-dashboard-shell"><header class="public-registration-header patient-dashboard-header"><a class="brand public-registration-brand" href="${appBase}display"><span class="brand-mark">${icon('heart')}</span><span class="brand-copy"><strong>Medi<span>Q</span></strong><small>CARE, IN ORDER</small></span></a><span class="registration-route-label">PATIENT PORTAL <span class="patient-live-indicator"><i></i> LIVE QUEUE</span></span></header><section class="public-registration-card patient-dashboard-card"><div class="patient-dashboard-heading"><div><p class="eyebrow">YOUR VISIT AT A GLANCE</p><h1>Queue tracker</h1><p class="patient-dashboard-subtitle">Stay updated while the hospital team moves through the queue.</p></div><span class="patient-status-pill ${escapeHtml(String(row.appointment_status).toLowerCase())}"><i></i>${escapeHtml(row.appointment_status)}</span></div><div class="patient-token-panel"><div><span class="patient-token-label">YOUR QUEUE TOKEN</span><strong class="patient-token-value">${escapeHtml(row.patient_token)}</strong><span class="patient-token-caption">${escapeHtml(row.department_name)} <b>•</b> ${escapeHtml(row.queue_date)}</span></div><div class="patient-token-mark">${icon('queue')}</div></div><div class="patient-queue-metrics"><article class="patient-queue-metric"><span class="patient-metric-icon">${icon('monitor')}</span><span class="patient-metric-label">Now serving</span><strong>${escapeHtml(row.now_serving_token || '—')}</strong><small>Current token</small></article><article class="patient-queue-metric"><span class="patient-metric-icon">${icon('users')}</span><span class="patient-metric-label">Ahead of you</span><strong>${Number(row.patients_ahead || 0)}</strong><small>Patients waiting</small></article></div><div class="patient-visit-details"><div class="patient-section-heading"><h2>Visit details</h2><span>Appointment information</span></div><div class="patient-detail-row"><span>Department</span><strong>${escapeHtml(row.department_name)}</strong></div><div class="patient-detail-row"><span>Assigned doctor</span><strong>${escapeHtml(row.doctor_name)}</strong></div><div class="patient-detail-row"><span>Queue date</span><strong>${escapeHtml(row.queue_date)}</strong></div></div><div class="patient-live-note"><span>${icon('clock')}</span><p><strong>Page updates automatically</strong><small>Queue status refreshes every few seconds. Keep this private link secure.</small></p><span class="patient-refresh-dot" aria-label="Automatic updates enabled"></span></div></section><footer class="public-registration-footer patient-dashboard-footer">MediQ <span>•</span> Care, in order <span>•</span> © ${new Date().getFullYear()}</footer></div></main>`
  }
  try {
    await render()
    if (publicChannel) supabase.removeChannel(publicChannel)
    publicChannel = supabase.channel('mediq-patient-tracking')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_records' }, () => render().catch(() => {}))
      .subscribe()
    window.setInterval(() => render().catch(() => {}), 15000)
  } catch {
    app.innerHTML = `<main class="public-route"><section class="auth-card"><h1>Tracking link unavailable</h1><p>This private link may be invalid. Contact hospital reception for help.</p></section></main>`
  }
}

async function renderPublicDisplay() {
  if (!isSupabaseConfigured) {
    renderConfigurationError()
    return
  }
  app.innerHTML = `<main class="public-route"><section class="auth-card"><span class="brand-mark">${icon('heart')}</span><h1>Loading public queue</h1><p>Connecting to the hospital queue display.</p><div class="loading-indicator" role="status" aria-label="Loading"></div></section></main>`
  try {
    state.publicRows = await loadPublicQueue(supabase)
    renderPublicDisplayRows()
    if (publicChannel) supabase.removeChannel(publicChannel)
    publicChannel = supabase.channel('mediq-public-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'public_queue_display' }, async () => {
        try {
          state.publicRows = await loadPublicQueue(supabase)
          renderPublicDisplayRows()
        } catch (error) {
          app.innerHTML = `<main class="public-route"><section class="auth-card" role="alert"><h1>Public queue unavailable</h1><p>${escapeHtml(error.message)}</p></section></main>`
        }
      })
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return
        try {
          state.publicRows = await loadPublicQueue(supabase)
          renderPublicDisplayRows()
        } catch (error) {
          app.innerHTML = `<main class="public-route"><section class="auth-card" role="alert"><h1>Public queue unavailable</h1><p>${escapeHtml(error.message)}</p></section></main>`
        }
      })
  } catch (error) {
    app.innerHTML = `<main class="public-route"><section class="auth-card" role="alert"><h1>Public queue unavailable</h1><p>${escapeHtml(error.message)}</p><button class="button button-primary" data-action="retry-public">Try again</button></section></main>`
  }
}

function renderPublicDisplayRows() {
  const rows = state.publicRows
  const hospital = rows[0]?.hospital_name || 'Hospital queue'
  app.innerHTML = `<main class="public-route"><div class="public-display-preview"><div class="display-top"><div class="display-brand"><span class="brand-mark">${icon('heart')}</span><div><strong>${escapeHtml(hospital)}</strong><small>PATIENT QUEUE</small></div></div><span class="display-live"><i></i> LIVE QUEUE</span></div><div class="display-welcome"><p>WELCOME</p><h2>Your care is our priority.</h2><span>Please listen for your token number.</span></div><div class="public-queue-grid">${rows.map((row) => `<article class="public-department"><span>${escapeHtml(row.department_name.toUpperCase())}</span><div class="public-called-label"><i></i> NOW SERVING</div><strong class="called-token">${escapeHtml(row.now_serving_token || '—')}</strong><small>${row.now_serving_token ? 'Please proceed to your care team' : 'Please wait for your turn'}</small><div class="public-next"><span>UP NEXT</span><strong>${escapeHtml(row.next_token || '—')}</strong></div></article>`).join('')}</div><div class="display-footer"><span>${icon('heart')} Thank you for choosing ${escapeHtml(hospital)}</span><span>${new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date())} · Updates automatically</span></div><div class="app-copyright">© ${new Date().getFullYear()} MediQ — All Rights Reserved.</div></div></main>`
}

function pageHeading(title, description, actions = '') {
  return `<div class="page-heading"><div><p class="eyebrow">${state.page === 'Dashboard' ? 'OVERVIEW' : 'WORKSPACE'}</p><h1>${title}</h1><p class="page-description">${description}</p></div><div class="heading-actions">${actions}</div></div>`
}

function metricCard(title, value, note, iconName, tone, change) {
  return `<article class="metric-card"><div class="metric-top"><span class="metric-label">${title}</span><span class="metric-icon ${tone}">${icon(iconName)}</span></div><div class="metric-value">${value}</div><div class="metric-foot"><span class="metric-change">${change}</span><span>${note}</span></div></article>`
}

function departmentCard(department, code, iconName, tone) {
  const queue = sortedQueue(department)
  const serving = state.queues.find((patient) => patient.department === department && patient.status === 'Serving' && patient.queueDate === dateKey() && (state.profile.role !== 'Doctor' || patient.doctorUserId === state.user.id))
  const total = todayPatients().filter((patient) => patient.department === department).length
  const average = averageWait(todayPatients().filter((patient) => patient.department === department))
  return `<article class="department-card">
    <div class="department-top"><span class="department-icon ${tone}">${icon(iconName)}</span><span class="live-pill"><i></i> Live</span></div>
    <h3>${department}</h3><div class="department-total">${total} <span>patients today</span></div>
    <div class="department-divider"></div>
    <div class="department-meta"><span>Now serving</span><strong>${serving ? escapeHtml(serving.token) : '—'}</strong></div>
    <div class="department-meta"><span>Waiting</span><strong>${queue.length} <small>patients</small></strong></div>
    <div class="department-meta"><span>Avg. wait today</span><strong>${average === null ? '—' : `${average} <small>min</small>`}</strong></div>
  </article>`
}

function patientRows(patients, compact = false) {
  if (!patients.length) return `<tr><td class="empty-cell" colspan="5">No patients found. Try adjusting your search or filters.</td></tr>`
  return patients.map((patient) => `<tr>
    <td><button class="patient-name" data-action="view-medical-record" data-id="${escapeHtml(patient.id)}"><span class="avatar avatar-soft">${initials(patient.name)}</span><span><strong>${escapeHtml(patient.name)}</strong><small>${escapeHtml(patient.id)}</small></span></button></td>
    ${compact ? '' : `<td>${escapeHtml(patient.department)}</td>`}
    <td><span class="token">${escapeHtml(patient.token || '—')}</span></td>
        <td>${patient.status ? `<span class="status-badge ${patient.status.toLowerCase()}"><i></i>${escapeHtml(patient.status)}</span>` : '—'}</td>
    <td class="muted-cell">${formatTime(patient.createdAt)}</td>
  </tr>`).join('')
}

function dashboardPage() {
  if (state.profile.role === 'Doctor') return doctorDashboardPage()
  const metric = stats()
  const recent = [...todayPatients()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5)
  const canRegister = ['Admin', 'Receptionist'].includes(state.profile.role)
  return `${pageHeading(`Good ${greeting()}, ${escapeHtml(state.profile.full_name.split(' ')[0])} <span class="wave">✦</span>`, 'Here’s what’s happening at your hospital today.', `<button class="button button-secondary" data-page="Reports">${icon('chart')} View reports</button>${canRegister ? `<button class="button button-primary" data-action="open-register">${icon('plus')} Register patient</button>` : ''}`)}
    <div class="metric-grid">
      ${metricCard('Registered today', metric.registered, 'visits created today', 'users', 'blue', '<span class="up-arrow">●</span> Today')}
      ${metricCard('Currently waiting', metric.waiting, 'across all departments', 'clock', 'amber', '<span class="metric-neutral">●</span> Live')}
      ${metricCard('Being served', metric.serving, 'across all departments', 'heart', 'teal', '<span class="live-dot"></span> Live')}
      ${metricCard('Completed visits', metric.completed, 'today so far', 'check', 'green', '<span class="up-arrow">●</span> Today')}
    </div>
    ${state.profile.role === 'Admin' ? `<section class="section-block qr-share-section">
      <div class="section-heading"><div><h2>Quick access QR codes</h2><p>Admin-managed QR codes for the Patient Dashboard and secure doctor sign-in.</p></div></div>
      <div class="dashboard-qr-grid">
        <div class="qr-share-card"><div id="registration-qr" class="qr-code" role="img" aria-label="QR code for the Patient Dashboard"></div><div><strong>Patient Dashboard</strong><p>Patients scan this code to open their dashboard, complete registration, and then track their own live queue. Display it at reception or in the waiting area.</p><a class="text-button" href="${import.meta.env.BASE_URL}patient" target="_blank" rel="noopener">Open Patient Dashboard ${icon('arrow')}</a></div></div>
        <div class="qr-share-card doctor-login-qr-card"><div id="doctor-login-qr" class="qr-code" role="img" aria-label="QR code for doctor dashboard login"></div><div><strong>Doctor dashboard login</strong><p>Doctors scan this code to open the secure Doctor Portal, then sign in with their own work email and password. The QR code does not contain credentials.</p><a class="text-button" href="${doctorPortalHref}" target="_blank" rel="noopener">Open doctor login page ${icon('arrow')}</a></div></div>
      </div>
    </section>` : ''}
    <section class="section-block">
      <div class="section-heading"><div><h2>Department overview</h2><p>Live queue status across your departments</p></div><button class="link-button" data-page="Queue Management">Manage queues ${icon('chevron')}</button></div>
      <div class="department-grid">
        ${departments.map((department, index) => departmentCard(department, state.departmentRows.find((item) => item.name === department)?.code || '', index === 1 ? 'plus' : 'heart', ['blue', 'rose', 'violet'][index % 3])).join('')}
      </div>
    </section>
    <section class="section-block">
      <div class="section-heading"><div><h2>Recent registrations</h2><p>Your latest patient check-ins</p></div><button class="link-button" data-page="Patients">View all patients ${icon('chevron')}</button></div>
      <div class="table-card"><div class="table-wrap"><table><thead><tr><th>PATIENT</th><th>DEPARTMENT</th><th>TOKEN</th><th>STATUS</th><th>ARRIVAL</th></tr></thead><tbody>${patientRows(recent)}</tbody></table></div></div>
    </section>

    <div class="dashboard-bottom">
            <button class="public-shortcut" data-action="open-public-display">${icon('monitor')}<span><strong>Public queue display</strong><small>Token-only screen · opens without staff sign-in</small></span>${icon('chevron')}</button>
    </div>`
}

function doctorDashboardPage() {
  const mine = todayPatients().filter((item) => item.doctorUserId === state.user.id)
  const waiting = mine.filter((item) => item.status === 'Waiting')
  const serving = mine.find((item) => item.status === 'Serving')
  const completed = mine.filter((item) => item.status === 'Completed')
  const ordered = [...waiting].sort((a, b) => new Date(a.arrivalAt) - new Date(b.arrivalAt))
  return `${pageHeading('Doctor dashboard', 'Your assigned appointments and live queue status.', '')}
    <div class="metric-grid">
      ${metricCard('Assigned today', mine.length, 'your appointments', 'users', 'blue', 'Today')}
      ${metricCard('Patients waiting', waiting.length, 'in your queue', 'clock', 'amber', 'Live')}
      ${metricCard('Currently serving', serving ? serving.token : '—', 'your active patient', 'heart', 'teal', 'Live')}
      ${metricCard('Completed', completed.length, 'visits today', 'check', 'green', 'Today')}
    </div>
    <section class="section-block">
      <div class="section-heading"><div><h2>Your appointment queue</h2><p>Only patients registered with you are shown here.</p></div><button class="link-button" data-page="Queue Management">Open queue management ${icon('chevron')}</button></div>
      <div class="table-card"><div class="table-wrap"><table><thead><tr><th>POSITION</th><th>PATIENT</th><th>TOKEN</th><th>STATUS</th><th>ARRIVAL</th></tr></thead><tbody>
      ${ordered.map((patient,index) => `<tr><td>${index+1}</td><td><strong>${escapeHtml(patient.name)}</strong><small>${escapeHtml(patient.id)}</small></td><td><strong>${escapeHtml(patient.token)}</strong></td><td><span class="status-badge waiting">Waiting</span></td><td>${formatTime(patient.arrivalAt)}</td></tr>`).join('')}
      ${serving ? `<tr><td>—</td><td><strong>Currently serving</strong></td><td><strong>${escapeHtml(serving.token)}</strong></td><td><span class="status-badge serving">Serving</span></td><td>${formatTime(serving.arrivalAt)}</td></tr>` : ''}
      ${!ordered.length && !serving ? '<tr><td colspan="6">No appointments assigned for today.</td></tr>' : ''}
      </tbody></table></div></div>
    </section>`
}

function greeting() {
  const hour = new Date().getHours()
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
}

function patientsPage() {
  const canRegister = ['Admin', 'Receptionist'].includes(state.profile.role)
  const normalized = state.search.toLowerCase().trim()
  const filtered = state.patients.filter((patient) => {
    const matchesText = !normalized || [patient.name, patient.id, patient.mobile, patient.token].some((value) => String(value || '').toLowerCase().includes(normalized))
    const matchesStatus = state.patientFilter === 'All patients' || patient.status === state.patientFilter
    const matchesDepartment = state.departmentFilter === 'All departments' || patient.department === state.departmentFilter
    return matchesText && matchesStatus && matchesDepartment
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  return `${pageHeading('Patients', 'Manage patient records and registrations.', `${canRegister ? `<button class="button button-primary" data-action="open-register">${icon('plus')} Register patient</button>` : ''}`)}
    <div class="patient-summary-strip"><div><span class="summary-icon blue">${icon('users')}</span><span><strong>${state.patients.length}</strong><small>Total patient records</small></span></div><div><span class="summary-icon amber">${icon('clock')}</span><span><strong>${stats().waiting}</strong><small>Waiting today</small></span></div><div><span class="summary-icon teal">${icon('check')}</span><span><strong>${stats().completed}</strong><small>Visits completed</small></span></div></div>
    <section class="table-card patients-table-card"><div class="table-toolbar"><div><h2>Patient directory</h2><p>${filtered.length} patient${filtered.length === 1 ? '' : 's'} found</p></div><div class="table-filters"><label class="search-field">${icon('search')}<input id="patient-search" type="search" placeholder="Search patients..." value="${escapeHtml(state.search)}" aria-label="Search patients"></label><select id="patient-status-filter" aria-label="Filter by status"><option>All patients</option>${['Waiting', 'Serving', 'Completed'].map((status) => `<option ${state.patientFilter === status ? 'selected' : ''}>${status}</option>`).join('')}</select><select id="department-filter" aria-label="Filter by department"><option>All departments</option>${departments.map((department) => `<option ${state.departmentFilter === department ? 'selected' : ''}>${department}</option>`).join('')}</select></div></div>
      <div class="table-wrap"><table><thead><tr><th>PATIENT</th><th>DEPARTMENT</th><th>TOKEN</th><th>STATUS</th><th>ARRIVAL</th></tr></thead><tbody>${patientRows(filtered)}</tbody></table></div>
      <div class="table-footer"><span>Showing <strong>${filtered.length ? 1 : 0}–${filtered.length}</strong> of <strong>${state.patients.length}</strong> patient records</span><span>Access is governed by your staff permissions</span></div>
    </section>`
}

function queuePage() {
  const canComplete = ['Admin', 'Doctor', 'Nurse'].includes(state.profile.role)
  const canRegister = ['Admin', 'Receptionist'].includes(state.profile.role)
  return `${pageHeading('Queue management', 'Coordinate patient flow across every department.', `<button class="button button-secondary" data-action="open-public-display">${icon('monitor')} Public display</button>${canRegister ? `<button class="button button-primary" data-action="open-register">${icon('plus')} Add to queue</button>` : ''}`)}
    <div class="queue-departments">${departments.map((department, index) => {
      const queue = sortedQueue(department)
      const serving = state.queues.find((patient) => patient.department === department && patient.status === 'Serving' && patient.queueDate === dateKey() && (state.profile.role !== 'Doctor' || patient.doctorUserId === state.user.id))
      const code = state.departmentRows.find((item) => item.name === department)?.code || ''
      return `<section class="queue-card"><div class="queue-card-heading"><div><span class="department-chip ${['blue', 'rose', 'violet'][index]}">${code}</span><div><h2>${department}</h2><p>${queue.length} waiting · ${serving ? '1 being served' : 'No patient serving'}</p></div></div><button class="button button-primary button-small" data-action="call-next" data-department="${department}" ${!queue.length ? 'disabled' : ''}>Call next ${icon('arrow')}</button></div>
        ${serving ? `<div class="serving-banner"><span class="live-dot"></span><span>NOW SERVING</span><strong>${escapeHtml(serving.token)}</strong><em>Patient checked in at ${formatTime(serving.arrivalAt)}</em>${canComplete ? `<button class="button button-small button-done" data-action="complete-patient" data-id="${serving.queueId}">${icon('check')} Complete</button>` : ''}</div>` : ''}
        ${queue.length ? `<div class="queue-list">${queue.map((patient, indexInQueue) => `<div class="queue-row"><span class="queue-position">${pad(indexInQueue + 1)}</span><span class="token queue-token">${escapeHtml(patient.token)}</span><div class="queue-patient"><strong>${escapeHtml(patient.name)}</strong><small>${escapeHtml(patient.id)} · Arrived ${formatTime(patient.arrivalAt)}</small></div><button class="icon-button row-action" data-action="start-serving" data-id="${patient.queueId}" aria-label="Call next patient in this department">${icon('arrow')}</button></div>`).join('')}</div>` : `<div class="queue-empty"><span>${icon('check')}</span><strong>All caught up</strong><small>No patients are waiting in this queue.</small></div>`}
        <div class="queue-footnote">Last token issued today: <strong>${state.queues.filter((patient) => patient.department === department && patient.queueDate === dateKey() && (state.profile.role !== 'Doctor' || patient.doctorUserId === state.user.id)).map((patient) => patient.token).sort().slice(-1)[0] || '—'}</strong></div>
      </section>`
    }).join('')}</div>
`
}

function staffPage() {
  const canManage = state.profile.role === 'Admin'
  return `${pageHeading('Staff directory', 'Manage staff profiles and application roles.', `<button class="button button-primary" data-action="invite-staff" ${canManage ? '' : 'disabled title="Only admins can manage staff profiles"'}>${icon('plus')} Add staff member</button>`)}
    <div class="staff-summary"><div class="staff-summary-card"><span class="summary-icon blue">${icon('staff')}</span><span><strong>${state.staff.length}</strong><small>Team members</small></span></div>${['Doctor', 'Nurse', 'Receptionist', 'Admin'].map((role) => `<div class="staff-role-count"><span>${role}</span><strong>${state.staff.filter((person) => person.role === role).length.toString().padStart(2, '0')}</strong></div>`).join('')}</div>
    <div class="staff-section-heading"><div><h2>Team members</h2><p>Roles are enforced by database policies, not only by this interface.</p></div><span class="access-note">${icon('settings')} Authenticated staff</span></div>
    <div class="staff-grid">${state.staff.map((person) => `<article class="staff-card"><div class="staff-card-top"><span class="avatar avatar-${person.color}">${escapeHtml(person.initials)}</span><span class="staff-status"><i class="${person.active ? '' : 'inactive'}"></i> ${person.active ? 'Active' : 'Inactive'}</span></div><h3>${escapeHtml(person.name)}</h3><span class="role-badge ${person.role.toLowerCase()}">${escapeHtml(person.role)}</span><p>${escapeHtml(person.department)}</p><a href="mailto:${escapeHtml(person.email)}">${escapeHtml(person.email)}</a>${canManage ? `<button class="staff-edit" data-action="edit-staff" data-id="${escapeHtml(person.id)}">Edit profile ${icon('chevron')}</button>` : ''}</article>`).join('')}</div>
    <div class="demo-disclaimer">${icon('heart')} <p><strong>Staff provisioning</strong> Create/invite the Auth user in Supabase first, then add a staff profile using the documented admin setup SQL. Browser-based account creation is intentionally not exposed.</p></div>`
}

function reportsPage() {
  const current = stats()
  const countByDepartment = departments.map((department) => ({
    name: department,
    count: todayPatients().filter((patient) => patient.department === department).length,
    color: state.departmentRows.find((row) => row.name === department)?.code === 'GM' ? 'blue' : state.departmentRows.find((row) => row.name === department)?.code === 'ER' ? 'rose' : 'violet',
  }))
  const max = Math.max(1, ...countByDepartment.map((item) => item.count))
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setUTCDate(date.getUTCDate() - (6 - index))
    return date
  })
  const weekly = weekDays.map((date) => state.queues.filter((queue) => queue.queueDate === dateKey(date)).length)
  const maxWeekly = Math.max(1, ...weekly)
  const avgWait = averageWait(todayPatients())
  return `${pageHeading('Reports & insights', 'A clear picture of today’s patient flow.', `<button class="button button-secondary" data-action="export-report">${icon('download')} Export CSV</button>`)}
    <div class="report-kpis">${metricCard('Daily registrations', current.registered, 'visits created today', 'users', 'blue', '<span class="up-arrow">●</span> Today')}${metricCard('Waiting patients', current.waiting, 'across all departments', 'clock', 'amber', '<span class="metric-neutral">●</span> Live')}${metricCard('Completed visits', current.completed, 'completed today', 'check', 'green', '<span class="up-arrow">●</span> Today')}${metricCard('Avg. wait time', avgWait === null ? '—' : `${avgWait}<span class="unit"> min</span>`, 'arrival to patient call', 'chart', 'teal', '<span class="metric-neutral">●</span> Today')}</div>
    <div class="report-chart-grid"><section class="chart-card"><div class="chart-heading"><div><h2>Patient registrations</h2><p>Daily check-ins over the past week</p></div><span class="chart-period">Last 7 days</span></div><div class="bar-chart">${weekly.map((value, index) => `<div class="bar-column"><span class="bar-value">${value}</span><div class="bar-track"><i style="height:${Math.max(value ? 14 : 0, value / maxWeekly * 100)}%" class="${index === 6 ? 'today-bar' : ''}"></i></div><small>${new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(weekDays[index])}</small></div>`).join('')}</div><div class="chart-caption"><span><i></i> Patient registrations</span><strong>${current.registered} today</strong></div></section>
    <section class="chart-card department-report"><div class="chart-heading"><div><h2>Department breakdown</h2><p>Registrations by department today</p></div><span class="report-date">Today</span></div><div class="department-bars">${countByDepartment.map((item) => `<div class="department-bar-row"><div><span>${item.name}</span><strong>${item.count}</strong></div><div class="horizontal-track"><i class="${item.color}" style="width:${Math.max(item.count ? 8 : 0, item.count / max * 100)}%"></i></div></div>`).join('')}</div><div class="department-total-report"><span>Total registrations</span><strong>${current.registered}</strong></div></section></div>
    <div class="report-footnote">${icon('heart')} Reports are calculated from authorized Supabase records (daily token dates use UTC).</div>`
}

function publicQueuePage() {
  return `${pageHeading('Public queue display', 'A privacy-first view for your waiting room.', `<button class="button button-secondary" data-action="fullscreen">${icon('monitor')} Full screen</button>`)}
    <div class="public-display-preview"><div class="display-top"><div class="display-brand"><span class="brand-mark">${icon('heart')}</span><div><strong>${escapeHtml(state.hospital)}</strong><small>PATIENT QUEUE</small></div></div><span class="display-live"><i></i> LIVE QUEUE</span></div>
    <div class="display-welcome"><p>WELCOME</p><h2>Your care is our priority.</h2><span>Please listen for your token number.</span></div>
    <div class="public-queue-grid">${departments.map((department, index) => {
      const serving = state.queues.find((patient) => patient.department === department && patient.status === 'Serving' && patient.queueDate === dateKey())
      const next = sortedQueue(department)[0]
      return `<article class="public-department"><span>${escapeHtml(department.toUpperCase())}</span><div class="public-called-label"><i></i> NOW SERVING</div><strong class="called-token">${serving ? escapeHtml(serving.token) : '—'}</strong><small>${serving ? 'Please proceed to your care team' : 'Please wait for your turn'}</small><div class="public-next"><span>UP NEXT</span><strong>${next ? escapeHtml(next.token) : '—'}</strong></div></article>`
    }).join('')}</div>
    <div class="display-footer"><span>${icon('heart')} Thank you for choosing MediQ City Hospital</span><span>${new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date())} · Updates automatically</span></div></div>
    <div class="privacy-note">${icon('check')} <span><strong>Privacy protected.</strong> Only queue tokens and department names appear on this display. Patient names and contact details are never shown.</span></div>`
}

function settingsPage() {
  const isAdmin = state.profile.role === 'Admin'
  const retention = state.publicRegistrationRetention
  return `${pageHeading('Settings', 'Configure your hospital workspace.', '')}
    <div class="settings-grid">${isAdmin ? `<section class="settings-card retention-warning" role="status" aria-live="polite"><div class="settings-card-heading"><span class="summary-icon amber">${icon('clock')}</span><div><h2>Public registration retry-record retention</h2><p>Idempotency records are retained for 30 days.</p></div></div>${!retention || retention.loading ? `<p class="retention-status">Loading retry-record status…</p>` : retention.error ? `<p class="retention-status retention-error" role="alert">Retry-record status is temporarily unavailable. Reopen Settings to try again.</p>` : `<div class="retention-counts"><div><span>Records approaching expiry (25–30 days old)</span><strong>${retention.approachingExpiryCount}</strong></div>${retention.expiredCount > 0 ? `<div><span>Expired, awaiting cleanup</span><strong>${retention.expiredCount}</strong></div>` : ''}</div>`}<p class="retention-explanation">Cleanup deletes only public-registration idempotency/retry records. It does not delete or modify patient records, visits, queue records, audit logs, or rate-limit attempts.</p></section>` : ''}
    <section class="settings-card"><div class="settings-card-heading"><span class="summary-icon blue">${icon('grid')}</span><div><h2>Hospital profile</h2><p>The name shown on the public queue display.</p></div></div>${isAdmin ? `<label class="form-field"><span>Hospital name</span><input id="hospital-name" value="${escapeHtml(state.hospital)}" maxlength="120" required></label><button class="button button-primary settings-save" data-action="save-settings">${icon('check')} Save changes</button>` : `<div class="setting-readonly">${escapeHtml(state.hospital)}</div><p class="settings-preview">Only admins can update hospital settings.</p>`}</section>
    <section class="settings-card"><div class="settings-card-heading"><span class="summary-icon teal">${icon('settings')}</span><div><h2>Application status</h2><p>Live project connection details.</p></div></div><div class="data-info"><div><span>Database</span><strong>Supabase Postgres</strong></div><div><span>Authentication</span><strong>Email and password</strong></div><div><span>Realtime</span><strong>${escapeHtml(state.realtimeStatus)}</strong></div></div></section>
    <section class="settings-card settings-data-card"><div class="settings-card-heading"><span class="summary-icon amber">${icon('users')}</span><div><h2>Your access</h2><p>Permissions are enforced by PostgreSQL RLS and database functions.</p></div></div><div class="data-info"><div><span>Signed in as</span><strong>${escapeHtml(state.profile.email)}</strong></div><div><span>Assigned role</span><strong>${escapeHtml(state.profile.role)}</strong></div><div><span>Session</span><strong>Supabase Auth</strong></div></div></section>
    <div class="settings-disclaimer">${icon('heart')} <p>Patient data is stored in your configured Supabase project. Use production privacy and retention policies appropriate for your organization before entering real patient data.</p></div></div>`
}

function drawQrCode(container, value) {
  if (!container) return
  container.innerHTML = ''
  if (typeof window.QRCode !== 'function') {
    container.textContent = 'QR generator unavailable. Check your internet connection and reload.'
    return
  }
  new window.QRCode(container, { text: value, width: 176, height: 176, correctLevel: window.QRCode.CorrectLevel.M })
}

function renderPage() {
  const pages = {
    Dashboard: dashboardPage,
    Patients: patientsPage,
    'Queue Management': queuePage,
    Staff: staffPage,
    Reports: reportsPage,
    'Public Queue': publicQueuePage,
    Settings: settingsPage,
  }
  document.querySelector('#page-content').innerHTML = (pages[state.page] || dashboardPage)()
  document.querySelector('.breadcrumb strong').textContent = state.page
  const registrationQr = document.querySelector('#registration-qr')
  if (registrationQr) drawQrCode(registrationQr, `${window.location.origin}${import.meta.env.BASE_URL}patient`)
  const doctorLoginQr = document.querySelector('#doctor-login-qr')
  if (doctorLoginQr) drawQrCode(doctorLoginQr, doctorPortalHref)
}

function renderModal() {
  const root = document.querySelector('#modal-root')
  if (!state.modal) {
    root.innerHTML = ''
    return
  }
  let content = ''
  if (state.modal.type === 'register') {
    content = `<div class="modal-heading"><div><p class="eyebrow">NEW CHECK-IN</p><h2>Register a patient</h2><p>Enter patient details to create a queue token.</p></div><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div>
    <form id="register-form" class="modal-form"><div class="form-grid"><label class="form-field form-full"><span>Full name <b>*</b></span><input name="name" required maxlength="120" placeholder="Patient full name"></label><label class="form-field"><span>Age <b>*</b></span><input name="age" type="number" min="0" max="120" required placeholder="Age"></label><label class="form-field"><span>Gender <b>*</b></span><select name="gender" required><option value="">Select gender</option><option>Female</option><option>Male</option><option>Non-binary</option><option>Prefer not to say</option></select></label><label class="form-field form-full"><span>Mobile number <b>*</b></span><input name="mobile" type="tel" inputmode="tel" required placeholder="+91 98765 43210"></label><label class="form-field form-full"><span>Department <b>*</b></span><select name="departmentId" required><option value="">Choose a department</option>${state.departmentRows.map((department) => `<option value="${department.id}">${escapeHtml(department.name)}</option>`).join('')}</select></label><label class="form-field form-full"><span>Select doctor <b>*</b></span><select name="doctorUserId" required disabled><option value="">Choose a department first</option></select></label></div><div class="form-guidance">${icon('heart')} Daily token assignment is handled securely by MediQ.</div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">${icon('plus')} Register patient</button></div></form>`
  } else if (state.modal.type === 'profile') {
    const patient = state.patients.find((item) => item.id === state.modal.id)
    if (patient) {
      const canEdit = ['Admin', 'Receptionist'].includes(state.profile.role)
      const fields = `<div class="form-grid"><label class="form-field form-full"><span>Full name</span><input name="name" required maxlength="120" value="${escapeHtml(patient.name)}" ${canEdit ? '' : 'readonly'}></label><label class="form-field"><span>Age</span><input name="age" type="number" min="0" max="120" required value="${patient.age}" ${canEdit ? '' : 'readonly'}></label><label class="form-field"><span>Gender</span><select name="gender" ${canEdit ? '' : 'disabled'}>${['Female', 'Male', 'Non-binary', 'Prefer not to say'].map((gender) => `<option ${patient.gender === gender ? 'selected' : ''}>${gender}</option>`).join('')}</select></label><label class="form-field form-full"><span>Mobile number</span><input name="mobile" type="tel" required value="${escapeHtml(patient.mobile)}" ${canEdit ? '' : 'readonly'}></label></div>`
      content = `<div class="modal-heading"><div><p class="eyebrow">PATIENT PROFILE</p><h2>${escapeHtml(patient.name)}</h2><p>${escapeHtml(patient.id)} · Registered ${formatTime(patient.createdAt)}</p></div><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div><div class="profile-summary"><span class="avatar avatar-soft avatar-large">${initials(patient.name)}</span><div><span class="token">${escapeHtml(patient.token || 'No visit')}</span>${patient.status ? `<span class="status-badge ${patient.status.toLowerCase()}"><i></i>${escapeHtml(patient.status)}</span>` : ''}</div></div>${canEdit ? `<form id="edit-patient-form" class="modal-form"><input type="hidden" name="patientUuid" value="${escapeHtml(patient.patientUuid)}">${fields}<div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">${icon('check')} Save profile</button></div></form>` : `<div class="modal-form">${fields}<div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Close</button></div></div>`}${state.profile?.role === 'Admin' ? `<form id="link-patient-account-form" class="modal-form"><h3>Link patient login</h3><input type="hidden" name="patientUuid" value="${escapeHtml(patient.patientUuid)}"><label class="form-field"><span>Verified patient account email</span><input name="email" type="email" required placeholder="patient@example.com"></label><button type="submit" class="button button-secondary">Link account</button><small>Patient must first create an account or have one created by the hospital and verify its email.</small></form>` : ''}`
    }
  } else if (state.modal.type === 'medical-record') {
    const record = state.modal.record
    if (record) {
      const isDoctor = state.profile?.role === 'Doctor'
      const reportRows = record.reports.map((r) => '<article class="medical-record-item"><strong>' + escapeHtml(r.report_title) + '</strong><span class="status-badge">' + escapeHtml(r.status) + '</span><p><b>Diagnosis:</b> ' + escapeHtml(r.diagnosis || 'Not recorded') + '</p><p><b>Examination:</b> ' + escapeHtml(r.examination || 'Not recorded') + '</p><p><b>Treatment:</b> ' + escapeHtml(r.treatment_plan || 'Not recorded') + '</p><p><b>Follow-up:</b> ' + escapeHtml(r.follow_up_instructions || 'Not recorded') + '</p>' + (r.status === 'draft' && isDoctor ? '<button class="button button-primary button-small" data-action="finalize-doctor-report" data-id="' + escapeHtml(r.id) + '">Finalize report</button>' : '') + '</article>').join('')
      const noteRows = record.notes.map((n) => '<article class="medical-record-item"><strong>' + escapeHtml(n.title) + '</strong><p>' + escapeHtml(n.content) + '</p><small>' + escapeHtml(n.visibility) + '</small></article>').join('')
      const docRows = record.documents.map((d) => '<article class="medical-record-item"><strong>' + escapeHtml(d.file_name) + '</strong> <button class="button button-secondary button-small" data-action="download-patient-document" data-path="' + escapeHtml(d.storage_path) + '">Download</button></article>').join('')
      const visitRows = record.visits.map((v) => '<div class="medical-record-item"><strong>' + escapeHtml(v.department?.name || 'Visit') + '</strong><p>' + escapeHtml(v.status) + ' · ' + escapeHtml(new Date(v.arrived_at).toLocaleString()) + '</p></div>').join('')
      content = '<div class="modal-heading"><div><p class="eyebrow">CONFIDENTIAL MEDICAL RECORD</p><h2>' + escapeHtml(record.patient.full_name) + '</h2><p>' + escapeHtml(record.patient.patient_code) + '</p></div><button class="icon-button" data-action="close-modal">×</button></div>' +
        '<div class="medical-record-summary"><p>Age: ' + record.patient.age + ' · Gender: ' + escapeHtml(record.patient.gender) + ' · Mobile: ' + escapeHtml(record.patient.mobile) + '</p></div>' +
        '<section class="medical-record-section"><h3>Visit history</h3>' + (visitRows || '<p>No visits.</p>') + '</section>' +
        '<section class="medical-record-section"><div class="medical-record-section-heading"><h3>Doctor reports</h3>' + (isDoctor ? '<button class="button button-primary button-small" data-action="new-doctor-report">New report</button>' : '') + '</div>' + (reportRows || '<p>No reports yet.</p>') + '</section>' +
        (isDoctor ? '<form id="doctor-report-form" class="modal-form" hidden><h3>New report</h3><input type="hidden" name="patientId" value="' + escapeHtml(record.patient.id) + '"><label class="form-field"><span>Visit</span><select name="visitId" required>' + record.visits.map((v) => '<option value="' + escapeHtml(v.id) + '">' + escapeHtml(v.department?.name || 'Visit') + ' · ' + escapeHtml(new Date(v.arrived_at).toLocaleDateString()) + '</option>').join('') + '</select></label><label class="form-field"><span>Examination</span><textarea name="examination" rows="3"></textarea></label><label class="form-field"><span>Diagnosis</span><textarea name="diagnosis" rows="3"></textarea></label><label class="form-field"><span>Treatment plan</span><textarea name="treatmentPlan" rows="3"></textarea></label><label class="form-field"><span>Follow-up instructions</span><textarea name="followUpInstructions" rows="2"></textarea></label><label class="form-field"><span>Follow-up date</span><input type="date" name="followUpDate"></label><button class="button button-primary" type="submit">Save draft report</button></form>' : '') +
        '<section class="medical-record-section"><h3>Medical notes (doctor only)</h3>' + (noteRows || '<p>No notes.</p>') + '</section>' +
        '<section class="medical-record-section"><h3>Documents</h3>' + (docRows || '<p>No documents.</p>') + (isDoctor ? '<button class="button button-secondary button-small" data-action="upload-patient-document">Upload document</button><input id="patient-document-input" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" hidden>' : '') + '</section>' +
        '<div class="modal-actions"><button class="button button-secondary" data-action="close-modal">Close</button><button class="button button-secondary" data-action="print-medical-record">Print / Save PDF</button></div>'
    }  } else if (state.modal.type === 'token-qr' && state.profile?.role === 'Admin') {
    const patientId = String(state.modal.patientId || '');
    const token = String(state.modal.token || '');
    const department = String(state.modal.department || '');
    content = `<div class="modal-heading"><div><p class="eyebrow">QUEUE TOKEN</p><h2>Patient token QR</h2><p>${escapeHtml(patientId)} · ${escapeHtml(department)}</p></div><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div>
    <div class="token-qr-content"><strong class="token-qr-number">${escapeHtml(token)}</strong><div id="token-qr" class="qr-code qr-code-large" role="img" aria-label="QR code containing patient ID and queue token"></div><p>Scan to read this patient ID and queue token. Keep this QR private; it is intended for the patient or attendant.</p><button class="button button-secondary" data-action="print-token-qr">${icon('download')} Print token</button></div>`;
  } else if (state.modal.type === 'staff-invite') {
    content = `<div class="modal-heading"><div><p class="eyebrow">STAFF DIRECTORY</p><h2>Invite staff member</h2><p>An invitation email will be sent and their MediQ profile created.</p></div><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div>
    <form id="staff-invite-form" class="modal-form"><div class="form-grid"><label class="form-field form-full"><span>Full name <b>*</b></span><input name="fullName" required maxlength="120" autocomplete="name" placeholder="Staff member name"></label><label class="form-field form-full"><span>Work email <b>*</b></span><input name="email" type="email" required maxlength="254" autocomplete="email" placeholder="name@hospital.com"></label><label class="form-field"><span>Role <b>*</b></span><select name="role" required><option value="">Select role</option><option>Doctor</option><option>Nurse</option><option>Receptionist</option></select></label><label class="form-field"><span>Department</span><select name="departmentId"><option value="">Unassigned</option>${state.departmentRows.map((department) => `<option value="${department.id}">${escapeHtml(department.name)}</option>`).join('')}</select></label></div><div class="form-guidance">${icon('settings')} The invitation link lets the staff member set up their account. Admin access cannot be assigned from this form.</div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">${icon('plus')} Send invitation</button></div></form>`
  } else if (state.modal.type === 'staff') {
    const person = state.staff.find((member) => member.id === state.modal.id)
    if (person) content = `<div class="modal-heading"><div><p class="eyebrow">STAFF DIRECTORY</p><h2>Edit staff profile</h2><p>${escapeHtml(person.email)}</p></div><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div><form id="staff-form" class="modal-form"><input type="hidden" name="userId" value="${escapeHtml(person.id)}"><div class="form-grid"><label class="form-field form-full"><span>Full name <b>*</b></span><input name="name" required maxlength="120" value="${escapeHtml(person.name)}"></label><label class="form-field"><span>Role <b>*</b></span><select name="role" required>${['Admin', 'Receptionist', 'Doctor', 'Nurse'].map((role) => `<option ${person.role === role ? 'selected' : ''}>${role}</option>`).join('')}</select></label><label class="form-field"><span>Department</span><select name="departmentId"><option value="">Unassigned</option>${state.departmentRows.map((department) => `<option value="${department.id}" ${person.departmentId === department.id ? 'selected' : ''}>${escapeHtml(department.name)}</option>`).join('')}</select></label></div><div class="form-guidance">${icon('settings')} Role changes take effect immediately and are checked by database RLS.</div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">${icon('check')} Save profile</button></div></form>`
  }
  root.innerHTML = `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><span id="modal-title" class="sr-only">MediQ dialog</span>${content}</section></div>`
  if (state.modal.type === 'token-qr') drawQrCode(root.querySelector('#token-qr'), `MediQ queue token\\nPatient ID: ${state.modal.patientId}\\nToken: ${state.modal.token}\\nDepartment: ${state.modal.department}\\nLive queue: ${window.location.origin}${appBase}display`)
  const focusTarget = root.querySelector('input:not([type="hidden"]), select')
  if (focusTarget) focusTarget.focus()
}

function showToast(message, type = 'success') {
  state.toast = { message, type }
  const root = document.querySelector('#toast-root')
  root.innerHTML = `<div class="toast toast-${type}">${icon(type === 'error' ? 'close' : 'check')}<span>${escapeHtml(message)}</span><button data-action="dismiss-toast" aria-label="Dismiss notification">${icon('close')}</button></div>`
  window.clearTimeout(showToast.timeout)
  showToast.timeout = window.setTimeout(() => { root.innerHTML = ''; state.toast = null }, 3500)
}

function changePage(page) {
  if (!['Dashboard', 'Patients', 'Queue Management', 'Staff', 'Reports', 'Settings', 'Public Queue'].includes(page)) return
  state.page = page
  state.mobileMenu = false
  renderShell()
  if (page === 'Settings' && state.profile.role === 'Admin') {
    loadAdminRegistrationRetentionStatus()
  }
}

async function loadAdminRegistrationRetentionStatus() {
  if (state.profile?.role !== 'Admin') return
  const userId = state.user?.id
  const requestId = ++retentionStatusRequestId
  state.publicRegistrationRetention = { loading: true }
  if (state.page === 'Settings') renderPage()

  try {
    const status = await loadPublicRegistrationRetentionStatus(supabase)
    if (requestId !== retentionStatusRequestId || state.user?.id !== userId || state.profile?.role !== 'Admin') return
    state.publicRegistrationRetention = { loading: false, ...status }
  } catch {
    if (requestId !== retentionStatusRequestId || state.user?.id !== userId || state.profile?.role !== 'Admin') return
    state.publicRegistrationRetention = { loading: false, error: true }
  }

  if (requestId === retentionStatusRequestId && state.page === 'Settings' && state.profile?.role === 'Admin') {
    renderPage()
  }
}

async function refreshWorkspace() {
  const workspace = await loadWorkspace(supabase, state.user)
  if (!workspace.profile) {
    state.profile = null
    renderProfileMissing()
    return
  }
  state.profile = workspace.profile
  state.patients = workspace.patients
  state.queues = workspace.queues
  state.staff = workspace.staff
  state.departmentRows = workspace.departments
  state.hospital = workspace.hospital
  departments = workspace.departments.map((department) => department.name)
  renderShell()
}

async function registerPatient(form) {
  const data = new FormData(form)
  const patient = {
    name: String(data.get('name')).trim(),
    age: Number(data.get('age')),
    gender: String(data.get('gender')),
    mobile: String(data.get('mobile')).trim(),
    departmentId: String(data.get('departmentId')),
    doctorUserId: String(data.get('doctorUserId')),
  }
  const selectedDoctor = state.staff.find((member) =>
    member.id === patient.doctorUserId
    && member.role === 'Doctor'
    && member.active
    && member.departmentId === patient.departmentId
  )
  if (!patient.name || !validMobile(patient.mobile) || !state.departmentRows.some((department) => department.id === patient.departmentId) || !selectedDoctor || !Number.isInteger(patient.age) || patient.age < 0 || patient.age > 120) {
    showToast('Please check the patient details and try again.', 'error')
    return
  }
  const submit = form.querySelector('button[type="submit"]')
  submit.disabled = true
  submit.textContent = 'Saving registration…'
  try {
    const result = await createPatientRecord(supabase, patient)
    if (!result || typeof result.patient_code !== 'string' || !result.patient_code.trim()
      || typeof result.token !== 'string' || !result.token.trim()) {
      state.modal = null
      renderShell()
      showToast('Registration may have completed, but the server did not return a Patient ID and token. Refresh the patient list before retrying.', 'error')
      return
    }

    state.modal = state.profile.role === 'Admin' ? { type: 'token-qr', patientId: result.patient_code, token: result.token, department: patient.departmentId ? state.departmentRows.find((row) => row.id === patient.departmentId)?.name || 'Department' : 'Department' } : null
    renderShell()
    renderModal()
    const successMessage = `Patient registered. Patient ID ${result.patient_code}; queue token ${result.token}.`
    showToast(successMessage)
    try {
      await refreshWorkspace()
    } catch (error) {
      showToast(`${successMessage} Workspace refresh failed: ${error.message}`, 'error')
    }
  } catch (error) {
    showToast(`Patient registration could not be confirmed: ${error.message}. Check the patient list before retrying.`, 'error')
  } finally {
    if (form.isConnected) {
      submit.disabled = false
      submit.innerHTML = `${icon('plus')} Register patient`
    }
  }
}

async function savePatient(form) {
  const data = new FormData(form)
  const patient = {
    patientUuid: String(data.get('patientUuid')),
    name: String(data.get('name')).trim(),
    age: Number(data.get('age')),
    gender: String(data.get('gender')),
    mobile: String(data.get('mobile')).trim(),
  }
  if (!patient.name || !validMobile(patient.mobile) || !Number.isInteger(patient.age) || patient.age < 0 || patient.age > 120) {
    showToast('Please check the patient details and try again.', 'error')
    return
  }
  const submit = form.querySelector('button[type="submit"]')
  submit.disabled = true
  submit.textContent = 'Saving profile…'
  try {
    await updatePatient(supabase, patient)
    state.modal = null
    await refreshWorkspace()
    showToast('Patient profile updated.')
  } catch (error) {
    showToast(`Patient update failed: ${error.message}`, 'error')
  } finally {
    if (form.isConnected) {
      submit.disabled = false
      submit.innerHTML = `${icon('check')} Save profile`
    }
  }
}

async function callNext(departmentName) {
  const department = state.departmentRows.find((item) => item.name === departmentName)
  if (!department) {
    showToast('This department is not available.', 'error')
    return
  }
  try {
    const result = await callNextPatient(supabase, department.id)
    await refreshWorkspace()
    showToast(`${result.token} is now being served.`)
  } catch (error) {
    showToast(`Could not call the next patient: ${error.message}`, 'error')
  }
}


function exportReport() {
  const rows = [['Patient ID', 'Patient', 'Department', 'Token', 'Status', 'Arrival']]
  todayPatients().forEach((patient) => rows.push([
    patient.id, patient.name, patient.department, patient.token,
    patient.status, formatTime(patient.arrivalAt),
  ]))
  const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `mediq-report-${dateKey()}.csv`
  link.click()
  URL.revokeObjectURL(url)
  showToast('Daily report exported as CSV.')
}

app.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-page], [data-action]')
  if (!target) return
  const page = target.dataset.page
  const action = target.dataset.action
  if (page) {
    event.preventDefault()
    changePage(page)
    return
  }
  if (action === 'toggle-theme') { currentTheme = applyTheme(currentTheme === 'dark' ? 'light' : 'dark'); renderShell(); return }
  if (action === 'toggle-menu') { state.mobileMenu = true; renderShell() }
  if (action === 'close-menu') { state.mobileMenu = false; renderShell() }
  if (action === 'open-register') { state.modal = { type: 'register' }; renderModal() }
  if (action === 'close-modal') { state.modal = null; renderModal() }
  if (action === 'backdrop-close' && event.target === target) { state.modal = null; renderModal() }
  if (action === 'view-patient') { state.modal = { type: 'profile', id: target.dataset.id }; renderModal() }
  if (action === 'download-report-pdf') window.print()
  if (action === 'patient-signout') { await supabase.auth.signOut(); await renderPatientDashboard() }
  if (action === 'view-medical-record') {
    const patient = state.patients.find((p) => p.id === target.dataset.id)
    if (patient) { try { state.modal = { type: 'medical-record', record: await loadPatientMedicalRecord(supabase, patient.patientUuid) }; renderModal() } catch (error) { showToast('Could not load medical record: ' + error.message, 'error') } }
  }
  if (action === 'new-doctor-report') { const form = document.querySelector('#doctor-report-form'); if (form) form.hidden = false }
  if (action === 'finalize-doctor-report') { try { await finalizeDoctorReport(supabase, target.dataset.id); state.modal.record = await loadPatientMedicalRecord(supabase, state.modal.record.patient.id); renderModal(); showToast('Doctor report finalized.') } catch (error) { showToast('Could not finalize report: ' + error.message, 'error') } }
  if (action === 'upload-patient-document') document.querySelector('#patient-document-input')?.click()
  if (action === 'download-patient-document') { try { const url = await getPatientDocumentDownloadUrl(supabase, target.dataset.path); window.open(url, '_blank', 'noopener,noreferrer') } catch (error) { showToast('Download failed: ' + error.message, 'error') } }
  if (action === 'print-medical-record') window.print()
  if (action === 'print-token-qr') window.print()
  if (action === 'call-next') await callNext(target.dataset.department)
  if (action === 'start-serving') {
    const patient = state.queues.find((item) => item.queueId === target.dataset.id)
    if (patient) await callNext(patient.department)
  }
  if (action === 'complete-patient') {
    const record = state.queues.find((item) => item.queueId === target.dataset.id)
    try {
      const completed = await completeQueueRecord(supabase, target.dataset.id)
      await refreshWorkspace()
      showToast(`${completed.token} visit marked complete.`)
    } catch (error) {
      showToast(`Could not complete the visit: ${error.message}`, 'error')
    }
  }
  if (action === 'edit-staff') { state.modal = { type: 'staff', id: target.dataset.id }; renderModal() }
  if (action === 'invite-staff') { if (state.profile?.role !== 'Admin') { showToast('Only admins can invite staff.', 'error'); return }; state.modal = { type: 'staff-invite' }; renderModal() }
  if (action === 'save-settings') {
    const input = document.querySelector('#hospital-name')
    if (!input.value.trim()) { showToast('Hospital name cannot be empty.', 'error'); input.focus(); return }
    try {
      await updateHospitalName(supabase, input.value.trim())
      await refreshWorkspace()
      showToast('Hospital settings saved.')
    } catch (error) {
      showToast(`Settings update failed: ${error.message}`, 'error')
    }
  }
  if (action === 'export-report') exportReport()
  if (action === 'dismiss-toast') { document.querySelector('#toast-root').innerHTML = ''; state.toast = null }
  if (action === 'fullscreen') {
    const display = document.querySelector('.public-display-preview')
    if (document.fullscreenElement) document.exitFullscreen()
    else if (display && display.requestFullscreen) display.requestFullscreen().catch(() => showToast('Full screen is not available in this browser.', 'error'))
  }
  if (action === 'open-public-display') window.open(`${appBase}display`, '_blank', 'noopener,noreferrer')
  if (action === 'retry-workspace') {
    if (state.user) await loadSignedInWorkspace(state.user, true)
  }
  if (action === 'retry-public') await renderPublicDisplay()
  if (action === 'sign-out') {
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) throw error
      stopWorkspaceRealtime()
      state.user = null
      state.profile = null
      lastLoadedUserId = null
      renderSignIn()
    } catch (error) {
      showToast(`Sign out failed: ${error.message}`, 'error')
    }
  }
  if (action === 'dismiss-note') target.closest('.info-note').remove()
})

app.addEventListener('input', (event) => {
  if (event.target.id === 'patient-search') {
    const start = event.target.selectionStart
    state.search = event.target.value
    renderPage()
    const search = document.querySelector('#patient-search')
    search.focus()
    search.setSelectionRange(start, start)
  }
})

app.addEventListener('change', (event) => {
  if (event.target.id === 'patient-status-filter') { state.patientFilter = event.target.value; renderPage() }
  if (event.target.id === 'department-filter') { state.departmentFilter = event.target.value; renderPage() }
  if (event.target.name === 'departmentId' && event.target.form?.id === 'register-form') {
    const doctorSelect = event.target.form.elements.doctorUserId
    const departmentId = event.target.value
    const doctors = state.staff.filter((member) =>
      member.role === 'Doctor' && member.active && member.departmentId === departmentId
    )
    doctorSelect.innerHTML = doctors.length
      ? '<option value="">Choose a doctor</option>' + doctors.map((doctor) =>
        `<option value="${escapeHtml(doctor.id)}">${escapeHtml(doctor.name)}</option>`
      ).join('')
      : '<option value="">No active doctors in this department</option>'
    doctorSelect.disabled = doctors.length === 0
  }
})

app.addEventListener('change', async (event) => {
  if (event.target.id === 'patient-document-input' && event.target.files?.[0] && state.modal?.type === 'medical-record') {
    try { const record = state.modal.record; await uploadPatientDocument(supabase, { patientId: record.patient.id, visitId: record.visits[0]?.id || null, file: event.target.files[0], visibility: 'doctor_only' }); state.modal.record = await loadPatientMedicalRecord(supabase, record.patient.id); renderModal(); showToast('Document uploaded securely.') } catch (error) { showToast('Upload failed: ' + error.message, 'error') }
    event.target.value = ''
  }
})
app.addEventListener('submit', async (event) => {
  if (event.target.id === 'patient-account-login' || event.target.id === 'patient-account-signup') {
    event.preventDefault()
    const form = event.target
    const data = new FormData(form)
    const email = String(data.get('email')).trim()
    const password = String(data.get('password'))
    const submit = form.querySelector('button[type="submit"]')
    submit.disabled = true
    try {
      if (form.id === 'patient-account-signup') {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: String(data.get('fullName')).trim(), account_type: 'patient' } } })
        if (error) throw error
        await renderPatientDashboard()
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        await renderPatientDashboard()
      }
    } catch (error) {
      submit.disabled = false
      const note = document.createElement('p')
      note.className = 'form-guidance'
      note.setAttribute('role', 'alert')
      note.textContent = error.message
      form.prepend(note)
    }
  }
  if (event.target.id === 'sign-in-form') {
    event.preventDefault()
    if (isDoctorPortal) doctorSignInInitiated = true
    const data = new FormData(event.target)
    const submit = event.target.querySelector('button[type="submit"]')
    submit.disabled = true
    submit.textContent = 'Signing in…'
    supabase.auth.signInWithPassword({
      email: String(data.get('email')).trim(),
      password: String(data.get('password')),
    }).then(({ error }) => {
      if (error) {
        state.authError = error.message
        renderSignIn(state.authError)
      }
    }).catch((error) => {
      state.authError = error.message
      renderSignIn(state.authError)
    })
  }
  if (event.target.id === 'register-form') { event.preventDefault(); registerPatient(event.target) }
  if (event.target.id === 'doctor-report-form') {
    event.preventDefault(); const data = new FormData(event.target)
    const report = { patientId: String(data.get('patientId')), visitId: String(data.get('visitId')), title: 'Consultation report', examination: String(data.get('examination')).trim(), diagnosis: String(data.get('diagnosis')).trim(), treatmentPlan: String(data.get('treatmentPlan')).trim(), followUpInstructions: String(data.get('followUpInstructions')).trim(), followUpDate: String(data.get('followUpDate')) || null }
    try { await createDoctorReport(supabase, report); state.modal.record = await loadPatientMedicalRecord(supabase, report.patientId); renderModal(); showToast('Doctor report saved as draft.') } catch (error) { showToast('Could not save report: ' + error.message, 'error') }
  }
  if (event.target.id === 'edit-patient-form') { event.preventDefault(); savePatient(event.target) }
  if (event.target.id === 'link-patient-account-form') { event.preventDefault(); if (state.profile?.role !== 'Admin') return; const data = new FormData(event.target); try { const { error } = await supabase.rpc('admin_link_patient_account', { p_patient_id: String(data.get('patientUuid')), p_patient_email: String(data.get('email')).trim() }); if (error) throw error; showToast('Patient account linked securely.'); event.target.reset() } catch (error) { showToast('Could not link patient account: ' + error.message, 'error') } }

  if (event.target.id === 'staff-invite-form') {
    event.preventDefault()
    if (state.profile?.role !== 'Admin') { showToast('Only admins can invite staff.', 'error'); return }
    const form = event.target
    const data = new FormData(form)
    const submit = form.querySelector('button[type="submit"]')
    submit.disabled = true
    submit.textContent = 'Sending invitation…'
    const staff = {
      fullName: String(data.get('fullName')).trim(),
      email: String(data.get('email')).trim(),
      role: String(data.get('role')),
      departmentId: String(data.get('departmentId')) || null,
    }
    inviteStaffMember(supabase, staff)
      .then(async () => {
        state.modal = null
        await refreshWorkspace()
        showToast(`Invitation sent to ${staff.email} and staff profile created.`)
      })
      .catch((error) => {
        showToast(`Staff invitation failed: ${error.message}`, 'error')
        if (submit.isConnected) { submit.disabled = false; submit.innerHTML = `${icon('plus')} Send invitation` }
      })
  }
  if (event.target.id === 'staff-form') {
    event.preventDefault()
    if (state.profile.role !== 'Admin') { showToast('Only admins can manage staff profiles.', 'error'); return }
    const data = new FormData(event.target)
    const name = String(data.get('name')).trim()
    const profile = {
      name,
      role: String(data.get('role')),
      departmentId: String(data.get('departmentId')) || null,
    }
    updateStaffProfile(supabase, String(data.get('userId')), profile)
      .then(async () => {
        state.modal = null
        await refreshWorkspace()
        showToast('Staff profile updated.')
      })
      .catch((error) => showToast(`Staff profile update failed: ${error.message}`, 'error'))
  }
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.modal) { state.modal = null; renderModal() }
  if (event.key === 'Escape' && state.mobileMenu) { state.mobileMenu = false; renderShell() }
})

if (isPublicRegistration) {
  window.location.replace(`${appBase}patient`)
} else if (isPublicPatient) {
  renderPatientDashboard()
} else if (!isSupabaseConfigured) {
  renderConfigurationError()
} else if (isPublicDisplay) {
  renderPublicDisplay()
} else {
  const doctorPortalRequested = isDoctorPortal
  if (doctorPortalRequested) renderSignIn()
  else renderLoading()
  supabase.auth.onAuthStateChange((event, session) => {
    window.setTimeout(() => {
      // Never hydrate an existing Admin session on the doctor QR route.
      // Only an explicit sign-in action should enter the workspace.
      if (doctorPortalRequested && (!doctorSignInInitiated || event !== 'SIGNED_IN')) return
      if (session?.user) {
        if (doctorPortalRequested && event === 'SIGNED_IN') {
          const cleanUrl = new URL(window.location.href)
          cleanUrl.searchParams.delete('portal')
          window.history.replaceState({}, '', cleanUrl)
        }
        loadSignedInWorkspace(session.user)
      } else {
        stopWorkspaceRealtime()
        state.user = null
        state.profile = null
        state.patients = []
        state.queues = []
        state.staff = []
        state.departmentRows = []
        lastLoadedUserId = null
        renderSignIn(state.authError)
      }
    }, 0)
  })
}
