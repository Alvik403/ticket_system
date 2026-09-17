import type { Request } from 'express';

export function clientIp(request: Pick<Request, 'headers' | 'socket'>): string {
  const realIp = request.headers['x-real-ip'];
  if (typeof realIp === 'string') {
    const value = realIp.trim();
    if (value && !value.includes(',')) return value;
  }
  return request.socket.remoteAddress ?? 'unknown';
}
