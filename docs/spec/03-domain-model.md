# 03 — Domain Model

## 1. Object inventory

The vision's 12 first-class objects map to 9 stored types (plus 2 operational):

| Vision object | Stored as | Notes |
|---|---|---|
| Entry | `entries` row | Source document. Evidence substrate, never knowledge. |
| Observation / Interpretation / Insight / Pattern / Principle / Question | `knowledge` row with `type` | One table, one enum (ADR-0005). `interpretation` exists in schema, hidden in MVP UI. |
| Experiment | `experiments` row | Distinct shape → own table. |
| Outcome | `outcomes` row | Child of experiment; generates evidence. |
| Evidence | `evidence` row | Edge: knowledge ↔ (entry \| outcome), with stance. |
| Relationship | `relationships` row | Edge: knowledge ↔ knowledge, typed. |
| Revision | `revisions` row | Snapshot log for knowledge + experiments. |
| — | `proposals` row | The AI-mutation gate (not in vision's list; required by its AI philosophy). |
| — | `reviews` row | Generated periodic reviews. |

## 2. Entry (source document)

- `kind`: `journal` (written reflection) · `conversation` (pasted AI/human conversation) · `note` (fragment).
- `body` markdown; `occurredAt` (when the experience happened — user-editable) distinct from `_creationTime` (when captured).
- `source`: `app` | `mcp` — provenance of capture.
- `duplicateOf` (optional entry id): marks re-tellings of the same event so evidence dedup counts them once (vision: "repeated summaries of the same event are not additional evidence").
- Editable; edits do not create revisions (entries are evidence, not conclusions) but set `editedAt`.
- Deletable only if no evidence rows cite it; otherwise archive (evidence integrity).

## 3. Knowledge object

The atom of Atlas.

- `type`: `observation` | `interpretation` | `insight` | `pattern` | `principle` | `question`.
  - *observation* — something noticed, low abstraction ("I spoke less after Marco arrived").
  - *insight* — a claim about oneself/the world ("I become performative around perceived-higher-status people").
  - *pattern* — an insight-level claim explicitly supported by recurrence (≥3 distinct sources expected).
  - *principle* — an action-guiding rule distilled from patterns ("Choose the honest response over the impressive one").
  - *question* — an open question the system should keep gathering evidence toward.
  - *interpretation* — reading of a specific event; schema-present, UI-deferred (00-overview §deviation-4).
- `statement`: the claim itself, ≤ 280 chars, first person. The searchable, displayable core.
- `body`: optional elaboration (markdown).
- `confidence` + `confidenceOverridden` (§5), `status`: `active` | `archived`.
- `origin`: `user` | `ai` (ai ⇒ was approved through a proposal; there is no unapproved path).
- Embedded for vector search on `statement + body`.

## 4. Edges

**Evidence** — `knowledgeId`, `sourceType` (`entry` | `outcome`), `sourceId`, `stance` (`supports` | `contradicts` | `neutral`), optional `note` (which part of the entry, why it bears on the claim), `origin`.
- Uniqueness: one evidence row per (knowledgeId, sourceType, sourceId). Re-proposals update the note, never duplicate.
- Distinctness for confidence: sources collapse through `entries.duplicateOf` chains.

**Relationship** — `fromId` → `toId` (both knowledge), `kind`:
- `derives-from` (insight from observations), `generalizes` (pattern over insights; principle over patterns), `contradicts`, `relates-to`, `answers` (knowledge answers a question), `supersedes` (new formulation replaces old; old is archived with pointer).
- The promotion path insight → pattern → principle is *relationships between separate objects*, not type mutation: promoting preserves the original object and its history.

## 5. Confidence model

Two orthogonal fields (deviation from vision's 7-value ladder — see 00-overview §deviation-3):

`confidence`: `hypothesis` → `tentative` → `supported` → `strong`, plus `mixed`, `contradicted`.
`status`: `active` | `archived` (vision's "Archived" is lifecycle, not confidence).

Mapping from vision: Hypothesis→`hypothesis`, Emerging Pattern→`tentative`, Supported→`supported`, Strongly Supported→`strong`, Mixed Evidence→`mixed`, Contradicted→`contradicted`.

**Computation** (`convex/lib/confidence.ts`, pure):

```
S = count of distinct supporting sources (dedup via duplicateOf; outcomes count double-weight — real-world tests beat recollections)
C = count of distinct contradicting sources

suggested =
  C == 0:            S == 0 → hypothesis; S == 1 → tentative; S in 2..3 → supported; S >= 4 → strong
  C > 0 && S > 2C:   mixed-leaning-supported → supported (UI shows the tension)
  C > 0 && S <= 2C:  mixed
  C >= 2 && C > S:   contradicted

Precedence (first match wins): C == 0 ladder → contradicted → supported → mixed.
(The contradicted guard must be checked before mixed: C >= 2 && C > S implies S <= 2C,
so a top-to-bottom reading of the cases above would never reach it.)
```

Rules:
- The function returns a suggestion **with its inputs** (S, C, source list); the UI always shows the arithmetic.
- Auto-applied only while `confidenceOverridden == false`. A user override sets the flag and records a revision with reason; later evidence still recomputes the *suggestion* and the UI shows drift ("your override: supported; evidence suggests: mixed").
- AI can never write confidence — not even via proposal ops. It adds evidence; confidence follows.
- Repetition guard: distinct-source counting is the enforcement of "repeated summaries are not additional evidence."
- Dedup nuance: distinct-source collapsing happens per canonical source, so two evidence rows
  whose entries are linked by `duplicateOf` but carry OPPOSITE stances collapse to one source
  with a single stance (implementation: last row wins). Unreachable until the retelling UI can
  set `duplicateOf`; add a pinning test when it lands (logged 2026-07-21).

## 6. Experiment & Outcome

Experiment: `knowledgeId` (object under test), `hypothesis`, `behavior`, `context`, `successCriteria`, `failureCriteria`, `observationTarget`, `status` (`draft` | `active` | `completed` | `abandoned`), `origin`.

Outcome: `experimentId`, `result` (`success` | `failure` | `mixed` | `inconclusive`), `narrative`, `observedAt`.

Lifecycle: recording an outcome (a) completes the experiment, (b) auto-drafts a proposal attaching the outcome as evidence on the tested knowledge object with stance derived from result (`success`→supports, `failure`→contradicts, `mixed`/`inconclusive`→neutral + note). The user approves like any proposal — an outcome narrative might actually bear on a *different* belief, and the human decides.

## 7. Proposal (the AI gate)

A proposal is an ordered list of typed **ops** + rationale + citations, from `source`: `distillation` | `connection` | `outcome` | `mcp` | `review`.

Op union (shared TS type, `convex/shared/proposalOps.ts`):

```ts
type OpRef = { kind: 'existing'; id: string } | { kind: 'new'; index: number }; // reference an op's own creations

type ProposalOp =
  | { op: 'createKnowledge'; type: KnowledgeType; statement: string; body?: string }
  | { op: 'updateKnowledge'; target: OpRef; patch: { statement?: string; body?: string; type?: KnowledgeType }; reason: string }
  | { op: 'archiveKnowledge'; target: OpRef; reason: string }
  | { op: 'addEvidence'; knowledge: OpRef; sourceType: 'entry' | 'outcome'; sourceId: string; stance: Stance; note?: string }
  | { op: 'createRelationship'; from: OpRef; to: OpRef; kind: RelationshipKind; note?: string }
  | { op: 'createExperiment'; knowledge: OpRef; hypothesis: string; behavior: string; context: string; successCriteria: string; failureCriteria: string; observationTarget: string }
```

Rules:
- **Op-level resolution:** user approves/rejects/edits each op independently. `applyProposal` applies the approved subset in one transaction; dependency check rejects approving an op whose `new`-ref target was rejected.
- Every applied op that touches a knowledge object or experiment writes a `revisions` snapshot (actor `ai-approved`, the proposal id, the op's reason).
- Proposals expire (`superseded`) if a newer proposal from the same source covers the same entry/run.
- **User direct edits** go through the same op-application lib with actor `user` — identical revision/provenance behavior, no proposal row.

## 8. Revision

Snapshot-based (objects are small; diffs are false economy): `targetType` + `targetId`, monotonically increasing `rev`, full `snapshot` of the object's domain fields, `actor` (`user` | `ai-approved`), `reason`, optional `proposalId`. Written in the same mutation as the change. Answering the vision's provenance questions = current row + revision chain + evidence rows.

## 9. Provenance answers (vision §Provenance → fields)

| Question | Answered by |
|---|---|
| Where did this come from? | `origin` + creating revision's `proposalId` → proposal's `source` + citations |
| What supports / contradicts it? | `evidence` rows by stance |
| Who created it? Me or AI? | `origin`; per-change: `revisions.actor` |
| When / why last updated? | latest revision `_creationTime` + `reason` |
