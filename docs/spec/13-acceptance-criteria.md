# 13 — Acceptance Criteria

Given/When/Then per MVP capability. Each maps to tests (11) and a roadmap gate (12). "AC-x.y" ids are referenced from test names.

## AC-1 Authentication & account

- **1.1** Given a new visitor, when they sign up, then a display name is required before completion, and their `users` row carries it plus a valid IANA timezone.
- **1.2** Given user B authenticated, when any public function is invoked targeting user A's document ids, then the call throws or returns empty — for **every** public function (registry-enforced test).
- **1.3** Given a user deletes their account, when they complete the typed confirmation, then all rows across all tables for that `userId` are gone, the Clerk user is deleted, and the flow displayed "this is permanent" copy beforehand.

## AC-2 Capture

- **2.1** Given the app is open to Capture, when the user types and saves, then the entry exists with `source: 'app'`, correct kind and `occurredAt`, and appears in the recent list — within one perceived interaction (< 1 s save feedback).
- **2.2** Given connectivity is lost mid-typing, when the user reloads the PWA, then the draft is restored from local storage and the UI said "Saved on this device — will sync" (never a fake success).
- **2.3** Given an entry is a retelling, when the user marks `duplicateOf`, then confidence computations count the pair as one distinct source (verified through AC-5.2).
- **2.4** Given an entry is cited by evidence, when the user tries to delete it, then it archives instead and the UI explains why.

## AC-3 Distillation & proposals

- **3.1** Given an entry, when the user taps Distill, then either a proposal with 1–4 ops + rationale + entry-excerpt citations appears in the review queue, or the UI states Atlas found nothing worth proposing. No knowledge/evidence/relationship rows are written by distillation itself.
- **3.2** Given a proposal's ops, when the user approves some, edits one, and rejects another, then exactly the approved/edited ops apply in one transaction, each touched object gains a revision (`actor: 'ai-approved'`, proposal id, reason), and rejected ops leave no trace beyond their recorded resolution.
- **3.3** Given an op whose `new`-ref target was rejected, when the user attempts approval, then application is refused with an explanation naming the dependency.
- **3.4** Given the daily AI budget is exhausted, when the user taps Distill, then the run is refused with the honest budget message and the entry remains intact; capture and browsing are unaffected.
- **3.5** Given the same entry re-distilled, when a prior proposal is pending, then it is superseded — never duplicated (runId idempotency).

## AC-4 Knowledge objects & provenance

- **4.1** Given an approved knowledge object, when its detail is opened, then statement, type, status, confidence with shown computation (S/C and sources), evidence split supports/contradicts with tappable sources, relationships both directions, and full revision history (actor + reason + date) are all present — the vision's provenance questions answerable on one screen.
- **4.2** Given a user edits a statement directly, when they save, then a reason is required and a revision (`actor: 'user'`) is written — identical mechanics to AI-approved changes.
- **4.3** Given an object is archived, then it disappears from default views, remains in archived filter with intact history, and its evidence/relationships are preserved.

## AC-5 Confidence

- **5.1** Given evidence changes on a non-overridden object, then confidence equals the pure function's output for the distinct-source S/C counts, and the UI shows those counts.
- **5.2** Given two evidence rows whose entries are linked by `duplicateOf`, then they count as one distinct source.
- **5.3** Given a user overrides confidence, then the override sticks (`confidenceOverridden`), is recorded as a revision with reason, and later evidence shows suggestion drift without silently changing the label.
- **5.4** There exists no code path — proposal op, MCP tool, or pipeline write — that sets confidence from an AI value (asserted by op-schema and MCP contract tests).

## AC-6 Experiments & outcomes

- **6.1** Given a knowledge object, when the user designs an experiment, then hypothesis/behavior/context/success/failure/observation-target are captured and the experiment links to the object.
- **6.2** Given an active experiment, when an outcome is recorded, then the experiment completes and a pending evidence proposal targeting the tested object exists with stance derived from the result — applied only after user approval, after which the object's confidence recomputes (closing the loop: an outcome can move a confidence label).

## AC-7 Search & Ask

- **7.1** Given knowledge exists on a topic, when the user searches, then hybrid results return relevant knowledge and entries; with embeddings missing, full-text still returns results.
- **7.2** Given an Ask question on a covered topic, then the answer cites ≥1 owned object/entry via links, and content derives only from retrieved items (fixture-tested); on an uncovered topic, the answer says Atlas has nothing relevant yet.

## AC-8 Reviews

- **8.1** Given daily/weekly cadence enabled, when the user's local boundary passes, then a review exists with computed sections (ids resolve to real objects) and prose ≤ 200 words containing no banned motivational lexicon.
- **8.2** Given a period with zero activity, then the review states that plainly and invents nothing.

## AC-9 MCP / Hermes

- **9.1** Given a fresh named API key, then it is displayed exactly once, stored hashed, listed by prefix, and revocation takes effect on the next request.
- **9.2** Given a valid `capture`-scoped key, when `atlas_create_entry` is called, then the entry exists with `source: 'mcp'` and appears in the PWA instantly; with a key lacking the scope, the call returns `forbidden_scope` and writes nothing.
- **9.3** Given `atlas_submit_proposal` with valid ops, then a `pending` proposal (`source: 'mcp'`) appears in the review queue and **no** knowledge/evidence/relationship row exists until PWA approval. `atlas_preview_proposal` on invalid ops returns per-op errors and writes nothing.
- **9.4** Given the full tool registry, then no tool exists that directly mutates knowledge, evidence, relationships, confidence, or revisions (contract-suite invariant), and every read tool returns only the key-owner's data.
- **9.5** Given 60+ requests in a minute on one key, then subsequent calls receive 429 with `Retry-After`.

## AC-10 Export & operational

- **10.1** Given any account state, when Export runs, then a single JSON document containing every user-owned row (all tables, ids preserved) downloads, and re-parsing it accounts for 100% of the user's documents.
- **10.2** Given a client-side crash, then a `crashes` row exists with message/stack/route and **no entry or knowledge content**, and it is visible in the owner ops panel.
- **10.3** Given a filed issue, then the owner sees it in the inbox, and resolution returns to the filer with a verify/reopen control.

## Release gates (roll-up)

- **MVP-complete:** AC-1 through AC-10 green (test-backed where automatable; AC-8.1 tone and AC-3.1 quality via logged evals).
- **First non-owner user:** MVP-complete + four-audit findings resolved + launch checklist (12 §pre-launch) signed off in the ledger.
