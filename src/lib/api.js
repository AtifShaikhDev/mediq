function unwrap(result) {
  if (result.error) throw new Error(result.error.message)
  return result.data
}

function mapQueue(record) {
  const patient = record.visit.patient
  const department = record.department
  return {
    id: patient.patient_code,
    patientUuid: patient.id,
    queueId: record.id,
    visitId: record.visit.id,
    name: patient.full_name,
    age: patient.age,
    gender: patient.gender,
    mobile: patient.mobile,
    department: department.name,
    departmentId: department.id,
    departmentCode: department.code,
    token: record.token,
    status: record.status,
    queueDate: record.queue_date,
    createdAt: record.created_at,
    arrivalAt: record.visit.arrived_at,
    calledAt: record.called_at,
    doctorUserId: record.visit.doctor_user_id,
  }
}

export async function loadWorkspace(client, user) {
  const profileResult = await client.from('staff_profiles')
    .select('user_id,email,full_name,role,active,department_id,department:departments(name)')
    .eq('user_id', user.id)
    .maybeSingle()
  const profile = unwrap(profileResult)
  if (!profile || !profile.active) return { profile: null }

  const [departmentsResult, settingsResult] = await Promise.all([
    client.from('departments').select('id,name,code').eq('active', true).order('name'),
    client.from('hospital_settings').select('hospital_name').eq('id', true).single(),
  ])
  const departmentRows = unwrap(departmentsResult)
  const settings = unwrap(settingsResult)

  const [patientsResult, queueResult, staffResult] = await Promise.all([
    client.from('patients')
      .select('id,patient_code,full_name,age,gender,mobile,created_at')
      .order('created_at', { ascending: false })
      .limit(2000),
    client.from('queue_records')
      .select('id,token,status,queue_date,created_at,called_at,department:departments!queue_records_department_id_fkey(id,name,code),visit:visits!inner(id,arrived_at,doctor_user_id,patient:patients!inner(id,patient_code,full_name,age,gender,mobile))')
      .order('created_at', { ascending: false })
      .limit(2000),
    client.from('staff_profiles')
      .select('user_id,email,full_name,role,active,department_id,department:departments(name)')
      .order('full_name'),
  ])
  const patientRows = unwrap(patientsResult)
  const queueRows = unwrap(queueResult)
  const staffRows = unwrap(staffResult)
  const queues = queueRows.map(mapQueue)
  const latestVisitByPatient = new Map()
  queues.forEach((queue) => {
    if (!latestVisitByPatient.has(queue.patientUuid)) latestVisitByPatient.set(queue.patientUuid, queue)
  })
  const patients = patientRows.map((patient) => ({
    id: patient.patient_code,
    patientUuid: patient.id,
    name: patient.full_name,
    age: patient.age,
    gender: patient.gender,
    mobile: patient.mobile,
    createdAt: patient.created_at,
    ...(latestVisitByPatient.get(patient.id) || {}),
  }))
  const staff = staffRows.map((member, index) => ({
    id: member.user_id,
    name: member.full_name,
    email: member.email,
    role: member.role,
    department: member.department?.name || 'Unassigned',
    departmentId: member.department_id,
    active: member.active,
    initials: member.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(),
    color: ['violet', 'blue', 'teal', 'rose', 'amber'][index % 5],
  }))

  return {
    profile,
    departments: departmentRows,
    hospital: settings.hospital_name,
    patients,
    queues,
    staff,
  }
}

export async function registerPatient(client, patient) {
  const result = await client.rpc('register_patient', {
    p_full_name: patient.name,
    p_age: patient.age,
    p_gender: patient.gender,
    p_mobile: patient.mobile,
    p_department_id: patient.departmentId,
    p_doctor_user_id: patient.doctorUserId,
  })
  return unwrap(result)?.[0]
}

export async function loadPublicDoctors(client) {
  const result = await client.rpc('get_public_doctor_directory')
  return unwrap(result) || []
}

export async function registerPublicPatient(client, patient, idempotencyKey, documents = []) {
  const body = new FormData()
  body.set('registration', JSON.stringify(patient))
  documents.forEach((file) => body.append('documents', file, file.name))
  const result = await client.functions.invoke('public-register', {
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  })
  if (!result.error) return result.data

  const context = result.error.context
  let message = result.error.message
  if (context instanceof Response) {
    try {
      const body = await context.clone().json()
      if (typeof body?.error === 'string') message = body.error
    } catch {
      message = result.error.message
    }
    const requestError = new Error(message)
    requestError.status = context.status
    throw requestError
  }
  throw result.error
}

export async function loadPublicRegistrationRetentionStatus(client) {
  const result = await client.rpc('get_public_registration_retention_status')
  const row = unwrap(result)?.[0]
  if (!row) throw new Error('Public registration retention status is unavailable.')

  const parseCount = (value) => {
    const count = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error('Public registration retention status is invalid.')
    }
    return count
  }

  return {
    approachingExpiryCount: parseCount(row.approaching_expiry_count),
    expiredCount: parseCount(row.expired_count),
  }
}

export async function updatePatient(client, patient) {
  const result = await client.from('patients')
    .update({
      full_name: patient.name,
      age: patient.age,
      gender: patient.gender,
      mobile: patient.mobile,
    })
    .eq('id', patient.patientUuid)
    .select('id')
    .single()
  return unwrap(result)
}

export async function callNextPatient(client, departmentId) {
  const result = await client.rpc('call_next_patient', { p_department_id: departmentId })
  return unwrap(result)?.[0]
}

export async function completeQueueRecord(client, queueId) {
  const result = await client.rpc('complete_queue_record', { p_queue_record_id: queueId })
  return unwrap(result)?.[0]
}

export async function updateStaffProfile(client, userId, profile) {
  const result = await client.from('staff_profiles')
    .update({
      full_name: profile.name,
      role: profile.role,
      department_id: profile.departmentId || null,
    })
    .eq('user_id', userId)
    .select('user_id')
    .single()
  return unwrap(result)
}

export async function inviteStaffMember(client, staff) {
  const { data: sessionData, error: sessionError } = await client.auth.getSession()
  if (sessionError) throw sessionError
  const accessToken = sessionData.session?.access_token
  if (!accessToken) throw new Error('Your session has expired. Please sign in again.')

  const result = await client.functions.invoke('invite-staff', {
    body: staff,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!result.error) return result.data

  const context = result.error.context
  if (context instanceof Response) {
    try {
      const body = await context.clone().json()
      if (typeof body?.error === 'string') throw new Error(body.error)
    } catch (error) {
      if (error instanceof Error && error.message !== result.error.message) throw error
    }
  }
  throw result.error
}

export async function invitePatientAccount(client, { patientId, email }) {
  const { data: sessionData, error: sessionError } = await client.auth.getSession()
  if (sessionError) throw sessionError
  const accessToken = sessionData.session?.access_token
  if (!accessToken) throw new Error('Your session has expired. Please sign in again.')

  const result = await client.functions.invoke('invite-patient', {
    body: { patientId, email },
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!result.error) return result.data
  const context = result.error.context
  if (context instanceof Response) {
    try {
      const body = await context.clone().json()
      if (typeof body?.error === 'string') throw new Error(body.error)
    } catch (error) {
      if (error instanceof Error && error.message !== result.error.message) throw error
    }
  }
  throw result.error
}
export async function updateHospitalName(client, hospitalName) {
  const result = await client.from('hospital_settings')
    .update({ hospital_name: hospitalName })
    .eq('id', true)
    .select('hospital_name')
    .single()
  return unwrap(result)
}

export async function loadPublicHospitalProfile(client) {
  const result = await client.rpc('get_public_hospital_profile')
  return unwrap(result)?.[0] || { hospital_name: 'MediQ Hospital' }
}

export async function updateHospitalProfile(client, profile) {
  const result = await client.from('hospital_settings')
    .update({
      hospital_name: profile.hospital_name,
      hospital_address: profile.hospital_address,
      hospital_phone: profile.hospital_phone,
      hospital_email: profile.hospital_email,
      hospital_website: profile.hospital_website,
      hospital_description: profile.hospital_description,
      hospital_logo_url: profile.hospital_logo_url,
    })
    .eq('id', true)
    .select('hospital_name')
    .single()
  return unwrap(result)
}

export async function loadPublicQueue(client) {
  const result = await client.from('public_queue_display')
    .select('department_id,hospital_name,department_name,department_code,now_serving_token,next_token,updated_at')
    .order('department_name')
  return unwrap(result)
}

export async function loadPublicPatientTracking(client, accessToken) {
  const result = await client.rpc('get_public_patient_tracking', { p_access_token: accessToken })
  return unwrap(result)?.[0] || (() => { throw new Error('Patient tracking is unavailable.') })()
}


export async function loadPatientMedicalRecord(client, patientId) {
  const [patientResult, visitsResult, notesResult, reportsResult, documentsResult] = await Promise.all([
    client.from('patients').select('id,patient_code,full_name,age,gender,mobile,created_at').eq('id', patientId).single(),
    client.from('visits').select('id,patient_id,department_id,status,arrived_at,started_at,completed_at,doctor_user_id,department:departments(name)').eq('patient_id', patientId).order('arrived_at', { ascending: false }),
    client.from('patient_medical_notes').select('id,visit_id,author_user_id,category,title,content,visibility,created_at,updated_at').eq('patient_id', patientId).order('created_at', { ascending: false }),
    client.from('doctor_reports').select('id,visit_id,author_user_id,report_title,examination,diagnosis,treatment_plan,follow_up_instructions,follow_up_date,status,finalized_at,created_at,updated_at').eq('patient_id', patientId).order('created_at', { ascending: false }),
    client.from('patient_documents').select('id,visit_id,uploaded_by,file_name,mime_type,file_size_bytes,storage_path,visibility,created_at').eq('patient_id', patientId).order('created_at', { ascending: false }),
  ])
  return {
    patient: unwrap(patientResult),
    visits: unwrap(visitsResult) || [],
    notes: unwrap(notesResult) || [],
    reports: unwrap(reportsResult) || [],
    documents: unwrap(documentsResult) || [],
  }
}

export async function createDoctorReport(client, report) {
  const { data: sessionData, error: sessionError } = await client.auth.getSession()
  if (sessionError) throw sessionError
  const authorUserId = sessionData.session?.user?.id
  if (!authorUserId) throw new Error('Please sign in again before saving a report.')
  const result = await client.from('doctor_reports').insert({
    patient_id: report.patientId,
    visit_id: report.visitId,
    author_user_id: authorUserId,
    report_title: report.title || 'Consultation report',
    examination: report.examination || '',
    diagnosis: report.diagnosis || '',
    treatment_plan: report.treatmentPlan || '',
    follow_up_instructions: report.followUpInstructions || '',
    follow_up_date: report.followUpDate || null,
    status: 'draft',
  }).select('id').single()
  return unwrap(result)
}

export async function finalizeDoctorReport(client, reportId) {
  const result = await client.from('doctor_reports')
    .update({ status: 'finalized', finalized_at: new Date().toISOString() })
    .eq('id', reportId)
    .eq('status', 'draft')
    .select('id,status,finalized_at')
    .single()
  return unwrap(result)
}

export async function uploadPatientDocument(client, { patientId, visitId = null, file, visibility = 'patient_visible' }) {
  if (!(file instanceof File)) throw new Error('Choose a file to upload.')
  const allowedTypes = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ])
  if (!allowedTypes.has(file.type)) throw new Error('Upload a PDF, JPG, PNG, DOC, or DOCX file.')
  if (file.size <= 0 || file.size > 15 * 1024 * 1024) throw new Error('File size must be 15 MB or less.')
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180) || 'medical-document'
  const storagePath = `${patientId}/${crypto.randomUUID()}-${safeName}`
  const storage = client.storage.from('patient-medical-records')
  const uploadResult = await storage.upload(storagePath, file, { contentType: file.type, upsert: false })
  if (uploadResult.error) throw uploadResult.error
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession()
    if (sessionError) throw sessionError
    const uploadedBy = sessionData.session?.user?.id
    if (!uploadedBy) throw new Error('Please sign in again before uploading.')
    const result = await client.from('patient_documents').insert({
      patient_id: patientId,
      visit_id: visitId,
      uploaded_by: uploadedBy,
      file_name: file.name,
      mime_type: file.type,
      file_size_bytes: file.size,
      storage_path: storagePath,
      visibility,
    }).select('id').single()
    return unwrap(result)
  } catch (error) {
    await storage.remove([storagePath])
    throw error
  }
}

export async function getPatientDocumentDownloadUrl(client, storagePath) {
  const result = await client.storage.from('patient-medical-records').createSignedUrl(storagePath, 60)
  return unwrap(result).signedUrl
}


export async function createPatientVisitRequest(client, { departmentId, doctorUserId }) {
  const result = await client.rpc('create_patient_visit_request', {
    p_department_id: departmentId,
    p_doctor_user_id: doctorUserId,
  })
  return unwrap(result)?.[0]
}
