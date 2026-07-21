// Semantic validation beyond schema shape (docs/spec/04 §notes).
// Pure functions — no ctx, no Date.now(). Unit-tested in tests/validate.test.ts.

import { ConvexError } from 'convex/values';

export function requireValidTimezone(timezone: string): string {
  try {
    // Throws RangeError on invalid IANA names.
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return timezone;
  } catch {
    throw new ConvexError({ code: 'invalid_timezone', message: `Invalid timezone: ${timezone}` });
  }
}

export function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ConvexError({ code: 'invalid_input', message: `${field} must not be empty.` });
  }
  return trimmed;
}
