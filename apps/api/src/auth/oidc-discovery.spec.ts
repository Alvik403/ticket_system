import {
  browserIssuer,
  rewriteInternalEndpoints,
} from './oidc-discovery';

describe('oidc discovery helpers', () => {
  it('builds the public issuer from the request origin', () => {
    expect(browserIssuer('http://queue.example:18080/')).toBe(
      'http://queue.example:18080/realms/ticket-system',
    );
  });

  it('keeps token endpoints on the internal Keycloak host', () => {
    expect(
      rewriteInternalEndpoints(
        {
          issuer: 'http://queue.example:18080/realms/ticket-system',
          token_endpoint:
            'http://queue.example:18080/realms/ticket-system/protocol/openid-connect/token',
        },
        'http://keycloak:8080/realms/ticket-system',
      ),
    ).toEqual({
      token_endpoint:
        'http://keycloak:8080/realms/ticket-system/protocol/openid-connect/token',
      jwks_uri: undefined,
      userinfo_endpoint: undefined,
      introspection_endpoint: undefined,
      revocation_endpoint: undefined,
    });
  });
});
