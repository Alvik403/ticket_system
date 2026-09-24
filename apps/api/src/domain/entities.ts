import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

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

export const SLOT_HOLDING_STATUSES: TicketStatus[] = [
  'BOOKED',
  'WAITING',
  'CHECKED_IN',
  'ASSIGNED',
  'CALLED',
  'IN_SERVICE',
  'REQUEUED',
];

export const LIVE_QUEUE_STATUSES: TicketStatus[] = ['CHECKED_IN', 'REQUEUED'];
export type EmployeeStatus =
  'OFFLINE' | 'AVAILABLE' | 'RESERVED' | 'BUSY' | 'PAUSED';
export type Role = 'EMPLOYEE' | 'ADMIN' | 'AUDITOR';
export type ClientCountry = 'RF' | 'CN';

@Entity()
export class Site {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) code!: string;
  @Column() name!: string;
  @Column({ default: 'Europe/Moscow' }) timezone!: string;
  @Column({ default: true }) active!: boolean;
}

@Entity()
export class ServiceType {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() name!: string;
  @Column({ default: 900 }) slaSeconds!: number;
  @Column({ default: true }) active!: boolean;
  @ManyToOne(() => Site, { nullable: false }) site!: Site;
}

@Entity()
export class Desk {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() label!: string;
  @Column({ type: 'varchar', default: 'RF' }) country!: ClientCountry;
  @Column({ default: true }) active!: boolean;
  @ManyToOne(() => Site, { nullable: false }) site!: Site;
}

@Entity()
@Unique(['oidcSubject'])
export class Employee {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() oidcSubject!: string;
  @Column() displayName!: string;
  @Column({ type: 'varchar', default: 'EMPLOYEE' }) role!: Role;
  @Column({ type: 'varchar', default: 'OFFLINE' }) status!: EmployeeStatus;
  @ManyToOne(() => Site, { nullable: true }) site?: Site;
  @ManyToOne(() => Desk, { nullable: true }) desk?: Desk;
  @Column({ type: 'varchar', nullable: true }) country?: ClientCountry;
  @Column('simple-array', { nullable: true }) serviceTypeIds?: string[];
  @UpdateDateColumn() updatedAt!: Date;
}

@Entity()
@Index(['site', 'status', 'createdAt'])
@Index(['site', 'scheduledAt'])
@Index(['site', 'country', 'scheduledAt', 'status'])
@Index('one_active_slot_per_desk_time', ['reservedDesk', 'scheduledAt'], {
  unique: true,
  where: `"reservedDeskId" IS NOT NULL AND "scheduledAt" IS NOT NULL AND "status" IN ('BOOKED','WAITING','CHECKED_IN','ASSIGNED','CALLED','IN_SERVICE','REQUEUED')`,
})
export class Ticket {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() number!: string;
  @Column({ unique: true }) accessTokenHash!: string;
  @Column({ type: 'varchar', nullable: true, unique: true })
  lookupCodeHash?: string;
  @Column({ type: 'varchar', default: 'BOOKED' }) status!: TicketStatus;
  @Column({ default: 0 }) callAttempts!: number;
  @Column({ default: 0 }) priority!: number;
  @ManyToOne(() => Site, { nullable: false }) site!: Site;
  @ManyToOne(() => ServiceType, { nullable: false }) serviceType!: ServiceType;
  @Column({ type: 'varchar', nullable: true }) country?: ClientCountry;
  @Column({ nullable: true }) fullName?: string;
  @Column({ type: 'text', nullable: true }) travelHistory?: string;
  @Column({ type: 'date', nullable: true }) departureDate?: string;
  @Column({ type: 'date', nullable: true }) arrivalDate?: string;
  @Column({ type: 'timestamptz', nullable: true }) personalDataConsentAt?: Date;
  @Column({ type: 'timestamptz', nullable: true }) scheduledAt?: Date;
  @Column({ type: 'timestamptz', nullable: true }) checkedInAt?: Date;
  @Column({ default: 10 }) durationMinutes!: number;
  @ManyToOne(() => Desk, { nullable: true }) reservedDesk?: Desk;
  @Column({ type: 'text', nullable: true }) clientNotice?: string;
  @OneToMany(() => Assignment, (assignment) => assignment.ticket)
  assignments!: Assignment[];
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}

@Entity()
@Index('one_active_assignment_per_ticket', ['ticket'], {
  unique: true,
  where: '"active" = true',
})
@Index('one_active_assignment_per_employee', ['employee'], {
  unique: true,
  where: '"active" = true',
})
export class Assignment {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @ManyToOne(() => Ticket, (ticket) => ticket.assignments, { nullable: false })
  ticket!: Ticket;
  @ManyToOne(() => Employee, { nullable: false }) employee!: Employee;
  @ManyToOne(() => Desk, { nullable: true }) desk?: Desk;
  @Column({ default: true }) active!: boolean;
  @CreateDateColumn() assignedAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) calledAt?: Date;
  @Column({ type: 'timestamptz', nullable: true }) startedAt?: Date;
  @Column({ type: 'timestamptz', nullable: true }) completedAt?: Date;
}

@Entity()
export class BlockedSlot {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @ManyToOne(() => Site, { nullable: false }) site!: Site;
  @ManyToOne(() => Employee, { nullable: false }) employee!: Employee;
  @Column({ type: 'date' }) date!: string;
  @Column({ type: 'varchar', length: 5 }) startTime!: string;
  @Column({ type: 'varchar', length: 5 }) endTime!: string;
  @Column({ nullable: true }) reason?: string;
  @CreateDateColumn() createdAt!: Date;
}

@Entity()
export class TicketEvent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() ticketId!: string;
  @Column() type!: string;
  @Column({ type: 'jsonb', default: {} }) data!: Record<string, unknown>;
  @Column({ nullable: true }) actorSubject?: string;
  @CreateDateColumn() occurredAt!: Date;
}

@Entity()
export class AuditEvent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() action!: string;
  @Column() actorSubject!: string;
  @Column({ nullable: true }) targetId?: string;
  @Column({ type: 'jsonb', default: {} }) details!: Record<string, unknown>;
  @CreateDateColumn() occurredAt!: Date;
}

@Entity()
export class Shift {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @ManyToOne(() => Employee, { nullable: false }) employee!: Employee;
  @CreateDateColumn() startedAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) endedAt?: Date;
}
