import {
  canCancel,
  canCheckIn,
  canReleaseOnBreak,
  checkInWindowExpired,
  nextTicketStatus,
} from './queue.rules';

describe('queue state rules', () => {
  it('allows only the documented happy path', () => {
    expect(nextTicketStatus('ASSIGNED', 'CALL')).toBe('CALLED');
    expect(nextTicketStatus('CALLED', 'START')).toBe('IN_SERVICE');
    expect(nextTicketStatus('IN_SERVICE', 'COMPLETE')).toBe('COMPLETED');
  });

  it('rejects invalid or repeated commands', () => {
    expect(nextTicketStatus('WAITING', 'START')).toBeNull();
    expect(nextTicketStatus('BOOKED', 'CALL')).toBeNull();
    expect(nextTicketStatus('COMPLETED', 'COMPLETE')).toBeNull();
    expect(nextTicketStatus('NO_SHOW', 'CALL')).toBeNull();
  });

  it('returns a reassigned ticket to REQUEUED', () => {
    expect(nextTicketStatus('CALLED', 'REQUEUE')).toBe('REQUEUED');
    expect(nextTicketStatus('ASSIGNED', 'REQUEUE')).toBe('REQUEUED');
  });

  it('limits cancellation to pre-service states', () => {
    expect(canCancel('BOOKED')).toBe(true);
    expect(canCancel('CHECKED_IN')).toBe(true);
    expect(canCancel('WAITING')).toBe(true);
    expect(canCancel('CALLED')).toBe(true);
    expect(canCancel('IN_SERVICE')).toBe(false);
    expect(canCancel('COMPLETED')).toBe(false);
  });

  it('allows releasing assigned tickets on employee break', () => {
    expect(canReleaseOnBreak('ASSIGNED')).toBe(true);
    expect(canReleaseOnBreak('CALLED')).toBe(true);
    expect(canReleaseOnBreak('IN_SERVICE')).toBe(false);
  });

  it('opens check-in 15 minutes before the slot and closes at slot end', () => {
    const scheduledAt = new Date('2026-09-07T07:00:00.000Z');
    expect(canCheckIn('BOOKED', scheduledAt, 10, scheduledAt.getTime() - 16 * 60_000)).toBe(
      false,
    );
    expect(canCheckIn('BOOKED', scheduledAt, 10, scheduledAt.getTime() - 15 * 60_000)).toBe(
      true,
    );
    expect(canCheckIn('BOOKED', scheduledAt, 10, scheduledAt.getTime() + 10 * 60_000)).toBe(
      true,
    );
    expect(canCheckIn('BOOKED', scheduledAt, 10, scheduledAt.getTime() + 10 * 60_000 + 1)).toBe(
      false,
    );
    expect(canCheckIn('CHECKED_IN', scheduledAt, 10, scheduledAt.getTime())).toBe(false);
    expect(checkInWindowExpired(scheduledAt, 10, scheduledAt.getTime() + 10 * 60_000 + 1)).toBe(
      true,
    );
  });
});
