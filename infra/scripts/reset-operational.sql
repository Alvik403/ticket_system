-- Очистка операционных данных. Площадка, столы и услуги (очередь) не трогаем.

BEGIN;

DELETE FROM assignment;
DELETE FROM ticket_event;
DELETE FROM ticket;
DELETE FROM audit_event;
DELETE FROM shift;
DELETE FROM blocked_slot;
DELETE FROM employee;

COMMIT;
