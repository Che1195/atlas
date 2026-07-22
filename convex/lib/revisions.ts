// The only snapshot shape written to revisions.snapshot for knowledge rows —
// the lib-side validation the schema's sanctioned any-validator relies on (spec 04 §notes).
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

// Same shape discipline as knowledgeSnapshot, for the other revision target (targetType 'experiment').
export function experimentSnapshot(doc: Doc<'experiments'>) {
  return {
    knowledgeId: doc.knowledgeId,
    hypothesis: doc.hypothesis,
    behavior: doc.behavior,
    context: doc.context,
    successCriteria: doc.successCriteria,
    failureCriteria: doc.failureCriteria,
    observationTarget: doc.observationTarget,
    status: doc.status,
    origin: doc.origin,
  };
}
