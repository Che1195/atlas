'use client';

import { useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { OpCard, type OpResolution } from '@/components/op-card';
import type { ProposalOp } from '@/convex/shared/proposalOps';

type ProposalListItem = {
  _id: Id<'proposals'>;
  source: 'distillation' | 'connection' | 'outcome' | 'mcp' | 'review';
  rationale: string;
  entryId?: Id<'entries'>;
  entryExcerpt?: string;
  citations: { sourceType: string; sourceId: string; excerpt?: string }[];
  ops: unknown[];
  _creationTime: number;
};

/** AC-3.3 copy comes straight from the ConvexError's message when present. */
function dependencyMessage(err: unknown): string {
  const fallback = 'Some approved changes depend on a rejected one.';
  if (!(err instanceof ConvexError)) return fallback;
  const data: unknown = err.data;
  if (
    typeof data === 'object' &&
    data !== null &&
    'message' in data &&
    typeof (data as { message?: unknown }).message === 'string'
  ) {
    return (data as { message: string }).message;
  }
  return fallback;
}

/**
 * One pending proposal — op-level triage (10 §4). Resolutions/edits live only in
 * this component's state until Apply; the proposal disappears from proposals.list
 * reactively once resolved (AC-3.2).
 */
function ProposalCard({ proposal }: { proposal: ProposalListItem }) {
  const ops = proposal.ops as ProposalOp[]; // validated server-side at write time
  const resolve = useMutation(api.proposals.resolve);
  const [resolutions, setResolutions] = useState<OpResolution[]>(() => ops.map(() => 'pending'));
  const [editedOps, setEditedOps] = useState<Array<ProposalOp | null>>(() => ops.map(() => null));
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setResolution(i: number, resolution: OpResolution, edited: ProposalOp | null = null) {
    setResolutions((prev) => prev.map((x, idx) => (idx === i ? resolution : x)));
    setEditedOps((prev) => prev.map((x, idx) => (idx === i ? edited : x)));
    setError(null);
  }

  function approveRemaining() {
    setResolutions((prev) => prev.map((r) => (r === 'pending' ? 'approved' : r)));
    setError(null);
  }

  const allResolved = resolutions.every((r) => r !== 'pending');

  async function apply() {
    setApplying(true);
    setError(null);
    try {
      await resolve({
        id: proposal._id,
        resolutions: resolutions as Exclude<OpResolution, 'pending'>[],
        editedOps,
      });
    } catch (err) {
      setError(dependencyMessage(err));
    } finally {
      setApplying(false);
    }
  }

  return (
    <section data-testid="review-proposal" className="rounded-card border border-ink-faint bg-surface p-4">
      <header className="border-b border-ink-faint pb-2">
        <p className="text-meta text-ink-faint">
          <span className="text-meridian">AI</span> · {proposal.source}
        </p>
        {proposal.entryId !== undefined && proposal.entryExcerpt !== undefined && (
          <Link
            href={`/entries/${proposal.entryId}`}
            data-testid="review-entry-link"
            className="fade-state mt-1 block text-body text-ink-muted"
          >
            {proposal.entryExcerpt}
          </Link>
        )}
        <p className="mt-1 text-meta text-ink-muted">{proposal.rationale}</p>
      </header>

      <ul className="mt-3 space-y-3">
        {ops.map((op, i) => (
          <OpCard
            key={i}
            op={op}
            index={i}
            resolution={resolutions[i] ?? 'pending'}
            editedOp={editedOps[i] ?? null}
            citation={proposal.citations[i]}
            onApprove={() => setResolution(i, 'approved')}
            onReject={() => setResolution(i, 'rejected')}
            onEdit={(edited) => setResolution(i, 'edited', edited)}
          />
        ))}
      </ul>

      <footer className="mt-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="proposal-approve-remaining"
            onClick={approveRemaining}
            disabled={allResolved}
            className="rounded-control border border-ink-faint px-3 py-1.5 text-meta text-ink-muted disabled:opacity-50"
          >
            Approve remaining
          </button>
          <button
            type="button"
            data-testid="proposal-apply"
            onClick={apply}
            disabled={!allResolved || applying}
            className="rounded-control bg-meridian px-3 py-1.5 text-meta text-paper disabled:opacity-50"
          >
            Apply
          </button>
        </div>
        {error !== null && (
          <p data-testid="proposal-apply-error" className="text-meta text-contradict">
            {error}
          </p>
        )}
      </footer>
    </section>
  );
}

export default function ReviewPage() {
  const proposals = useQuery(api.proposals.list, {});

  return (
    <section className="flex flex-col gap-4 p-4">
      <h1 className="text-title font-medium">Review</h1>

      {proposals === undefined && (
        <div className="space-y-3" aria-hidden>
          <div className="h-4 w-2/3 rounded-control bg-ink-faint" />
          <div className="h-4 w-1/2 rounded-control bg-ink-faint" />
        </div>
      )}

      {proposals !== undefined && proposals.length === 0 && (
        <p data-testid="review-empty" className="text-body text-ink-muted">
          Nothing awaits review. Capture something, or ask Atlas a question.
        </p>
      )}

      {proposals !== undefined && proposals.length > 0 && (
        <div data-testid="review-list" className="flex flex-col gap-4">
          {proposals.map((proposal) => (
            <ProposalCard key={proposal._id} proposal={proposal} />
          ))}
        </div>
      )}
    </section>
  );
}
