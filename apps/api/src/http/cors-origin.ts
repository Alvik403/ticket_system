export function parseOriginList(
  ...values: Array<string | undefined>
): string[] {
  return values
    .flatMap((value) => (value ?? '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isHttpOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === origin
    );
  } catch {
    return false;
  }
}

export function isAllowedBrowserOrigin(
  origin: string | undefined,
  options: { allowedOrigins: string[]; allowAnyHttpOrigin: boolean },
): boolean {
  if (!origin) return true;
  if (options.allowedOrigins.includes(origin)) return true;
  return options.allowAnyHttpOrigin && isHttpOrigin(origin);
}
