import { describe, expect, it } from 'vitest';
import { requireNonEmpty, requireStatement, requireValidTimezone } from '../convex/lib/validate';

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

describe('requireStatement', () => {
  it('trims and returns valid statements', () => {
    expect(requireStatement('  I avoid conflict.  ')).toBe('I avoid conflict.');
  });
  it('rejects empty statements', () => {
    expect(() => requireStatement('   ')).toThrow();
  });
  it('rejects statements over 280 chars', () => {
    expect(() => requireStatement('x'.repeat(281))).toThrow();
    expect(requireStatement('x'.repeat(280))).toBe('x'.repeat(280));
  });
});
