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
    priority: record.priority,
    status: record.status,
    queueDate: record.queue_date,
    createdAt: record.created_at,
    arrivalAt: record.visit.arrived_at,
    calledAt: record.called_at,
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
      .select('id,token,priority,status,queue_date,created_at,called_at,department:departments!queue_records_department_id_fkey(id,name,code),visit:visits!inner(id,arrived_at,patient:patients!inner(id,patient_code,full_name,age,gender,mobile))')
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

export async function registerPublicPatient(client, patient, idempotencyKey) {
  const result = await client.functions.invoke('public-register', {
    body: patient,
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

export async function setQueuePriority(client, queueId, priority) {
  const result = await client.rpc('set_queue_priority', {
    p_queue_record_id: queueId,
    p_priority: priority || null,
  })
  return unwrap(result)
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

export async function updateHospitalName(client, hospitalName) {
  const result = await client.from('hospital_settings')
    .update({ hospital_name: hospitalName })
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
