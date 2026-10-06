export const NAME_MAX_LENGTH = 40

const NAME_PATTERN = /^[A-Za-zА-Яа-яЁё]+(?:[ -][A-Za-zА-Яа-яЁё]+)*$/

export type NameKind = 'last' | 'first' | 'patronymic'

const NAME_MESSAGES: Record<NameKind, { invalid: string; long: string }> = {
  last: {
    invalid: 'Некорректная фамилия',
    long: 'Слишком длинное фамилию',
  },
  first: {
    invalid: 'Некорректное имя',
    long: 'Слишком длинное имя',
  },
  patronymic: {
    invalid: 'Некорректное отчество',
    long: 'Слишком длинное отчество',
  },
}

export function nameFieldError(value: string, kind: NameKind): string | null {
  const text = value.trim()
  if (text.length < 2) return 'Введите больше символов'
  if (text.length > NAME_MAX_LENGTH) return NAME_MESSAGES[kind].long
  if (!NAME_PATTERN.test(text)) return NAME_MESSAGES[kind].invalid
  return null
}

export function phoneFieldError(digits: string): string | null {
  return /^79\d{9}$/.test(digits) ? null : 'Некорректный номер телефона'
}

export function travelDatesError(
  country: 'RF' | 'CN' | '',
  departureDate: string,
  arrivalDate: string,
): string | null {
  if (!departureDate || !arrivalDate) return 'Укажите даты выезда и приезда'
  if (country === 'CN' && arrivalDate <= departureDate) {
    return 'Заграничные выезд оформляются больше одного дня'
  }
  if (arrivalDate < departureDate) {
    return 'Дата приезда не может быть раньше даты выезда'
  }
  return null
}

export function contactFieldsError(input: {
  lastName: string
  firstName: string
  patronymic: string
  phoneDigits: string
  country?: 'RF' | 'CN' | ''
  departureDate?: string
  arrivalDate?: string
  requireTravelDates?: boolean
}): string | null {
  return (
    nameFieldError(input.lastName, 'last') ??
    nameFieldError(input.firstName, 'first') ??
    nameFieldError(input.patronymic, 'patronymic') ??
    phoneFieldError(input.phoneDigits) ??
    (input.requireTravelDates
      ? travelDatesError(
          input.country ?? '',
          input.departureDate ?? '',
          input.arrivalDate ?? '',
        )
      : null)
  )
}
