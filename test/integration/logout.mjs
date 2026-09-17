import assert from 'node:assert/strict';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:18080';
const api = `${baseUrl}/api`;

class CookieJar {
  cookies = new Map();
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

async function followRedirects(startUrl, jar, max = 15) {
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

function parseLoginForm(html, pageUrl) {
  const actionMatch = html.match(/action="([^"]+)"/);
  assert.ok(actionMatch, 'Keycloak login form action not found');
  return new URL(actionMatch[1].replace(/&amp;/g, '&'), pageUrl).toString();
}

async function login(jar, username, password) {
  const loginStart = await followRedirects(`${api}/auth/login`, jar);
  const formAction = parseLoginForm(await loginStart.response.text(), loginStart.url);
  const authResponse = await fetchTracked(formAction, jar, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }),
  });
  const callback = await followRedirects(
    new URL(authResponse.headers.get('location') ?? '', loginStart.url).toString(),
    jar,
  );
  assert.match(callback.url, /\/staff\/?$/, 'Should land on staff app after login');
}

const jar = new CookieJar();
await login(jar, process.env.ADMIN_USERNAME ?? 'admin', process.env.ADMIN_PASSWORD ?? 'Admin123!');

const meBefore = await fetchTracked(`${api}/auth/me`, jar);
assert.equal(meBefore.status, 200);
assert.ok((await meBefore.json())?.subject, 'Should be logged in before logout');

const logoutResponse = await fetchTracked(`${api}/auth/logout`, jar);
assert.equal(logoutResponse.status, 302, 'Logout should redirect');

const meAfter = await fetchTracked(`${api}/auth/me`, jar);
assert.equal(meAfter.status, 401, 'Session should be cleared after logout');

console.log('LOGOUT_OK');
