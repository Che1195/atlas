// TDD for the deterministic embedding stub (Phase M Task 3, docs/spec/05-ai-pipeline.md
// §1 "embed"). PURE — no convex-test needed.
import { describe, expect, it } from 'vitest';
import { embedStub } from '../convex/lib/embedStub';

const DIMENSIONS = 1024;

describe('embedStub', () => {
  it('is deterministic: same text -> byte-identical vector', () => {
    const a = embedStub('I noticed I get defensive in code review.', DIMENSIONS);
    const b = embedStub('I noticed I get defensive in code review.', DIMENSIONS);
    expect(a).toEqual(b);
  });

  it('different text -> a different vector', () => {
    const a = embedStub('entry one', DIMENSIONS);
    const b = embedStub('entry two', DIMENSIONS);
    expect(a).not.toEqual(b);
  });

  it('produces exactly `dimensions` components', () => {
    expect(embedStub('any text', DIMENSIONS)).toHaveLength(DIMENSIONS);
    expect(embedStub('any text', 8)).toHaveLength(8);
  });

  it('is unit-normalized (Euclidean norm 1, within 1e-6)', () => {
    const vector = embedStub('unit norm check', DIMENSIONS);
    const normSquared = vector.reduce((sum, value) => sum + value * value, 0);
    expect(Math.abs(Math.sqrt(normSquared) - 1)).toBeLessThanOrEqual(1e-6);
  });

  it('empty string still produces a valid unit vector', () => {
    const vector = embedStub('', DIMENSIONS);
    expect(vector).toHaveLength(DIMENSIONS);
    const normSquared = vector.reduce((sum, value) => sum + value * value, 0);
    expect(Math.abs(Math.sqrt(normSquared) - 1)).toBeLessThanOrEqual(1e-6);
  });
});
