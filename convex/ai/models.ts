// Centralized model selection (docs/spec/05-ai-pipeline.md §2). Changing a model
// for a task is a one-line change here; aiRuns records make A/B comparison possible.

/** distill, connect, ask — high-volume, structured, cost-sensitive. */
export const DISTILL_MODEL = 'gpt-5.6-terra';
export const DISTILL_REASONING_EFFORT = 'medium' as const;

/**
 * Embeddings (Phase M Task 3, docs/spec/05-ai-pipeline.md §1 "embed"). 1024 dims
 * matches the vector indexes locked in schema.ts — changing EMBED_DIMENSIONS
 * requires a matching schema migration, not just this constant. EMBED_VERSION
 * stamps every embedded row; bump it on any model/dimension change so the
 * backfill cron (convex/crons.ts) re-embeds everything.
 */
export const EMBED_MODEL = 'text-embedding-3-small';
export const EMBED_DIMENSIONS = 1024;
export const EMBED_VERSION = 'te3s-1024-v1';
