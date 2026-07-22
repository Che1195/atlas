// Distill prompt template (docs/spec/05-ai-pipeline.md §1 "distill"). Bump
// DISTILL_PROMPT_VERSION on any semantic change — it stamps aiRuns and gates
// idempotent proposal runIds (`distill:{entryId}:{promptVersion}`).

export const DISTILL_PROMPT_VERSION = 'distill-v1';

export type DistillKnowledgeContextItem = {
  id: string;
  type: string;
  statement: string;
  confidence: string;
};

export type DistillPromptInput = {
  entryBody: string;
  entryKind: string;
  occurredAt: string;
  knowledgeContext: DistillKnowledgeContextItem[];
};

export function buildDistillPrompt(input: DistillPromptInput): { system: string; user: string } {
  const system = [
    `You are Atlas's distillation model (prompt version ${DISTILL_PROMPT_VERSION}).`,
    'Your job is to read one journal entry and propose a small, conservative set of knowledge operations.',
    '',
    'Conservatism contract (do not deviate):',
    '- Propose between 0 and 4 ops. Most entries warrant 0-1.',
    '- Only these op kinds are allowed: createKnowledge, addEvidence, updateKnowledge. Never propose archiveKnowledge, createRelationship, or createExperiment here.',
    '- Prefer addEvidence on an existing knowledge item (from the provided context) over createKnowledge when the entry is a near-duplicate of something already known. The context below exists precisely so you can do this.',
    '- Do not include a confidence field on any op, never — confidence is computed by the system from evidence, not proposed by you.',
    '- Trivial or purely logistical entries (scheduling, errands, one-line status updates) should produce an empty ops array. An empty ops array is a valid, expected output.',
    '- Every op must cite a short verbatim excerpt from the entry body supporting it (in the citations list).',
    '- Every statement must be written in first person and must be 280 characters or fewer.',
    '- Reference existing knowledge only by the exact ids given in the context below.',
  ].join('\n');

  const contextLines =
    input.knowledgeContext.length > 0
      ? input.knowledgeContext
          .map((k, i) => `${i + 1}. id=${k.id} type=${k.type} confidence=${k.confidence} statement="${k.statement}"`)
          .join('\n')
      : '(no existing knowledge context)';

  const user = [
    `Entry kind: ${input.entryKind}`,
    `Occurred at: ${input.occurredAt}`,
    '',
    'Entry body:',
    input.entryBody,
    '',
    'Existing knowledge context (reference by exact id):',
    contextLines,
    '',
    'Propose 0-4 ops following the conservatism contract above.',
  ].join('\n');

  return { system, user };
}
