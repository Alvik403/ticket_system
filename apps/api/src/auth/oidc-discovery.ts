import type { ServerMetadata } from 'openid-client';

export async function fetchOidcMetadata(
  wellKnownUrl: string,
  options?: { attempts?: number; delayMs?: number },
): Promise<ServerMetadata> {
  const attempts = options?.attempts ?? 8;
  const delayMs = options?.delayMs ?? 1500;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(wellKnownUrl);
      if (!response.ok) {
        throw new Error(`OIDC discovery HTTP ${response.status}`);
      }
      return (await response.json()) as ServerMetadata;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('OIDC discovery failed');
}

export function browserIssuer(publicOrigin: string): string {
  return `${publicOrigin.replace(/\/$/, '')}/realms/ticket-system`;
}

export function rewriteInternalEndpoints(
  discovered: ServerMetadata,
  internalIssuer: string,
): Pick<
  ServerMetadata,
  | 'token_endpoint'
  | 'jwks_uri'
  | 'userinfo_endpoint'
  | 'introspection_endpoint'
  | 'revocation_endpoint'
> {
  const internalOrigin = new URL(internalIssuer).origin;
  const rewrite = (endpoint?: string): string | undefined => {
    if (!endpoint) return undefined;
    const url = new URL(endpoint);
    return `${internalOrigin}${url.pathname}${url.search}`;
  };
  return {
    token_endpoint: rewrite(discovered.token_endpoint),
    jwks_uri: rewrite(discovered.jwks_uri),
    userinfo_endpoint: rewrite(discovered.userinfo_endpoint),
    introspection_endpoint: rewrite(discovered.introspection_endpoint),
    revocation_endpoint: rewrite(discovered.revocation_endpoint),
  };
}
