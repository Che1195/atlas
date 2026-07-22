"use node";

// Distill action (Phase 3a Task 6, docs/spec/05-ai-pipeline.md §1/§3). Turns one
// journal entry into 0-4 conservative knowledge ops. Every exit path finishes the
// aiRuns row exactly once (never leaves a row stuck at 'running'), and no partial
// proposal is ever written — a throw anywhere after start() finishes as an error.
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { withinBudget } from '../lib/budget';
import { DISTILL_MODEL, DISTILL_REASONING_EFFORT } from './models';
import { buildDistillPrompt, DISTILL_PROMPT_VERSION } from './prompts/distill';
import { getProviderKind, stubDistillation } from './provider';
import {
  PROPOSAL_OPS_JSON_SCHEMA,
  validateOps,
  type OpVerdict,
} from '../shared/proposalOps';

const MAX_OPS = 4;
const DEFAULT_DAILY_TOKEN_BUDGET = 50000;
const ALLOWED_OP_KINDS = new Set(['createKnowledge', 'addEvidence', 'updateKnowledge']);

/**
 * Deep-normalizes parsed structured-output JSON by removing every key whose
 * value is null (recursively, over arrays and objects). The proposal-ops JSON
 * schema models optional fields (body, note, patch.*) as required-but-nullable
 * (schema has no "optional" concept) — live LLM output therefore contains
 * explicit `null`s that both validateOps and upsertProposal's arg validator
 * reject (they expect the key to be absent, not null). Call this BEFORE
 * validateOps on any parsed provider output.
 */
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null) continue;
      result[key] = stripNulls(v);
    }
    return result;
  }
  return value;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

type ProviderResult = { ops: unknown[]; rationale: string; citations: { excerpt?: string }[] };

export const run = internalAction({
  args: { userId: v.id('users'), entryId: v.id('entries') },
  handler: async (ctx, args): Promise<null> => {
    const runId = `distill:${args.entryId}:${DISTILL_PROMPT_VERSION}`;

    const budget = Number(process.env.AI_DAILY_TOKEN_BUDGET ?? DEFAULT_DAILY_TOKEN_BUDGET);
    const spent: number = await ctx.runQuery(internal.internal.aiRuns.spentToday, {
      userId: args.userId,
      nowMs: Date.now(),
    });

    const runRowId = await ctx.runMutation(internal.internal.aiRuns.start, {
      userId: args.userId,
      purpose: 'distill',
      runId,
      model: DISTILL_MODEL,
      promptVersion: DISTILL_PROMPT_VERSION,
    });

    if (!withinBudget(spent, budget)) {
      await ctx.runMutation(internal.internal.aiRuns.finish, {
        id: runRowId,
        status: 'error',
        error: 'budget',
      });
      return null;
    }

    // Declared outside the try so the catch below can still report partial spend
    // (e.g. a live call succeeds but a later step throws) on the error finish().
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const inputs = await ctx.runQuery(internal.internal.distillInputs.load, {
        userId: args.userId,
        entryId: args.entryId,
      });

      let result: ProviderResult;

      if (getProviderKind(process.env) === 'stub' || !process.env.OPENAI_API_KEY) {
        result = stubDistillation(inputs.entry.body);
      } else {
        const { system, user } = buildDistillPrompt({
          entryBody: inputs.entry.body,
          entryKind: inputs.entry.kind,
          occurredAt: new Date(inputs.entry.occurredAt).toISOString(),
          knowledgeContext: inputs.knowledgeContext,
        });

        const { default: OpenAI } = await import('openai');
        const client = new OpenAI();

        const attempt = async (
          userContent: string,
        ): Promise<{
          normalized: ProviderResult;
          verdicts: OpVerdict[];
          input: number;
          output: number;
          errorReason: 'truncated' | 'refusal' | null;
        }> => {
          const response = await client.responses.create({
            model: DISTILL_MODEL,
            max_output_tokens: 8192,
            reasoning: { effort: DISTILL_REASONING_EFFORT },
            text: {
              format: { type: 'json_schema', name: 'distill_ops', schema: PROPOSAL_OPS_JSON_SCHEMA, strict: true },
            },
            input: [
              { role: 'system', content: system },
              { role: 'user', content: userContent },
            ],
          });
          const input = response.usage?.input_tokens ?? 0;
          const output = response.usage?.output_tokens ?? 0;
          // Check status/refusal BEFORE ever parsing output_text: real
          // truncation of structured output arrives as PARTIAL (broken) JSON
          // text, not absent text — parsing first would throw a generic
          // SyntaxError that lands in the outer catch with no same-prompt
          // retry, masking the real (recoverable) cause.
          const truncated =
            response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens';
          const refused = response.output.some(
            (item) => item.type === 'message' && item.content.some((block) => block.type === 'refusal'),
          );
          const errorReason: 'truncated' | 'refusal' | null = truncated ? 'truncated' : refused ? 'refusal' : null;
          if (errorReason !== null) {
            return { normalized: { ops: [], rationale: '', citations: [] }, verdicts: [], input, output, errorReason };
          }
          const text = response.output_text;
          if (!text) {
            throw new Error('distill: no text content in provider response');
          }
          const parsed = JSON.parse(text);
          const normalized = stripNulls(parsed) as {
            ops?: unknown[];
            rationale?: string;
            citations?: unknown[];
          };
          const opsField = normalized.ops ?? [];
          return {
            normalized: {
              ops: opsField,
              rationale: normalized.rationale ?? '',
              citations: (normalized.citations ?? []) as { excerpt?: string }[],
            },
            verdicts: validateOps(opsField),
            input,
            output,
            errorReason: null,
          };
        };

        const finishWithError = async (error: string) => {
          await ctx.runMutation(internal.internal.aiRuns.finish, {
            id: runRowId,
            status: 'error',
            inputTokens,
            outputTokens,
            error,
          });
        };

        let attemptResult = await attempt(user);
        inputTokens += attemptResult.input;
        outputTokens += attemptResult.output;
        let callsUsed = 1;

        // Only truncation gets a same-prompt retry (attempt 1 only — total
        // calls stay <= 2); a refusal is a final failure with no retry.
        if (attemptResult.errorReason === 'truncated' && callsUsed < 2) {
          attemptResult = await attempt(user);
          inputTokens += attemptResult.input;
          outputTokens += attemptResult.output;
          callsUsed = 2;
        }
        if (attemptResult.errorReason !== null) {
          await finishWithError(attemptResult.errorReason);
          return null;
        }

        let invalid = attemptResult.verdicts.find((verdict) => !verdict.valid);
        if (invalid && callsUsed < 2) {
          const errorList = attemptResult.verdicts
            .map((verdict, i) => (verdict.valid ? null : `op[${i}]: ${verdict.error}`))
            .filter((line): line is string => line !== null)
            .join('\n');
          const retryUser = `${user}\n\nYour previous output was invalid:\n${errorList}\nRespond again with corrected, valid JSON.`;
          attemptResult = await attempt(retryUser);
          inputTokens += attemptResult.input;
          outputTokens += attemptResult.output;
          callsUsed = 2;
          if (attemptResult.errorReason !== null) {
            await finishWithError(attemptResult.errorReason);
            return null;
          }
          invalid = attemptResult.verdicts.find((verdict) => !verdict.valid);
        }

        if (invalid) {
          await finishWithError('invalid_output');
          return null;
        }

        result = attemptResult.normalized;
      }

      // Post-filters (code, not prompt-trust — 05 §3).
      if (result.ops.length > MAX_OPS) {
        await ctx.runMutation(internal.internal.aiRuns.finish, {
          id: runRowId,
          status: 'error',
          inputTokens,
          outputTokens,
          error: 'too_many_ops',
        });
        return null;
      }

      const knowledgeContextIds = new Set(inputs.knowledgeContext.map((k) => k.id));
      const filteredOps: unknown[] = [];
      // citations are positional (citations[i] supports ops[i] — see the prompt's
      // "every op must cite ..." contract), so dropping an op below must drop its
      // corresponding citation too, or later citations end up misaligned with the
      // surviving ops (the positional-citations bug).
      const filteredCitations: (ProviderResult['citations'][number] | undefined)[] = [];
      for (let i = 0; i < result.ops.length; i++) {
        const rawOp = result.ops[i];
        const citation = result.citations[i];
        if (!isRecord(rawOp) || typeof rawOp.op !== 'string' || !ALLOWED_OP_KINDS.has(rawOp.op)) {
          continue;
        }
        let op = rawOp;
        if (op.op === 'addEvidence') {
          const knowledgeRef = op.knowledge;
          if (
            isRecord(knowledgeRef) &&
            knowledgeRef.kind === 'existing' &&
            !knowledgeContextIds.has(String(knowledgeRef.id))
          ) {
            continue;
          }
          // Distill only ever proposes evidence sourced from the entry it ran
          // on — an op claiming any other sourceType (e.g. 'outcome') is
          // dropped outright rather than having its sourceId silently
          // rewritten to this entry.
          if (op.sourceType !== 'entry') {
            continue;
          }
          if (op.sourceId !== args.entryId) {
            op = { ...op, sourceId: args.entryId };
          }
        }
        if (op.op === 'updateKnowledge') {
          const targetRef = op.target;
          if (
            isRecord(targetRef) &&
            targetRef.kind === 'existing' &&
            !knowledgeContextIds.has(String(targetRef.id))
          ) {
            continue;
          }
        }
        filteredOps.push(op);
        filteredCitations.push(citation);
      }

      if (filteredOps.length === 0) {
        await ctx.runMutation(internal.internal.aiRuns.finish, {
          id: runRowId,
          status: 'ok',
          inputTokens,
          outputTokens,
        });
        return null;
      }

      const citations = filteredCitations.map((c) => ({
        sourceType: 'entry' as const,
        sourceId: args.entryId as unknown as string,
        excerpt: c?.excerpt,
      }));

      const proposalId = await ctx.runMutation(internal.internal.proposalStore.upsertProposal, {
        userId: args.userId,
        source: 'distillation',
        runId,
        entryId: args.entryId,
        ops: filteredOps as never,
        rationale: result.rationale,
        citations,
        model: DISTILL_MODEL,
        promptVersion: DISTILL_PROMPT_VERSION,
      });

      await ctx.runMutation(internal.internal.aiRuns.finish, {
        id: runRowId,
        status: 'ok',
        inputTokens,
        outputTokens,
        proposalId,
      });
      return null;
    } catch (err) {
      await ctx.runMutation(internal.internal.aiRuns.finish, {
        id: runRowId,
        status: 'error',
        inputTokens,
        outputTokens,
        error: err instanceof Error ? err.message : 'unknown error',
      });
      return null;
    }
  },
});
