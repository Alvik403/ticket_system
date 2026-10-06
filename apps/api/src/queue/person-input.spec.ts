import { BadRequestException } from '@nestjs/common';
import { assertPersonInput, phoneFieldError } from './person-input';

describe('person input', () => {
  const valid = {
    lastName: 'Иванов',
    firstName: 'Иван',
    patronymic: 'Иванович',
    phone: '+7 (900) 000-00-00',
  };

  it('accepts a mobile phone and joins the name', () => {
    expect(assertPersonInput(valid)).toEqual({
      fullName: 'Иванов Иван Иванович',
      phone: '79000000000',
    });
  });

  it('rejects digits, short values, long values, and non-mobile phones', () => {
    expect(() =>
      assertPersonInput({ ...valid, firstName: 'Иван1' }),
    ).toThrow(new BadRequestException('Некорректное имя'));
    expect(() =>
      assertPersonInput({ ...valid, lastName: 'А' }),
    ).toThrow(new BadRequestException('Введите больше символов'));
    expect(() =>
      assertPersonInput({ ...valid, firstName: 'И'.repeat(41) }),
    ).toThrow(new BadRequestException('Слишком длинное имя'));
    expect(phoneFieldError('71111111111')).toBe('Некорректный номер телефона');
  });

  it('requires a later arrival date for foreign travel', () => {
    expect(() =>
      assertPersonInput({
        ...valid,
        country: 'CN',
        departureDate: '2026-10-02',
        arrivalDate: '2026-10-02',
        requireTravelDates: true,
      }),
    ).toThrow(
      new BadRequestException(
        'Заграничные выезд оформляются больше одного дня',
      ),
    );
  });
});
