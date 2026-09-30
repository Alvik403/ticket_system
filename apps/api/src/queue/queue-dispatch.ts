import type { SelectQueryBuilder } from 'typeorm';
import type { ClientCountry } from '../domain/entities';
import { Ticket } from '../domain/entities';

/** Направление менеджера: профиль или стол */
export function employeeWorkCountry(
  employee: {
    country?: ClientCountry | null;
    desk?: { country?: ClientCountry } | null;
  },
): ClientCountry | null {
  return employee.country ?? employee.desk?.country ?? null;
}

/** Завершённые / неявки — вниз списка менеджера */
export const MANAGER_LIST_BOTTOM_STATUSES = [
  'NO_SHOW',
  'COMPLETED',
  'CANCELLED',
] as const;

/** Вызов / обслуживание — сверху, только у вызвавшего менеджера */
export const MANAGER_IN_PROGRESS_STATUSES = [
  'CALLED',
  'ASSIGNED',
  'IN_SERVICE',
] as const;

function managerListSortTier(status?: string): number {
  if (
    status &&
    (MANAGER_LIST_BOTTOM_STATUSES as readonly string[]).includes(status)
  ) {
    return 2;
  }
  if (
    status &&
    (MANAGER_IN_PROGRESS_STATUSES as readonly string[]).includes(status)
  ) {
    return 0;
  }
  return 1;
}

export function activeAssignmentEmployeeId(
  assignments?: Array<{ active: boolean; employee?: { id: string } | null }>,
): string | null {
  const row = assignments?.find((assignment) => assignment.active);
  return row?.employee?.id ?? null;
}

/** Скрыть у других менеджеров, если клиент уже вызван/обслуживается */
export function managerTicketVisibleInList(
  ticket: {
    status: string;
    assignments?: Array<{ active: boolean; employee?: { id: string } | null }>;
  },
  viewerEmployeeId: string,
): boolean {
  if (
    !(MANAGER_IN_PROGRESS_STATUSES as readonly string[]).includes(ticket.status)
  ) {
    return true;
  }
  const ownerId = activeAssignmentEmployeeId(ticket.assignments);
  if (!ownerId) return true;
  return ownerId === viewerEmployeeId;
}

/** Сортировка списка менеджера по времени слота (без слота — в конец дня) */
export function compareManagerTickets(
  left: { scheduledAt?: Date | null; createdAt: Date; status?: string },
  right: { scheduledAt?: Date | null; createdAt: Date; status?: string },
): number {
  const leftDone = managerListSortTier(left.status);
  const rightDone = managerListSortTier(right.status);
  if (leftDone !== rightDone) return leftDone - rightDone;
  const leftHasSlot = left.scheduledAt ? 0 : 1;
  const rightHasSlot = right.scheduledAt ? 0 : 1;
  if (leftHasSlot !== rightHasSlot) return leftHasSlot - rightHasSlot;
  const leftTime = left.scheduledAt?.getTime() ?? left.createdAt.getTime();
  const rightTime = right.scheduledAt?.getTime() ?? right.createdAt.getTime();
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.createdAt.getTime() - right.createdAt.getTime();
}

/** Очередь на стол: запись ближе по слоту важнее walk-in */
export function applyQueueDispatchOrder(
  query: SelectQueryBuilder<Ticket>,
  alias = 'ticket',
): SelectQueryBuilder<Ticket> {
  return query
    .addOrderBy(
      `CASE WHEN ${alias}.scheduledAt IS NOT NULL THEN 0 ELSE 1 END`,
      'ASC',
    )
    .addOrderBy(`${alias}.priority`, 'DESC')
    .addOrderBy(`${alias}.scheduledAt`, 'ASC', 'NULLS LAST')
    .addOrderBy(`${alias}.createdAt`, 'ASC');
}
