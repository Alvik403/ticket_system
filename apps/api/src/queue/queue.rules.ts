import type { TicketStatus } from '../domain/entities';

export type AssignmentAction =
  'CALL' | 'START' | 'COMPLETE' | 'REQUEUE' | 'NO_SHOW';

const transitions: Record<
  AssignmentAction,
  { from: TicketStatus[]; to: TicketStatus }
> = {
  CALL: { from: ['ASSIGNED'], to: 'CALLED' },
  START: { from: ['CALLED'], to: 'IN_SERVICE' },
  COMPLETE: { from: ['IN_SERVICE'], to: 'COMPLETED' },
  REQUEUE: { from: ['ASSIGNED', 'CALLED'], to: 'REQUEUED' },
  NO_SHOW: { from: ['CALLED', 'BOOKED'], to: 'NO_SHOW' },
};

export function nextTicketStatus(
  current: TicketStatus,
  action: AssignmentAction,
): TicketStatus | null {
  const transition = transitions[action];
  return transition.from.includes(current) ? transition.to : null;
}

export function canCancel(status: TicketStatus): boolean {
  return [
    'BOOKED',
    'WAITING',
    'CHECKED_IN',
    'ASSIGNED',
    'CALLED',
    'REQUEUED',
  ].includes(status);
}

export function canReleaseOnBreak(status: TicketStatus): boolean {
  return ['ASSIGNED', 'CALLED'].includes(status);
}

export function blocksBreak(status: TicketStatus): boolean {
  return status === 'IN_SERVICE';
}

export function checkInWindow(scheduledAt: Date, durationMinutes: number) {
  const start = scheduledAt.getTime() - 15 * 60_000;
  const end = scheduledAt.getTime() + durationMinutes * 60_000;
  return { start, end };
}

export function canCheckIn(
  status: TicketStatus,
  scheduledAt: Date | undefined,
  durationMinutes: number,
  now = Date.now(),
): boolean {
  if (status !== 'BOOKED' || !scheduledAt) return false;
  const window = checkInWindow(scheduledAt, durationMinutes);
  return now >= window.start && now <= window.end;
}

export function checkInWindowExpired(
  scheduledAt: Date | undefined,
  durationMinutes: number,
  now = Date.now(),
): boolean {
  if (!scheduledAt) return false;
  return now > scheduledAt.getTime() + durationMinutes * 60_000;
}
