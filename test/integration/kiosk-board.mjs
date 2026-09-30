import assert from 'node:assert/strict';

const api = process.env.API_URL ?? 'http://localhost:18080/api';

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

const jar = new CookieJar();
const csrfResponse = await fetchTracked(`${api}/public/csrf`, jar);
assert.equal(csrfResponse.ok, true, 'CSRF bootstrap failed');
const { csrfToken } = await csrfResponse.json();

const [site] = await fetchTracked(`${api}/public/sites`, jar).then((response) =>
  response.json(),
);
assert.ok(site?.id, 'No public site');
const [service] = await fetchTracked(
  `${api}/public/sites/${site.id}/services`,
  jar,
).then((response) => response.json());
assert.ok(service?.id, 'No public service');

const today = new Date().toLocaleDateString('en-CA', {
  timeZone: 'Europe/Moscow',
});
const slots = await fetchTracked(
  `${api}/public/sites/${site.id}/slots?date=${today}&country=RF`,
  jar,
).then((response) => response.json());
const slot = slots.find((row) => row.available);
assert.ok(slot?.scheduledAt, 'Need a free slot today for walk-in test');

const boardResponse = await fetchTracked(`${api}/public/board`, jar);
assert.equal(boardResponse.ok, true, 'Public board failed');
const board = await boardResponse.json();
assert.ok(Array.isArray(board.columns), 'Board columns missing');
assert.deepEqual(
  board.columns.map((column) => column.id),
  ['booked', 'queue', 'approach', 'service'],
);

const walkInResponse = await fetchTracked(`${api}/public/tickets/walk-in`, jar, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-csrf-token': csrfToken,
  },
  body: JSON.stringify({
    siteId: site.id,
    serviceTypeId: service.id,
    country: 'RF',
    fullName: 'Киосков Киоск Киоскович',
    phone: '+79001234567',
    scheduledAt: slot.scheduledAt,
    personalDataConsent: true,
  }),
});
assert.equal(walkInResponse.ok, true, `Walk-in failed: ${walkInResponse.status}`);
const walkIn = await walkInResponse.json();
assert.ok(walkIn.number, 'Walk-in must return a ticket number');
assert.ok(walkIn.scheduledLabel, 'Walk-in must return scheduledLabel');
assert.equal(walkIn.accessToken, undefined, 'accessToken must not leak');
assert.equal(walkIn.fullName, undefined, 'walk-in response is number-only');

const after = await fetchTracked(`${api}/public/board`, jar).then((response) =>
  response.json(),
);
const booked = after.columns.find((column) => column.id === 'booked');
assert.ok(
  booked?.tickets.some(
    (ticket) =>
      ticket.number === walkIn.number &&
      ticket.fullName === 'Киосков Киоск Киоскович' &&
      ticket.countryLabel === 'РФ' &&
      ticket.scheduledTime,
  ),
  'Walk-in ticket must appear in booked column with FIO and time',
);

const honeypot = await fetchTracked(`${api}/public/tickets/walk-in`, jar, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-csrf-token': csrfToken,
  },
  body: JSON.stringify({
    siteId: site.id,
    serviceTypeId: service.id,
    country: 'RF',
    fullName: 'Спам Спамович',
    phone: '+79007654321',
    scheduledAt: slot.scheduledAt,
    personalDataConsent: true,
    website: 'https://spam.example',
  }),
});
assert.equal(honeypot.status, 400, 'Honeypot must be rejected by validation');

console.log(`kiosk-board ok: ${walkIn.number}`);
