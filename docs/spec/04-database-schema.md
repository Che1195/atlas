# 04 — Database Schema (Convex)

Authoritative shape for `convex/schema.ts`. Convex validators are the enforcement layer (the playbook's `PERSISTED_KEYS` + rules `hasOnly` pattern, but checked by one system). Every table carries `userId`; every index leads with it (subject-scoping invariant).

```ts
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const knowledgeType = v.union(
  v.literal('observation'), v.literal('interpretation'), v.literal('insight'),
  v.literal('pattern'), v.literal('principle'), v.literal('question'),
);
const confidence = v.union(
  v.literal('hypothesis'), v.literal('tentative'), v.literal('supported'),
  v.literal('strong'), v.literal('mixed'), v.literal('contradicted'),
);
const stance = v.union(v.literal('supports'), v.literal('contradicts'), v.literal('neutral'));
const relationshipKind = v.union(
  v.literal('derives-from'), v.literal('generalizes'), v.literal('contradicts'),
  v.literal('relates-to'), v.literal('answers'), v.literal('supersedes'),
);
const origin = v.union(v.literal('user'), v.literal('ai'));

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    displayName: v.string(),           // captured at signup — playbook identity rule
    email: v.string(),
    timezone: v.string(),              // IANA, for review scheduling
    settings: v.object({
      autoDistill: v.boolean(),        // default false (cost + control)
      dailyReview: v.boolean(),
      weeklyReview: v.boolean(),
    }),
  }).index('by_clerkId', ['clerkId']),

  entries: defineTable({
    userId: v.id('users'),
    kind: v.union(v.literal('journal'), v.literal('conversation'), v.literal('note')),
    title: v.optional(v.string()),
    body: v.string(),                  // markdown
    occurredAt: v.number(),            // ms epoch; when the experience happened
    source: v.union(v.literal('app'), v.literal('mcp')),
    duplicateOf: v.optional(v.id('entries')),
    editedAt: v.optional(v.number()),
    archived: v.optional(v.boolean()),
    embedding: v.optional(v.array(v.float64())),
    embeddingVersion: v.optional(v.string()),
  })
    .index('by_user', ['userId', 'occurredAt'])
    .searchIndex('search_body', { searchField: 'body', filterFields: ['userId', 'kind'] })
    .vectorIndex('by_embedding', { vectorField: 'embedding', dimensions: 1024, filterFields: ['userId'] }),

  knowledge: defineTable({
    userId: v.id('users'),
    type: knowledgeType,
    statement: v.string(),             // <= 280 chars, enforced in mutation
    body: v.optional(v.string()),
    confidence,
    confidenceOverridden: v.boolean(),
    status: v.union(v.literal('active'), v.literal('archived')),
    origin,
    rev: v.number(),                   // current revision number
    lastReviewedAt: v.optional(v.number()),
    embedding: v.optional(v.array(v.float64())),
    embeddingVersion: v.optional(v.string()),
  })
    .index('by_user_status_type', ['userId', 'status', 'type'])
    .index('by_user_confidence', ['userId', 'confidence'])
    .searchIndex('search_statement', { searchField: 'statement', filterFields: ['userId', 'type', 'status'] })
    .vectorIndex('by_embedding', { vectorField: 'embedding', dimensions: 1024, filterFields: ['userId'] }),

  evidence: defineTable({
    userId: v.id('users'),
    knowledgeId: v.id('knowledge'),
    sourceType: v.union(v.literal('entry'), v.literal('outcome')),
    sourceId: v.string(),              // Id<'entries'> | Id<'outcomes'> as string (polymorphic)
    stance,
    note: v.optional(v.string()),
    origin,
  })
    .index('by_knowledge', ['userId', 'knowledgeId'])
    .index('by_source', ['userId', 'sourceType', 'sourceId'])
    .index('by_unique', ['userId', 'knowledgeId', 'sourceType', 'sourceId']), // uniqueness checked in mutation

  relationships: defineTable({
    userId: v.id('users'),
    fromId: v.id('knowledge'),
    toId: v.id('knowledge'),
    kind: relationshipKind,
    note: v.optional(v.string()),
    origin,
  })
    .index('by_from', ['userId', 'fromId'])
    .index('by_to', ['userId', 'toId']),

  experiments: defineTable({
    userId: v.id('users'),
    knowledgeId: v.id('knowledge'),
    hypothesis: v.string(),
    behavior: v.string(),
    context: v.string(),
    successCriteria: v.string(),
    failureCriteria: v.string(),
    observationTarget: v.string(),
    status: v.union(v.literal('draft'), v.literal('active'), v.literal('completed'), v.literal('abandoned')),
    origin,
    rev: v.number(),
    startedAt: v.optional(v.number()),
  }).index('by_user_status', ['userId', 'status'])
    .index('by_knowledge', ['userId', 'knowledgeId']),

  outcomes: defineTable({
    userId: v.id('users'),
    experimentId: v.id('experiments'),
    result: v.union(v.literal('success'), v.literal('failure'), v.literal('mixed'), v.literal('inconclusive')),
    narrative: v.string(),
    observedAt: v.number(),
  }).index('by_experiment', ['userId', 'experimentId']),

  revisions: defineTable({
    userId: v.id('users'),
    targetType: v.union(v.literal('knowledge'), v.literal('experiment')),
    targetId: v.string(),
    rev: v.number(),
    snapshot: v.any(),                 // full domain-field snapshot; shape validated by lib before write
    actor: v.union(v.literal('user'), v.literal('ai-approved')),
    reason: v.string(),
    proposalId: v.optional(v.id('proposals')),
  }).index('by_target', ['userId', 'targetType', 'targetId', 'rev']),

  proposals: defineTable({
    userId: v.id('users'),
    source: v.union(v.literal('distillation'), v.literal('connection'), v.literal('outcome'),
                    v.literal('mcp'), v.literal('review')),
    runId: v.optional(v.string()),     // idempotency key for pipeline runs
    entryId: v.optional(v.id('entries')),      // primary source doc, if any
    status: v.union(v.literal('pending'), v.literal('resolved'), v.literal('expired'), v.literal('superseded')),
    ops: v.array(v.any()),             // ProposalOp[] — validated by convex/shared/proposalOps.ts zod-style checker in the mutation
    opResolutions: v.optional(v.array(v.union(
      v.literal('pending'), v.literal('approved'), v.literal('rejected'), v.literal('edited'),
    ))),
    rationale: v.string(),             // AI's explanation, shown in review queue
    citations: v.array(v.object({ sourceType: v.string(), sourceId: v.string(), excerpt: v.optional(v.string()) })),
    model: v.string(),
    promptVersion: v.string(),
    resolvedAt: v.optional(v.number()),
  }).index('by_user_status', ['userId', 'status'])
    .index('by_runId', ['userId', 'runId']),

  reviews: defineTable({
    userId: v.id('users'),
    period: v.union(v.literal('daily'), v.literal('weekly')),   // monthly/quarterly post-MVP
    rangeStart: v.number(),
    rangeEnd: v.number(),
    sections: v.object({               // structured, renders natively — no markdown blob
      newInsights: v.array(v.string()),        // knowledge ids
      recurringThemes: v.array(v.object({ theme: v.string(), knowledgeIds: v.array(v.string()) })),
      contradictions: v.array(v.string()),     // knowledge ids currently mixed/contradicted or newly challenged
      experiments: v.array(v.string()),
      confidenceChanges: v.array(v.object({ knowledgeId: v.string(), from: confidence, to: confidence })),
      openQuestions: v.array(v.string()),
      prose: v.string(),                        // short factual narrative, style contract in 05 §5
    }),
    status: v.union(v.literal('unread'), v.literal('read')),
    model: v.string(),
    promptVersion: v.string(),
  }).index('by_user_period', ['userId', 'period', 'rangeStart']),

  apiKeys: defineTable({
    userId: v.id('users'),
    name: v.string(),                  // "Claude Desktop", "Claude Code"
    keyHash: v.string(),               // SHA-256 of full key; plaintext shown once at creation
    prefix: v.string(),                // first 8 chars, for display
    scopes: v.array(v.union(v.literal('read'), v.literal('capture'), v.literal('propose'))),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  }).index('by_hash', ['keyHash'])
    .index('by_user', ['userId']),

  aiRuns: defineTable({                // operational visibility — "no news must mean no crashes"
    userId: v.id('users'),
    purpose: v.union(v.literal('distill'), v.literal('connect'), v.literal('review'),
                     v.literal('ask'), v.literal('embed')),
    runId: v.string(),
    model: v.string(),
    promptVersion: v.string(),
    status: v.union(v.literal('running'), v.literal('ok'), v.literal('error')),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    error: v.optional(v.string()),
    proposalId: v.optional(v.id('proposals')),
  }).index('by_user', ['userId', 'purpose'])
    .index('by_runId', ['runId']),

  issues: defineTable({                // playbook Phase 3: in-app inbox
    userId: v.id('users'),
    title: v.string(),
    body: v.string(),
    route: v.optional(v.string()),
    status: v.union(v.literal('open'), v.literal('resolved'), v.literal('reopened'), v.literal('closed')),
    resolution: v.optional(v.string()),
  }).index('by_status', ['status']),

  crashes: defineTable({               // playbook Phase 3: crash reporting
    userId: v.optional(v.id('users')),
    message: v.string(),
    stack: v.optional(v.string()),
    route: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  }),                                  // no explicit index — _creationTime ordering is implicit
});
```

## Notes and rules

- **Vector dimensions 1024** assumes `text-embedding-3-small` at `dimensions: 1024`; if the embedding model changes, bump `embeddingVersion` and run the backfill cron — never mix versions in one index (filter by `embeddingVersion` if a migration window is unavoidable).
- **`v.any()` appears exactly twice** (`revisions.snapshot`, `proposals.ops`) and both are validated by the shared runtime checker in `convex/shared/proposalOps.ts` before any write. No third `v.any()` without an ADR.
- **Polymorphic `sourceId`/`targetId` as strings:** Convex ids are table-typed; the discriminator field (`sourceType`/`targetType`) governs interpretation. Mutations validate existence + ownership of the referenced doc before writing the edge.
- **Uniqueness** (evidence triple, users.clerkId, apiKeys.keyHash) is enforced by query-then-insert inside mutations — safe because Convex mutations are serializable transactions.
- **Deletion rules:** entries with citing evidence archive instead of delete. Knowledge archives (never hard-deletes) to preserve revision chains, except within account deletion, which purges all tables by `userId` (08-security §data-deletion).
- **Statement length, non-empty bodies, timezone validity** are mutation-level checks in `convex/lib/validate.ts` — validators enforce shape, lib enforces semantics.
