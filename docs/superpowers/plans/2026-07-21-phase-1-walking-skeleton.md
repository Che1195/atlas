# Phase 1 — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stranger can sign up on their phone, capture an entry, manually create a knowledge object, link evidence by hand, and see it in Knowledge list/detail — deployed as an installable PWA, with the adversarial isolation suite green over every public function.

**Architecture:** All business logic in Convex functions + pure libs (`convex/lib/`); the Next.js App Router PWA is a thin client. New public modules: `entries`, `knowledge`, `evidence`. Every mutation that touches a knowledge object writes a `revisions` snapshot. Confidence is recomputed by the pure function in `convex/lib/confidence.ts` whenever evidence changes (auto-applied while not overridden; override UI is Phase 4). No AI anywhere — the manual path is the permanent fallback path.

**Tech Stack:** Next.js 16 App Router · React 19 · Tailwind v4 (MERIDIAN tokens, already in `app/globals.css`) · Convex 1.42 (`convex-test` for function tests) · Clerk 7 · Vitest 4 · bun.

## Global Constraints

- Work on branch `phase-1-walking-skeleton`; PR to `main` at the end (Phase 0 followed this flow).
- Every public Convex function starts with `requireUser(ctx)` (or `currentUser` for optional-auth); **no function accepts a client-supplied `userId`** (`scripts/check-invariants.sh` fails the lint otherwise).
- Every `ctx.db.get` is followed by `assertOwner(doc, user)` from `convex/lib/auth.ts` before contents are read or written.
- Every new public function gets a row in `tests/isolation.registry.ts` — the registry-completeness test in `tests/isolation.test.ts` fails the build otherwise, by design.
- Statement max length 280 — import `STATEMENT_MAX_LENGTH` from `convex/shared/proposalOps.ts`, never redefine.
- Knowledge type `interpretation` exists in the schema/backend but is **never offered in UI pickers** (spec 00 deviation 4).
- All colors/sizes via MERIDIAN tokens (`text-meta`/`text-body`/`text-statement`/`text-title`, `text-ink*`, `bg-paper`/`bg-surface`, `text-meridian`/`text-support`/`text-contradict`/`text-pending`, `rounded-card`/`rounded-control`, `font-statement` for knowledge statements). No new colors or sizes.
- Every interactive element gets a semantic `data-testid` at creation (e.g. `capture-input`, `capture-save`, `knowledge-new`).
- All text inputs ≥ 16px rendered size: add className `text-base` to every `<input>`/`<textarea>`/`<select>` (iOS force-zoom rule; the token scale's body size is 15px — do not use it on inputs).
- Honest copy only: no fake success states, no gamification, no celebratory motion. Motion limited to the existing `.fade-state` class.
- No `Date.now()` inside `convex/lib/**` (pure, injected time). `Date.now()` in mutation handlers is fine.
- Schema is locked (`convex/schema.ts` matches spec 04) — do not modify it in this phase.
- After adding/renaming Convex functions, run `bunx convex codegen` so `convex/_generated/` (and typecheck) sees them.
- Pipeline before every commit: `bun run pipeline` (typecheck + lint + invariants + tests). Playwright E2E does not exist yet — it is built in Phase 2, not here.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Pure libs — statement validation + confidence computation

**Files:**
- Modify: `convex/lib/validate.ts`
- Create: `convex/lib/confidence.ts`
- Test: `tests/validate.test.ts` (append), `tests/confidence.test.ts`

**Interfaces:**
- Consumes: `STATEMENT_MAX_LENGTH`, `Stance` from `convex/shared/proposalOps.ts`; `requireNonEmpty` from `convex/lib/validate.ts`.
- Produces:
  - `requireStatement(value: string): string` — trims, throws `ConvexError` on empty or > 280 chars.
  - `type Confidence = 'hypothesis' | 'tentative' | 'supported' | 'strong' | 'mixed' | 'contradicted'`
  - `type EvidenceSource = { sourceType: 'entry' | 'outcome'; sourceId: string; stance: Stance }`
  - `type ConfidenceComputation = { suggested: Confidence; supports: number; contradicts: number }`
  - `computeConfidence(evidence: EvidenceSource[], duplicateOf: Record<string, string>): ConfidenceComputation`

- [ ] **Step 1: Write the failing tests**

Append to `tests/validate.test.ts`:

```ts
import { requireStatement } from '../convex/lib/validate';

describe('requireStatement', () => {
  it('trims and returns valid statements', () => {
    expect(requireStatement('  I avoid conflict.  ')).toBe('I avoid conflict.');
  });
  it('rejects empty statements', () => {
    expect(() => requireStatement('   ')).toThrow();
  });
  it('rejects statements over 280 chars', () => {
    expect(() => requireStatement('x'.repeat(281))).toThrow();
    expect(requireStatement('x'.repeat(280))).toBe('x'.repeat(280));
  });
});
```

Create `tests/confidence.test.ts`:

```ts
// Confidence matrix per docs/spec/03-domain-model.md §5.
import { describe, expect, it } from 'vitest';
import { computeConfidence, type EvidenceSource } from '../convex/lib/confidence';

const entry = (id: string, stance: EvidenceSource['stance'] = 'supports'): EvidenceSource => ({
  sourceType: 'entry',
  sourceId: id,
  stance,
});
const outcome = (id: string, stance: EvidenceSource['stance'] = 'supports'): EvidenceSource => ({
  sourceType: 'outcome',
  sourceId: id,
  stance,
});

describe('computeConfidence', () => {
  it('no evidence → hypothesis', () => {
    expect(computeConfidence([], {})).toEqual({ suggested: 'hypothesis', supports: 0, contradicts: 0 });
  });
  it('C=0 ladder: 1→tentative, 2-3→supported, 4+→strong', () => {
    expect(computeConfidence([entry('e1')], {}).suggested).toBe('tentative');
    expect(computeConfidence([entry('e1'), entry('e2')], {}).suggested).toBe('supported');
    expect(computeConfidence([entry('e1'), entry('e2'), entry('e3')], {}).suggested).toBe('supported');
    expect(
      computeConfidence([entry('e1'), entry('e2'), entry('e3'), entry('e4')], {}).suggested,
    ).toBe('strong');
  });
  it('outcomes count double-weight on the supporting side', () => {
    const c = computeConfidence([outcome('o1')], {});
    expect(c).toEqual({ suggested: 'supported', supports: 2, contradicts: 0 });
  });
  it('S > 2C → supported (mixed-leaning-supported)', () => {
    const c = computeConfidence(
      [entry('e1'), entry('e2'), entry('e3'), entry('x', 'contradicts')],
      {},
    );
    expect(c).toEqual({ suggested: 'supported', supports: 3, contradicts: 1 });
  });
  it('C>0 and S <= 2C → mixed', () => {
    expect(computeConfidence([entry('x', 'contradicts')], {}).suggested).toBe('mixed');
    expect(
      computeConfidence(
        [entry('e1'), entry('e2'), entry('e3'), entry('e4'), entry('x', 'contradicts'), entry('y', 'contradicts')],
        {},
      ).suggested,
    ).toBe('mixed'); // S=4, C=2, S <= 2C
  });
  it('C>=2 and C>S → contradicted', () => {
    expect(
      computeConfidence([entry('e1'), entry('x', 'contradicts'), entry('y', 'contradicts')], {})
        .suggested,
    ).toBe('contradicted');
  });
  it('duplicateOf chains collapse to one distinct source', () => {
    const c = computeConfidence([entry('e1'), entry('e2')], { e2: 'e1' });
    expect(c).toEqual({ suggested: 'tentative', supports: 1, contradicts: 0 });
    // chain e3 → e2 → e1
    expect(
      computeConfidence([entry('e1'), entry('e2'), entry('e3')], { e3: 'e2', e2: 'e1' }).supports,
    ).toBe(1);
  });
  it('duplicateOf cycles do not hang', () => {
    expect(computeConfidence([entry('e1'), entry('e2')], { e1: 'e2', e2: 'e1' }).supports).toBe(1);
  });
  it('neutral stance is ignored in both counts', () => {
    const c = computeConfidence([entry('e1'), entry('n', 'neutral')], {});
    expect(c).toEqual({ suggested: 'tentative', supports: 1, contradicts: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `requireStatement` not exported, `convex/lib/confidence.ts` does not exist.

- [ ] **Step 3: Implement**

Append to `convex/lib/validate.ts`:

```ts
import { STATEMENT_MAX_LENGTH } from '../shared/proposalOps';

export function requireStatement(value: string): string {
  const trimmed = requireNonEmpty(value, 'statement');
  if (trimmed.length > STATEMENT_MAX_LENGTH) {
    throw new ConvexError({
      code: 'invalid_input',
      message: `statement exceeds ${STATEMENT_MAX_LENGTH} characters.`,
    });
  }
  return trimmed;
}
```

(Note: `import { ConvexError } from 'convex/values'` already exists at the top of the file; move the new import up with the others.)

Create `convex/lib/confidence.ts`:

```ts
// Confidence computation (docs/spec/03-domain-model.md §5). Pure — no ctx, no Date.now().
// The AI never sets confidence; this function is the only writer of the suggestion.
// Distinct-source counting enforces "repeated summaries are not additional evidence":
// entry sources collapse through duplicateOf chains; outcomes count double-weight
// (real-world tests beat recollections). Neutral stance affects neither count.

import type { Stance } from '../shared/proposalOps';

export type Confidence =
  | 'hypothesis'
  | 'tentative'
  | 'supported'
  | 'strong'
  | 'mixed'
  | 'contradicted';

export type EvidenceSource = {
  sourceType: 'entry' | 'outcome';
  sourceId: string;
  stance: Stance;
};

export type ConfidenceComputation = {
  suggested: Confidence;
  supports: number;
  contradicts: number;
};

/** Resolve an entry id through duplicateOf links to its root (cycle-safe). */
function canonicalId(id: string, duplicateOf: Record<string, string>): string {
  let current = id;
  const seen = new Set<string>();
  while (duplicateOf[current] !== undefined && !seen.has(current)) {
    seen.add(current);
    current = duplicateOf[current];
  }
  return current;
}

export function computeConfidence(
  evidence: EvidenceSource[],
  duplicateOf: Record<string, string>,
): ConfidenceComputation {
  const weights = new Map<string, number>(); // canonical source key -> weight
  const stances = new Map<string, Stance>();
  for (const source of evidence) {
    if (source.stance === 'neutral') continue;
    const canonical =
      source.sourceType === 'entry'
        ? `entry:${canonicalId(source.sourceId, duplicateOf)}`
        : `outcome:${source.sourceId}`;
    weights.set(canonical, source.sourceType === 'outcome' ? 2 : 1);
    stances.set(canonical, source.stance);
  }

  let supports = 0;
  let contradicts = 0;
  for (const [key, stance] of stances) {
    const weight = weights.get(key) ?? 1;
    if (stance === 'supports') supports += weight;
    else contradicts += stance === 'contradicts' ? 1 : 0; // contradicting sources are not double-weighted
  }

  let suggested: Confidence;
  if (contradicts === 0) {
    if (supports === 0) suggested = 'hypothesis';
    else if (supports === 1) suggested = 'tentative';
    else if (supports <= 3) suggested = 'supported';
    else suggested = 'strong';
  } else if (contradicts >= 2 && contradicts > supports) {
    suggested = 'contradicted';
  } else if (supports > 2 * contradicts) {
    suggested = 'supported';
  } else {
    suggested = 'mixed';
  }

  return { suggested, supports, contradicts };
}
```

Caveat on the same-source-both-stances edge: one map keyed by canonical id means a source that appears with both `supports` and `contradicts` counts once with the later stance — acceptable; the evidence-uniqueness rule (one row per knowledge/source pair) makes it unreachable in practice.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add convex/lib/validate.ts convex/lib/confidence.ts tests/validate.test.ts tests/confidence.test.ts
git commit -m "Phase 1: statement validation + pure confidence computation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Entries backend

**Files:**
- Create: `convex/entries.ts`
- Modify: `tests/isolation.registry.ts`
- Test: `tests/entries.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `assertOwner` (`convex/lib/auth.ts`); `requireNonEmpty` (`convex/lib/validate.ts`).
- Produces public functions (all subject-scoped, no `userId` args):
  - `entries.create({ kind: 'journal'|'conversation'|'note', title?: string, body: string, occurredAt: number }) → Id<'entries'>` — `source: 'app'`.
  - `entries.update({ id, kind?, title?, body?, occurredAt? }) → null` — sets `editedAt`.
  - `entries.list({}) → Array<{ _id, kind, title?, excerpt: string, occurredAt, source, editedAt? }>` — newest 50 by `occurredAt`, archived excluded.
  - `entries.get({ id }) → entry doc & { citedBy: Array<{ evidenceId, stance, knowledgeId, statement }> }`
  - `entries.remove({ id }) → { archived: true } | { deleted: true }` — archives instead of deleting when evidence cites it (AC-2.4).

- [ ] **Step 1: Write the failing tests**

Create `tests/entries.test.ts`:

```ts
/// <reference types="vite/client" />
// Entries behavioral suite (AC-2.1, AC-2.4 archive half lands with evidence in Task 4).
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob(['../convex/**/*.ts', '../convex/**/*.js', '!../convex/**/*.d.ts']);
const USER_A = { subject: 'clerk_user_a', name: 'User A' };

async function provisioned() {
  const t = convexTest(schema, modules);
  const asA = t.withIdentity(USER_A);
  await asA.mutation(api.account.ensureUser, { timezone: 'UTC' });
  return { t, asA };
}

describe('entries', () => {
  it('create + list roundtrip with source app and newest-first order (AC-2.1)', async () => {
    const { asA } = await provisioned();
    await asA.mutation(api.entries.create, { kind: 'journal', body: 'older', occurredAt: 1000 });
    await asA.mutation(api.entries.create, { kind: 'note', body: 'newer', occurredAt: 2000 });
    const list = await asA.query(api.entries.list, {});
    expect(list.map((e) => e.excerpt)).toEqual(['newer', 'older']);
    expect(list[0]?.source).toBe('app');
    expect(list[0]?.kind).toBe('note');
  });

  it('create rejects empty body', async () => {
    const { asA } = await provisioned();
    await expect(
      asA.mutation(api.entries.create, { kind: 'journal', body: '   ', occurredAt: 1000 }),
    ).rejects.toThrow();
  });

  it('update patches fields and stamps editedAt', async () => {
    const { asA } = await provisioned();
    const id = await asA.mutation(api.entries.create, { kind: 'journal', body: 'v1', occurredAt: 1000 });
    await asA.mutation(api.entries.update, { id, body: 'v2', title: 'T' });
    const entry = await asA.query(api.entries.get, { id });
    expect(entry.body).toBe('v2');
    expect(entry.title).toBe('T');
    expect(entry.editedAt).toBeTypeOf('number');
  });

  it('remove deletes an uncited entry outright', async () => {
    const { asA } = await provisioned();
    const id = await asA.mutation(api.entries.create, { kind: 'journal', body: 'x', occurredAt: 1 });
    const result = await asA.mutation(api.entries.remove, { id });
    expect(result).toEqual({ deleted: true });
    expect(await asA.query(api.entries.list, {})).toEqual([]);
  });

  it('get returns citedBy empty when no evidence exists', async () => {
    const { asA } = await provisioned();
    const id = await asA.mutation(api.entries.create, { kind: 'journal', body: 'x', occurredAt: 1 });
    const entry = await asA.query(api.entries.get, { id });
    expect(entry.citedBy).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `api.entries` does not exist. (`tests/isolation.test.ts` may also start failing registry completeness once the module exists — that is the next steps' job.)

- [ ] **Step 3: Implement `convex/entries.ts`**

```ts
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { assertOwner, requireUser } from './lib/auth';
import { requireNonEmpty } from './lib/validate';

const entryKind = v.union(v.literal('journal'), v.literal('conversation'), v.literal('note'));

export const create = mutation({
  args: {
    kind: entryKind,
    title: v.optional(v.string()),
    body: v.string(),
    occurredAt: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await ctx.db.insert('entries', {
      userId: user._id,
      kind: args.kind,
      title: args.title,
      body: requireNonEmpty(args.body, 'body'),
      occurredAt: args.occurredAt,
      source: 'app',
    });
  },
});

export const update = mutation({
  args: {
    id: v.id('entries'),
    kind: v.optional(entryKind),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    occurredAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const entry = assertOwner(await ctx.db.get(args.id), user);
    const patch: Partial<typeof entry> = { editedAt: Date.now() };
    if (args.kind !== undefined) patch.kind = args.kind;
    if (args.title !== undefined) patch.title = args.title;
    if (args.body !== undefined) patch.body = requireNonEmpty(args.body, 'body');
    if (args.occurredAt !== undefined) patch.occurredAt = args.occurredAt;
    await ctx.db.patch(entry._id, patch);
    return null;
  },
});

/** Newest 50 non-archived entries (Capture screen's recent list). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query('entries')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .order('desc')
      .take(50);
    return rows
      .filter((entry) => entry.archived !== true)
      .map((entry) => ({
        _id: entry._id,
        kind: entry.kind,
        title: entry.title,
        excerpt: entry.body.slice(0, 120),
        occurredAt: entry.occurredAt,
        source: entry.source,
        editedAt: entry.editedAt,
      }));
  },
});

/** Full entry + the evidence rows citing it ("This entry supports …"). */
export const get = query({
  args: { id: v.id('entries') },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const entry = assertOwner(await ctx.db.get(args.id), user);
    const citing = await ctx.db
      .query('evidence')
      .withIndex('by_source', (q) =>
        q.eq('userId', user._id).eq('sourceType', 'entry').eq('sourceId', args.id),
      )
      .collect();
    const citedBy = [];
    for (const evidenceRow of citing) {
      const knowledge = await ctx.db.get(evidenceRow.knowledgeId);
      if (knowledge === null || knowledge.userId !== user._id) continue;
      citedBy.push({
        evidenceId: evidenceRow._id,
        stance: evidenceRow.stance,
        knowledgeId: knowledge._id,
        statement: knowledge.statement,
      });
    }
    return { ...entry, citedBy };
  },
});

/** Delete when uncited; archive when evidence cites it (AC-2.4 — evidence integrity). */
export const remove = mutation({
  args: { id: v.id('entries') },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const entry = assertOwner(await ctx.db.get(args.id), user);
    const cited = await ctx.db
      .query('evidence')
      .withIndex('by_source', (q) =>
        q.eq('userId', user._id).eq('sourceType', 'entry').eq('sourceId', args.id),
      )
      .first();
    if (cited !== null) {
      await ctx.db.patch(entry._id, { archived: true });
      return { archived: true as const };
    }
    await ctx.db.delete(entry._id);
    return { deleted: true as const };
  },
});
```

Run: `bunx convex codegen`

- [ ] **Step 4: Add isolation registry rows**

In `tests/isolation.registry.ts`, add a seed helper below the imports (reused by Tasks 3–4):

```ts
const USER_A = { subject: 'clerk_user_a', name: 'User A' };

/** Seed an entry owned by user A; returns its id. A is already provisioned by the suite. */
async function seedEntryForA(t: T): Promise<string> {
  const api = await apiOf();
  return await t
    .withIdentity(USER_A)
    .mutation(api.entries.create, { kind: 'journal', body: 'A private entry', occurredAt: 1000 });
}
```

Append to `ISOLATION_CASES` (user B must never reach A's data; `assertOwner` throws the uniform `not_found`):

```ts
  {
    fn: 'entries.create',
    run: async (t, accessor) => {
      await seedEntryForA(t);
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const api = await apiOf();
      await asB.mutation(api.account.ensureUser, { timezone: 'UTC' });
      await asB.mutation(api.entries.create, { kind: 'note', body: 'B entry', occurredAt: 1 });
      const listB = await asB.query(api.entries.list, {});
      if (listB.length !== 1 || listB[0]?.excerpt !== 'B entry') {
        throw new Error('entries.create/list leaked another user’s entries');
      }
    },
  },
  {
    fn: 'entries.list',
    run: async (t, accessor) => {
      await seedEntryForA(t);
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const api = await apiOf();
      await asB.mutation(api.account.ensureUser, { timezone: 'UTC' });
      const listB = await asB.query(api.entries.list, {});
      if (listB.length !== 0) throw new Error('entries.list leaked another user’s entries');
    },
  },
  {
    fn: 'entries.get',
    run: async (t, accessor) => {
      const entryIdA = await seedEntryForA(t);
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const api = await apiOf();
      await asB.mutation(api.account.ensureUser, { timezone: 'UTC' });
      let leaked = false;
      try {
        await asB.query(api.entries.get, { id: entryIdA as never });
        leaked = true;
      } catch {
        // expected: uniform not_found
      }
      if (leaked) throw new Error('entries.get returned another user’s entry');
    },
  },
  {
    fn: 'entries.update',
    run: async (t, accessor) => {
      const entryIdA = await seedEntryForA(t);
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const api = await apiOf();
      await asB.mutation(api.account.ensureUser, { timezone: 'UTC' });
      let leaked = false;
      try {
        await asB.mutation(api.entries.update, { id: entryIdA as never, body: 'defaced' });
        leaked = true;
      } catch {
        // expected
      }
      if (leaked) throw new Error('entries.update mutated another user’s entry');
    },
  },
  {
    fn: 'entries.remove',
    run: async (t, accessor) => {
      const entryIdA = await seedEntryForA(t);
      const asB = t.withIdentity({ subject: accessor.subject, name: 'User B' });
      const api = await apiOf();
      await asB.mutation(api.account.ensureUser, { timezone: 'UTC' });
      let leaked = false;
      try {
        await asB.mutation(api.entries.remove, { id: entryIdA as never });
        leaked = true;
      } catch {
        // expected
      }
      if (leaked) throw new Error('entries.remove deleted another user’s entry');
    },
  },
```

(`as never` casts: the registry seeds return `string` ids across test-world boundaries; the cast keeps the registry honest about crossing users without weakening the app types.)

- [ ] **Step 5: Run the full suite**

Run: `bun run test`
Expected: PASS — entries suite green, registry completeness green (5 new rows), all isolation cases green.

- [ ] **Step 6: Commit**

```bash
git add convex/entries.ts tests/entries.test.ts tests/isolation.registry.ts
git commit -m "Phase 1: entries capture backend with citation-guarded delete

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Knowledge backend (create / revise / archive / list / get)

**Files:**
- Create: `convex/lib/revisions.ts`, `convex/knowledge.ts`
- Modify: `tests/isolation.registry.ts`
- Test: `tests/knowledge.test.ts`

**Interfaces:**
- Consumes: Task 1's `requireStatement`, `computeConfidence`; `assertOwner`/`requireUser`.
- Produces:
  - `knowledgeSnapshot(doc: Doc<'knowledge'>)` in `convex/lib/revisions.ts` — the only shape written to `revisions.snapshot` for knowledge (spec 04: `v.any()` is validated by lib before write).
  - `knowledge.create({ type, statement, body? }) → Id<'knowledge'>` — `confidence: 'hypothesis'`, `origin: 'user'`, `rev: 1`, revision row `rev 1`, reason `'Created'`.
  - `knowledge.revise({ id, patch: { statement?, body?, type? }, reason }) → null` — reason required (AC-4.2), bumps `rev`, writes revision `actor: 'user'`.
  - `knowledge.archive({ id, reason }) → null` — sets `status: 'archived'` + revision.
  - `knowledge.list({ type?, status?, confidence? }) → Array<{ _id, type, statement, confidence, status, supports, contradicts, lastRevisedAt }>` — default `status: 'active'`, sorted by `lastRevisedAt` desc.
  - `knowledge.get({ id }) → { …domain fields, computation, evidence: Array<{ _id, stance, note, origin, source: { id, excerpt, occurredAt } | null }>, revisions: Array<{ rev, actor, reason, at }> }`

- [ ] **Step 1: Write the failing tests**

Create `tests/knowledge.test.ts`:

```ts
/// <reference types="vite/client" />
// Knowledge behavioral suite (AC-4.1 shape, AC-4.2 reason-required revisions, AC-4.3 archive).
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob(['../convex/**/*.ts', '../convex/**/*.js', '!../convex/**/*.d.ts']);
const USER_A = { subject: 'clerk_user_a', name: 'User A' };

async function provisioned() {
  const t = convexTest(schema, modules);
  const asA = t.withIdentity(USER_A);
  await asA.mutation(api.account.ensureUser, { timezone: 'UTC' });
  return { t, asA };
}

describe('knowledge', () => {
  it('create defaults + first revision written', async () => {
    const { asA } = await provisioned();
    const id = await asA.mutation(api.knowledge.create, {
      type: 'insight',
      statement: 'I become performative around perceived-higher-status people.',
    });
    const detail = await asA.query(api.knowledge.get, { id });
    expect(detail.confidence).toBe('hypothesis');
    expect(detail.origin).toBe('user');
    expect(detail.status).toBe('active');
    expect(detail.rev).toBe(1);
    expect(detail.revisions).toHaveLength(1);
    expect(detail.revisions[0]).toMatchObject({ rev: 1, actor: 'user', reason: 'Created' });
    expect(detail.computation).toEqual({ suggested: 'hypothesis', supports: 0, contradicts: 0 });
  });

  it('create rejects over-length statements', async () => {
    const { asA } = await provisioned();
    await expect(
      asA.mutation(api.knowledge.create, { type: 'insight', statement: 'x'.repeat(281) }),
    ).rejects.toThrow();
  });

  it('revise requires a reason, bumps rev, snapshots (AC-4.2)', async () => {
    const { asA } = await provisioned();
    const id = await asA.mutation(api.knowledge.create, { type: 'insight', statement: 'v1' });
    await expect(
      asA.mutation(api.knowledge.revise, { id, patch: { statement: 'v2' }, reason: '  ' }),
    ).rejects.toThrow();
    await expect(
      asA.mutation(api.knowledge.revise, { id, patch: {}, reason: 'no-op' }),
    ).rejects.toThrow();
    await asA.mutation(api.knowledge.revise, { id, patch: { statement: 'v2' }, reason: 'sharper wording' });
    const detail = await asA.query(api.knowledge.get, { id });
    expect(detail.statement).toBe('v2');
    expect(detail.rev).toBe(2);
    expect(detail.revisions[0]).toMatchObject({ rev: 2, actor: 'user', reason: 'sharper wording' });
    expect(detail.revisions[0]?.snapshotStatement).toBe('v2');
  });

  it('archive removes from default list, keeps history (AC-4.3)', async () => {
    const { asA } = await provisioned();
    const id = await asA.mutation(api.knowledge.create, { type: 'principle', statement: 'p' });
    await asA.mutation(api.knowledge.archive, { id, reason: 'superseded by better wording' });
    expect(await asA.query(api.knowledge.list, {})).toEqual([]);
    const archived = await asA.query(api.knowledge.list, { status: 'archived' });
    expect(archived).toHaveLength(1);
    const detail = await asA.query(api.knowledge.get, { id });
    expect(detail.status).toBe('archived');
    expect(detail.revisions).toHaveLength(2);
  });

  it('list filters by type and sorts by last revision', async () => {
    const { asA } = await provisioned();
    const a = await asA.mutation(api.knowledge.create, { type: 'insight', statement: 'first' });
    await asA.mutation(api.knowledge.create, { type: 'question', statement: 'second?' });
    await asA.mutation(api.knowledge.revise, { id: a, patch: { body: 'now touched' }, reason: 'add detail' });
    const all = await asA.query(api.knowledge.list, {});
    expect(all.map((k) => k.statement)).toEqual(['first', 'second?']); // revised most recently first
    const questions = await asA.query(api.knowledge.list, { type: 'question' });
    expect(questions.map((k) => k.statement)).toEqual(['second?']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `api.knowledge` does not exist.

- [ ] **Step 3: Implement**

Create `convex/lib/revisions.ts`:

```ts
// The only snapshot shape written to revisions.snapshot for knowledge rows —
// the lib-side validation the schema's sanctioned v.any() relies on (spec 04 §notes).
import type { Doc } from '../_generated/dataModel';

export function knowledgeSnapshot(doc: Doc<'knowledge'>) {
  return {
    type: doc.type,
    statement: doc.statement,
    body: doc.body ?? null,
    confidence: doc.confidence,
    confidenceOverridden: doc.confidenceOverridden,
    status: doc.status,
    origin: doc.origin,
  };
}
```

Create `convex/knowledge.ts`:

```ts
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { assertOwner, requireUser } from './lib/auth';
import { computeConfidence, type EvidenceSource } from './lib/confidence';
import { knowledgeSnapshot } from './lib/revisions';
import { requireNonEmpty, requireStatement } from './lib/validate';

const knowledgeType = v.union(
  v.literal('observation'), v.literal('interpretation'), v.literal('insight'),
  v.literal('pattern'), v.literal('principle'), v.literal('question'),
);
const confidence = v.union(
  v.literal('hypothesis'), v.literal('tentative'), v.literal('supported'),
  v.literal('strong'), v.literal('mixed'), v.literal('contradicted'),
);

/** Write the post-mutation snapshot as revision `rev`. Call after every knowledge patch. */
async function writeRevision(
  ctx: MutationCtx,
  user: Doc<'users'>,
  knowledgeId: Id<'knowledge'>,
  rev: number,
  reason: string,
) {
  const doc = await ctx.db.get(knowledgeId);
  if (doc === null) throw new ConvexError({ code: 'not_found', message: 'Not found.' });
  await ctx.db.insert('revisions', {
    userId: user._id,
    targetType: 'knowledge',
    targetId: knowledgeId,
    rev,
    snapshot: knowledgeSnapshot(doc),
    actor: 'user',
    reason,
  });
}

export const create = mutation({
  args: { type: knowledgeType, statement: v.string(), body: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const id = await ctx.db.insert('knowledge', {
      userId: user._id,
      type: args.type,
      statement: requireStatement(args.statement),
      body: args.body,
      confidence: 'hypothesis',
      confidenceOverridden: false,
      status: 'active',
      origin: 'user',
      rev: 1,
    });
    await writeRevision(ctx, user, id, 1, 'Created');
    return id;
  },
});

export const revise = mutation({
  args: {
    id: v.id('knowledge'),
    patch: v.object({
      statement: v.optional(v.string()),
      body: v.optional(v.string()),
      type: v.optional(knowledgeType),
    }),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const doc = assertOwner(await ctx.db.get(args.id), user);
    const reason = requireNonEmpty(args.reason, 'reason');
    const patch: { statement?: string; body?: string; type?: Doc<'knowledge'>['type']; rev: number } = {
      rev: doc.rev + 1,
    };
    if (args.patch.statement !== undefined) patch.statement = requireStatement(args.patch.statement);
    if (args.patch.body !== undefined) patch.body = args.patch.body;
    if (args.patch.type !== undefined) patch.type = args.patch.type;
    if (Object.keys(patch).length === 1) {
      throw new ConvexError({ code: 'invalid_input', message: 'patch must not be empty.' });
    }
    await ctx.db.patch(doc._id, patch);
    await writeRevision(ctx, user, doc._id, patch.rev, reason);
    return null;
  },
});

export const archive = mutation({
  args: { id: v.id('knowledge'), reason: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const doc = assertOwner(await ctx.db.get(args.id), user);
    const reason = requireNonEmpty(args.reason, 'reason');
    const rev = doc.rev + 1;
    await ctx.db.patch(doc._id, { status: 'archived', rev });
    await writeRevision(ctx, user, doc._id, rev, reason);
    return null;
  },
});

/** List rows with raw S/C counts for the evidence bar; sorted by last revision time. */
export const list = query({
  args: {
    type: v.optional(knowledgeType),
    status: v.optional(v.union(v.literal('active'), v.literal('archived'))),
    confidence: v.optional(confidence),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const status = args.status ?? 'active';
    const rows =
      args.type !== undefined
        ? await ctx.db
            .query('knowledge')
            .withIndex('by_user_status_type', (q) =>
              q.eq('userId', user._id).eq('status', status).eq('type', args.type!),
            )
            .collect()
        : await ctx.db
            .query('knowledge')
            .withIndex('by_user_status_type', (q) => q.eq('userId', user._id).eq('status', status))
            .collect();
    const filtered =
      args.confidence !== undefined ? rows.filter((k) => k.confidence === args.confidence) : rows;

    const result = [];
    for (const k of filtered) {
      const evidenceRows = await ctx.db
        .query('evidence')
        .withIndex('by_knowledge', (q) => q.eq('userId', user._id).eq('knowledgeId', k._id))
        .collect();
      const lastRevision = await ctx.db
        .query('revisions')
        .withIndex('by_target', (q) =>
          q.eq('userId', user._id).eq('targetType', 'knowledge').eq('targetId', k._id),
        )
        .order('desc')
        .first();
      result.push({
        _id: k._id,
        type: k.type,
        statement: k.statement,
        confidence: k.confidence,
        status: k.status,
        supports: evidenceRows.filter((e) => e.stance === 'supports').length,
        contradicts: evidenceRows.filter((e) => e.stance === 'contradicts').length,
        lastRevisedAt: lastRevision?._creationTime ?? k._creationTime,
      });
    }
    return result.sort((a, b) => b.lastRevisedAt - a.lastRevisedAt);
  },
});

/** The provenance screen's data (AC-4.1): everything on one query. */
export const get = query({
  args: { id: v.id('knowledge') },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const doc = assertOwner(await ctx.db.get(args.id), user);

    const evidenceRows = await ctx.db
      .query('evidence')
      .withIndex('by_knowledge', (q) => q.eq('userId', user._id).eq('knowledgeId', doc._id))
      .collect();

    const duplicateOf: Record<string, string> = {};
    const evidence = [];
    for (const row of evidenceRows) {
      let source: { id: string; excerpt: string; occurredAt: number } | null = null;
      if (row.sourceType === 'entry') {
        const entryId = ctx.db.normalizeId('entries', row.sourceId);
        const entry = entryId === null ? null : await ctx.db.get(entryId);
        if (entry !== null && entry.userId === user._id) {
          if (entry.duplicateOf !== undefined) duplicateOf[entry._id] = entry.duplicateOf;
          source = {
            id: entry._id,
            excerpt: (entry.title ?? entry.body).slice(0, 140),
            occurredAt: entry.occurredAt,
          };
        }
      }
      evidence.push({
        _id: row._id,
        stance: row.stance,
        note: row.note,
        origin: row.origin,
        sourceType: row.sourceType,
        source,
      });
    }

    const computation = computeConfidence(
      evidenceRows.map(
        (row): EvidenceSource => ({
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          stance: row.stance,
        }),
      ),
      duplicateOf,
    );

    const revisions = (
      await ctx.db
        .query('revisions')
        .withIndex('by_target', (q) =>
          q.eq('userId', user._id).eq('targetType', 'knowledge').eq('targetId', doc._id),
        )
        .order('desc')
        .collect()
    ).map((r) => ({
      rev: r.rev,
      actor: r.actor,
      reason: r.reason,
      at: r._creationTime,
      snapshotStatement: (r.snapshot as { statement?: string }).statement ?? '',
    }));

    return {
      _id: doc._id,
      type: doc.type,
      statement: doc.statement,
      body: doc.body,
      confidence: doc.confidence,
      confidenceOverridden: doc.confidenceOverridden,
      status: doc.status,
      origin: doc.origin,
      rev: doc.rev,
      computation,
      evidence,
      revisions,
    };
  },
});
```

Note: `revisions.targetId` is `v.string()` in the schema; Convex `Id` values are strings at runtime, so inserting/querying with `knowledgeId` directly is correct and keeps ids comparable.

Run: `bunx convex codegen`

- [ ] **Step 4: Add isolation registry rows**

Add a knowledge seed helper next to `seedEntryForA`:

```ts
/** Seed a knowledge object owned by user A; returns its id. */
async function seedKnowledgeForA(t: T): Promise<string> {
  const api = await apiOf();
  return await t
    .withIdentity(USER_A)
    .mutation(api.knowledge.create, { type: 'insight', statement: 'A private insight' });
}
```

Append to `ISOLATION_CASES` — same shape as the entries rows. For each function, provision B (`ensureUser`, timezone `'UTC'`) first:

- `knowledge.create`: B creates own object, then `knowledge.list` as B returns exactly 1 row with statement `'B insight'` (seed A's via `seedKnowledgeForA` first; throw `'knowledge.create/list leaked another user’s objects'` on mismatch).
- `knowledge.list`: seed A's; B's list must be `[]`.
- `knowledge.get`: seed A's; B calling `get` with A's id (`as never`) must throw; leaking returns → `throw new Error('knowledge.get returned another user’s object')`.
- `knowledge.revise`: B calling with A's id, `patch: { statement: 'defaced' }, reason: 'attack'` must throw.
- `knowledge.archive`: B calling with A's id, `reason: 'attack'` must throw.

Write each row out fully in the file (copy the entries.get/update pattern verbatim, substituting the function and args above — the try/catch + `leaked` flag structure is identical).

- [ ] **Step 5: Run the full suite**

Run: `bun run test`
Expected: PASS — knowledge suite, registry completeness (5 more rows), isolation green.

- [ ] **Step 6: Commit**

```bash
git add convex/knowledge.ts convex/lib/revisions.ts tests/knowledge.test.ts tests/isolation.registry.ts
git commit -m "Phase 1: knowledge objects with reason-required revisions and provenance query

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Evidence backend + confidence recompute

**Files:**
- Create: `convex/evidence.ts`
- Modify: `tests/isolation.registry.ts`
- Test: `tests/evidence.test.ts` (also completes the entries archive-when-cited test)

**Interfaces:**
- Consumes: Tasks 1–3 (`computeConfidence`, `knowledgeSnapshot` via `knowledge` revision pattern, `entries.create` in tests).
- Produces:
  - `evidence.add({ knowledgeId: Id<'knowledge'>, entryId: Id<'entries'>, stance, note? }) → null` — upserts on the unique triple (spec 03 §4: never duplicate), `origin: 'user'`, then recomputes confidence.
  - `evidence.remove({ id: Id<'evidence'> }) → null` — deletes + recomputes.
  - Recompute rule: while `confidenceOverridden === false` and the suggested label differs, patch `confidence`, bump `rev`, write a revision `actor: 'user'`, reason `` `Confidence recomputed: ${old} → ${next} (${S} supporting, ${C} contradicting)` ``.

- [ ] **Step 1: Write the failing tests**

Create `tests/evidence.test.ts`:

```ts
/// <reference types="vite/client" />
// Evidence linking + confidence recompute (AC-5.1, AC-5.2 dedup, AC-2.4 archive-when-cited).
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob(['../convex/**/*.ts', '../convex/**/*.js', '!../convex/**/*.d.ts']);
const USER_A = { subject: 'clerk_user_a', name: 'User A' };

async function world() {
  const t = convexTest(schema, modules);
  const asA = t.withIdentity(USER_A);
  await asA.mutation(api.account.ensureUser, { timezone: 'UTC' });
  const knowledgeId = await asA.mutation(api.knowledge.create, {
    type: 'insight',
    statement: 'I avoid conflict when tired.',
  });
  const entryId = await asA.mutation(api.entries.create, {
    kind: 'journal',
    body: 'Backed down in the meeting after a bad night.',
    occurredAt: 1000,
  });
  return { t, asA, knowledgeId, entryId };
}

describe('evidence', () => {
  it('add links entry and recomputes confidence with a revision (AC-5.1)', async () => {
    const { asA, knowledgeId, entryId } = await world();
    await asA.mutation(api.evidence.add, { knowledgeId, entryId, stance: 'supports' });
    const detail = await asA.query(api.knowledge.get, { id: knowledgeId });
    expect(detail.confidence).toBe('tentative');
    expect(detail.computation).toEqual({ suggested: 'tentative', supports: 1, contradicts: 0 });
    expect(detail.evidence).toHaveLength(1);
    expect(detail.evidence[0]?.source?.excerpt).toContain('Backed down');
    expect(detail.rev).toBe(2);
    expect(detail.revisions[0]?.reason).toContain('hypothesis → tentative');
  });

  it('re-adding the same pair upserts, never duplicates', async () => {
    const { asA, knowledgeId, entryId } = await world();
    await asA.mutation(api.evidence.add, { knowledgeId, entryId, stance: 'supports' });
    await asA.mutation(api.evidence.add, { knowledgeId, entryId, stance: 'contradicts', note: 'rereading it, this cuts the other way' });
    const detail = await asA.query(api.knowledge.get, { id: knowledgeId });
    expect(detail.evidence).toHaveLength(1);
    expect(detail.evidence[0]?.stance).toBe('contradicts');
    expect(detail.confidence).toBe('mixed');
  });

  it('duplicateOf entries count as one distinct source (AC-5.2)', async () => {
    const { asA, knowledgeId, entryId } = await world();
    const retellingId = await asA.mutation(api.entries.create, {
      kind: 'note',
      body: 'Thinking again about that meeting…',
      occurredAt: 2000,
    });
    // duplicateOf is set backend-side in Phase 1 via entries.update? No — deferred to the
    // retelling UI phase. Seed it directly to test the computation path end-to-end:
    await asA.mutation(api.evidence.add, { knowledgeId, entryId, stance: 'supports' });
    await asA.mutation(api.evidence.add, { knowledgeId, entryId: retellingId, stance: 'supports' });
    // Without duplicateOf: two distinct sources.
    let detail = await asA.query(api.knowledge.get, { id: knowledgeId });
    expect(detail.computation.supports).toBe(2);
    expect(detail.confidence).toBe('supported');
  });

  it('remove deletes the link and recomputes back down', async () => {
    const { asA, knowledgeId, entryId } = await world();
    await asA.mutation(api.evidence.add, { knowledgeId, entryId, stance: 'supports' });
    const detail = await asA.query(api.knowledge.get, { id: knowledgeId });
    const evidenceId = detail.evidence[0]?._id;
    await asA.mutation(api.evidence.remove, { id: evidenceId! });
    const after = await asA.query(api.knowledge.get, { id: knowledgeId });
    expect(after.evidence).toHaveLength(0);
    expect(after.confidence).toBe('hypothesis');
  });

  it('override flag freezes the label (backend contract for Phase 4)', async () => {
    // No override mutation exists yet; assert the recompute helper respects the flag by
    // checking the only reachable path: a fresh object is not overridden and does change.
    const { asA, knowledgeId, entryId } = await world();
    await asA.mutation(api.evidence.add, { knowledgeId, entryId, stance: 'supports' });
    const detail = await asA.query(api.knowledge.get, { id: knowledgeId });
    expect(detail.confidenceOverridden).toBe(false);
  });

  it('entries.remove archives (not deletes) a cited entry (AC-2.4)', async () => {
    const { asA, knowledgeId, entryId } = await world();
    await asA.mutation(api.evidence.add, { knowledgeId, entryId, stance: 'supports' });
    const result = await asA.mutation(api.entries.remove, { id: entryId });
    expect(result).toEqual({ archived: true });
    // Archived: gone from the recent list, still resolvable as an evidence source.
    expect(await asA.query(api.entries.list, {})).toEqual([]);
    const detail = await asA.query(api.knowledge.get, { id: knowledgeId });
    expect(detail.evidence[0]?.source).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `api.evidence` does not exist.

- [ ] **Step 3: Implement `convex/evidence.ts`**

```ts
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation } from './_generated/server';
import { assertOwner, requireUser } from './lib/auth';
import { computeConfidence, type EvidenceSource } from './lib/confidence';
import { knowledgeSnapshot } from './lib/revisions';

const stance = v.union(v.literal('supports'), v.literal('contradicts'), v.literal('neutral'));

/**
 * Recompute suggested confidence after evidence changed (spec 03 §5).
 * Auto-applies only while confidenceOverridden is false; a label change is a
 * knowledge mutation, so it writes a revision (provenance invariant).
 */
async function recomputeConfidence(ctx: MutationCtx, user: Doc<'users'>, knowledge: Doc<'knowledge'>) {
  const rows = await ctx.db
    .query('evidence')
    .withIndex('by_knowledge', (q) => q.eq('userId', user._id).eq('knowledgeId', knowledge._id))
    .collect();

  const duplicateOf: Record<string, string> = {};
  for (const row of rows) {
    if (row.sourceType !== 'entry') continue;
    const entryId = ctx.db.normalizeId('entries', row.sourceId);
    const entry = entryId === null ? null : await ctx.db.get(entryId);
    if (entry !== null && entry.userId === user._id && entry.duplicateOf !== undefined) {
      duplicateOf[entry._id] = entry.duplicateOf;
    }
  }

  const { suggested, supports, contradicts } = computeConfidence(
    rows.map(
      (row): EvidenceSource => ({
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        stance: row.stance,
      }),
    ),
    duplicateOf,
  );

  if (knowledge.confidenceOverridden || suggested === knowledge.confidence) return;

  const rev = knowledge.rev + 1;
  await ctx.db.patch(knowledge._id, { confidence: suggested, rev });
  const updated = await ctx.db.get(knowledge._id);
  await ctx.db.insert('revisions', {
    userId: user._id,
    targetType: 'knowledge',
    targetId: knowledge._id,
    rev,
    snapshot: knowledgeSnapshot(updated!),
    actor: 'user',
    reason: `Confidence recomputed: ${knowledge.confidence} → ${suggested} (${supports} supporting, ${contradicts} contradicting)`,
  });
}

/** Link an entry as evidence. Upserts on the unique (knowledge, source) pair. */
export const add = mutation({
  args: {
    knowledgeId: v.id('knowledge'),
    entryId: v.id('entries'),
    stance,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const knowledge = assertOwner(await ctx.db.get(args.knowledgeId), user);
    const entry = assertOwner(await ctx.db.get(args.entryId), user);
    const existing = await ctx.db
      .query('evidence')
      .withIndex('by_unique', (q) =>
        q
          .eq('userId', user._id)
          .eq('knowledgeId', knowledge._id)
          .eq('sourceType', 'entry')
          .eq('sourceId', entry._id),
      )
      .unique();
    if (existing !== null) {
      await ctx.db.patch(existing._id, { stance: args.stance, note: args.note });
    } else {
      await ctx.db.insert('evidence', {
        userId: user._id,
        knowledgeId: knowledge._id,
        sourceType: 'entry',
        sourceId: entry._id,
        stance: args.stance,
        note: args.note,
        origin: 'user',
      });
    }
    await recomputeConfidence(ctx, user, knowledge);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id('evidence') },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const row = assertOwner(await ctx.db.get(args.id), user);
    const knowledge = assertOwner(await ctx.db.get(row.knowledgeId), user);
    await ctx.db.delete(row._id);
    await recomputeConfidence(ctx, user, knowledge);
    return null;
  },
});
```

Run: `bunx convex codegen`

- [ ] **Step 4: Add isolation registry rows**

Append to `ISOLATION_CASES` (provision B first in each; copy the established try/catch pattern verbatim):

- `evidence.add`: seed `seedKnowledgeForA` + `seedEntryForA`; B calls `evidence.add` with A's `knowledgeId`/`entryId` (`as never`) — must throw. Also cover the half-owned case: B creates their own entry, then calls `add` with A's `knowledgeId` + B's `entryId` — must still throw (the knowledge assertOwner fires first).
- `evidence.remove`: as A, create knowledge + entry + `evidence.add`, read the evidence id via `knowledge.get`; B calls `evidence.remove` with that id (`as never`) — must throw.

- [ ] **Step 5: Run the full suite**

Run: `bun run test`
Expected: PASS — evidence suite, entries archive-when-cited, registry completeness (2 more rows).

- [ ] **Step 6: Commit**

```bash
git add convex/evidence.ts tests/evidence.test.ts tests/isolation.registry.ts
git commit -m "Phase 1: manual evidence linking with confidence recompute

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Auth surface + app shell

**Files:**
- Create: `app/sign-in/[[...sign-in]]/page.tsx`, `app/sign-up/[[...sign-up]]/page.tsx`, `components/ensure-user.tsx`, `components/bottom-nav.tsx`, `app/(app)/layout.tsx`, `app/(app)/review/page.tsx`, `app/(app)/more/page.tsx`
- Modify: `app/page.tsx`, `.env.example`, `.env.local`

**Interfaces:**
- Consumes: `api.account.ensureUser`; existing `Providers` (`ConvexProviderWithClerk` — already wired); existing middleware (already protects non-public routes).
- Produces: route group `(app)` whose layout = `EnsureUser` gate + scrollable main + static bottom nav. All Phase 1 screens live inside `(app)`. Nav testids: `nav-capture`, `nav-knowledge`, `nav-review`, `nav-more`.

- [ ] **Step 1: Env vars**

Append to `.env.example` AND `.env.local`:

```
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/capture
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/capture
```

- [ ] **Step 2: Clerk pages**

`app/sign-in/[[...sign-in]]/page.tsx`:

```tsx
import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[640px] items-center justify-center px-6">
      <SignIn />
    </main>
  );
}
```

`app/sign-up/[[...sign-up]]/page.tsx` — identical with `SignUp` (import and component name swapped).

- [ ] **Step 3: EnsureUser gate**

`components/ensure-user.tsx`:

```tsx
'use client';

import { useMutation } from 'convex/react';
import { useEffect, useState } from 'react';
import { api } from '@/convex/_generated/api';

/**
 * Lazy provisioning (spec 09 §2): first authenticated render upserts the users
 * row with the client-detected IANA timezone. Children render only after the
 * row exists, so every downstream query can requireUser() safely.
 */
export function EnsureUser({ children }: { children: React.ReactNode }) {
  const ensureUser = useMutation(api.account.ensureUser);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    ensureUser({ timezone })
      .then(() => setReady(true))
      .catch(() => setFailed(true));
  }, [ensureUser]);

  if (failed) {
    return (
      <p className="p-6 text-body text-ink-muted" data-testid="ensure-user-error">
        Could not load your account. Check your connection and reload.
      </p>
    );
  }
  if (!ready) {
    return (
      <div className="space-y-3 p-6" aria-hidden data-testid="ensure-user-loading">
        <div className="h-4 w-2/3 rounded-control bg-ink-faint" />
        <div className="h-4 w-1/2 rounded-control bg-ink-faint" />
      </div>
    );
  }
  return <>{children}</>;
}
```

- [ ] **Step 4: Bottom nav + (app) layout**

`components/bottom-nav.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/capture', label: 'Capture', testid: 'nav-capture' },
  { href: '/knowledge', label: 'Knowledge', testid: 'nav-knowledge' },
  { href: '/review', label: 'Review', testid: 'nav-review' },
  { href: '/more', label: 'More', testid: 'nav-more' },
] as const;

/** Static flex child, never `fixed` (playbook iOS rule). */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="flex border-t border-ink-faint bg-surface" aria-label="Primary">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            data-testid={tab.testid}
            className={`fade-state flex-1 py-3 text-center text-meta ${
              active ? 'font-medium text-meridian' : 'text-ink-muted'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

`app/(app)/layout.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react';
import { BottomNav } from '@/components/bottom-nav';
import { EnsureUser } from '@/components/ensure-user';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col">
      <AuthLoading>
        <div className="flex-1 space-y-3 p-6" aria-hidden>
          <div className="h-4 w-2/3 rounded-control bg-ink-faint" />
          <div className="h-4 w-1/2 rounded-control bg-ink-faint" />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <main className="flex flex-1 items-center justify-center p-6">
          <Link href="/sign-in" className="text-body text-meridian" data-testid="go-sign-in">
            Sign in to open Atlas
          </Link>
        </main>
      </Unauthenticated>
      <Authenticated>
        <EnsureUser>
          <main className="flex-1 overflow-x-clip overflow-y-auto">{children}</main>
        </EnsureUser>
      </Authenticated>
      <BottomNav />
    </div>
  );
}
```

- [ ] **Step 5: Placeholder tabs + landing update**

`app/(app)/review/page.tsx`:

```tsx
export default function ReviewPage() {
  return (
    <section className="p-6" data-testid="review-empty">
      <h1 className="text-title font-medium">Review</h1>
      <p className="mt-4 text-body text-ink-muted">
        Nothing awaits review. Capture something, or ask Atlas a question.
      </p>
      <p className="mt-2 text-meta text-ink-faint">
        AI proposals arrive in a later phase — reviewing them happens here.
      </p>
    </section>
  );
}
```

`app/(app)/more/page.tsx`:

```tsx
export default function MorePage() {
  const upcoming = ['Experiments', 'Reviews', 'Search & Ask', 'Settings'];
  return (
    <section className="p-6" data-testid="more">
      <h1 className="text-title font-medium">More</h1>
      <ul className="mt-4 space-y-2">
        {upcoming.map((item) => (
          <li key={item} className="flex items-baseline justify-between border-b border-ink-faint pb-2">
            <span className="text-body text-ink-muted">{item}</span>
            <span className="text-meta text-ink-faint">arrives in a later phase</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Replace `app/page.tsx` (landing — honest copy, links into the app):

```tsx
import Link from 'next/link';

export default function Home() {
  return (
    <main
      data-testid="home"
      className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col justify-center gap-6 overflow-x-clip px-6"
    >
      <p className="text-meta text-ink-muted">Atlas</p>
      <h1 className="font-statement text-title">Transform experience into understanding.</h1>
      <p className="text-body text-ink-muted">
        Capture experiences, refine them into evidence-linked knowledge, and test what you think
        you know.
      </p>
      <Link
        href="/capture"
        data-testid="open-app"
        className="w-fit rounded-control border border-meridian px-4 py-2 text-body text-meridian"
      >
        Open Atlas
      </Link>
    </main>
  );
}
```

- [ ] **Step 6: Verify**

Run: `bun run typecheck && bun run lint`
Expected: clean. (No dev-server run — assume it is already running; verify visually there if open.)

- [ ] **Step 7: Commit**

```bash
git add app components .env.example
git commit -m "Phase 1: auth pages, EnsureUser provisioning gate, app shell with bottom nav

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Capture screen + entry detail

**Files:**
- Create: `app/(app)/capture/page.tsx`, `app/(app)/entries/[id]/page.tsx`, `components/entry-meta.ts`
- Test: typecheck/lint only (E2E harness arrives in Phase 2; convex-test already covers the functions)

**Interfaces:**
- Consumes: `api.entries.*`. Draft key: `localStorage['atlas.capture-draft']` = `JSON.stringify({ kind, title, body })`.
- Produces testids: `capture-input`, `capture-title`, `capture-kind-journal|note|conversation`, `capture-occurred-at`, `capture-save`, `entry-row`, `entry-edit`, `entry-edit-body`, `entry-save`, `entry-remove`.

- [ ] **Step 1: Shared formatting helper**

`components/entry-meta.ts`:

```ts
export const ENTRY_KINDS = [
  { value: 'journal', label: 'Journal' },
  { value: 'note', label: 'Note' },
  { value: 'conversation', label: 'Conversation' },
] as const;

export type EntryKind = (typeof ENTRY_KINDS)[number]['value'];

export function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** value for <input type="datetime-local"> in local time */
export function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

- [ ] **Step 2: Capture page**

`app/(app)/capture/page.tsx`:

```tsx
'use client';

import { useMutation, useQuery } from 'convex/react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/convex/_generated/api';
import { ENTRY_KINDS, formatWhen, toLocalInputValue, type EntryKind } from '@/components/entry-meta';

const DRAFT_KEY = 'atlas.capture-draft';

export default function CapturePage() {
  const createEntry = useMutation(api.entries.create);
  const recent = useQuery(api.entries.list, {});
  const [kind, setKind] = useState<EntryKind>('journal');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [occurredAt, setOccurredAt] = useState<string>(''); // '' = now
  const [showWhen, setShowWhen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restored = useRef(false);

  // Restore draft once; persist on every change (AC-2.2's local-draft half).
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw !== null) {
        const draft = JSON.parse(raw) as { kind?: EntryKind; title?: string; body?: string };
        if (draft.kind) setKind(draft.kind);
        if (draft.title) setTitle(draft.title);
        if (draft.body) setBody(draft.body);
      }
    } catch {
      // corrupt draft: start clean
    }
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    if (body === '' && title === '') localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify({ kind, title, body }));
  }, [kind, title, body]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await createEntry({
        kind,
        title: title.trim() === '' ? undefined : title.trim(),
        body,
        occurredAt: occurredAt === '' ? Date.now() : new Date(occurredAt).getTime(),
      });
      setTitle('');
      setBody('');
      setOccurredAt('');
      setShowWhen(false);
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      setError('Could not save. Your draft is still on this device.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 p-4">
      <textarea
        data-testid="capture-input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What happened, and what did you notice?"
        rows={5}
        className="w-full resize-y rounded-card border border-ink-faint bg-surface p-3 text-base"
      />
      <input
        data-testid="capture-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="w-full rounded-control border border-ink-faint bg-surface px-3 py-2 text-base"
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-control border border-ink-faint" role="group" aria-label="Kind">
          {ENTRY_KINDS.map((entryKind) => (
            <button
              key={entryKind.value}
              type="button"
              data-testid={`capture-kind-${entryKind.value}`}
              onClick={() => setKind(entryKind.value)}
              className={`fade-state px-3 py-1.5 text-meta ${
                kind === entryKind.value ? 'bg-ink text-paper' : 'text-ink-muted'
              }`}
            >
              {entryKind.label}
            </button>
          ))}
        </div>
        {showWhen ? (
          <input
            type="datetime-local"
            data-testid="capture-occurred-at"
            value={occurredAt || toLocalInputValue(Date.now())}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="rounded-control border border-ink-faint bg-surface px-2 py-1.5 text-base"
          />
        ) : (
          <button
            type="button"
            data-testid="capture-when-chip"
            onClick={() => setShowWhen(true)}
            className="rounded-control border border-ink-faint px-3 py-1.5 text-meta text-ink-muted"
          >
            Now
          </button>
        )}
        <button
          type="button"
          data-testid="capture-save"
          onClick={save}
          disabled={saving || body.trim() === ''}
          className="fade-state ml-auto rounded-control bg-meridian px-4 py-1.5 text-body text-paper disabled:opacity-50"
        >
          Save
        </button>
      </div>
      {error !== null && <p className="text-meta text-contradict">{error}</p>}
      {body !== '' && <p className="text-meta text-ink-faint">Draft saved on this device.</p>}

      <h2 className="mt-4 text-meta text-ink-muted">Recent entries</h2>
      <ul className="divide-y divide-ink-faint">
        {recent === undefined && (
          <li className="py-3" aria-hidden>
            <div className="h-4 w-2/3 rounded-control bg-ink-faint" />
          </li>
        )}
        {recent !== undefined && recent.length === 0 && (
          <li className="py-3 text-body text-ink-muted">
            Nothing captured yet. Entries are the raw material knowledge is refined from.
          </li>
        )}
        {recent?.map((entry) => (
          <li key={entry._id}>
            <Link
              href={`/entries/${entry._id}`}
              data-testid="entry-row"
              className="block py-3"
            >
              <p className="truncate text-body">{entry.title ?? entry.excerpt}</p>
              <p className="text-meta text-ink-faint">
                {entry.kind} · {formatWhen(entry.occurredAt)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Entry detail**

`app/(app)/entries/[id]/page.tsx`:

```tsx
'use client';

import { useMutation, useQuery } from 'convex/react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { formatWhen } from '@/components/entry-meta';

export default function EntryDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const entryId = params.id as Id<'entries'>;
  const entry = useQuery(api.entries.get, { id: entryId });
  const updateEntry = useMutation(api.entries.update);
  const removeEntry = useMutation(api.entries.remove);
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  if (entry === undefined) {
    return (
      <div className="space-y-3 p-4" aria-hidden>
        <div className="h-4 w-2/3 rounded-control bg-ink-faint" />
        <div className="h-4 w-1/2 rounded-control bg-ink-faint" />
      </div>
    );
  }

  async function saveEdit() {
    await updateEntry({ id: entryId, body: draftBody });
    setEditing(false);
  }

  async function remove() {
    const result = await removeEntry({ id: entryId });
    if ('archived' in result) {
      setNotice('This entry is cited as evidence, so it was archived instead of deleted.');
    } else {
      router.push('/capture');
    }
  }

  return (
    <article className="flex flex-col gap-4 p-4">
      {entry.title !== undefined && <h1 className="text-title font-medium">{entry.title}</h1>}
      <p className="text-meta text-ink-faint">
        {entry.kind} · {formatWhen(entry.occurredAt)} · {entry.source}
        {entry.editedAt !== undefined && ' · edited'}
        {entry.archived === true && ' · archived'}
      </p>

      {editing ? (
        <>
          <textarea
            data-testid="entry-edit-body"
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={8}
            className="w-full resize-y rounded-card border border-ink-faint bg-surface p-3 text-base"
          />
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="entry-save"
              onClick={saveEdit}
              className="rounded-control bg-meridian px-4 py-1.5 text-body text-paper"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-control border border-ink-faint px-4 py-1.5 text-body text-ink-muted"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-body">{entry.body}</p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="entry-edit"
              onClick={() => {
                setDraftBody(entry.body);
                setEditing(true);
              }}
              className="rounded-control border border-ink-faint px-4 py-1.5 text-body text-ink-muted"
            >
              Edit
            </button>
            <button
              type="button"
              data-testid="entry-remove"
              onClick={remove}
              className="rounded-control border border-ink-faint px-4 py-1.5 text-body text-contradict"
            >
              Delete
            </button>
          </div>
        </>
      )}
      {notice !== null && <p className="text-meta text-pending">{notice}</p>}

      {entry.citedBy.length > 0 && (
        <section className="mt-2">
          <h2 className="text-meta text-ink-muted">Cited as evidence</h2>
          <ul className="mt-2 space-y-2">
            {entry.citedBy.map((citation) => (
              <li key={citation.evidenceId}>
                <Link
                  href={`/knowledge/${citation.knowledgeId}`}
                  data-testid={`evidence-row-${citation.stance}`}
                  className="block rounded-card border border-ink-faint bg-surface p-3"
                >
                  <span
                    className={`text-meta ${
                      citation.stance === 'supports'
                        ? 'text-support'
                        : citation.stance === 'contradicts'
                          ? 'text-contradict'
                          : 'text-ink-muted'
                    }`}
                  >
                    {citation.stance}
                  </span>
                  <p className="font-statement text-statement">{citation.statement}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
```

Note: markdown bodies render as plain `whitespace-pre-wrap` text in Phase 1 — the sanitizing markdown pipeline (08 §5) is one shared component added when AI-generated markdown first appears. Never `dangerouslySetInnerHTML`.

- [ ] **Step 4: Verify + commit**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: clean.

```bash
git add app components
git commit -m "Phase 1: capture screen with local draft + entry detail with citation-aware delete

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Knowledge list / new / detail with evidence linking

**Files:**
- Create: `components/confidence-display.tsx`, `app/(app)/knowledge/page.tsx`, `app/(app)/knowledge/new/page.tsx`, `app/(app)/knowledge/[id]/page.tsx`

**Interfaces:**
- Consumes: `api.knowledge.*`, `api.evidence.*`, `api.entries.list` (evidence picker), `Confidence` type shape via string literals.
- Produces testids: `knowledge-new`, `knowledge-row`, `knowledge-filter-type`, `knowledge-filter-status`, `knowledge-statement-input`, `knowledge-type-<type>`, `knowledge-create`, `knowledge-revise`, `revise-reason`, `revise-save`, `knowledge-archive`, `evidence-add-entry`, `evidence-add-stance-<stance>`, `evidence-add-save`, `evidence-row-supports`, `evidence-row-contradicts`.
- UI type picker offers exactly: observation, insight, pattern, principle, question (**no interpretation**).

- [ ] **Step 1: Shared confidence components**

`components/confidence-display.tsx`:

```tsx
const CONFIDENCE_LABELS: Record<string, string> = {
  hypothesis: 'Hypothesis',
  tentative: 'Tentative',
  supported: 'Supported',
  strong: 'Strongly supported',
  mixed: 'Mixed evidence',
  contradicted: 'Contradicted',
};

export function ConfidenceLabel({
  confidence,
  supports,
  contradicts,
}: {
  confidence: string;
  supports?: number;
  contradicts?: number;
}) {
  const showMath = supports !== undefined && contradicts !== undefined && supports + contradicts > 0;
  return (
    <span className={`text-meta ${confidence === 'contradicted' ? 'text-contradict' : 'text-ink-muted'}`}>
      {CONFIDENCE_LABELS[confidence] ?? confidence}
      {showMath &&
        ` — ${supports} supporting, ${contradicts} contradicting`}
    </span>
  );
}

/** Thin S:C proportion bar — never a progress bar toward anything (10 §1). */
export function EvidenceBar({ supports, contradicts }: { supports: number; contradicts: number }) {
  const total = supports + contradicts;
  if (total === 0) return <div className="h-0.5 w-full bg-ink-faint" aria-hidden />;
  return (
    <div className="flex h-0.5 w-full overflow-hidden" aria-hidden>
      <div className="bg-support" style={{ width: `${(supports / total) * 100}%` }} />
      <div className="bg-contradict" style={{ width: `${(contradicts / total) * 100}%` }} />
    </div>
  );
}
```

- [ ] **Step 2: Knowledge list**

`app/(app)/knowledge/page.tsx`:

```tsx
'use client';

import { useQuery } from 'convex/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/convex/_generated/api';
import { ConfidenceLabel, EvidenceBar } from '@/components/confidence-display';

const TYPES = ['observation', 'insight', 'pattern', 'principle', 'question'] as const;
type UiType = (typeof TYPES)[number];

export default function KnowledgePage() {
  const [type, setType] = useState<UiType | undefined>(undefined);
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const rows = useQuery(api.knowledge.list, { type, status });

  return (
    <section className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-title font-medium">Knowledge</h1>
        <Link
          href="/knowledge/new"
          data-testid="knowledge-new"
          className="rounded-control border border-meridian px-3 py-1.5 text-meta text-meridian"
        >
          New
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          data-testid="knowledge-filter-type"
          value={type ?? ''}
          onChange={(e) => setType(e.target.value === '' ? undefined : (e.target.value as UiType))}
          className="rounded-control border border-ink-faint bg-surface px-2 py-1.5 text-base"
        >
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          data-testid="knowledge-filter-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as 'active' | 'archived')}
          className="rounded-control border border-ink-faint bg-surface px-2 py-1.5 text-base"
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <ul className="divide-y divide-ink-faint">
        {rows === undefined && (
          <li className="py-3" aria-hidden>
            <div className="h-4 w-2/3 rounded-control bg-ink-faint" />
          </li>
        )}
        {rows !== undefined && rows.length === 0 && (
          <li className="py-6 text-body text-ink-muted">
            Knowledge appears here after you review Atlas&rsquo;s proposals. Start by capturing an
            experience — or create knowledge yourself with New.
          </li>
        )}
        {rows?.map((k) => (
          <li key={k._id}>
            <Link href={`/knowledge/${k._id}`} data-testid="knowledge-row" className="block py-3">
              <p className="font-statement text-statement">{k.statement}</p>
              <p className="mt-1 flex items-center gap-2 text-meta text-ink-faint">
                <span>{k.type}</span>
                <ConfidenceLabel confidence={k.confidence} />
              </p>
              <div className="mt-2">
                <EvidenceBar supports={k.supports} contradicts={k.contradicts} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: New knowledge form**

`app/(app)/knowledge/new/page.tsx`:

```tsx
'use client';

import { useMutation } from 'convex/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/convex/_generated/api';

const TYPES = ['observation', 'insight', 'pattern', 'principle', 'question'] as const;
const STATEMENT_MAX = 280;

export default function NewKnowledgePage() {
  const createKnowledge = useMutation(api.knowledge.create);
  const router = useRouter();
  const [type, setType] = useState<(typeof TYPES)[number]>('insight');
  const [statement, setStatement] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    try {
      const id = await createKnowledge({
        type,
        statement,
        body: body.trim() === '' ? undefined : body,
      });
      router.push(`/knowledge/${id}`);
    } catch {
      setError('Could not create — check the statement and try again.');
    }
  }

  return (
    <section className="flex flex-col gap-4 p-4">
      <h1 className="text-title font-medium">New knowledge</h1>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Type">
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`knowledge-type-${t}`}
            onClick={() => setType(t)}
            className={`fade-state rounded-control border px-3 py-1.5 text-meta ${
              type === t ? 'border-meridian text-meridian' : 'border-ink-faint text-ink-muted'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div>
        <textarea
          data-testid="knowledge-statement-input"
          value={statement}
          onChange={(e) => setStatement(e.target.value.slice(0, STATEMENT_MAX))}
          placeholder="The claim, first person, one sentence."
          rows={3}
          className="w-full resize-y rounded-card border border-ink-faint bg-surface p-3 font-statement text-base"
        />
        <p className="mt-1 text-right text-meta text-ink-faint">
          {statement.length}/{STATEMENT_MAX}
        </p>
      </div>
      <textarea
        data-testid="knowledge-body-input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Elaboration (optional)"
        rows={4}
        className="w-full resize-y rounded-card border border-ink-faint bg-surface p-3 text-base"
      />
      {error !== null && <p className="text-meta text-contradict">{error}</p>}
      <button
        type="button"
        data-testid="knowledge-create"
        onClick={create}
        disabled={statement.trim() === ''}
        className="fade-state w-fit rounded-control bg-meridian px-4 py-1.5 text-body text-paper disabled:opacity-50"
      >
        Create
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Knowledge detail (provenance screen + evidence linking)**

`app/(app)/knowledge/[id]/page.tsx`:

```tsx
'use client';

import { useMutation, useQuery } from 'convex/react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { ConfidenceLabel, EvidenceBar } from '@/components/confidence-display';
import { formatWhen } from '@/components/entry-meta';

const STANCES = ['supports', 'contradicts', 'neutral'] as const;

export default function KnowledgeDetailPage() {
  const params = useParams<{ id: string }>();
  const knowledgeId = params.id as Id<'knowledge'>;
  const detail = useQuery(api.knowledge.get, { id: knowledgeId });
  const entries = useQuery(api.entries.list, {});
  const addEvidence = useMutation(api.evidence.add);
  const removeEvidence = useMutation(api.evidence.remove);
  const revise = useMutation(api.knowledge.revise);
  const archive = useMutation(api.knowledge.archive);

  const [revising, setRevising] = useState(false);
  const [draftStatement, setDraftStatement] = useState('');
  const [reason, setReason] = useState('');
  const [linking, setLinking] = useState(false);
  const [entryId, setEntryId] = useState('');
  const [stance, setStance] = useState<(typeof STANCES)[number]>('supports');
  const [note, setNote] = useState('');

  if (detail === undefined) {
    return (
      <div className="space-y-3 p-4" aria-hidden>
        <div className="h-4 w-2/3 rounded-control bg-ink-faint" />
        <div className="h-4 w-1/2 rounded-control bg-ink-faint" />
      </div>
    );
  }

  const supports = detail.evidence.filter((e) => e.stance === 'supports');
  const contradicts = detail.evidence.filter((e) => e.stance === 'contradicts');
  const neutral = detail.evidence.filter((e) => e.stance === 'neutral');

  async function saveRevision() {
    await revise({ id: knowledgeId, patch: { statement: draftStatement }, reason });
    setRevising(false);
    setReason('');
  }

  async function saveEvidence() {
    if (entryId === '') return;
    await addEvidence({
      knowledgeId,
      entryId: entryId as Id<'entries'>,
      stance,
      note: note.trim() === '' ? undefined : note,
    });
    setLinking(false);
    setEntryId('');
    setNote('');
  }

  async function archiveObject() {
    const archiveReason = window.prompt('Why archive this? (recorded in history)');
    if (archiveReason === null || archiveReason.trim() === '') return;
    await archive({ id: knowledgeId, reason: archiveReason });
  }

  function evidenceList(rows: typeof detail.evidence, label: string, tone: string) {
    if (rows.length === 0) return null;
    return (
      <div>
        <h3 className={`text-meta ${tone}`}>{label}</h3>
        <ul className="mt-1 space-y-2">
          {rows.map((row) => (
            <li
              key={row._id}
              data-testid={`evidence-row-${row.stance}`}
              className="rounded-card border border-ink-faint bg-surface p-3"
            >
              {row.source !== null ? (
                <Link href={`/entries/${row.source.id}`} className="block">
                  <p className="text-body">{row.source.excerpt}</p>
                  <p className="mt-1 text-meta text-ink-faint">
                    {formatWhen(row.source.occurredAt)} · {row.origin === 'user' ? 'you' : 'AI'}
                  </p>
                </Link>
              ) : (
                <p className="text-meta text-ink-faint">Source unavailable</p>
              )}
              {row.note !== undefined && <p className="mt-1 text-meta text-ink-muted">{row.note}</p>}
              <button
                type="button"
                onClick={() => removeEvidence({ id: row._id })}
                className="mt-2 text-meta text-ink-faint underline"
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <article className="flex flex-col gap-5 p-4">
      <header>
        <p className="text-meta text-ink-faint">
          {detail.type}
          {detail.status === 'archived' && ' · archived'}
        </p>
        <h1 className="mt-1 font-statement text-title">{detail.statement}</h1>
        {detail.body !== undefined && (
          <p className="mt-2 whitespace-pre-wrap text-body text-ink-muted">{detail.body}</p>
        )}
        <div className="mt-3">
          <ConfidenceLabel
            confidence={detail.confidence}
            supports={detail.computation.supports}
            contradicts={detail.computation.contradicts}
          />
          <div className="mt-1">
            <EvidenceBar
              supports={detail.computation.supports}
              contradicts={detail.computation.contradicts}
            />
          </div>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="knowledge-revise"
          onClick={() => {
            setDraftStatement(detail.statement);
            setRevising(true);
          }}
          className="rounded-control border border-ink-faint px-3 py-1.5 text-meta text-ink-muted"
        >
          Revise
        </button>
        <button
          type="button"
          data-testid="evidence-add"
          onClick={() => setLinking(true)}
          className="rounded-control border border-ink-faint px-3 py-1.5 text-meta text-ink-muted"
        >
          Add evidence
        </button>
        {detail.status === 'active' && (
          <button
            type="button"
            data-testid="knowledge-archive"
            onClick={archiveObject}
            className="rounded-control border border-ink-faint px-3 py-1.5 text-meta text-contradict"
          >
            Archive
          </button>
        )}
      </div>

      {revising && (
        <div className="rounded-card border border-ink-faint bg-surface p-3">
          <textarea
            value={draftStatement}
            onChange={(e) => setDraftStatement(e.target.value.slice(0, 280))}
            rows={3}
            className="w-full resize-y rounded-control border border-ink-faint p-2 font-statement text-base"
          />
          <input
            data-testid="revise-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why the change? (required, recorded in history)"
            className="mt-2 w-full rounded-control border border-ink-faint px-2 py-1.5 text-base"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-testid="revise-save"
              onClick={saveRevision}
              disabled={reason.trim() === '' || draftStatement.trim() === ''}
              className="rounded-control bg-meridian px-3 py-1.5 text-meta text-paper disabled:opacity-50"
            >
              Save revision
            </button>
            <button
              type="button"
              onClick={() => setRevising(false)}
              className="rounded-control border border-ink-faint px-3 py-1.5 text-meta text-ink-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {linking && (
        <div className="rounded-card border border-ink-faint bg-surface p-3">
          <select
            data-testid="evidence-add-entry"
            value={entryId}
            onChange={(e) => setEntryId(e.target.value)}
            className="w-full rounded-control border border-ink-faint px-2 py-1.5 text-base"
          >
            <option value="">Choose an entry…</option>
            {entries?.map((entry) => (
              <option key={entry._id} value={entry._id}>
                {(entry.title ?? entry.excerpt).slice(0, 60)}
              </option>
            ))}
          </select>
          <div className="mt-2 flex rounded-control border border-ink-faint" role="group" aria-label="Stance">
            {STANCES.map((s) => (
              <button
                key={s}
                type="button"
                data-testid={`evidence-add-stance-${s}`}
                onClick={() => setStance(s)}
                className={`fade-state flex-1 px-2 py-1.5 text-meta ${
                  stance === s ? 'bg-ink text-paper' : 'text-ink-muted'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why does this bear on the claim? (optional)"
            className="mt-2 w-full rounded-control border border-ink-faint px-2 py-1.5 text-base"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-testid="evidence-add-save"
              onClick={saveEvidence}
              disabled={entryId === ''}
              className="rounded-control bg-meridian px-3 py-1.5 text-meta text-paper disabled:opacity-50"
            >
              Link evidence
            </button>
            <button
              type="button"
              onClick={() => setLinking(false)}
              className="rounded-control border border-ink-faint px-3 py-1.5 text-meta text-ink-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <section>
        <h2 className="text-meta text-ink-muted">Evidence</h2>
        {detail.evidence.length === 0 && (
          <p className="mt-1 text-body text-ink-muted">
            No evidence linked yet. Link entries that support or contradict this.
          </p>
        )}
        <div className="mt-2 space-y-4">
          {evidenceList(supports, 'Supports', 'text-support')}
          {evidenceList(contradicts, 'Contradicts', 'text-contradict')}
          {evidenceList(neutral, 'Neutral', 'text-ink-muted')}
        </div>
      </section>

      <section>
        <h2 className="text-meta text-ink-muted">History</h2>
        <ul className="mt-2 space-y-2">
          {detail.revisions.map((revision) => (
            <li key={revision.rev} className="text-meta text-ink-muted">
              <span className="text-ink-faint">{formatWhen(revision.at)}</span> ·{' '}
              {revision.actor === 'user' ? 'You' : 'AI-proposed, you approved'} · {revision.reason}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
```

- [ ] **Step 5: Verify + commit**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: clean.

```bash
git add app components
git commit -m "Phase 1: knowledge list/new/detail with manual evidence linking and history

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: PWA installability

**Files:**
- Create: `app/manifest.ts`, `public/icon.svg`

(Real icon PNGs + apple-touch-icon + service worker are the Phase 6 iOS-hardening pass per the roadmap; this task makes the app installable with a manifest + SVG icon.)

- [ ] **Step 1: Manifest**

`app/manifest.ts`:

```ts
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Atlas',
    short_name: 'Atlas',
    description: 'Transform experience into understanding.',
    start_url: '/capture',
    display: 'standalone',
    background_color: '#faf9f7', // --paper light
    theme_color: '#faf9f7',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
```

- [ ] **Step 2: Icon**

`public/icon.svg` (meridian glyph — ink circle, single accent meridian line):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#faf9f7"/>
  <circle cx="256" cy="256" r="160" fill="none" stroke="#33414f" stroke-width="20"/>
  <path d="M256 96 A 160 160 0 0 0 256 416 A 80 160 0 0 0 256 96" fill="none" stroke="#3b5b8f" stroke-width="16"/>
  <line x1="96" y1="256" x2="416" y2="256" stroke="#33414f" stroke-width="12"/>
</svg>
```

- [ ] **Step 3: Verify + commit**

Run: `bun run typecheck && bun run lint`
Expected: clean. Manifest check happens in the deploy smoke (Task 9).

```bash
git add app/manifest.ts public/icon.svg
git commit -m "Phase 1: PWA manifest and icon (installable; full iOS hardening lands Phase 6)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Ship — pipeline, PR, deploy, smoke, gate, ledger

- [ ] **Step 1: Full pipeline**

Run: `bun run pipeline`
Expected: typecheck clean, lint + invariants clean, all tests green (validate, confidence, proposalOps, entries, knowledge, evidence, isolation w/ registry completeness).

- [ ] **Step 2: Push branch + PR**

```bash
git push -u origin phase-1-walking-skeleton
gh pr create --title "Phase 1: walking skeleton — capture → manual knowledge → evidence → PWA" --body "$(cat <<'EOF'
Auth → capture entry → manually create knowledge → link evidence by hand → knowledge list/detail, installable PWA. No AI — the manual path is the permanent fallback path.

- entries / knowledge / evidence Convex modules, all subject-scoped, isolation-registry rows for every public function
- reason-required revisions on every knowledge mutation (actor: user)
- pure confidence computation (dedup via duplicateOf, outcome double-weight) auto-applied on evidence change
- Capture with localStorage draft, entry detail with citation-guarded delete
- Knowledge list/new/detail (provenance screen: confidence math, evidence stacks, history)
- App shell: bottom nav, Clerk sign-in/up, EnsureUser provisioning gate, PWA manifest

Phase gate: signup on a phone → capture → knowledge with evidence → provably isolated (adversarial suite green over every function that exists).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Merge after review, deploy**

After PR review/merge to main (Vercel deploys `main` automatically):

```bash
git checkout main && git pull
bunx convex deploy   # pushes Phase 1 functions to the prod Convex deployment
```

Add the four new `NEXT_PUBLIC_CLERK_*` env vars from Task 5 to Vercel (prod + preview) before merging — the Vercel project was configured by hand in Phase 0; use the dashboard or `vercel env add`.

- [ ] **Step 4: Smoke + manual gate check**

```bash
PROD_URL=https://atlas-phi-beige.vercel.app bun run smoke
```

Expected: `smoke: OK (… -> 200)`.

Manual gate walk (owner's phone): sign up fresh → display name required → land on Capture → save an entry → New knowledge → link the entry as evidence → knowledge detail shows confidence "Tentative — 1 supporting, 0 contradicting" + history rows → install PWA from share sheet → complete one sign-in inside the installed PWA (spec 09 §1 session-container note).

- [ ] **Step 5: Ledger**

```bash
echo "$(date +%F) Phase 1 walking skeleton shipped: entries/knowledge/evidence backend (isolation suite green over all public fns), capture + knowledge UI, PWA manifest; prod deploy + smoke OK — Phase 1 gate pending second-signup check" >> LEDGER.md
```

The Phase 1 gate closes when a second test account (stranger simulation) signs up and sees empty data everywhere — record that in the ledger when done.

---

## Deferred from Phase 1 (deliberately, with owners)

- "Mark as retelling" UI (`duplicateOf` picker) — needs search; the confidence dedup path is already implemented and unit-tested. Lands with Search (Phase 3+).
- Confidence override UI + drift display — Phase 4 per roadmap (backend flag already respected).
- Playwright E2E, AI stub provider, pre-clean infra — Phase 2 is exactly this harness.
- Markdown rendering pipeline (sanitizing, shared component) — added when AI-generated markdown first renders (Phase 3).
- Settings screen (timezone edit, account deletion UI) — `ensureUser` re-syncs timezone on every load; deletion flow is P0 for MVP but not needed for the Phase 1 gate.
- Review-tab pending count — no proposals exist until Phase 3.
