const IPV4_ORIGIN =
  /^https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$/;
const LOCAL_ORIGIN =
  /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

export function parseOriginList(...values: Array<string | undefined>): string[] {
  return values
    .flatMap((value) => (value ?? '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isAllowedBrowserOrigin(
  origin: string | undefined,
  options: { allowedOrigins: string[]; allowLocalAndIp: boolean },
): boolean {
  if (!origin) return true;
  if (options.allowedOrigins.includes(origin)) return true;
  if (!options.allowLocalAndIp) return false;
  return LOCAL_ORIGIN.test(origin) || IPV4_ORIGIN.test(origin);
}
