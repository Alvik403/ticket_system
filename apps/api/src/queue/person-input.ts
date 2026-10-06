import { BadRequestException } from '@nestjs/common';
import type { ClientCountry } from '../domain/entities';

export const NAME_MAX_LENGTH = 40;

const NAME_PATTERN = /^[A-Za-zА-Яа-яЁё]+(?:[ -][A-Za-zА-Яа-яЁё]+)*$/;

type NameKind = 'last' | 'first' | 'patronymic';

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
};

export function nameFieldError(value: string, kind: NameKind): string | null {
  const text = value.trim();
  if (text.length < 2) return 'Введите больше символов';
  if (text.length > NAME_MAX_LENGTH) return NAME_MESSAGES[kind].long;
  if (!NAME_PATTERN.test(text)) return NAME_MESSAGES[kind].invalid;
  return null;
}

export function normalizePhoneDigits(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (!digits.startsWith('7') && digits.length === 10) digits = `7${digits}`;
  return digits;
}

export function phoneFieldError(value: string): string | null {
  return /^79\d{9}$/.test(normalizePhoneDigits(value))
    ? null
    : 'Некорректный номер телефона';
}

export function travelDatesError(
  country: ClientCountry,
  departureDate: string,
  arrivalDate: string,
): string | null {
  if (!departureDate || !arrivalDate) return 'Укажите даты выезда и приезда';
  if (country === 'CN' && arrivalDate <= departureDate) {
    return 'Заграничные выезд оформляются больше одного дня';
  }
  if (arrivalDate < departureDate) {
    return 'Дата приезда не может быть раньше даты выезда';
  }
  return null;
}

export function assertPersonInput(input: {
  lastName: string;
  firstName: string;
  patronymic: string;
  phone: string;
  country?: ClientCountry;
  departureDate?: string;
  arrivalDate?: string;
  requireTravelDates?: boolean;
}): { fullName: string; phone: string } {
  const error =
    nameFieldError(input.lastName, 'last') ??
    nameFieldError(input.firstName, 'first') ??
    nameFieldError(input.patronymic, 'patronymic') ??
    phoneFieldError(input.phone) ??
    (input.requireTravelDates
      ? travelDatesError(
          input.country ?? 'RF',
          input.departureDate ?? '',
          input.arrivalDate ?? '',
        )
      : null);
  if (error) throw new BadRequestException(error);
  return {
    fullName: [input.lastName, input.firstName, input.patronymic]
      .map((part) => part.trim())
      .join(' '),
    phone: normalizePhoneDigits(input.phone),
  };
}
