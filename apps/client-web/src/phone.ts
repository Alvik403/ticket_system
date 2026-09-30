export const PHONE_DIGITS_TOTAL = 11

export function normalizePhoneDigits(value: string): string {
  let digits = value.replace(/\D/g, '')
  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`
  if (digits.startsWith('7')) return digits.slice(0, PHONE_DIGITS_TOTAL)
  if (digits.length === 10) return `7${digits}`
  return digits.slice(0, PHONE_DIGITS_TOTAL)
}

export function formatPhoneInput(value: string): string {
  const digits = normalizePhoneDigits(value)
  if (!digits) return ''
  if (digits.length <= 1) return '+7'
  const rest = digits.slice(1)
  let out = '+7'
  if (rest.length > 0) out += ` (${rest.slice(0, 3)}`
  if (rest.length >= 3) out += `) ${rest.slice(3, 6)}`
  if (rest.length >= 6) out += `-${rest.slice(6, 8)}`
  if (rest.length >= 8) out += `-${rest.slice(8, 10)}`
  return out
}
