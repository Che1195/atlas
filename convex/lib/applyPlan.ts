// Pure application planning for proposal resolution (docs/spec/03 §7, AC-3.3).
// No ctx, no Date.now — deterministic. Consumed by proposals.resolve (Task 4), which
// re-validates any edited ops before calling here; this lib does STRUCTURAL planning
// only (dependency refusal + creation-index remapping), never field validation.

import type { OpRef, ProposalOp } from '../shared/proposalOps';

export type OpResolution = 'approved' | 'rejected' | 'edited';

export type PlanResult =
  | { ok: true; toApply: Array<{ index: number; op: ProposalOp }>; newIndexMap: Map<number, number> }
  | { ok: false; error: string; failedIndex: number };

/** Extract the OpRef slots carried by an op, in a stable order, for dependency checks. */
function refsOf(op: ProposalOp): OpRef[] {
  switch (op.op) {
    case 'createKnowledge':
      return [];
    case 'updateKnowledge':
    case 'archiveKnowledge':
      return [op.target];
    case 'addEvidence':
    case 'createExperiment':
      return [op.knowledge];
    case 'createRelationship':
      return [op.from, op.to];
  }
}

/**
 * resolutions[i] applies to ops[i]; editedOps[i] (non-null only where resolutions[i]==='edited')
 * replaces the op and is treated as approved. Refuses (AC-3.3) any approved/edited op whose
 * {kind:'new'} OpRef targets a createKnowledge op that is rejected — with an error naming the
 * dependency. newIndexMap maps original createKnowledge op index (its ordinal among ALL
 * createKnowledge ops in the proposal) -> position among APPLIED (approved/edited) creations,
 * so the mutation can resolve refs to real ids at apply time. Rejected creations are absent
 * from the map.
 */
export function planApplication(
  ops: ProposalOp[],
  resolutions: OpResolution[],
  editedOps: Array<ProposalOp | null>,
): PlanResult {
  if (ops.length !== resolutions.length || ops.length !== editedOps.length) {
    throw new Error(
      `planApplication: length mismatch (ops=${ops.length}, resolutions=${resolutions.length}, editedOps=${editedOps.length})`,
    );
  }

  // Effective op at each position: the edited replacement when edited, else the original.
  const effectiveOps: ProposalOp[] = ops.map((op, i) => {
    const resolution = resolutions[i];
    if (resolution === 'edited') {
      const edited = editedOps[i];
      if (edited == null) {
        throw new Error(`planApplication: resolutions[${i}] is 'edited' but editedOps[${i}] is null`);
      }
      return edited;
    }
    return op;
  });

  // Ordered list of original op-array indices that are createKnowledge ops. The position
  // within this list is the ordinal a {kind:'new', index} ref points at.
  const creationOpIndices: number[] = [];
  effectiveOps.forEach((op, i) => {
    if (op.op === 'createKnowledge') creationOpIndices.push(i);
  });

  const isRejected = (i: number): boolean => resolutions[i] === 'rejected';

  // Dependency check (AC-3.3): every approved/edited op's 'new' refs must point at a
  // creation that is itself approved/edited.
  for (let i = 0; i < effectiveOps.length; i++) {
    if (isRejected(i)) continue;
    const currentOp = effectiveOps[i];
    if (!currentOp) continue;
    for (const ref of refsOf(currentOp)) {
      if (ref.kind !== 'new') continue;
      const creationOpIndex = creationOpIndices[ref.index];
      if (creationOpIndex === undefined || isRejected(creationOpIndex)) {
        const creation = creationOpIndex === undefined ? undefined : effectiveOps[creationOpIndex];
        const statement = creation && creation.op === 'createKnowledge' ? creation.statement : undefined;
        const named = statement ? ` ("${statement}")` : '';
        return {
          ok: false,
          error: `op at index ${i} depends on createKnowledge #${ref.index}${named}, which was rejected`,
          failedIndex: i,
        };
      }
    }
  }

  // newIndexMap: creation ordinal -> position among applied creations.
  const newIndexMap = new Map<number, number>();
  let appliedCreationCount = 0;
  creationOpIndices.forEach((opIndex, ordinal) => {
    if (isRejected(opIndex)) return;
    newIndexMap.set(ordinal, appliedCreationCount);
    appliedCreationCount += 1;
  });

  const toApply: Array<{ index: number; op: ProposalOp }> = [];
  effectiveOps.forEach((op, i) => {
    if (isRejected(i)) return;
    toApply.push({ index: i, op });
  });

  return { ok: true, toApply, newIndexMap };
}
