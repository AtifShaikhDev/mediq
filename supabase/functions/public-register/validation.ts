const genders = new Set(['Female', 'Male', 'Non-binary', 'Prefer not to say'])
const departments = new Set(['General Medicine', 'Emergency', 'Cardiology'])
const registrationFields = ['age', 'department', 'doctorUserId', 'fullName', 'gender', 'mobile']

export class RegistrationValidationError extends Error {}

export type NormalizedRegistration = {
  fullName: string
  age: number
  gender: string
  mobile: string
  department: string
  doctorUserId: string
}

export function normalizeRegistration(value: unknown): NormalizedRegistration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RegistrationValidationError('Registration details are invalid.')
  }

  const body = value as Record<string, unknown>
  const fields = Object.keys(body).sort()
  if (fields.length !== registrationFields.length || fields.some((field, index) => field !== registrationFields[index])) {
    throw new RegistrationValidationError('Registration details are invalid.')
  }

  if (typeof body.fullName !== 'string') {
    throw new RegistrationValidationError('Enter your full name.')
  }
  const fullName = body.fullName.trim().replace(/\s+/gu, ' ')
  if (!fullName || fullName.length > 120 || /[\u0000-\u001f\u007f]/u.test(fullName)) {
    throw new RegistrationValidationError('Enter a valid full name.')
  }

  if (typeof body.age !== 'number' || !Number.isInteger(body.age) || body.age < 0 || body.age > 120) {
    throw new RegistrationValidationError('Enter a valid age.')
  }

  if (typeof body.gender !== 'string' || !genders.has(body.gender)) {
    throw new RegistrationValidationError('Select a valid gender.')
  }

  if (typeof body.mobile !== 'string') {
    throw new RegistrationValidationError('Enter a valid Indian mobile number.')
  }
  const mobileDigits = body.mobile.replace(/[\s().-]/g, '')
  const mobileMatch = mobileDigits.match(/^(?:\+?91)?([6-9]\d{9})$/)
  if (!mobileMatch) {
    throw new RegistrationValidationError('Enter a valid 10-digit Indian mobile number.')
  }

  if (typeof body.department !== 'string' || !departments.has(body.department)) {
    throw new RegistrationValidationError('Select a valid department.')
  }

  if (typeof body.doctorUserId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.doctorUserId)) {
    throw new RegistrationValidationError('Select a valid doctor.')
  }

  return {
    fullName,
    age: body.age,
    gender: body.gender,
    mobile: `+91${mobileMatch[1]}`,
    department: body.department,
    doctorUserId: body.doctorUserId,
  }
}
