export type AuditTone = 'admin' | 'staff' | 'ticket' | 'view' | 'system'

export function auditPresentation(action: string): {
  label: string
  tone: AuditTone
} {
  const exact: Record<string, { label: string; tone: AuditTone }> = {
    AUDIT_VIEWED: { label: 'Просмотр журнала', tone: 'view' },
    ADMIN_QUEUE_VIEWED: { label: 'Просмотр очереди', tone: 'view' },
    EMPLOYEE_METRICS_VIEWED: { label: 'Просмотр метрик', tone: 'view' },
    QUEUE_OVERVIEW_VIEWED: { label: 'Просмотр сводки', tone: 'view' },
    DESK_CREATED: { label: 'Стол создан', tone: 'admin' },
    DESK_UPDATED: { label: 'Стол изменён', tone: 'admin' },
    DESK_DELETED: { label: 'Стол удалён', tone: 'admin' },
    EMPLOYEE_COUNTRY_UPDATED: { label: 'Направление менеджера', tone: 'admin' },
    EMPLOYEE_DESK_ASSIGNED: { label: 'Стол назначен', tone: 'admin' },
    EMPLOYEE_STATUS_CHANGED: { label: 'Статус сотрудника', tone: 'staff' },
    MANAGER_CREATED: { label: 'Менеджер создан', tone: 'admin' },
    MANAGER_PASSWORD_RESET: { label: 'Сброс пароля', tone: 'admin' },
    BLOCKED_SLOT_CREATED: { label: 'Блокировка слота', tone: 'system' },
    BLOCKED_SLOT_DELETED: { label: 'Блокировка снята', tone: 'system' },
    TICKET_NO_SHOW: { label: 'Неявка клиента', tone: 'ticket' },
    TICKET_STATUS_SET: { label: 'Статус записи', tone: 'ticket' },
    TICKET_RESCHEDULED: { label: 'Перенос записи', tone: 'ticket' },
    ASSIGNMENT_CALL: { label: 'Вызов клиента', tone: 'staff' },
    ASSIGNMENT_START: { label: 'Начало приёма', tone: 'staff' },
    ASSIGNMENT_COMPLETE: { label: 'Завершение приёма', tone: 'staff' },
    ASSIGNMENT_REQUEUE: { label: 'Возврат в очередь', tone: 'staff' },
    ASSIGNMENT_NO_SHOW: { label: 'Неявка после вызова', tone: 'ticket' },
  }
  if (exact[action]) return exact[action]
  if (action.startsWith('ASSIGNMENT_')) {
    return { label: 'Действие с талоном', tone: 'staff' }
  }
  return { label: action.replaceAll('_', ' ').toLowerCase(), tone: 'system' }
}
