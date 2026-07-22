// Shared validation for atlas_preview_proposal / atlas_submit_proposal (Phase M
// Task 4, docs/spec/06 §3, 05 §3 post-filters). Runs the SAME checks for both
// tools — preview must show exactly what submit would reject, or "fix problems
// before submitting" (06 §3) is a lie.
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { validateOps, type ProposalOp } from '../shared/proposalOps';

export type OpVerdictWithWarnings = { valid: boolean; error?: string; warnings?: string[] };

/**
 * RRF-fused score threshold (lib/retrieval.ts's mergeRanked) above which a
 * `createKnowledge` op is flagged as a likely near-duplicate of existing
 * knowledge. This is a coarser proxy than distill's true cosine>0.95 dedup
 * (05 §3) — it reads hybridSearch's already-fused vector+text score rather than
 * raw embedding similarity, since that's the only signal this stateless,
 * no-extra-model-call path has available. An identical or near-identical
 * statement ranks #1 on BOTH signals (vector cosine ~1 AND exact text match),
 * contributing 1/(60+1) from each => ~0.0328; unrelated statements sit far
 * below this. Never a hard fail (06 §3: "warnings" only) — the caller decides.
 */
const NEAR_DUPLICATE_SCORE_THRESHOLD = 0.02;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Collect the 'existing'-kind ref ids an already-structurally-valid op touches. */
function collectRefs(op: ProposalOp): { knowledgeIds: string[]; entryIds: string[]; outcomeIds: string[] } {
  const knowledgeIds: string[] = [];
  const entryIds: string[] = [];
  const outcomeIds: string[] = [];
  const takeRef = (ref: { kind: 'existing' | 'new'; id?: string }) => {
    if (ref.kind === 'existing' && ref.id !== undefined) knowledgeIds.push(ref.id);
  };
  switch (op.op) {
    case 'createKnowledge':
      break;
    case 'updateKnowledge':
    case 'archiveKnowledge':
      takeRef(op.target);
      break;
    case 'addEvidence':
      takeRef(op.knowledge);
      if (op.sourceType === 'entry') entryIds.push(op.sourceId);
      else outcomeIds.push(op.sourceId);
      break;
    case 'createRelationship':
      takeRef(op.from);
      takeRef(op.to);
      break;
    case 'createExperiment':
      takeRef(op.knowledge);
      break;
  }
  return { knowledgeIds, entryIds, outcomeIds };
}

function refsMissingError(
  op: ProposalOp,
  existing: { knowledgeIds: Set<string>; entryIds: Set<string>; outcomeIds: Set<string> },
): string | null {
  const { knowledgeIds, entryIds, outcomeIds } = collectRefs(op);
  const missingKnowledge = knowledgeIds.filter((id) => !existing.knowledgeIds.has(id));
  const missingEntries = entryIds.filter((id) => !existing.entryIds.has(id));
  const missingOutcomes = outcomeIds.filter((id) => !existing.outcomeIds.has(id));
  const missing = [...missingKnowledge, ...missingEntries, ...missingOutcomes];
  if (missing.length === 0) return null;
  return `referenced object(s) not found or not owned by this user: ${missing.join(', ')}`;
}

/**
 * Validates a raw ops payload: structural/semantic checks (validateOps, pure) +
 * DB-backed reference-existence checks, and (when `withWarnings`) near-duplicate
 * warnings on createKnowledge ops. Returns one verdict per input op, positional.
 */
export async function checkProposalOps(
  ctx: ActionCtx,
  userId: Id<'users'>,
  ops: unknown,
  withWarnings: boolean,
): Promise<OpVerdictWithWarnings[]> {
  const structural = validateOps(ops);
  if (!Array.isArray(ops)) return structural;

  const validOps = ops as ProposalOp[];
  const allKnowledgeIds: string[] = [];
  const allEntryIds: string[] = [];
  const allOutcomeIds: string[] = [];
  structural.forEach((verdict, i) => {
    if (!verdict.valid) return;
    const refs = collectRefs(validOps[i]!);
    allKnowledgeIds.push(...refs.knowledgeIds);
    allEntryIds.push(...refs.entryIds);
    allOutcomeIds.push(...refs.outcomeIds);
  });

  const existence = await ctx.runQuery(internal.internal.mcpReads.checkRefExistence, {
    userId,
    knowledgeIds: allKnowledgeIds,
    entryIds: allEntryIds,
    outcomeIds: allOutcomeIds,
  });
  const existing = {
    knowledgeIds: new Set(existence.knowledgeIds),
    entryIds: new Set(existence.entryIds),
    outcomeIds: new Set(existence.outcomeIds),
  };

  const results: OpVerdictWithWarnings[] = [];
  for (let i = 0; i < structural.length; i++) {
    const verdict = structural[i]!;
    if (!verdict.valid) {
      results.push({ valid: false, error: verdict.error });
      continue;
    }
    const op = validOps[i]!;
    const refError = refsMissingError(op, existing);
    if (refError !== null) {
      results.push({ valid: false, error: refError });
      continue;
    }

    const warnings: string[] = [];
    if (withWarnings && op.op === 'createKnowledge') {
      const hits = await ctx.runAction(internal.ai.search.hybridSearch, {
        userId,
        query: op.statement,
        scope: 'knowledge',
        limit: 1,
      });
      const top = hits[0];
      if (top !== undefined && top.score > NEAR_DUPLICATE_SCORE_THRESHOLD) {
        warnings.push(`near-duplicate of knowledge ${top.id}`);
      }
    }
    results.push(warnings.length > 0 ? { valid: true, warnings } : { valid: true });
  }
  return results;
}

/** True only if every verdict in the list is valid (errors, not warnings, gate this). */
export function allValid(verdicts: OpVerdictWithWarnings[]): boolean {
  return verdicts.length > 0 && verdicts.every((v) => v.valid);
}

function isCitation(x: unknown): x is { sourceType: string; sourceId: string; excerpt?: string } {
  return (
    isRecord(x) &&
    typeof x.sourceType === 'string' &&
    typeof x.sourceId === 'string' &&
    (x.excerpt === undefined || typeof x.excerpt === 'string')
  );
}

/** Loose shape check for the `citations` arg — schema mirrors proposalStore's own validator. */
export function parseCitations(x: unknown): { sourceType: string; sourceId: string; excerpt?: string }[] | null {
  if (!Array.isArray(x)) return null;
  return x.every(isCitation) ? x : null;
}
