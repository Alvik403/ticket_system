import type { ClientCountry, TicketStatus } from '../domain/entities';
import { kanbanColumnFor, ticketKind, type TicketKind } from './ticket-presentation';

export type BoardColumnId = 'booked' | 'approach' | 'service';

export const BOARD_COLUMNS: Array<{
  id: BoardColumnId;
  title: string;
  statuses: TicketStatus[];
}> = [
  { id: 'booked', title: 'Запись', statuses: ['BOOKED'] },
  { id: 'approach', title: 'Подойти', statuses: ['CALLED', 'ASSIGNED'] },
  { id: 'service', title: 'Приём', statuses: ['IN_SERVICE'] },
];

export function lastNameFromFullName(fullName?: string | null): string {
  const first = fullName?.trim().split(/\s+/)[0];
  return first || '—';
}

export function boardFullName(fullName?: string | null): string {
  return fullName?.trim() || '—';
}

export function boardCountryLabel(country?: ClientCountry | null): string {
  if (country === 'CN') return 'Заграничная';
  if (country === 'RF') return 'РФ';
  return '—';
}

export function formatBoardSlotTime(
  value?: Date | null,
  timeZone = 'Europe/Moscow',
): string | null {
  if (!value) return null;
  return value.toLocaleString('ru-RU', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function deskNumberFrom(desk?: {
  displayNumber?: number | null;
  label?: string;
} | null): number | null {
  if (!desk) return null;
  if (typeof desk.displayNumber === 'number' && desk.displayNumber > 0) {
    return desk.displayNumber;
  }
  const match = desk.label?.match(/(\d+)\s*$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function boardColumnFor(status: TicketStatus): BoardColumnId | null {
  for (const column of BOARD_COLUMNS) {
    if (column.statuses.includes(status)) return column.id;
  }
  return null;
}

export type PublicBoardTicket = {
  number: string;
  fullName: string;
  countryLabel: string;
  scheduledTime: string | null;
  deskNumber: number | null;
  kind: TicketKind;
};

export type PublicBoardColumn = {
  id: BoardColumnId;
  title: string;
  showDesk: boolean;
  tickets: PublicBoardTicket[];
};

export type BoardTicketSource = {
  number: string;
  status: TicketStatus;
  fullName?: string | null;
  country?: ClientCountry | null;
  scheduledAt?: Date | null;
  desk?: { displayNumber?: number | null; label?: string } | null;
  siteTimeZone?: string;
};

export function buildPublicBoardColumns(
  tickets: BoardTicketSource[],
  day?: { start: Date; end: Date },
  now = Date.now(),
): PublicBoardColumn[] {
  const grouped = new Map<BoardColumnId, BoardTicketSource[]>(
    BOARD_COLUMNS.map((column) => [column.id, []]),
  );
  for (const ticket of tickets) {
    const kind = ticketKind(ticket.scheduledAt);
    const columnId = kanbanColumnFor(
      ticket.status,
      kind,
      ticket.scheduledAt ?? null,
      day,
      now,
    );
    if (!columnId) continue;
    grouped.get(columnId)?.push(ticket);
  }
  return BOARD_COLUMNS.map((column) => {
    const showDesk = column.id === 'approach';
    const rows = grouped.get(column.id) ?? [];
    return {
      id: column.id,
      title: column.title,
      showDesk,
      tickets: rows.map((ticket) => ({
        number: ticket.number,
        fullName: boardFullName(ticket.fullName),
        countryLabel: boardCountryLabel(ticket.country),
        scheduledTime: formatBoardSlotTime(
          ticket.scheduledAt,
          ticket.siteTimeZone ?? 'Europe/Moscow',
        ),
        deskNumber: showDesk ? deskNumberFrom(ticket.desk) : null,
        kind: ticketKind(ticket.scheduledAt),
      })),
    };
  });
}
