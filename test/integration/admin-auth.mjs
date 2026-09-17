import assert from 'node:assert/strict';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:18080';
const api = `${baseUrl}/api`;
const username = process.env.ADMIN_USERNAME ?? 'admin';
const password = process.env.ADMIN_PASSWORD ?? 'Admin123!';

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
  const response = await fetch(url, {
    ...init,
    headers,
    redirect: 'manual',
  });
  jar.store(response);
  return response;
}

/** @param {string} startUrl @param {CookieJar} jar */
async function followRedirects(startUrl, jar, max = 12) {
  let url = startUrl;
  for (let step = 0; step < max; step += 1) {
    const response = await fetchTracked(url, jar);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      assert.ok(location, `Redirect without location from ${url}`);
      url = new URL(location, url).toString();
      continue;
    }
    return { response, url };
  }
  throw new Error(`Too many redirects from ${startUrl}`);
}

/** @param {string} html */
function parseLoginForm(html, pageUrl) {
  const actionMatch = html.match(/action="([^"]+)"/);
  assert.ok(actionMatch, 'Keycloak login form action not found');
  return new URL(actionMatch[1].replace(/&amp;/g, '&'), pageUrl).toString();
}

/** @param {CookieJar} jar */
async function loginAsAdmin(jar) {
  const loginStart = await followRedirects(`${api}/auth/login`, jar);
  assert.equal(loginStart.response.status, 200, 'Expected Keycloak login page');
  const html = await loginStart.response.text();
  assert.match(html, /username|login/i, 'Login page should contain username field');

  const formAction = parseLoginForm(html, loginStart.url);
  const body = new URLSearchParams({
    username,
    password,
  });
  const authResponse = await fetchTracked(formAction, jar, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  assert.ok(
    authResponse.status >= 300 && authResponse.status < 400,
    `Expected redirect after login, got ${authResponse.status}`,
  );

  const callbackUrl = new URL(
    authResponse.headers.get('location') ?? '',
    loginStart.url,
  ).toString();
  const callback = await followRedirects(callbackUrl, jar);
  assert.equal(
    callback.response.status,
    200,
    `Expected staff app after callback, got ${callback.response.status} at ${callback.url}`,
  );
  assert.match(callback.url, /\/staff\/?$/, 'Should land on staff app');
}

/** @param {CookieJar} jar */
async function apiFetch(path, jar, init = {}) {
  const headers = new Headers(init.headers);
  const cookie = jar.header();
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  jar.store(response);
  return response;
}

const jar = new CookieJar();
await loginAsAdmin(jar);

const meResponse = await apiFetch('/auth/me', jar);
assert.equal(meResponse.status, 200, '/auth/me should return 200');
const me = await meResponse.json();
assert.ok(me?.subject, 'Session user subject missing');
assert.ok(me?.csrfToken, 'CSRF token missing');
assert.ok(
  me.roles?.includes('ADMIN'),
  `Expected ADMIN role, got ${JSON.stringify(me.roles)}`,
);
console.log(`ADMIN_SESSION_OK ${me.displayName}`);

const currentResponse = await apiFetch('/employee/current', jar);
assert.equal(currentResponse.status, 200, '/employee/current should work for admin');
const current = await currentResponse.json();
assert.ok(current.employee, 'Admin should have employee profile');
assert.equal(current.employee.displayName, me.displayName);

const statusResponse = await apiFetch('/employee/status', jar, {
  method: 'PATCH',
  headers: {
    'content-type': 'application/json',
    'x-csrf-token': me.csrfToken,
  },
  body: JSON.stringify({ status: 'AVAILABLE' }),
});
assert.equal(statusResponse.status, 200, 'Admin status change should succeed');

const queueResponse = await apiFetch('/admin/queue', jar);
assert.equal(queueResponse.status, 200, '/admin/queue should be accessible');
const queue = await queueResponse.json();
assert.ok(Array.isArray(queue), 'Admin queue should be an array');
for (const ticket of queue) {
  assert.ok(ticket.id && ticket.number && ticket.status, 'Ticket shape invalid');
  assert.ok(ticket.serviceType?.name, 'Ticket serviceType.name missing');
  assert.equal(
    ticket.accessTokenHash,
    undefined,
    'accessTokenHash must not leak to admin API',
  );
}

const metricsResponse = await apiFetch('/admin/metrics/employees', jar);
assert.equal(metricsResponse.status, 200, '/admin/metrics/employees should work');
const metrics = await metricsResponse.json();
assert.ok(Array.isArray(metrics), 'Metrics should be an array');

await apiFetch('/employee/status', jar, {
  method: 'PATCH',
  headers: {
    'content-type': 'application/json',
    'x-csrf-token': me.csrfToken,
  },
  body: JSON.stringify({ status: 'PAUSED' }),
});

console.log('ADMIN_FLOW_OK');
