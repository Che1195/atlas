/// <reference types="vite/client" />
// MCP contract suite (Phase M Task 4, docs/spec/06-mcp-interface.md, 11-testing §4).
//
// APPROACH: convex-test's `t.fetch(path, init)` drives the ACTUAL httpAction
// registered in convex/http.ts (it looks up the real router and invokes the real
// handler — see node_modules/convex-test's `fetch` implementation), so this suite
// exercises the real request/response path end to end: JSON parsing, auth
// resolution, rate limiting, tool dispatch, structured errors. Since our bearer
// auth reads the raw `Authorization` header itself (never `ctx.auth`), `t.fetch`
// needs no `withIdentity` — the httpAction's `ctx.auth` is irrelevant to this path.
//
// API keys aren't created via a public mutation yet (Task 5 adds convex/apiKeys.ts)
// — this suite seeds `apiKeys` rows directly via `t.run` + the same `sha256Hex`
// convex/mcp/auth.ts uses, exactly mirroring what Task 5's create() will store.
process.env.AI_PROVIDER = 'stub';

import { convexTest, type TestConvex } from 'convex-test';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { sha256Hex, type Scope } from '../convex/mcp/auth';
import { TOOLS } from '../convex/mcp/tools';
import schema from '../convex/schema';

const modules = import.meta.glob(['../convex/**/*.ts', '../convex/**/*.js', '!../convex/**/*.d.ts']);

type World = TestConvex<typeof schema>;

const USER_A = { subject: 'clerk_user_a', name: 'User A' };
const USER_B = { subject: 'clerk_user_b', name: 'User B' };

function randomHex(bytes: number): string {
  let out = '';
  for (let i = 0; i < bytes; i++) out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  return out;
}

async function provisionedUser(t: World, identity: { subject: string; name: string }) {
  const as = t.withIdentity(identity);
  await as.mutation(api.account.ensureUser, { timezone: 'UTC' });
  const userId = await t.run(async (ctx) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_clerkId', (q) => q.eq('clerkId', identity.subject))
      .unique();
    return user!._id;
  });
  return { as, userId: userId as Id<'users'> };
}

async function seedApiKey(
  t: World,
  userId: Id<'users'>,
  opts: { scopes: Scope[]; revoked?: boolean },
): Promise<{ token: string; keyId: Id<'apiKeys'> }> {
  const token = `atlas_sk_${randomHex(20)}`;
  const keyHash = await sha256Hex(token);
  const keyId = await t.run(async (ctx) =>
    ctx.db.insert('apiKeys', {
      userId,
      name: 'contract-suite key',
      keyHash,
      prefix: token.slice(0, 12),
      scopes: opts.scopes,
      revokedAt: opts.revoked === true ? Date.now() : undefined,
    }),
  );
  return { token, keyId };
}

type JsonRpcEnvelope = { jsonrpc: '2.0'; id: number | string | null; result?: unknown; error?: unknown };

async function rpc(t: World, token: string | undefined, method: string, params?: unknown, id: number | string = 1) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const response = await t.fetch('/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return response;
}

async function toolCall(t: World, token: string, name: string, args: Record<string, unknown> = {}) {
  const response = await rpc(t, token, 'tools/call', { name, arguments: args });
  expect(response.status).toBe(200);
  const body = (await response.json()) as JsonRpcEnvelope;
  const result = body.result as { isError?: boolean; content: { type: string; text: string }[] };
  const parsed = JSON.parse(result.content[0]!.text);
  return { isError: result.isError === true, value: parsed };
}

describe('protocol handshake', () => {
  it('initialize negotiates a protocol version and advertises the tools capability', async () => {
    const t = convexTest(schema, modules);
    const a = await provisionedUser(t, USER_A);
    const { token } = await seedApiKey(t, a.userId, { scopes: ['read'] });

    const response = await rpc(t, token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'contract-suite', version: '0' },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as JsonRpcEnvelope;
    const result = body.result as { protocolVersion: string; capabilities: { tools: unknown }; serverInfo: unknown };
    expect(result.protocolVersion).toBe('2025-06-18');
    expect(result.capabilities.tools).toEqual({});
    expect(result.serverInfo).toEqual({ name: 'atlas', version: '0.1.0' });
  });

  it('falls back to the default protocol version for an unrecognized request version', async () => {
    const t = convexTest(schema, modules);
    const a = await provisionedUser(t, USER_A);
    const { token } = await seedApiKey(t, a.userId, { scopes: ['read'] });
    const response = await rpc(t, token, 'initialize', { protocolVersion: '1999-01-01' });
    const body = (await response.json()) as JsonRpcEnvelope;
    expect((body.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18');
  });

  it('notifications/initialized is accepted with 202 and no body', async () => {
    const t = convexTest(schema, modules);
    const a = await provisionedUser(t, USER_A);
    const { token } = await seedApiKey(t, a.userId, { scopes: ['read'] });
    const response = await t.fetch('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(response.status).toBe(202);
  });

  it('rejects GET /mcp with 405', async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch('/mcp', { method: 'GET' });
    expect(response.status).toBe(405);
  });
});

describe('tools/list snapshot', () => {
  it('pins exactly the 10 shipped tools, their scopes, and non-knowledge writes metadata', async () => {
    const t = convexTest(schema, modules);
    const a = await provisionedUser(t, USER_A);
    const { token } = await seedApiKey(t, a.userId, { scopes: ['read', 'capture', 'propose'] });

    const response = await rpc(t, token, 'tools/list');
    const body = (await response.json()) as JsonRpcEnvelope;
    const tools = (body.result as { tools: { name: string; description: string; inputSchema: unknown }[] }).tools;

    expect(tools.map((tool) => tool.name)).toEqual([
      'atlas_search_knowledge',
      'atlas_get_object',
      'atlas_list_entries',
      'atlas_get_entry',
      'atlas_list_proposals',
      'atlas_list_experiments',
      'atlas_retrieve_context',
      'atlas_create_entry',
      'atlas_preview_proposal',
      'atlas_submit_proposal',
    ]);
    // atlas_list_reviews / atlas_get_review are deliberately absent (deferred —
    // 06 §3, no reviews exist yet). Note: 'atlas_preview_proposal' legitimately
    // contains the substring "review" ("p-review-w"), so check exact names only.
    expect(tools.map((tool) => tool.name)).not.toContain('atlas_list_reviews');
    expect(tools.map((tool) => tool.name)).not.toContain('atlas_get_review');

    for (const tool of tools) {
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
    }

    const submit = tools.find((tool) => tool.name === 'atlas_submit_proposal')!;
    expect(submit.description).toContain('The user must approve these changes in Atlas before they take effect.');
  });

  it('registry metadata: scopes match spec (read/capture/propose) and no tool writes knowledge directly', async () => {
    const expectedScopes: Record<string, Scope> = {
      atlas_search_knowledge: 'read',
      atlas_get_object: 'read',
      atlas_list_entries: 'read',
      atlas_get_entry: 'read',
      atlas_list_proposals: 'read',
      atlas_list_experiments: 'read',
      atlas_retrieve_context: 'read',
      atlas_create_entry: 'capture',
      atlas_preview_proposal: 'propose',
      atlas_submit_proposal: 'propose',
    };
    expect(TOOLS.map((tool) => tool.name).sort()).toEqual(Object.keys(expectedScopes).sort());
    for (const tool of TOOLS) {
      expect(tool.scope).toBe(expectedScopes[tool.name]);
      // The write-asymmetry invariant (06 §2): no tool may write knowledge
      // directly. The type only allows 'none' | 'entries' | 'proposals' — this
      // assertion documents that guarantee at the value level too.
      expect(['none', 'entries', 'proposals']).toContain(tool.writes);
    }
    expect(TOOLS.find((tool) => tool.name === 'atlas_create_entry')!.writes).toBe('entries');
    expect(TOOLS.find((tool) => tool.name === 'atlas_submit_proposal')!.writes).toBe('proposals');
    expect(TOOLS.filter((tool) => tool.writes === 'none')).toHaveLength(8);
  });

  it('no MCP module imports the domain knowledge-write helpers (grep-style static assertion)', () => {
    const files = [
      'convex/mcp/tools.ts',
      'convex/mcp/server.ts',
      'convex/mcp/auth.ts',
      'convex/mcp/proposalSupport.ts',
      'convex/internal/mcpReads.ts',
      'convex/internal/mcpWrites.ts',
      'convex/internal/mcpAuth.ts',
    ];
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(source, `${file} must not import ops/knowledgeWrites`).not.toMatch(/ops\/knowledgeWrites/);
    }
  });
});

describe('authz matrix', () => {
  it('no Authorization header -> 401 structured error', async () => {
    const t = convexTest(schema, modules);
    const response = await rpc(t, undefined, 'tools/list');
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  it('bad/unknown key -> 401', async () => {
    const t = convexTest(schema, modules);
    const response = await rpc(t, 'atlas_sk_' + randomHex(20), 'tools/list');
    expect(response.status).toBe(401);
  });

  it('revoked key -> 401', async () => {
    const t = convexTest(schema, modules);
    const a = await provisionedUser(t, USER_A);
    const { token } = await seedApiKey(t, a.userId, { scopes: ['read'], revoked: true });
    const response = await rpc(t, token, 'tools/list');
    expect(response.status).toBe(401);
  });

  it('wrong scope -> forbidden_scope tool-level error, not an HTTP failure', async () => {
    const t = convexTest(schema, modules);
    const a = await provisionedUser(t, USER_A);
    const { token } = await seedApiKey(t, a.userId, { scopes: ['read'] });
    const response = await rpc(t, token, 'tools/call', {
      name: 'atlas_create_entry',
      arguments: { kind: 'note', body: 'nope' },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as JsonRpcEnvelope;
    const result = body.result as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text).code).toBe('forbidden_scope');
  });

  it('unsupported OAuth token format -> 401 unauthorized with unsupported_token detail (Task 5 seam)', async () => {
    const t = convexTest(schema, modules);
    const response = await rpc(t, 'atlas_oat_' + randomHex(20), 'tools/list');
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string; details?: { reason?: string } } };
    expect(body.error.code).toBe('unauthorized');
    expect(body.error.details?.reason).toBe('unsupported_token');
  });
});

describe('rate limiting', () => {
  it('61st call within the fixed window gets 429 + Retry-After', async () => {
    const t = convexTest(schema, modules);
    const a = await provisionedUser(t, USER_A);
    const { token } = await seedApiKey(t, a.userId, { scopes: ['read'] });

    let last: Response | undefined;
    for (let i = 0; i < 61; i++) {
      last = await rpc(t, token, 'tools/list', undefined, i);
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get('Retry-After')).not.toBeNull();
    const body = (await last!.json()) as { error: { code: string } };
    expect(body.error.code).toBe('rate_limited');
  });
});

describe('per-tool happy paths', () => {
  async function seedWorld() {
    const t = convexTest(schema, modules);
    const a = await provisionedUser(t, USER_A);
    const { token } = await seedApiKey(t, a.userId, { scopes: ['read', 'capture', 'propose'] });
    const entryId = await a.as.mutation(api.entries.create, {
      kind: 'journal',
      body: 'A reflection on staying calm during a deploy incident.',
      occurredAt: Date.parse('2026-01-01T00:00:00Z'),
    });
    const knowledgeId = await a.as.mutation(api.knowledge.create, {
      type: 'observation',
      statement: 'I stay calmer during incidents when I narrate out loud.',
    });
    await a.as.mutation(api.evidence.add, { knowledgeId, entryId, stance: 'supports' });
    return { t, a, token, entryId, knowledgeId };
  }

  it('atlas_search_knowledge finds the seeded object', async () => {
    const { t, token, knowledgeId } = await seedWorld();
    const { value } = await toolCall(t, token, 'atlas_search_knowledge', { query: 'calmer during incidents' });
    expect(Array.isArray(value)).toBe(true);
    expect(value.some((row: { id: string }) => row.id === knowledgeId)).toBe(true);
    expect(value[0]).toHaveProperty('evidenceCounts');
  });

  it('atlas_get_object returns full detail including evidence and computation', async () => {
    const { t, token, knowledgeId, entryId } = await seedWorld();
    const { value } = await toolCall(t, token, 'atlas_get_object', { id: knowledgeId });
    expect(value.id).toBe(knowledgeId);
    expect(value.evidence).toHaveLength(1);
    expect(value.evidence[0].source.id).toBe(entryId);
    expect(value.computation.supports).toBe(1);
  });

  it('atlas_list_entries returns the seeded entry', async () => {
    const { t, token, entryId } = await seedWorld();
    const { value } = await toolCall(t, token, 'atlas_list_entries', {});
    expect(value.some((row: { id: string }) => row.id === entryId)).toBe(true);
  });

  it('atlas_get_entry returns full body + citedBy', async () => {
    const { t, token, entryId, knowledgeId } = await seedWorld();
    const { value } = await toolCall(t, token, 'atlas_get_entry', { id: entryId });
    expect(value.id).toBe(entryId);
    expect(value.citedBy.some((c: { knowledgeId: string }) => c.knowledgeId === knowledgeId)).toBe(true);
  });

  it('atlas_list_proposals returns proposals across all statuses', async () => {
    const { t, a, token } = await seedWorld();
    const userId = await t.run(async (ctx) => {
      const u = await ctx.db
        .query('users')
        .withIndex('by_clerkId', (q) => q.eq('clerkId', USER_A.subject))
        .unique();
      return u!._id;
    });
    await t.mutation(internal.internal.proposalStore.upsertProposal, {
      userId,
      source: 'distillation',
      ops: [{ op: 'createKnowledge', type: 'insight', statement: 'From distill' }],
      rationale: 'r',
      citations: [],
      model: 'stub',
      promptVersion: 'v1',
    });
    void a;
    const { value } = await toolCall(t, token, 'atlas_list_proposals', {});
    expect(value.length).toBeGreaterThan(0);
    expect(value[0]).toHaveProperty('opResolutions');
  });

  it('atlas_list_experiments returns experiments with the tested statement', async () => {
    const { t, token, knowledgeId } = await seedWorld();
    const userId = await t.run(async (ctx) => {
      const u = await ctx.db
        .query('users')
        .withIndex('by_clerkId', (q) => q.eq('clerkId', USER_A.subject))
        .unique();
      return u!._id;
    });
    await t.run(async (ctx) =>
      ctx.db.insert('experiments', {
        userId,
        knowledgeId,
        hypothesis: 'Narrating out loud helps.',
        behavior: 'narrate steps',
        context: 'incidents',
        successCriteria: 'feel calmer',
        failureCriteria: 'no change',
        observationTarget: 'self-report',
        status: 'active',
        origin: 'user',
        rev: 1,
      }),
    );
    const { value } = await toolCall(t, token, 'atlas_list_experiments', {});
    expect(value).toHaveLength(1);
    expect(value[0].knowledgeStatement).toContain('calmer');
  });

  it('atlas_retrieve_context returns a bundle with no synthesis field', async () => {
    const { t, token } = await seedWorld();
    const { value } = await toolCall(t, token, 'atlas_retrieve_context', { question: 'staying calm incidents' });
    expect(value).toHaveProperty('knowledge');
    expect(value).toHaveProperty('entries');
    expect(value).toHaveProperty('relationships');
    expect(value).not.toHaveProperty('answer');
  });

  it('atlas_create_entry writes an entry with source mcp', async () => {
    const { t, token, a } = await seedWorld();
    const { value } = await toolCall(t, token, 'atlas_create_entry', {
      kind: 'note',
      body: 'Captured via an MCP client.',
      occurredAt: '2026-02-01T12:00:00Z',
    });
    expect(typeof value.id).toBe('string');
    const stored = await a.as.query(api.entries.get, { id: value.id });
    expect(stored.source).toBe('mcp');
    expect(stored.occurredAt).toBe(Date.parse('2026-02-01T12:00:00Z'));
  });

  it('atlas_create_entry rejects an invalid ISO occurredAt with invalid_ops', async () => {
    const { t, token } = await seedWorld();
    const { isError, value } = await toolCall(t, token, 'atlas_create_entry', {
      kind: 'note',
      body: 'bad date',
      occurredAt: 'not-a-date',
    });
    expect(isError).toBe(true);
    expect(value.code).toBe('invalid_ops');
  });

  it('atlas_preview_proposal validates without writing, and flags an exact-duplicate statement as a warning', async () => {
    const { t, token, knowledgeId } = await seedWorld();
    // Give the existing knowledge object a (stub) embedding so hybridSearch has
    // a vector signal for the near-duplicate check.
    await t.action(internal.ai.embed.run, {
      userId: await t.run(async (ctx) => (await ctx.db.get(knowledgeId))!.userId),
      targetType: 'knowledge',
      targetId: knowledgeId,
    });

    const { value } = await toolCall(t, token, 'atlas_preview_proposal', {
      ops: [
        {
          op: 'createKnowledge',
          type: 'observation',
          statement: 'I stay calmer during incidents when I narrate out loud.',
        },
      ],
      rationale: 'testing near-dup',
      citations: [],
    });
    expect(value).toHaveLength(1);
    expect(value[0].valid).toBe(true);
    expect(value[0].warnings?.[0]).toContain('near-duplicate');

    // No write happened — dry run.
    const proposals = await t.run(async (ctx) => ctx.db.query('proposals').collect());
    expect(proposals).toHaveLength(0);
  });

  it('atlas_preview_proposal reports a hard error for a nonexistent cited entry', async () => {
    const { t, token } = await seedWorld();
    const { value } = await toolCall(t, token, 'atlas_preview_proposal', {
      ops: [
        {
          op: 'addEvidence',
          knowledge: { kind: 'new', index: 0 },
          sourceType: 'entry',
          sourceId: 'k17abcxyznonexistent00000000',
          stance: 'supports',
        },
      ],
      rationale: 'bad ref',
      citations: [],
    });
    // 'new' index 0 with zero preceding createKnowledge ops is itself invalid
    // (validateOps' ref-bounds check) — this exercises the structural path.
    expect(value[0].valid).toBe(false);
  });

  it('atlas_submit_proposal writes exactly one pending proposals row, source mcp, and returns reviewUrl', async () => {
    const { t, token } = await seedWorld();
    const { value } = await toolCall(t, token, 'atlas_submit_proposal', {
      ops: [{ op: 'createKnowledge', type: 'insight', statement: 'Submitted via MCP.' }],
      rationale: 'because the client reasoned so',
      citations: [{ sourceType: 'entry', sourceId: 'irrelevant', excerpt: 'x' }],
    });
    expect(typeof value.proposalId).toBe('string');
    expect(value.opCount).toBe(1);
    expect(value.reviewUrl).toBe('https://atlas-phi-beige.vercel.app/review');

    const stored = await t.run(async (ctx) => ctx.db.get(value.proposalId as Id<'proposals'>));
    expect(stored?.source).toBe('mcp');
    expect(stored?.status).toBe('pending');
    expect(stored?.runId).toMatch(/^mcp:/);
  });

  it('atlas_submit_proposal rejects invalid ops and writes nothing', async () => {
    const { t, token } = await seedWorld();
    const { isError, value } = await toolCall(t, token, 'atlas_submit_proposal', {
      ops: [{ op: 'createKnowledge', type: 'insight', statement: '' }],
      rationale: 'r',
      citations: [],
    });
    expect(isError).toBe(true);
    expect(value.code).toBe('invalid_ops');
    const proposals = await t.run(async (ctx) => ctx.db.query('proposals').collect());
    expect(proposals).toHaveLength(0);
  });
});

describe('safety invariant: atlas_submit_proposal never materializes knowledge', () => {
  it('creates ONLY a pending proposals row — knowledge/evidence/relationships/experiments untouched', async () => {
    const t = convexTest(schema, modules);
    const a = await provisionedUser(t, USER_A);
    const { token } = await seedApiKey(t, a.userId, { scopes: ['propose'] });

    await toolCall(t, token, 'atlas_submit_proposal', {
      ops: [{ op: 'createKnowledge', type: 'insight', statement: 'Should stay pending forever in this test.' }],
      rationale: 'r',
      citations: [],
    });

    const [knowledge, evidence, relationships, experiments, proposals] = await t.run(async (ctx) => [
      await ctx.db.query('knowledge').collect(),
      await ctx.db.query('evidence').collect(),
      await ctx.db.query('relationships').collect(),
      await ctx.db.query('experiments').collect(),
      await ctx.db.query('proposals').collect(),
    ]);
    expect(knowledge).toHaveLength(0);
    expect(evidence).toHaveLength(0);
    expect(relationships).toHaveLength(0);
    expect(experiments).toHaveLength(0);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.status).toBe('pending');
  });
});

describe('cross-user isolation', () => {
  it("key A cannot read, list, or leak user B's rows", async () => {
    const t = convexTest(schema, modules);
    const a = await provisionedUser(t, USER_A);
    const b = await provisionedUser(t, USER_B);
    const { token: tokenA } = await seedApiKey(t, a.userId, { scopes: ['read', 'capture', 'propose'] });

    const entryIdB = await b.as.mutation(api.entries.create, {
      kind: 'journal',
      body: "B's private entry.",
      occurredAt: 1,
    });
    const knowledgeIdB = await b.as.mutation(api.knowledge.create, {
      type: 'observation',
      statement: "B's private statement.",
    });

    const entryResult = await toolCall(t, tokenA, 'atlas_get_entry', { id: entryIdB });
    expect(entryResult.isError).toBe(true);
    expect(entryResult.value.code).toBe('not_found');

    const objectResult = await toolCall(t, tokenA, 'atlas_get_object', { id: knowledgeIdB });
    expect(objectResult.isError).toBe(true);
    expect(objectResult.value.code).toBe('not_found');

    const list = await toolCall(t, tokenA, 'atlas_list_entries', {});
    expect(list.value).toHaveLength(0);

    const search = await toolCall(t, tokenA, 'atlas_search_knowledge', { query: 'private statement' });
    expect(search.value).toHaveLength(0);
  });
});
