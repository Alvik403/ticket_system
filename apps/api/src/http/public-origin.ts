import type { Request } from 'express';

function firstHeaderValue(value: string | undefined): string {
  return (value ?? '').split(',')[0].trim();
}

export function requestPublicOrigin(request: Request): string {
  const proto = firstHeaderValue(
    request.get('x-forwarded-proto') ?? request.protocol,
  );
  const host = firstHeaderValue(
    request.get('x-forwarded-host') ?? request.get('host'),
  );
  if (!host) {
    throw new Error('Missing Host header');
  }
  return `${proto}://${host}`;
}

export function rewriteUrlOrigin(url: string, origin: string): string {
  const next = new URL(url);
  const from = new URL(origin);
  next.protocol = from.protocol;
  next.host = from.host;
  return next.toString();
}

export function originJoin(origin: string, path: string): string {
  const pathname = path.startsWith('/') ? path : `/${path}`;
  return `${origin.replace(/\/$/, '')}${pathname}`;
}

export function staffAppUrl(origin: string, configured?: string): string {
  let path = '/staff/';
  if (configured) {
    try {
      const configuredPath = new URL(configured, origin).pathname;
      if (configuredPath.startsWith('/staff')) {
        path = configuredPath.endsWith('/')
          ? configuredPath
          : `${configuredPath}/`;
      }
    } catch {
      if (configured.startsWith('/staff')) {
        path = configured.endsWith('/') ? configured : `${configured}/`;
      }
    }
  }
  return originJoin(origin, path);
}
