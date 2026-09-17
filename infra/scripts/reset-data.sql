-- Wipe operational data and employee profiles (recreated on next login).

BEGIN;

DELETE FROM assignment;
DELETE FROM ticket_event;
DELETE FROM ticket;
DELETE FROM audit_event;
DELETE FROM shift;
DELETE FROM blocked_slot;

DELETE FROM employee;
DELETE FROM desk;
DELETE FROM service_type;
DELETE FROM site;

INSERT INTO site (id, code, name, timezone, active)
VALUES (gen_random_uuid(), 'MAIN', 'Очередь', 'Europe/Moscow', true);

INSERT INTO service_type (id, name, "slaSeconds", active, "siteId")
SELECT gen_random_uuid(), 'Предоставление и сдача маршрутного листа', 1200, true, site.id
  FROM site
 WHERE site.code = 'MAIN';

INSERT INTO desk (id, label, country, active, "siteId")
SELECT gen_random_uuid(), label, country, true, site.id
  FROM site,
       (VALUES
          ('Стол РФ-1', 'RF'),
          ('Стол РФ-2', 'RF'),
          ('Стол Китай', 'CN')
       ) AS desks(label, country)
 WHERE site.code = 'MAIN';

COMMIT;
