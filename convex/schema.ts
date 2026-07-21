import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// Authoritative shape: docs/spec/04-database-schema.md
// Every table carries userId; every index leads with it (subject-scoping invariant).

export const knowledgeType = v.union(
  v.literal('observation'),
  v.literal('interpretation'),
  v.literal('insight'),
  v.literal('pattern'),
  v.literal('principle'),
  v.literal('question'),
);

export const confidence = v.union(
  v.literal('hypothesis'),
  v.literal('tentative'),
  v.literal('supported'),
  v.literal('strong'),
  v.literal('mixed'),
  v.literal('contradicted'),
);

export const stance = v.union(v.literal('supports'), v.literal('contradicts'), v.literal('neutral'));

export const relationshipKind = v.union(
  v.literal('derives-from'),
  v.literal('generalizes'),
  v.literal('contradicts'),
  v.literal('relates-to'),
  v.literal('answers'),
  v.literal('supersedes'),
);

export const origin = v.union(v.literal('user'), v.literal('ai'));

const EMBEDDING_DIMENSIONS = 1024; // voyage-3.5 — bump embeddingVersion on any change

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    displayName: v.string(),
    email: v.string(),
    timezone: v.string(),
    settings: v.object({
      autoDistill: v.boolean(),
      dailyReview: v.boolean(),
      weeklyReview: v.boolean(),
    }),
  }).index('by_clerkId', ['clerkId']),

  entries: defineTable({
    userId: v.id('users'),
    kind: v.union(v.literal('journal'), v.literal('conversation'), v.literal('note')),
    title: v.optional(v.string()),
    body: v.string(),
    occurredAt: v.number(),
    source: v.union(v.literal('app'), v.literal('mcp')),
    duplicateOf: v.optional(v.id('entries')),
    editedAt: v.optional(v.number()),
    archived: v.optional(v.boolean()),
    embedding: v.optional(v.array(v.float64())),
    embeddingVersion: v.optional(v.string()),
  })
    .index('by_user', ['userId', 'occurredAt'])
    .searchIndex('search_body', { searchField: 'body', filterFields: ['userId', 'kind'] })
    .vectorIndex('by_embedding', {
      vectorField: 'embedding',
      dimensions: EMBEDDING_DIMENSIONS,
      filterFields: ['userId'],
    }),

  knowledge: defineTable({
    userId: v.id('users'),
    type: knowledgeType,
    statement: v.string(),
    body: v.optional(v.string()),
    confidence,
    confidenceOverridden: v.boolean(),
    status: v.union(v.literal('active'), v.literal('archived')),
    origin,
    rev: v.number(),
    lastReviewedAt: v.optional(v.number()),
    embedding: v.optional(v.array(v.float64())),
    embeddingVersion: v.optional(v.string()),
  })
    .index('by_user_status_type', ['userId', 'status', 'type'])
    .index('by_user_confidence', ['userId', 'confidence'])
    .searchIndex('search_statement', {
      searchField: 'statement',
      filterFields: ['userId', 'type', 'status'],
    })
    .vectorIndex('by_embedding', {
      vectorField: 'embedding',
      dimensions: EMBEDDING_DIMENSIONS,
      filterFields: ['userId'],
    }),

  evidence: defineTable({
    userId: v.id('users'),
    knowledgeId: v.id('knowledge'),
    sourceType: v.union(v.literal('entry'), v.literal('outcome')),
    sourceId: v.string(),
    stance,
    note: v.optional(v.string()),
    origin,
  })
    .index('by_knowledge', ['userId', 'knowledgeId'])
    .index('by_source', ['userId', 'sourceType', 'sourceId'])
    .index('by_unique', ['userId', 'knowledgeId', 'sourceType', 'sourceId']),

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
    status: v.union(
      v.literal('draft'),
      v.literal('active'),
      v.literal('completed'),
      v.literal('abandoned'),
    ),
    origin,
    rev: v.number(),
    startedAt: v.optional(v.number()),
  })
    .index('by_user_status', ['userId', 'status'])
    .index('by_knowledge', ['userId', 'knowledgeId']),

  outcomes: defineTable({
    userId: v.id('users'),
    experimentId: v.id('experiments'),
    result: v.union(
      v.literal('success'),
      v.literal('failure'),
      v.literal('mixed'),
      v.literal('inconclusive'),
    ),
    narrative: v.string(),
    observedAt: v.number(),
  }).index('by_experiment', ['userId', 'experimentId']),

  revisions: defineTable({
    userId: v.id('users'),
    targetType: v.union(v.literal('knowledge'), v.literal('experiment')),
    targetId: v.string(),
    rev: v.number(),
    // Shape validated by convex/shared before write — sanctioned any-validator 1 of 2 (04 §notes)
    snapshot: v.any(),
    actor: v.union(v.literal('user'), v.literal('ai-approved')),
    reason: v.string(),
    proposalId: v.optional(v.id('proposals')),
  }).index('by_target', ['userId', 'targetType', 'targetId', 'rev']),

  proposals: defineTable({
    userId: v.id('users'),
    source: v.union(
      v.literal('distillation'),
      v.literal('connection'),
      v.literal('outcome'),
      v.literal('mcp'),
      v.literal('review'),
    ),
    runId: v.optional(v.string()),
    entryId: v.optional(v.id('entries')),
    status: v.union(
      v.literal('pending'),
      v.literal('resolved'),
      v.literal('expired'),
      v.literal('superseded'),
    ),
    // ProposalOp[] — validated by convex/shared/proposalOps.ts before write; sanctioned any-validator 2 of 2
    ops: v.array(v.any()),
    opResolutions: v.optional(
      v.array(
        v.union(
          v.literal('pending'),
          v.literal('approved'),
          v.literal('rejected'),
          v.literal('edited'),
        ),
      ),
    ),
    rationale: v.string(),
    citations: v.array(
      v.object({
        sourceType: v.string(),
        sourceId: v.string(),
        excerpt: v.optional(v.string()),
      }),
    ),
    model: v.string(),
    promptVersion: v.string(),
    resolvedAt: v.optional(v.number()),
  })
    .index('by_user_status', ['userId', 'status'])
    .index('by_runId', ['userId', 'runId']),

  reviews: defineTable({
    userId: v.id('users'),
    period: v.union(v.literal('daily'), v.literal('weekly')),
    rangeStart: v.number(),
    rangeEnd: v.number(),
    sections: v.object({
      newInsights: v.array(v.string()),
      recurringThemes: v.array(v.object({ theme: v.string(), knowledgeIds: v.array(v.string()) })),
      contradictions: v.array(v.string()),
      experiments: v.array(v.string()),
      confidenceChanges: v.array(
        v.object({ knowledgeId: v.string(), from: confidence, to: confidence }),
      ),
      openQuestions: v.array(v.string()),
      prose: v.string(),
    }),
    status: v.union(v.literal('unread'), v.literal('read')),
    model: v.string(),
    promptVersion: v.string(),
  }).index('by_user_period', ['userId', 'period', 'rangeStart']),

  apiKeys: defineTable({
    userId: v.id('users'),
    name: v.string(),
    keyHash: v.string(),
    prefix: v.string(),
    scopes: v.array(v.union(v.literal('read'), v.literal('capture'), v.literal('propose'))),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index('by_hash', ['keyHash'])
    .index('by_user', ['userId']),

  aiRuns: defineTable({
    userId: v.id('users'),
    purpose: v.union(
      v.literal('distill'),
      v.literal('connect'),
      v.literal('review'),
      v.literal('ask'),
      v.literal('embed'),
    ),
    runId: v.string(),
    model: v.string(),
    promptVersion: v.string(),
    status: v.union(v.literal('running'), v.literal('ok'), v.literal('error')),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    error: v.optional(v.string()),
    proposalId: v.optional(v.id('proposals')),
  })
    .index('by_user', ['userId', 'purpose'])
    .index('by_runId', ['runId']),

  issues: defineTable({
    userId: v.id('users'),
    title: v.string(),
    body: v.string(),
    route: v.optional(v.string()),
    status: v.union(
      v.literal('open'),
      v.literal('resolved'),
      v.literal('reopened'),
      v.literal('closed'),
    ),
    resolution: v.optional(v.string()),
  }).index('by_status', ['status']),

  crashes: defineTable({
    userId: v.optional(v.id('users')),
    message: v.string(),
    stack: v.optional(v.string()),
    route: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  }),
});
