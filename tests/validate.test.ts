import { describe, expect, it } from 'vitest';
import { requireNonEmpty, requireValidTimezone } from '../convex/lib/validate';

describe('requireValidTimezone', () => {
  it('accepts valid IANA names', () => {
    expect(requireValidTimezone('America/New_York')).toBe('America/New_York');
    expect(requireValidTimezone('UTC')).toBe('UTC');
  });

  it('rejects invalid names', () => {
    expect(() => requireValidTimezone('Mars/Olympus_Mons')).toThrow();
    expect(() => requireValidTimezone('')).toThrow();
  });
});

describe('requireNonEmpty', () => {
  it('trims and returns content', () => {
    expect(requireNonEmpty('  Che  ', 'displayName')).toBe('Che');
  });

  it('rejects whitespace-only values', () => {
    expect(() => requireNonEmpty('   ', 'displayName')).toThrow();
  });
});
