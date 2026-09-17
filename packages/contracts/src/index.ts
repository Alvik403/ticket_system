export type TicketStatus =
  | 'BOOKED'
  | 'WAITING'
  | 'CHECKED_IN'
  | 'ASSIGNED'
  | 'CALLED'
  | 'IN_SERVICE'
  | 'COMPLETED'
  | 'REQUEUED'
  | 'NO_SHOW'
  | 'CANCELLED';

export type EmployeeStatus =
  | 'OFFLINE'
  | 'AVAILABLE'
  | 'RESERVED'
  | 'BUSY'
  | 'PAUSED';

export type Role = 'EMPLOYEE' | 'ADMIN' | 'AUDITOR';

export interface PublicTicket {
  number: string;
  status: TicketStatus;
  serviceName: string;
  deskLabel?: string;
  createdAt: string;
  fullName?: string;
  travelHistory?: string;
  scheduledAt?: string;
  lookupCode?: string;
  canCheckIn?: boolean;
  queuePosition?: number;
}

export interface CreateTicketRequest {
  siteId: string;
  serviceTypeId: string;
  country: 'RF' | 'CN';
  fullName: string;
  travelHistory: string;
  scheduledAt: string;
  holdId: string;
  personalDataConsent: true;
}

export interface CreateTicketResponse extends PublicTicket {}

export interface HoldSlotRequest {
  siteId: string;
  country: 'RF' | 'CN';
  scheduledAt: string;
}

export interface HoldSlotResponse {
  holdId: string;
  deskId: string;
  scheduledAt: string;
  expiresAt: string;
  expiresInSeconds: number;
  canRefresh: boolean;
}

export interface LookupTicketRequest {
  number: string;
  lookupCode: string;
}

export interface PublicScheduleSlot {
  scheduledAt: string;
  durationMinutes: number;
  occupied: true;
}

export interface CurrentAssignment {
  id: string;
  ticketNumber: string;
  serviceName: string;
  status: TicketStatus;
  assignedAt: string;
}

export interface EmployeeMetrics {
  completed: number;
  averageHandlingSeconds: number;
  medianHandlingSeconds: number;
  p90HandlingSeconds: number;
  slaPercent: number;
}
