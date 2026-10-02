import type { TicketStatus } from '../domain/entities';
import type { BoardColumnId } from './queue.display';

export type TicketKind = 'booking' | 'walkIn';

export function ticketKind(scheduledAt?: Date | string | null): TicketKind {
  return scheduledAt ? 'booking' : 'walkIn';
}

const fallbackStatusLabel: Record<TicketStatus, string> = {
  BOOKED: 'Запись',
  WAITING: 'Ожидает',
  CHECKED_IN: 'В очереди',
  REQUEUED: 'Повторно в очереди',
  ASSIGNED: 'Назначен',
  CALLED: 'Вызов',
  IN_SERVICE: 'Обслуживается',
  COMPLETED: 'Завершён',
  CANCELLED: 'Отменён',
  NO_SHOW: 'Не явился',
};

/** Подписи для клиента на экране талона */
export function clientStatusLabel(
  status: TicketStatus,
  kind: TicketKind,
): string {
  if (kind === 'walkIn') {
    const walkIn: Partial<Record<TicketStatus, string>> = {
      CHECKED_IN: 'В очереди',
      REQUEUED: 'Снова в очереди',
      ASSIGNED: 'Скоро вызовут',
      CALLED: 'Вас вызывают',
      IN_SERVICE: 'Обслуживается',
      COMPLETED: 'Завершён',
      CANCELLED: 'Отменён',
      NO_SHOW: 'Не явились',
    };
    return walkIn[status] ?? fallbackStatusLabel[status];
  }

  const booking: Partial<Record<TicketStatus, string>> = {
    BOOKED: 'Запись подтверждена',
    WAITING: 'Ожидает явки',
    CHECKED_IN: 'Ожидаете свободный стол',
    REQUEUED: 'Снова ждёте стол',
    ASSIGNED: 'Подойдите к столу',
    CALLED: 'Подойдите к столу',
    IN_SERVICE: 'Обслуживается',
    COMPLETED: 'Завершён',
    CANCELLED: 'Запись отменена',
    NO_SHOW: 'Не явились',
  };
  return booking[status] ?? fallbackStatusLabel[status];
}

const MANAGER_TERMINAL: TicketStatus[] = ['COMPLETED', 'CANCELLED', 'NO_SHOW'];

/** Короткие подписи для менеджера */
export function managerSimpleLabel(
  status: TicketStatus,
  kind: TicketKind,
): string {
  if (kind === 'walkIn') {
    const walkIn: Partial<Record<TicketStatus, string>> = {
      CHECKED_IN: 'В очереди',
      REQUEUED: 'В очереди',
      ASSIGNED: 'В очереди',
      CALLED: 'Вызов',
      IN_SERVICE: 'Обработка',
      COMPLETED: 'Готово',
      CANCELLED: 'Отменено',
      NO_SHOW: 'Не явился',
    };
    return walkIn[status] ?? fallbackStatusLabel[status];
  }

  const booking: Partial<Record<TicketStatus, string>> = {
    BOOKED: 'Ожидает',
    WAITING: 'Ожидает',
    CHECKED_IN: 'В очереди',
    REQUEUED: 'В очереди',
    ASSIGNED: 'Вызов',
    CALLED: 'Вызов',
    IN_SERVICE: 'Обработка',
    COMPLETED: 'Готово',
    CANCELLED: 'Отменено',
    NO_SHOW: 'Не явился',
  };
  return booking[status] ?? fallbackStatusLabel[status];
}

export function staffStatusLabel(
  status: TicketStatus,
  kind: TicketKind,
): string {
  return managerSimpleLabel(status, kind);
}

/** Когда показывать клиенту номер/название стола */
export function clientShowsDesk(
  status: TicketStatus,
  kind: TicketKind,
): boolean {
  if (['IN_SERVICE', 'COMPLETED'].includes(status)) return true;
  if (kind === 'walkIn') return status === 'CALLED';
  return ['ASSIGNED', 'CALLED', 'IN_SERVICE'].includes(status);
}

/** Шаги прогресса на карточке клиента (0-based index) */
export function clientProgressStep(
  status: TicketStatus,
  kind: TicketKind,
): number {
  if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(status)) return 3;
  if (status === 'IN_SERVICE') return 2;
  if (kind === 'walkIn') {
    if (status === 'CALLED') return 1;
    return 0;
  }
  if (['ASSIGNED', 'CALLED'].includes(status)) return 1;
  return 0;
}

export function clientProgressLabels(kind: TicketKind): string[] {
  if (kind === 'walkIn') {
    return ['Очередь', 'Вызов', 'Приём', 'Итог'];
  }
  return ['Ожидание', 'К столу', 'Приём', 'Итог'];
}

function ticketOnBoardDay(
  scheduledAt: Date | null | undefined,
  day?: { start: Date; end: Date },
): boolean {
  if (!day || !scheduledAt) return true;
  const time = scheduledAt.getTime();
  return time >= day.start.getTime() && time < day.end.getTime();
}

/** Колонка канбана с учётом типа талона */
export function kanbanColumnFor(
  status: TicketStatus,
  kind: TicketKind,
  scheduledAt?: Date | null,
  day?: { start: Date; end: Date },
): BoardColumnId | null {
  if (scheduledAt && day && !ticketOnBoardDay(scheduledAt, day)) {
    return null;
  }
  if (status === 'BOOKED') {
    if (kind !== 'booking' || !scheduledAt || !day) return null;
    return 'booked';
  }
  if (status === 'IN_SERVICE') return 'service';
  if (status === 'CALLED') return 'approach';
  if (status === 'ASSIGNED') {
    return kind === 'booking' ? 'approach' : 'queue';
  }
  if (['WAITING', 'CHECKED_IN', 'REQUEUED'].includes(status)) return 'queue';
  return null;
}

export function bookingAllowsStartWithoutCall(
  scheduledAt?: Date | string | null,
): boolean {
  return Boolean(scheduledAt);
}

export function ticketKindLabel(kind: TicketKind): string {
  return kind === 'walkIn' ? 'Живая очередь' : 'Запись';
}

/** Подпись кнопки действия менеджера (не сырой статус) */
export function managerActionLabel(
  to: TicketStatus,
  kind: TicketKind,
  from: TicketStatus,
): string {
  if (to === 'IN_SERVICE') return 'Обработка';
  if (to === 'NO_SHOW') return 'Не явился';
  if (to === 'COMPLETED') return 'Готово';
  if (to === 'REQUEUED') return 'Вернуть в очередь';
  if (to === 'CALLED') return 'Вызов';
  if (to === 'ASSIGNED' && kind === 'booking') return 'Вызов';
  if (to === 'CHECKED_IN' && ['BOOKED', 'WAITING'].includes(from)) {
    return 'Клиент пришёл';
  }
  if (to === 'CHECKED_IN' && ['CALLED', 'ASSIGNED'].includes(from)) {
    return 'Вернуть в очередь';
  }
  return managerSimpleLabel(to, kind);
}

/** Следующие статусы, доступные менеджеру из текущего */
export function managerNextStatuses(
  kind: TicketKind,
  from: TicketStatus,
): TicketStatus[] {
  if (MANAGER_TERMINAL.includes(from)) return [];

  if (kind === 'walkIn') {
    const walkIn: Partial<Record<TicketStatus, TicketStatus[]>> = {
      CHECKED_IN: ['CALLED', 'NO_SHOW'],
      REQUEUED: ['CALLED', 'NO_SHOW'],
      ASSIGNED: ['CALLED', 'REQUEUED', 'NO_SHOW'],
      CALLED: ['IN_SERVICE', 'REQUEUED', 'NO_SHOW'],
      IN_SERVICE: ['COMPLETED'],
    };
    return walkIn[from] ?? [];
  }

  const booking: Partial<Record<TicketStatus, TicketStatus[]>> = {
    BOOKED: ['CHECKED_IN', 'NO_SHOW'],
    WAITING: ['CHECKED_IN', 'NO_SHOW'],
    CHECKED_IN: ['ASSIGNED', 'NO_SHOW'],
    REQUEUED: ['ASSIGNED', 'NO_SHOW'],
    ASSIGNED: ['IN_SERVICE', 'REQUEUED', 'NO_SHOW'],
    CALLED: ['IN_SERVICE', 'REQUEUED', 'NO_SHOW'],
    IN_SERVICE: ['COMPLETED'],
  };
  return booking[from] ?? [];
}

export function validateManagerStatusChange(
  kind: TicketKind,
  from: TicketStatus,
  to: TicketStatus,
): string | null {
  if (from === to) return null;
  if (MANAGER_TERMINAL.includes(from)) {
    return 'Талон уже закрыт — менять статус нельзя.';
  }
  if (MANAGER_TERMINAL.includes(to) && from === 'BOOKED') {
    if (to === 'COMPLETED' || to === 'IN_SERVICE') {
      return 'Сначала отметьте, что клиент явился.';
    }
  }
  const allowed = managerNextStatuses(kind, from);
  if (!allowed.includes(to)) {
    const hints = allowed.map((status) =>
      managerActionLabel(status, kind, from),
    );
    if (!hints.length) {
      return `Сейчас «${managerSimpleLabel(from, kind)}» — дальше менять нельзя.`;
    }
    return `Из «${managerSimpleLabel(from, kind)}» можно только: ${hints.join(', ')}.`;
  }
  return null;
}

export function managerStatusHint(
  kind: TicketKind,
  from: TicketStatus,
): string {
  if (MANAGER_TERMINAL.includes(from)) {
    return 'Талон закрыт — новый статус не нужен.';
  }
  const next = managerNextStatuses(kind, from);
  if (!next.length) {
    return 'Дальше менять статус нельзя.';
  }
  return next
    .map((status) => managerActionLabel(status, kind, from))
    .join(' · ');
}

export function managerStatusPickerOptions(
  kind: TicketKind,
  current: TicketStatus,
) {
  const next = managerNextStatuses(kind, current);
  return [
    { value: current, label: managerSimpleLabel(current, kind), current: true },
    ...next.map((value) => ({
      value,
      label: managerActionLabel(value, kind, current),
      current: false,
    })),
  ];
}

/** @deprecated используйте managerNextStatuses */
export function managerAllowedStatuses(kind: TicketKind): TicketStatus[] {
  if (kind === 'walkIn') {
    return [
      'CHECKED_IN',
      'CALLED',
      'IN_SERVICE',
      'COMPLETED',
      'NO_SHOW',
      'CANCELLED',
    ];
  }
  return [
    'BOOKED',
    'CHECKED_IN',
    'ASSIGNED',
    'IN_SERVICE',
    'COMPLETED',
    'NO_SHOW',
    'CANCELLED',
  ];
}

export function managerStatusOptions(kind: TicketKind, current?: TicketStatus) {
  if (current) return managerStatusPickerOptions(kind, current);
  return managerAllowedStatuses(kind).map((status) => ({
    value: status,
    label: managerSimpleLabel(status, kind),
    current: false,
  }));
}
