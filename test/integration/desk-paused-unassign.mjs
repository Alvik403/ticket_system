import assert from 'node:assert/strict';
import pg from 'pg';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:18080';
const api = `${baseUrl}/api`;
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://ticket:ticket@localhost:55432/ticket',
});

class CookieJar {
  cookies = new Map();
  store(response) {
    for (const entry of response.headers.getSetCookie?.() ?? []) {
      const [pair] = entry.split(';');
      const index = pair.indexOf('=');
      if (index === -1) continue;
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function fetchTracked(url, jar, init = {}) {
  const headers = new Headers(init.headers);
  const cookie = jar.header();
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(url, { ...init, headers, redirect: 'manual' });
  jar.store(response);
  return response;
}

async function followRedirects(startUrl, jar) {
  let url = startUrl;
  for (let step = 0; step < 12; step += 1) {
    const response = await fetchTracked(url, jar);
    if (response.status >= 300 && response.status < 400) {
      url = new URL(response.headers.get('location'), url).toString();
      continue;
    }
    return { response, url };
  }
  throw new Error('redirect loop');
}

async function loginAsAdmin(jar) {
  const loginStart = await followRedirects(`${api}/auth/login`, jar);
  const html = await loginStart.response.text();
  const action = html.match(/action="([^"]+)"/)[1].replace(/&amp;/g, '&');
  const authResponse = await fetchTracked(new URL(action, loginStart.url).toString(), jar, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'admin', password: 'Admin123!' }),
  });
  await followRedirects(new URL(authResponse.headers.get('location'), loginStart.url).toString(), jar);
}

async function apiFetch(path, jar, init = {}) {
  const headers = new Headers(init.headers);
  const cookie = jar.header();
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(`${api}${path}`, { ...init, headers, credentials: 'include' });
  jar.store(response);
  return response;
}

await db.connect();
let ticketNumber = '';
try {
  const emp = await db.query(
    `SELECT id FROM employee WHERE "oidcSubject" = 'integration-employee'`,
  );
  const desk = await db.query(`SELECT id FROM desk WHERE label = 'Стол 2' LIMIT 1`);
  const tokenHash = `hash-rel-test-${Date.now()}`;
  const inserted = await db.query(
    `INSERT INTO ticket (id, number, "accessTokenHash", status, "callAttempts", priority, "siteId", "serviceTypeId", "createdAt", "updatedAt")
     SELECT gen_random_uuid(), $1, $2, 'ASSIGNED', 0, 0, site.id, st.id, now(), now()
       FROM site JOIN service_type st ON st."siteId" = site.id
      LIMIT 1
     RETURNING id, number`,
    [`MAIN-REL-${Date.now()}`, tokenHash],
  );
  ticketNumber = inserted.rows[0].number;
  await db.query(`UPDATE assignment SET active = false WHERE "employeeId" = $1 AND active`, [
    emp.rows[0].id,
  ]);
  await db.query(`UPDATE employee SET status = 'RESERVED', "deskId" = $2 WHERE id = $1`, [
    emp.rows[0].id,
    desk.rows[0].id,
  ]);
  await db.query(
    `INSERT INTO assignment (id, active, "assignedAt", "employeeId", "ticketId", "deskId")
     VALUES (gen_random_uuid(), true, now(), $1, $2, $3)`,
    [emp.rows[0].id, inserted.rows[0].id, desk.rows[0].id],
  );
} finally {
  await db.end();
}

const jar = new CookieJar();
await loginAsAdmin(jar);
const me = await (await apiFetch('/auth/me', jar)).json();
const integration = (await (await apiFetch('/admin/employees', jar)).json()).find((e) =>
  e.displayName.includes('Integration'),
);

const unassign = await apiFetch(`/admin/employees/${integration.id}/desk`, jar, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrfToken },
  body: JSON.stringify({ deskId: null }),
});
const body = await unassign.text();
console.log('unassign reserved', unassign.status, body);
assert.equal(unassign.status, 200, body);
const payload = JSON.parse(body);
assert.equal(payload.desk, null);

const verify = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://ticket:ticket@localhost:55432/ticket',
});
await verify.connect();
const row = await verify.query(`SELECT status FROM ticket WHERE number = $1`, [ticketNumber]);
await verify.end();
assert.equal(row.rows[0]?.status, 'REQUEUED');
console.log('DESK_RELEASE_OK');
