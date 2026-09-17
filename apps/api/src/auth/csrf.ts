import { timingSafeEqual } from 'node:crypto';

export function tokensEqual(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  const expected = Buffer.from(left);
  const provided = Buffer.from(right);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
