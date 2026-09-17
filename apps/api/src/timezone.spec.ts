import { zonedDateTime } from './timezone';

describe('zonedDateTime', () => {
  it('builds Moscow wall time without a hardcoded +03:00 offset', () => {
    const value = zonedDateTime('2026-09-07', '10:00', 'Europe/Moscow');
    expect(
      value.toLocaleString('en-GB', {
        timeZone: 'Europe/Moscow',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    ).toBe('10:00');
    expect(value.toISOString()).toBe('2026-09-07T07:00:00.000Z');
  });
});
