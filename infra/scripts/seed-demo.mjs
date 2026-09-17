import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://ticket:ticket@localhost:55432/ticket';

const hashToken = (value) =>
  createHash('sha256').update(value).digest('hex');

const DEMO_EMPLOYEES = [
  { subject: 'demo:employee', displayName: 'Employee User', deskLabel: 'Стол 1', status: 'AVAILABLE' },
  { subject: 'demo:employee1', displayName: 'Employee One', deskLabel: 'Стол 2', status: 'AVAILABLE' },
  { subject: 'demo:employee2', displayName: 'Employee Two', deskLabel: 'Стол 3', status: 'BUSY' },
];

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query('BEGIN');

  const siteRes = await client.query(
    `SELECT id FROM site WHERE active = true ORDER BY code LIMIT 1`,
  );
  if (!siteRes.rows[0]) {
    throw new Error('Нет активной площадки — сначала выполните npm run reset:data');
  }
  const siteId = siteRes.rows[0].id;

  const servicesRes = await client.query(
    `SELECT id, name FROM service_type WHERE active = true AND "siteId" = $1 ORDER BY name`,
    [siteId],
  );
  if (servicesRes.rows.length < 1) {
    throw new Error('Нет услуг — сначала выполните npm run reset:data');
  }
  const services = servicesRes.rows;

  for (const label of ['Стол 1', 'Стол 2', 'Стол 3']) {
    await client.query(
      `INSERT INTO desk (id, label, active, "siteId")
       SELECT gen_random_uuid(), $1::varchar, true, $2
        WHERE NOT EXISTS (
          SELECT 1 FROM desk WHERE label = $1::varchar AND "siteId" = $2
        )`,
      [label, siteId],
    );
  }

  const desksRes = await client.query(
    `SELECT id, label FROM desk WHERE active = true AND "siteId" = $1 ORDER BY label`,
    [siteId],
  );
  const deskByLabel = new Map(desksRes.rows.map((row) => [row.label, row.id]));

  const employeeIds = [];
  for (const demo of DEMO_EMPLOYEES) {
    const deskId = deskByLabel.get(demo.deskLabel);
    const byName = await client.query(
      `SELECT id FROM employee WHERE "displayName" = $1 LIMIT 1`,
      [demo.displayName],
    );
    if (byName.rows[0]) {
      await client.query(
        `UPDATE employee
            SET status = $2, "deskId" = $3, "siteId" = $4, role = 'EMPLOYEE'
          WHERE id = $1`,
        [byName.rows[0].id, demo.status, deskId, siteId],
      );
      employeeIds.push(byName.rows[0].id);
      continue;
    }
    const bySubject = await client.query(
      `SELECT id FROM employee WHERE "oidcSubject" = $1 LIMIT 1`,
      [demo.subject],
    );
    if (bySubject.rows[0]) {
      await client.query(
        `UPDATE employee
            SET "displayName" = $2, status = $3, "deskId" = $4, "siteId" = $5, role = 'EMPLOYEE'
          WHERE id = $1`,
        [bySubject.rows[0].id, demo.displayName, demo.status, deskId, siteId],
      );
      employeeIds.push(bySubject.rows[0].id);
      continue;
    }
    const inserted = await client.query(
      `INSERT INTO employee (id, "oidcSubject", "displayName", role, status, "siteId", "deskId")
       VALUES (gen_random_uuid(), $1, $2, 'EMPLOYEE', $3, $4, $5)
       RETURNING id`,
      [demo.subject, demo.displayName, demo.status, siteId, deskId],
    );
    employeeIds.push(inserted.rows[0].id);
  }

  await client.query(`DELETE FROM assignment`);
  await client.query(`DELETE FROM ticket_event`);
  await client.query(`DELETE FROM ticket`);

  let ticketSeq = 0;
  const insertTicket = async ({
    status,
    serviceId,
    minutesAgo,
    handlingMinutes = 0,
  }) => {
    ticketSeq += 1;
    const number = `MAIN-${String(ticketSeq).padStart(3, '0')}`;
    const token = randomUUID();
    const createdMinutesAgo = minutesAgo;
    const updatedMinutesAgo = Math.max(0, minutesAgo - handlingMinutes);
    const res = await client.query(
      `INSERT INTO ticket (
         id, number, "accessTokenHash", status, "callAttempts", priority,
         "siteId", "serviceTypeId", "createdAt", "updatedAt"
       )
       VALUES (
         gen_random_uuid(), $1, $2, $3, 0, 0,
         $4, $5,
         now() - ($6::text || ' minutes')::interval,
         now() - ($7::text || ' minutes')::interval
       )
       RETURNING id, "createdAt"`,
      [
        number,
        hashToken(token),
        status,
        siteId,
        serviceId,
        String(createdMinutesAgo),
        String(updatedMinutesAgo),
      ],
    );
    return { id: res.rows[0].id, number, createdAt: res.rows[0].createdAt };
  };

  const insertAssignment = async ({
    ticketId,
    employeeId,
    deskId,
    active,
    waitMinutes,
    handleMinutes = 0,
    called = false,
    started = false,
    completed = false,
  }) => {
    const calledAtOffset = called ? Math.max(1, waitMinutes - 2) : null;
    const startedAtOffset = started ? Math.max(1, waitMinutes - 4) : null;
    const completedAtOffset = completed
      ? Math.max(1, waitMinutes - 4 - handleMinutes)
      : null;

    await client.query(
      `INSERT INTO assignment (
         id, "ticketId", "employeeId", "deskId", active,
         "assignedAt", "calledAt", "startedAt", "completedAt"
       )
       VALUES (
         gen_random_uuid(), $1, $2, $3, $4,
         now() - ($5::text || ' minutes')::interval,
         CASE WHEN $6 THEN now() - ($7::text || ' minutes')::interval ELSE NULL END,
         CASE WHEN $8 THEN now() - ($9::text || ' minutes')::interval ELSE NULL END,
         CASE WHEN $10 THEN now() - ($11::text || ' minutes')::interval ELSE NULL END
       )`,
      [
        ticketId,
        employeeId,
        deskId,
        active,
        String(waitMinutes),
        called,
        calledAtOffset !== null ? String(calledAtOffset) : '0',
        started,
        startedAtOffset !== null ? String(startedAtOffset) : '0',
        completed,
        completedAtOffset !== null ? String(completedAtOffset) : '0',
      ],
    );
  };

  const insertEvent = async (ticketId, type, minutesAgo) => {
    await client.query(
      `INSERT INTO ticket_event (id, "ticketId", type, data, "occurredAt")
       VALUES (gen_random_uuid(), $1, $2, '{}'::jsonb, now() - ($3::text || ' minutes')::interval)`,
      [ticketId, type, String(minutesAgo)],
    );
  };

  const pickService = (index) => services[index % services.length].id;
  const pickEmployee = (index) => employeeIds[index % employeeIds.length];
  const pickDesk = (index) => desksRes.rows[index % desksRes.rows.length].id;

  // Очередь
  for (let i = 0; i < 7; i += 1) {
    const ticket = await insertTicket({
      status: i % 5 === 0 ? 'REQUEUED' : 'CHECKED_IN',
      serviceId: pickService(i),
      minutesAgo: 8 + i * 4,
    });
    await insertEvent(ticket.id, 'CREATED', 8 + i * 4);
  }

  // В работе
  const assigned = await insertTicket({
    status: 'ASSIGNED',
    serviceId: pickService(0),
    minutesAgo: 12,
  });
  await insertAssignment({
    ticketId: assigned.id,
    employeeId: pickEmployee(0),
    deskId: pickDesk(0),
    active: true,
    waitMinutes: 10,
  });

  const called = await insertTicket({
    status: 'CALLED',
    serviceId: pickService(1),
    minutesAgo: 18,
  });
  await insertAssignment({
    ticketId: called.id,
    employeeId: pickEmployee(1),
    deskId: pickDesk(1),
    active: true,
    waitMinutes: 15,
    called: true,
  });

  const inService = await insertTicket({
    status: 'IN_SERVICE',
    serviceId: pickService(2),
    minutesAgo: 25,
  });
  await insertAssignment({
    ticketId: inService.id,
    employeeId: pickEmployee(2),
    deskId: pickDesk(2),
    active: true,
    waitMinutes: 20,
    called: true,
    started: true,
  });

  // Завершённые сегодня — для статистики и графика по часам
  for (let i = 0; i < 18; i += 1) {
    const minutesAgo = 40 + i * 22;
    const handleMinutes = 6 + (i % 12);
    const ticket = await insertTicket({
      status: 'COMPLETED',
      serviceId: pickService(i),
      minutesAgo,
      handlingMinutes: handleMinutes,
    });
    await insertAssignment({
      ticketId: ticket.id,
      employeeId: pickEmployee(i),
      deskId: pickDesk(i),
      active: false,
      waitMinutes: minutesAgo - 2,
      handleMinutes,
      called: true,
      started: true,
      completed: true,
    });
    await insertEvent(ticket.id, 'CREATED', minutesAgo);
    await insertEvent(ticket.id, 'COMPLETED', minutesAgo - handleMinutes);
  }

  // Отменённые
  for (let i = 0; i < 3; i += 1) {
    const minutesAgo = 45 + i * 20;
    const ticket = await insertTicket({
      status: 'CANCELLED',
      serviceId: pickService(i),
      minutesAgo,
    });
    await insertEvent(ticket.id, 'CANCELLED', minutesAgo - 2);
  }

  // Не явились
  for (let i = 0; i < 2; i += 1) {
    const minutesAgo = 35 + i * 25;
    const ticket = await insertTicket({
      status: 'NO_SHOW',
      serviceId: pickService(i + 1),
      minutesAgo,
    });
    await insertAssignment({
      ticketId: ticket.id,
      employeeId: pickEmployee(i),
      deskId: pickDesk(i),
      active: false,
      waitMinutes: minutesAgo - 5,
      called: true,
    });
    await insertEvent(ticket.id, 'NO_SHOW', minutesAgo - 3);
  }

  await client.query('COMMIT');

  const stats = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM ticket WHERE status IN ('CHECKED_IN', 'REQUEUED')) AS waiting,
      (SELECT COUNT(*)::int FROM ticket WHERE status IN ('ASSIGNED', 'CALLED', 'IN_SERVICE')) AS in_progress,
      (SELECT COUNT(*)::int FROM ticket WHERE status = 'COMPLETED' AND "updatedAt" >= date_trunc('day', now())) AS completed_today,
      (SELECT COUNT(*)::int FROM ticket WHERE "createdAt" >= date_trunc('day', now())) AS created_today,
      (SELECT COUNT(*)::int FROM employee) AS employees
  `);

  console.log('Demo data seeded:', stats.rows[0]);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}

try {
  execSync(`docker compose -f infra/docker-compose.yml restart api`, {
    stdio: 'inherit',
    cwd: join(__dirname, '../..'),
  });
} catch (error) {
  console.warn('API restart skipped:', error.message);
}

console.log('SEED_DEMO_OK');
