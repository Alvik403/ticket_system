export const ticketStatusLabel: Record<string, string> = {
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
}

export const employeeStatusLabel: Record<string, string> = {
  OFFLINE: 'Не в сети',
  AVAILABLE: 'Готов',
  RESERVED: 'Зарезервирован',
  BUSY: 'Занят',
  PAUSED: 'Пауза',
}

export const assignmentActionLabel: Record<string, string> = {
  CALL: 'Вызвать',
  START: 'Начать',
  COMPLETE: 'Завершить',
  REQUEUE: 'Вернуть в очередь',
  NO_SHOW: 'Не явился',
}

export function pluralClients(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} клиент`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} клиента`
  }
  return `${count} клиентов`
}
