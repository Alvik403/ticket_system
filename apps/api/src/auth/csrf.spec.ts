import { tokensEqual } from './csrf';

describe('tokensEqual', () => {
  it('accepts matching tokens', () => {
    expect(tokensEqual('abc', 'abc')).toBe(true);
  });

  it('rejects missing or different tokens', () => {
    expect(tokensEqual('abc', 'abd')).toBe(false);
    expect(tokensEqual('abc', undefined)).toBe(false);
    expect(tokensEqual(undefined, 'abc')).toBe(false);
    expect(tokensEqual('ab', 'abc')).toBe(false);
  });
});
