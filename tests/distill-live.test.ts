/// <reference types="vite/client" />
// TDD for the live Claude branch of the distill action (final-review fixes,
// docs/spec/05-ai-pipeline.md §1/§3): max_tokens/refusal robustness (total
// Claude calls per run stay <= 2) and the addEvidence sourceType post-filter
// (non-'entry' ops — and their positionally-corresponding citation — are
// dropped, not rewritten). Mocks @anthropic-ai/sdk entirely; never hits the
// network.
//
// AI_PROVIDER must NOT be 'stub' and ANTHROPIC_API_KEY must be set before any
// convex module import, so distill.ts takes the live branch.
process.env.ANTHROPIC_API_KEY = 'test-key';
delete process.env.AI_PROVIDER;

import { convexTest, type TestConvex } from 'convex-test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import { DISTILL_MODEL } from '../convex/ai/models';
import { DISTILL_PROMPT_VERSION } from '../convex/ai/prompts/distill';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';

const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: createMock };
  },
}));

const modules = import.meta.glob(['../convex/**/*.ts', '../convex/**/*.js', '!../convex/**/*.d.ts']);
const USER_A = { subject: 'clerk_user_a', name: 'User A' };

type World = TestConvex<typeof schema>;
type AsUser = ReturnType<World['withIdentity']>;

async function provisioned() {
  const t = convexTest(schema, modules);
  const asA = t.withIdentity(USER_A);
  await asA.mutation(api.account.ensureUser, { timezone: 'UTC' });
  const userId = await t.run(async (ctx) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', USER_A.subject))
      .unique();
    return user!._id;
  });
  return { t, asA, userId: userId as Id<'users'> };
}

async function createEntry(asA: AsUser, body: string) {
  return await asA.mutation(api.entries.create, { kind: 'journal', body, occurredAt: 1000 });
}

function textResponse(body: Record<string, unknown>, usage = { input_tokens: 10, output_tokens: 5 }) {
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    stop_reason: 'end_turn',
    usage,
  };
}

function truncatedResponse(usage = { input_tokens: 10, output_tokens: 5 }) {
  return { content: [], stop_reason: 'max_tokens', usage };
}

function refusalResponse(usage = { input_tokens: 10, output_tokens: 5 }) {
  return { content: [], stop_reason: 'refusal', usage };
}

const VALID_BODY = {
  ops: [{ op: 'createKnowledge', type: 'observation', statement: 'I noticed X.' }],
  rationale: 'r',
  citations: [{ excerpt: 'entry excerpt' }],
};

beforeEach(() => {
  createMock.mockReset();
});

async function runRow(t: World, entryId: Id<'entries'>) {
  const runId = `distill:${entryId}:${DISTILL_PROMPT_VERSION}`;
  return await t.run(async (ctx) =>
    ctx.db
      .query('aiRuns')
      .withIndex('by_runId', (q) => q.eq('runId', runId))
      .unique(),
  );
}

describe('distill.run (live branch: max_tokens/refusal robustness)', () => {
  it('max_tokens on attempt 1 retries once with the same prompt; a clean attempt 2 succeeds using exactly 2 calls', async () => {
    const { t, asA, userId } = await provisioned();
    const entryId = await createEntry(asA, 'I get defensive in code review.');
    createMock.mockResolvedValueOnce(truncatedResponse()).mockResolvedValueOnce(textResponse(VALID_BODY));

    await t.action(internal.ai.distill.run, { userId, entryId });

    expect(createMock).toHaveBeenCalledTimes(2);
    const row = await runRow(t, entryId);
    expect(row?.status).toBe('ok');
    expect(row?.proposalId).toBeDefined();
    const proposals = await asA.query(api.proposals.list, {});
    expect(proposals).toHaveLength(1);
  });

  it('max_tokens on both attempts finishes as error "truncated" after exactly 2 calls, no proposal', async () => {
    const { t, asA, userId } = await provisioned();
    const entryId = await createEntry(asA, 'I get defensive in code review.');
    createMock.mockResolvedValueOnce(truncatedResponse()).mockResolvedValueOnce(truncatedResponse());

    await t.action(internal.ai.distill.run, { userId, entryId });

    expect(createMock).toHaveBeenCalledTimes(2);
    const row = await runRow(t, entryId);
    expect(row?.status).toBe('error');
    expect(row?.error).toBe('truncated');
    expect(await asA.query(api.proposals.list, {})).toEqual([]);
  });

  it('a refusal on attempt 1 finishes as error "refusal" immediately — no retry, exactly 1 call', async () => {
    const { t, asA, userId } = await provisioned();
    const entryId = await createEntry(asA, 'I get defensive in code review.');
    createMock.mockResolvedValueOnce(refusalResponse());

    await t.action(internal.ai.distill.run, { userId, entryId });

    expect(createMock).toHaveBeenCalledTimes(1);
    const row = await runRow(t, entryId);
    expect(row?.status).toBe('error');
    expect(row?.error).toBe('refusal');
    expect(await asA.query(api.proposals.list, {})).toEqual([]);
  });

  it('requests max_tokens 8192 and disabled thinking (structured extraction has no use for adaptive thinking)', async () => {
    const { t, asA, userId } = await provisioned();
    const entryId = await createEntry(asA, 'I get defensive in code review.');
    createMock.mockResolvedValueOnce(textResponse(VALID_BODY));

    await t.action(internal.ai.distill.run, { userId, entryId });

    expect(createMock).toHaveBeenCalledTimes(1);
    const requestArgs = createMock.mock.calls[0]![0];
    expect(requestArgs.model).toBe(DISTILL_MODEL);
    expect(requestArgs.max_tokens).toBe(8192);
    expect(requestArgs.thinking).toEqual({ type: 'disabled' });
  });
});

describe('distill.run (live branch: addEvidence sourceType post-filter, Fix 4)', () => {
  it("drops an addEvidence op whose sourceType isn't 'entry' and drops its positionally-corresponding citation, keeping surviving ops/citations aligned", async () => {
    const { t, asA, userId } = await provisioned();
    const entryId = await createEntry(asA, 'I get defensive in code review.');
    createMock.mockResolvedValueOnce(
      textResponse({
        ops: [
          { op: 'createKnowledge', type: 'observation', statement: 'I noticed X.' },
          {
            op: 'addEvidence',
            knowledge: { kind: 'new', index: 0 },
            sourceType: 'outcome',
            sourceId: 'some-outcome-id',
            stance: 'supports',
          },
          {
            op: 'addEvidence',
            knowledge: { kind: 'new', index: 0 },
            sourceType: 'entry',
            sourceId: 'this-will-be-rewritten',
            stance: 'supports',
          },
        ],
        rationale: 'r',
        citations: [
          { excerpt: 'citation for createKnowledge' },
          { excerpt: 'citation for the dropped outcome op' },
          { excerpt: 'citation for the surviving entry op' },
        ],
      }),
    );

    await t.action(internal.ai.distill.run, { userId, entryId });

    const proposals = await asA.query(api.proposals.list, {});
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.ops).toHaveLength(2);
    expect(proposals[0]?.ops[1]).toMatchObject({ op: 'addEvidence', sourceType: 'entry', sourceId: entryId });

    // Positional alignment: citations[1] must be the surviving entry-op's
    // citation, not the dropped outcome-op's citation.
    expect(proposals[0]?.citations).toHaveLength(2);
    expect(proposals[0]?.citations[0]?.excerpt).toBe('citation for createKnowledge');
    expect(proposals[0]?.citations[1]?.excerpt).toBe('citation for the surviving entry op');
  });
});
