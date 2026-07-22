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

  function evidenceList(rows: NonNullable<typeof detail>['evidence'], label: string, tone: string) {
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
