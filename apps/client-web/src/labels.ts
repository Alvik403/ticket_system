export const ticketStatusLabel: Record<string, string> = {
  BOOKED: 'Запись',
  WAITING: 'Ожидает',
  CHECKED_IN: 'Вы в очереди',
  REQUEUED: 'Повторно в очереди',
  ASSIGNED: 'Назначен',
  CALLED: 'Вызван',
  IN_SERVICE: 'Обслуживается',
  COMPLETED: 'Завершён',
  CANCELLED: 'Отменён',
  NO_SHOW: 'Не явился',
}

export const countryLabel: Record<'RF' | 'CN', string> = {
  RF: 'РФ',
  CN: 'Китай',
}

export const ticketSteps = [
  { key: 'BOOKED', label: 'Запись' },
  { key: 'CHECKED_IN', label: 'Явка' },
  { key: 'CALLED', label: 'Вызов' },
  { key: 'IN_SERVICE', label: 'Приём' },
  { key: 'COMPLETED', label: 'Готово' },
]

export function stepIndex(status: string) {
  if (['BOOKED', 'WAITING'].includes(status)) return 0
  if (['CHECKED_IN', 'REQUEUED', 'ASSIGNED'].includes(status)) return 1
  if (status === 'CALLED') return 2
  if (status === 'IN_SERVICE') return 3
  if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(status)) return 4
  return 0
}
