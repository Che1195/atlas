// Pure matrix for convex/lib/budget.ts — window boundaries + budget refusal.
import { describe, expect, it } from 'vitest';
import { dayWindow, withinBudget } from '../convex/lib/budget';

describe('dayWindow', () => {
  it('exact midnight UTC is the start of its own day', () => {
    const midnight = Date.UTC(2026, 6, 22, 0, 0, 0, 0);
    const { start, end } = dayWindow(midnight);
    expect(start).toBe(midnight);
    expect(end).toBe(midnight + 24 * 60 * 60 * 1000);
  });

  it('a moment mid-day resolves to that day’s [start, end)', () => {
    const noon = Date.UTC(2026, 6, 22, 12, 30, 0, 0);
    const expectedStart = Date.UTC(2026, 6, 22, 0, 0, 0, 0);
    const { start, end } = dayWindow(noon);
    expect(start).toBe(expectedStart);
    expect(end).toBe(expectedStart + 24 * 60 * 60 * 1000);
  });

  it('1ms before midnight belongs to the previous day', () => {
    const midnight = Date.UTC(2026, 6, 22, 0, 0, 0, 0);
    const { start, end } = dayWindow(midnight - 1);
    expect(end).toBe(midnight);
    expect(start).toBe(midnight - 24 * 60 * 60 * 1000);
  });

  it('1ms after midnight belongs to the new day', () => {
    const midnight = Date.UTC(2026, 6, 22, 0, 0, 0, 0);
    const { start, end } = dayWindow(midnight + 1);
    expect(start).toBe(midnight);
    expect(end).toBe(midnight + 24 * 60 * 60 * 1000);
  });

  it('nowMs=0 (epoch) resolves to the epoch day', () => {
    const { start, end } = dayWindow(0);
    expect(start).toBe(0);
    expect(end).toBe(24 * 60 * 60 * 1000);
  });
});

describe('withinBudget', () => {
  it('spent below budget is allowed', () => {
    expect(withinBudget(0, 100)).toBe(true);
    expect(withinBudget(99, 100)).toBe(true);
  });

  it('spent equal to budget is refused (spent < budget, not <=)', () => {
    expect(withinBudget(100, 100)).toBe(false);
  });

  it('spent over budget is refused', () => {
    expect(withinBudget(101, 100)).toBe(false);
  });

  it('zero budget refuses everything, even zero spend', () => {
    expect(withinBudget(0, 0)).toBe(false);
  });

  it('negative budget refuses everything', () => {
    expect(withinBudget(0, -1)).toBe(false);
    expect(withinBudget(-5, -1)).toBe(false);
  });
});
