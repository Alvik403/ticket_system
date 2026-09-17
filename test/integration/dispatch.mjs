import assert from 'node:assert/strict';
import pg from 'pg';

const api = process.env.API_URL ?? 'http://localhost:18080/api';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://ticket:ticket@localhost:55432/ticket';
const database = new pg.Client({ connectionString: databaseUrl });

class CookieJar {
  /** @type {Map<string, string>} */
  cookies = new Map();

  /** @param {Response} response */
  store(response) {
    const setCookie =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [];
    for (const entry of setCookie) {
      const [pair] = entry.split(';');
      const index = pair.indexOf('=');
      if (index === -1) continue;
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  header() {
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
}

/** @param {string} url @param {CookieJar} jar @param {RequestInit} [init] */
async function fetchTracked(url, jar, init = {}) {
  const headers = new Headers(init.headers);
  const cookie = jar.header();
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(url, { ...init, headers });
  jar.store(response);
  return response;
}

await database.connect();
try {
  await database.query(`
    UPDATE employee
       SET status = 'PAUSED'
     WHERE "oidcSubject" LIKE 'integration-employee%';
    DELETE FROM assignment
     WHERE "employeeId" IN (
       SELECT id FROM employee
        WHERE "oidcSubject" LIKE 'integration-employee%'
    );
    UPDATE ticket
       SET status = 'CANCELLED'
     WHERE status IN ('BOOKED', 'WAITING', 'CHECKED_IN', 'REQUEUED', 'ASSIGNED', 'CALLED');
  `);
  await database.query(`
    INSERT INTO employee (
      id, "oidcSubject", "displayName", role, status,
      "updatedAt", "siteId", "deskId"
    )
    SELECT gen_random_uuid(), 'integration-employee', 'Integration Employee',
           'EMPLOYEE', 'AVAILABLE', now(), site.id, desk.id
      FROM site
      JOIN desk ON desk."siteId" = site.id
     LIMIT 1
    ON CONFLICT ("oidcSubject") DO UPDATE SET status = 'AVAILABLE'
  `);

  const jar = new CookieJar();
  const csrfResponse = await fetchTracked(`${api}/public/csrf`, jar);
  assert.equal(csrfResponse.ok, true, 'CSRF bootstrap failed');
  const { csrfToken } = await csrfResponse.json();
  const [site] = await fetchTracked(`${api}/public/sites`, jar).then((response) =>
    response.json(),
  );
  const [service] = await fetchTracked(
    `${api}/public/sites/${site.id}/services`,
    jar,
  ).then((response) => response.json());
  const dates = await fetchTracked(`${api}/public/booking/dates`, jar).then(
    (response) => response.json(),
  );
  const slots = await fetchTracked(
    `${api}/public/sites/${site.id}/slots?date=${dates[0]}&country=RF`,
    jar,
  ).then((response) => response.json());
  const slot = slots.find((row) => row.available);
  assert.ok(slot, 'No available RF slot for dispatch test');

  const holdResponse = await fetchTracked(`${api}/public/slots/hold`, jar, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({
      siteId: site.id,
      country: 'RF',
      scheduledAt: slot.scheduledAt,
    }),
  });
  assert.equal(holdResponse.ok, true, 'Slot hold failed');
  const hold = await holdResponse.json();

  const ticketResponse = await fetchTracked(`${api}/public/tickets`, jar, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({
      siteId: site.id,
      serviceTypeId: service.id,
      country: 'RF',
      fullName: 'Иванов Иван Иванович',
      travelHistory: 'Тестовая поездка',
      scheduledAt: slot.scheduledAt,
      holdId: hold.holdId,
      personalDataConsent: true,
    }),
  });
  assert.equal(ticketResponse.ok, true, 'Ticket create failed');
  const ticket = await ticketResponse.json();
  assert.equal(ticket.accessToken, undefined, 'accessToken must not leak');
  assert.equal(ticket.status, 'BOOKED');
  assert.ok(ticket.lookupCode, 'lookupCode must be issued once');

  await database.query(
    `UPDATE ticket SET "scheduledAt" = now() WHERE number = $1`,
    [ticket.number],
  );

  const checkInResponse = await fetchTracked(
    `${api}/public/tickets/current/check-in`,
    jar,
    {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
    },
  );
  assert.equal(checkInResponse.ok, true, 'Check-in failed');
  const checkedIn = await checkInResponse.json();
  assert.ok(
    ['CHECKED_IN', 'ASSIGNED'].includes(checkedIn.status),
    `Unexpected status after check-in: ${checkedIn.status}`,
  );

  const result = await database.query(
    `SELECT ticket.status, COUNT(assignment.id)::int AS assignments
       FROM ticket
       LEFT JOIN assignment ON assignment."ticketId" = ticket.id
      WHERE ticket.number = $1
      GROUP BY ticket.id`,
    [ticket.number],
  );
  assert.equal(result.rows[0].status, 'ASSIGNED');
  assert.equal(result.rows[0].assignments, 1);
  console.log(`DISPATCH_FLOW_OK ${ticket.number}`);
} finally {
  await database.query(`
    UPDATE employee
       SET status = 'PAUSED'
     WHERE "oidcSubject" LIKE 'integration-employee%';
    UPDATE assignment
       SET active = false
     WHERE "employeeId" IN (
       SELECT id FROM employee
        WHERE "oidcSubject" LIKE 'integration-employee%'
     )
       AND active = true;
    UPDATE ticket
       SET status = 'REQUEUED'
     WHERE status = 'ASSIGNED'
       AND id IN (
         SELECT "ticketId" FROM assignment
          WHERE "employeeId" IN (
            SELECT id FROM employee
             WHERE "oidcSubject" LIKE 'integration-employee%'
          )
       );
  `);
  await database.end();
}
