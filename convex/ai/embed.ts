"use node";

// Embed action (Phase M Task 3, docs/spec/05-ai-pipeline.md §1 "embed"). Turns one
// entry's body, or one knowledge row's statement+body, into a stored vector.
// Fire-and-forget from the caller's perspective: a row without an embedding is a
// legal state (05 §5 — "embedding lag is tolerated: search falls back to
// full-text-only"), so every failure path finishes the aiRuns row as an ERROR run
// rather than throwing back to the scheduler, and never leaves anything partial.
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { embedStub } from '../lib/embedStub';
import { EMBED_DIMENSIONS, EMBED_MODEL, EMBED_VERSION } from './models';
import { getProviderKind } from './provider';

const targetType = v.union(v.literal('entry'), v.literal('knowledge'));

/**
 * Backfill batch size (docs/superpowers/plans/2026-07-22-mcp-first-intelligence.md
 * Task 3 — "processes ≤50 stale rows/user-agnostic batch"). Scale note: at single-
 * digit-user scale an hourly 50-row sweep clears any realistic backlog in one or
 * two ticks; if the corpus grows large enough for this to lag meaningfully, the
 * fix is a bigger batch / more frequent cron, not a redesign.
 */
const BACKFILL_BATCH_SIZE = 50;

export const run = internalAction({
  args: { userId: v.id('users'), targetType, targetId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    // Idempotent runId (Task 3 convention): a repeat schedule for the same row
    // (e.g. two rapid edits) reuses the same aiRuns ledger row instead of piling
    // up duplicates — mirrors distill's `distill:{entryId}:{promptVersion}`.
    const runId = `embed:${args.targetType}:${args.targetId}`;

    const runRowId = await ctx.runMutation(internal.internal.aiRuns.start, {
      userId: args.userId,
      purpose: 'embed',
      runId,
      model: EMBED_MODEL,
      promptVersion: EMBED_VERSION,
    });

    try {
      const loaded = await ctx.runQuery(internal.internal.embedStore.loadText, {
        userId: args.userId,
        targetType: args.targetType,
        targetId: args.targetId,
      });

      if (loaded === null) {
        // Row was deleted, archived-away, or reassigned between scheduling and
        // running — nothing to embed. Not an error; finish clean.
        await ctx.runMutation(internal.internal.aiRuns.finish, { id: runRowId, status: 'ok' });
        return null;
      }

      let embedding: number[];
      let inputTokens = 0;

      if (getProviderKind(process.env) === 'stub') {
        embedding = embedStub(loaded.text, EMBED_DIMENSIONS);
      } else if (!process.env.OPENAI_API_KEY) {
        // Live path, no key: honest refusal, no provider call — same discipline
        // as distill's 'no_provider' path (Phase M Task 2).
        await ctx.runMutation(internal.internal.aiRuns.finish, {
          id: runRowId,
          status: 'error',
          error: 'no_provider',
        });
        return null;
      } else {
        const { default: OpenAI } = await import('openai');
        const client = new OpenAI();
        const response = await client.embeddings.create({
          model: EMBED_MODEL,
          input: loaded.text,
          dimensions: EMBED_DIMENSIONS,
        });
        const vector = response.data[0]?.embedding;
        if (vector === undefined || vector.length !== EMBED_DIMENSIONS) {
          throw new Error(
            `embed: provider returned ${vector?.length ?? 0} dims, expected ${EMBED_DIMENSIONS}`,
          );
        }
        embedding = vector;
        inputTokens = response.usage?.prompt_tokens ?? 0;
      }

      await ctx.runMutation(internal.internal.embedStore.write, {
        userId: args.userId,
        targetType: args.targetType,
        targetId: args.targetId,
        embedding,
        embeddingVersion: EMBED_VERSION,
      });

      await ctx.runMutation(internal.internal.aiRuns.finish, {
        id: runRowId,
        status: 'ok',
        inputTokens,
      });
      return null;
    } catch (err) {
      await ctx.runMutation(internal.internal.aiRuns.finish, {
        id: runRowId,
        status: 'error',
        error: err instanceof Error ? err.message : 'unknown error',
      });
      return null;
    }
  },
});

/**
 * Backfill sweep (convex/crons.ts, hourly): finds up to BACKFILL_BATCH_SIZE rows
 * whose embeddingVersion is missing or stale and schedules `run` for each. Runs
 * user-agnostic (a cron has no single acting user) — internal-only, so the
 * subject-scoping invariant (08 §2, "public functions only") doesn't apply here;
 * every scheduled `run` still re-derives and re-verifies ownership per row.
 */
export const sweep = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const stale = await ctx.runQuery(internal.internal.embedStore.scanStale, {
      limit: BACKFILL_BATCH_SIZE,
    });
    for (const row of stale) {
      await ctx.scheduler.runAfter(0, internal.ai.embed.run, {
        userId: row.userId,
        targetType: row.targetType,
        targetId: row.targetId,
      });
    }
    return { scheduled: stale.length };
  },
});
