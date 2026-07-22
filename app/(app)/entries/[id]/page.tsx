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
  const [removed, setRemoved] = useState(false);
  const entry = useQuery(api.entries.get, removed ? 'skip' : { id: entryId });
  const updateEntry = useMutation(api.entries.update);
  const removeEntry = useMutation(api.entries.remove);
  const distillStatus = useQuery(api.entries.distillStatus, removed ? 'skip' : { id: entryId });
  const requestDistill = useMutation(api.entries.requestDistill);
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [distillUnavailable, setDistillUnavailable] = useState(false);

  async function distill() {
    setDistillUnavailable(false);
    try {
      await requestDistill({ id: entryId });
    } catch {
      setDistillUnavailable(true);
    }
  }

  function renderDistill() {
    if (distillUnavailable) {
      return (
        <p data-testid="entry-distill" className="text-meta text-ink-faint">
          Distill is unavailable right now
        </p>
      );
    }
    if (distillStatus === undefined) return null;
    switch (distillStatus) {
      case 'none':
      case 'error':
        return (
          <button
            type="button"
            data-testid="entry-distill"
            onClick={distill}
            className="rounded-control border border-ink-faint px-3 py-1.5 text-meta text-ink-muted"
          >
            Distill
          </button>
        );
      case 'running':
        return (
          <button
            type="button"
            data-testid="entry-distill"
            disabled
            className="rounded-control border border-ink-faint px-3 py-1.5 text-meta text-ink-faint opacity-50"
          >
            Distilling…
          </button>
        );
      case 'proposed':
        return (
          <Link
            href="/review"
            data-testid="entry-distill"
            className="fade-state text-meta text-meridian underline"
          >
            Distilled ✓ — view proposal
          </Link>
        );
      case 'empty':
        return (
          <div>
            <p data-testid="entry-distill-empty" className="text-meta text-ink-muted">
              Atlas found nothing worth proposing in this entry
            </p>
            <button
              type="button"
              data-testid="entry-distill"
              onClick={distill}
              className="fade-state mt-1 text-meta text-meridian underline"
            >
              Distill again
            </button>
          </div>
        );
      case 'budget':
        return (
          <p data-testid="entry-distill" className="text-meta text-pending">
            AI budget reached for today — Distill will work tomorrow, your entry is saved
          </p>
        );
      case 'unavailable':
        return (
          <p data-testid="entry-distill-unavailable" className="text-meta text-ink-muted">
            Distillation happens through your connected assistant — see{' '}
            <Link href="/connections" className="text-meridian underline">
              Settings → Connections
            </Link>
            .
          </p>
        );
    }
  }

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
      setRemoved(true);
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
      <div className="mt-1">{renderDistill()}</div>
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
