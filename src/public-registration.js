import { loadPublicDoctors, registerPublicPatient } from './lib/api.js'

const departments = ['General Medicine', 'Emergency', 'Cardiology']
const genders = ['Female', 'Male', 'Non-binary', 'Prefer not to say']
const idempotencyStorageKey = 'mediq-public-registration-idempotency-key'

function isValidIndianMobile(value) {
  const normalized = value.replace(/[\s().-]/g, '')
  return /^(?:\+?91)?[6-9]\d{9}$/.test(normalized)
}

export function renderPublicRegistration(app, icon, client, registrationEnabled) {
  const registrationReady = Boolean(registrationEnabled && client)
  document.body.classList.add('public-registration-page')
  app.innerHTML = `<main class="public-route public-registration-route">
    <div class="public-registration-shell">
      <header class="public-registration-header">
        <a class="brand public-registration-brand" href="${import.meta.env.BASE_URL}display" aria-label="MediQ public queue display">
          <span class="brand-mark">${icon('heart')}</span>
          <span class="brand-copy"><strong>Medi<span>Q</span></strong><small>CARE, IN ORDER</small></span>
        </a>
        <span class="registration-route-label">PATIENT SELF REGISTRATION</span>
      </header>
      <section class="public-registration-card" aria-labelledby="registration-title">
        <p class="eyebrow">WELCOME TO MEDIQ</p>
        <h1 id="registration-title">Join the queue</h1>
        <p class="public-registration-intro">Enter your details to request a place in your department’s queue.</p>
        <div class="registration-emergency" role="note">
          <strong>Need urgent medical attention?</strong>
          <span>Do not wait for online registration. Call emergency services or contact hospital staff directly.</span>
          <div class="registration-emergency-actions">
            <a class="button button-danger registration-call-button" href="tel:108">☎ Call Ambulance · 108</a>
            <a class="button button-secondary registration-call-button" href="tel:112">Call Emergency · 112</a>
          </div>
          <small>These buttons open your phone dialer. MediQ does not dispatch an ambulance.</small>
        </div>
        <form id="public-registration-form" class="public-registration-form">
          <div class="public-registration-fields">
            <label class="form-field registration-full"><span>Full name <b>*</b></span><input name="fullName" type="text" autocomplete="name" maxlength="120" required placeholder="Enter your full name"></label>
            <label class="form-field"><span>Age <b>*</b></span><input name="age" type="number" inputmode="numeric" min="0" max="120" step="1" required placeholder="Age"></label>
            <label class="form-field"><span>Gender <b>*</b></span><select name="gender" required><option value="">Select gender</option>${genders.map((gender) => `<option value="${gender}">${gender}</option>`).join('')}</select></label>
            <label class="form-field registration-full"><span>Mobile number <b>*</b></span><input name="mobile" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" required aria-describedby="registration-mobile-help" placeholder="+91 98765 43210"><small id="registration-mobile-help">Use a 10-digit Indian mobile number, with or without +91.</small></label>
            <label class="form-field registration-full"><span>Department <b>*</b></span><select name="department" required><option value="">Choose a department</option>${departments.map((department) => `<option value="${department}">${department}</option>`).join('')}</select></label>
            <label class="form-field registration-full"><span>Select doctor <b>*</b></span><select name="doctorUserId" required disabled><option value="">Choose a department first</option></select></label>
          </div>
          <div class="registration-privacy" role="note"><strong>Privacy notice</strong><span>${registrationReady ? 'Your details are used to create your patient record and queue entry. Personal details are not shown on the public queue display. Do not enter medical details here.' : 'Online registration is not active yet. Your details will not be sent or saved. Do not enter medical details here.'}</span></div>
          <button class="button button-primary public-registration-submit" type="submit" ${registrationReady ? '' : 'disabled'}>${registrationReady ? `${icon('check')} Submit Registration` : 'Registration Currently Unavailable'}</button>
        </form>
        <div id="registration-status" class="registration-status" role="alert" tabindex="-1" hidden></div>
        <section id="registration-success" class="registration-success" aria-labelledby="registration-success-title" aria-live="polite" hidden>
          <span class="registration-success-icon">${icon('check')}</span>
          <p class="eyebrow">REGISTRATION COMPLETE</p>
          <h2 id="registration-success-title">You’re in the queue</h2>
          <dl><div><dt>Patient ID</dt><dd data-patient-id></dd></div><div><dt>Queue token</dt><dd data-queue-token></dd></div></dl>
          <div class="registration-tracking-link"><strong>Track your queue</strong><p>Use this private link to see your live queue position. Keep it private.</p><a class="button button-primary" data-dashboard-link href="#">Open Patient Dashboard</a></div>
          <button class="button button-secondary registration-reset" type="button">Register another patient</button>
        </section>
      </section>
      <footer class="public-registration-footer">Please ask hospital reception if you need help with registration.<br>© ${new Date().getFullYear()} MediQ — All Rights Reserved.</footer>
    </div>
  </main>`

  const form = app.querySelector('#public-registration-form')
  const status = app.querySelector('#registration-status')
  const success = app.querySelector('#registration-success')
  const submit = form.querySelector('button[type="submit"]')
  const nameInput = form.elements.fullName
  const mobileInput = form.elements.mobile
  const departmentSelect = form.elements.department
  const doctorSelect = form.elements.doctorUserId
  let publicDoctors = []
  let doctorDirectoryLoaded = false

  const updateDoctorOptions = () => {
    const department = departmentSelect.value
    const matchingDoctors = publicDoctors.filter((doctor) => doctor.department_name === department)
    doctorSelect.innerHTML = matchingDoctors.length
      ? '<option value="">Choose a doctor</option>' + matchingDoctors.map((doctor) =>
        `<option value="${doctor.user_id}">${String(doctor.full_name).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])}</option>`
      ).join('')
      : '<option value="">No active doctors in this department</option>'
    doctorSelect.disabled = !department || matchingDoctors.length === 0
  }

  departmentSelect.addEventListener('change', updateDoctorOptions)
  if (registrationReady) {
    loadPublicDoctors(client)
      .then((doctors) => {
        publicDoctors = doctors
        doctorDirectoryLoaded = true
        updateDoctorOptions()
      })
      .catch(() => {
        status.textContent = 'Doctor list is temporarily unavailable. Please refresh the page or contact hospital reception.'
        status.hidden = false
      })
  }
  let idempotencyKey = ''
  try {
    idempotencyKey = globalThis.sessionStorage.getItem(idempotencyStorageKey) || ''
  } catch {
    idempotencyKey = ''
  }

  const validateName = () => {
    nameInput.setCustomValidity(nameInput.value.trim() ? '' : 'Enter your full name.')
  }
  const validateMobile = () => {
    mobileInput.setCustomValidity(
      mobileInput.value && !isValidIndianMobile(mobileInput.value)
        ? 'Enter a valid 10-digit Indian mobile number, with or without +91.'
        : '',
    )
  }

  nameInput.addEventListener('input', validateName)
  mobileInput.addEventListener('input', validateMobile)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    validateName()
    validateMobile()
    status.hidden = true
    if (!form.reportValidity()) return

    if (!registrationReady) {
      status.textContent = 'Online registration is not active yet. Your details have not been sent or saved. Please contact hospital reception to register.'
      status.hidden = false
      status.focus()
      return
    }

    if (!doctorDirectoryLoaded || !doctorSelect.value) {
      status.textContent = 'Please select a doctor from the selected department.'
      status.hidden = false
      status.focus()
      return
    }

    const patient = {
      fullName: nameInput.value.trim(),
      age: Number(form.elements.age.value),
      gender: form.elements.gender.value,
      mobile: mobileInput.value.trim(),
      department: departmentSelect.value,
      doctorUserId: doctorSelect.value,
    }
    if (!idempotencyKey) {
      if (!globalThis.crypto?.randomUUID) {
        status.textContent = 'A secure browser connection is required to submit registration.'
        status.hidden = false
        status.focus()
        return
      }
      idempotencyKey = globalThis.crypto.randomUUID()
      try {
        globalThis.sessionStorage.setItem(idempotencyStorageKey, idempotencyKey)
      } catch {
        idempotencyKey = ''
        status.textContent = 'Secure browser storage is unavailable. Your registration cannot be submitted safely. Please contact hospital reception.'
        status.hidden = false
        status.focus()
        return
      }
    }

    submit.disabled = true
    submit.textContent = 'Submitting registration…'
    Promise.resolve()
      .then(() => registerPublicPatient(client, patient, idempotencyKey))
      .then((result) => {
        if (!result || typeof result.patientId !== 'string' || !result.patientId.trim()
          || typeof result.token !== 'string' || !result.token.trim()
          || typeof result.dashboardToken !== 'string' || !/^[0-9a-f]{64}$/.test(result.dashboardToken)) {
          throw new Error('Registration response was incomplete.')
        }
        try {
          globalThis.sessionStorage.removeItem(idempotencyStorageKey)
          idempotencyKey = ''
        } catch {
          console.error('Could not clear the completed registration key from session storage.')
        }
        const dashboardUrl = new URL(`${import.meta.env.BASE_URL}patient`, window.location.origin)
        dashboardUrl.searchParams.set('access', result.dashboardToken)
        window.location.assign(dashboardUrl.toString())
      })
      .catch((error) => {
        status.textContent = error.status === 409
          ? 'A previous request used this submission key with different details. It may already have succeeded. Please contact hospital reception before submitting again.'
          : error.message || 'Registration is temporarily unavailable. Please try again later.'
        status.hidden = false
        status.focus()
      })
      .finally(() => {
        if (form.isConnected) {
          submit.disabled = false
          submit.innerHTML = `${icon('check')} Submit Registration`
        }
      })
  })
  app.querySelector('.registration-reset').addEventListener('click', () => {
    try {
      globalThis.sessionStorage.removeItem(idempotencyStorageKey)
    } catch {
      status.textContent = 'Secure browser storage is unavailable. Please contact hospital reception before starting another registration.'
      status.hidden = false
      status.focus()
      return
    }
    idempotencyKey = ''
    success.hidden = true
    form.hidden = false
    form.reset()
    updateDoctorOptions()
    status.hidden = true
  })

  function showSuccess({ patientId, token, dashboardToken }) {
    app.querySelector('[data-patient-id]').textContent = patientId
    app.querySelector('[data-queue-token]').textContent = token
    const dashboardUrl = new URL(`${import.meta.env.BASE_URL}patient`, window.location.origin)
    dashboardUrl.searchParams.set('access', dashboardToken)
    app.querySelector('[data-dashboard-link]').href = dashboardUrl.toString()
    status.hidden = true
    form.hidden = true
    success.hidden = false
  }

  return {
    showSuccess,
  }
}
