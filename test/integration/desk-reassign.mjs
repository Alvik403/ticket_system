import assert from 'node:assert/strict';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:18080';
const api = `${baseUrl}/api`;

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

const jar = new CookieJar();
await loginAsAdmin(jar);
const me = await (await apiFetch('/auth/me', jar)).json();
const employees = await (await apiFetch('/admin/employees', jar)).json();
const desks = await (await apiFetch('/admin/desks', jar)).json();
const integration = employees.find((e) => e.displayName.includes('Integration'));
const admin = employees.find((e) => e.role === 'ADMIN');
const desk2 = desks.find((d) => d.label.includes('2')) ?? desks[1] ?? desks[0];

console.log('integration', integration);
console.log('admin', admin?.displayName);
console.log('desk2', desk2?.label);

if (integration && desk2) {
  let res = await apiFetch(`/admin/employees/${integration.id}/desk`, jar, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrfToken },
    body: JSON.stringify({ deskId: desk2.id }),
  });
  console.log('assign integration', res.status, await res.text());

  if (admin) {
    res = await apiFetch(`/admin/employees/${admin.id}/desk`, jar, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrfToken },
      body: JSON.stringify({ deskId: desk2.id }),
    });
    console.log('reassign to admin', res.status, await res.text());
  }

  res = await apiFetch(`/admin/employees/${integration.id}/desk`, jar, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrfToken },
    body: JSON.stringify({ deskId: null }),
  });
  console.log('unassign integration', res.status, await res.text());
}
