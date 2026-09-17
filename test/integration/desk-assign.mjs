import assert from 'node:assert/strict';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:18080';
const api = `${baseUrl}/api`;

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
  const html = await loginStart.response.text();
  const formAction = parseLoginForm(html, loginStart.url);
  const authResponse = await fetchTracked(formAction, jar, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: process.env.ADMIN_USERNAME ?? 'admin',
      password: process.env.ADMIN_PASSWORD ?? 'Admin123!',
    }),
  });
  const callbackUrl = new URL(
    authResponse.headers.get('location') ?? '',
    loginStart.url,
  ).toString();
  await followRedirects(callbackUrl, jar);
}

/** @param {string} path @param {CookieJar} jar @param {RequestInit} [init] */
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

const me = await (await apiFetch('/auth/me', jar)).json();
const employees = await (await apiFetch('/admin/employees', jar)).json();
const desks = await (await apiFetch('/admin/desks', jar)).json();
const employee = employees.find((item) => item.role === 'EMPLOYEE') ?? employees[0];
const desk = desks[0];

assert.ok(employee, 'Employee required for desk assignment test');
assert.ok(desk, 'Desk required for desk assignment test');

const assignResponse = await apiFetch(`/admin/employees/${employee.id}/desk`, jar, {
  method: 'PATCH',
  headers: {
    'content-type': 'application/json',
    'x-csrf-token': me.csrfToken,
  },
  body: JSON.stringify({ deskId: desk.id }),
});
assert.equal(
  assignResponse.status,
  200,
  `Desk assignment failed: ${assignResponse.status} ${await assignResponse.text()}`,
);

console.log('DESK_ASSIGN_OK');
