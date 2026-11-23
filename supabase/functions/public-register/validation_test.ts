import { normalizeRegistration, RegistrationValidationError } from './validation.ts'

function assertEqual(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`)
  }
}

function assertInvalid(input: unknown) {
  try {
    normalizeRegistration(input)
  } catch (error) {
    if (error instanceof RegistrationValidationError) return
    throw error
  }
  throw new Error('Expected registration validation to fail.')
}

Deno.test('normalizes valid Indian mobile numbers and names', () => {
  const normalized = normalizeRegistration({
    fullName: '  Test   Patient ',
    age: 30,
    gender: 'Female',
    mobile: '+91 98765 43210',
    department: 'Emergency',
    doctorUserId: '11111111-1111-4111-8111-111111111111',
  })
  assertEqual(normalized.fullName, 'Test Patient')
  assertEqual(normalized.mobile, '+919876543210')
  assertEqual(normalized.department, 'Emergency')
  assertEqual(normalized.doctorUserId, '11111111-1111-4111-8111-111111111111')
})

Deno.test('accepts a local 10-digit Indian mobile number', () => {
  const normalized = normalizeRegistration({
    fullName: 'Test Patient',
    age: 30,
    gender: 'Male',
    mobile: '9876543210',
    department: 'General Medicine',
    doctorUserId: '11111111-1111-4111-8111-111111111111',
  })
  assertEqual(normalized.mobile, '+919876543210')
})

Deno.test('rejects invalid age, phone, department, and unexpected fields', () => {
  const valid = {
    fullName: 'Test Patient',
    age: 30,
    gender: 'Female',
    mobile: '9876543210',
    department: 'Cardiology',
    doctorUserId: '11111111-1111-4111-8111-111111111111',
  }
  assertInvalid({ ...valid, age: 30.5 })
  assertInvalid({ ...valid, mobile: '12345' })
  assertInvalid({ ...valid, department: 'Unlisted department' })
  assertInvalid({ ...valid, diagnosis: 'not accepted' })
  assertInvalid({ ...valid, doctorUserId: 'not-a-uuid' })
})
