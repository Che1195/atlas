'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ProposalOp } from '@/convex/shared/proposalOps';

export type OpResolution = 'pending' | 'approved' | 'rejected' | 'edited';

type Citation = { sourceType: string; sourceId: string; excerpt?: string };

const EDITABLE_KINDS = new Set<ProposalOp['op']>(['createKnowledge', 'updateKnowledge']);

function chip(op: ProposalOp): { label: string; tone: string } {
  switch (op.op) {
    case 'createKnowledge':
      return { label: op.type, tone: 'text-ink-muted' };
    case 'addEvidence':
      return {
        label: op.stance,
        tone:
          op.stance === 'supports'
            ? 'text-support'
            : op.stance === 'contradicts'
              ? 'text-contradict'
              : 'text-ink-muted',
      };
    case 'updateKnowledge':
      return { label: 'update', tone: 'text-ink-muted' };
    case 'archiveKnowledge':
      return { label: 'archive', tone: 'text-contradict' };
    case 'createRelationship':
      return { label: op.kind, tone: 'text-ink-muted' };
    case 'createExperiment':
      return { label: 'experiment', tone: 'text-ink-muted' };
  }
}

function primaryText(op: ProposalOp): string {
  switch (op.op) {
    case 'createKnowledge':
      return op.statement;
    case 'updateKnowledge':
      return op.patch.statement ?? op.reason;
    case 'archiveKnowledge':
      return op.reason;
    case 'addEvidence':
      return op.note ?? `Cites this entry as ${op.stance}`;
    case 'createRelationship':
      return op.note ?? `${op.kind} relationship`;
    case 'createExperiment':
      return op.hypothesis;
  }
}

function secondaryText(op: ProposalOp): string | undefined {
  switch (op.op) {
    case 'createKnowledge':
      return op.body;
    case 'updateKnowledge':
      return op.patch.body;
    default:
      return undefined;
  }
}

/**
 * One proposed op inside a proposal (10 §4 review queue). Edit is only offered for
 * createKnowledge/updateKnowledge — addEvidence and the other op kinds have nothing
 * meaningful to edit in 3a. Kind is never changed by the UI; only statement/body.
 */
export function OpCard({
  op,
  index,
  resolution,
  editedOp,
  citation,
  onApprove,
  onReject,
  onEdit,
}: {
  op: ProposalOp;
  index: number;
  resolution: OpResolution;
  editedOp: ProposalOp | null;
  citation: Citation | undefined;
  onApprove: () => void;
  onReject: () => void;
  onEdit: (op: ProposalOp) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftStatement, setDraftStatement] = useState('');
  const [draftBody, setDraftBody] = useState('');

  const displayOp = editedOp ?? op;
  const { label, tone } = chip(op);
  const canEdit = EDITABLE_KINDS.has(op.op);

  function startEdit() {
    setDraftStatement(
      displayOp.op === 'createKnowledge'
        ? displayOp.statement
        : displayOp.op === 'updateKnowledge'
          ? (displayOp.patch.statement ?? '')
          : '',
    );
    setDraftBody(
      displayOp.op === 'createKnowledge'
        ? (displayOp.body ?? '')
        : displayOp.op === 'updateKnowledge'
          ? (displayOp.patch.body ?? '')
          : '',
    );
    setEditing(true);
  }

  function saveEdit() {
    if (displayOp.op === 'createKnowledge') {
      onEdit({
        ...displayOp,
        statement: draftStatement,
        body: draftBody.trim() === '' ? undefined : draftBody,
      });
    } else if (displayOp.op === 'updateKnowledge') {
      onEdit({
        ...displayOp,
        patch: {
          ...displayOp.patch,
          statement: draftStatement.trim() === '' ? undefined : draftStatement,
          body: draftBody.trim() === '' ? undefined : draftBody,
        },
      });
    }
    setEditing(false);
  }

  return (
    <li data-testid={`review-op-${index}`} className="rounded-card border border-ink-faint bg-surface p-3">
      <p className={`text-meta ${tone}`}>{label}</p>

      {editing ? (
        <div className="mt-2 space-y-2">
          <input
            data-testid={`op-edit-statement-${index}`}
            value={draftStatement}
            onChange={(e) => setDraftStatement(e.target.value.slice(0, 280))}
            className="w-full rounded-control border border-ink-faint px-2 py-1.5 font-statement text-base"
          />
          <textarea
            data-testid={`op-edit-body-${index}`}
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={3}
            className="w-full resize-y rounded-control border border-ink-faint p-2 text-base"
          />
          <div className="flex gap-2">
            <button
              type="button"
              data-testid={`op-edit-save-${index}`}
              onClick={saveEdit}
              disabled={draftStatement.trim() === ''}
              className="rounded-control bg-meridian px-3 py-1.5 text-meta text-paper disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              data-testid={`op-edit-cancel-${index}`}
              onClick={() => setEditing(false)}
              className="rounded-control border border-ink-faint px-3 py-1.5 text-meta text-ink-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1 font-statement text-statement">{primaryText(displayOp)}</p>
          {secondaryText(displayOp) !== undefined && (
            <p className="mt-1 text-body text-ink-muted">{secondaryText(displayOp)}</p>
          )}
        </>
      )}

      {citation?.excerpt !== undefined &&
        (citation.sourceType === 'entry' ? (
          <Link
            href={`/entries/${citation.sourceId}`}
            data-testid={`op-citation-${index}`}
            className="fade-state mt-2 block text-meta text-ink-faint underline"
          >
            &ldquo;{citation.excerpt}&rdquo;
          </Link>
        ) : (
          <p className="mt-2 text-meta text-ink-faint">&ldquo;{citation.excerpt}&rdquo;</p>
        ))}

      {!editing && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            data-testid={`op-approve-${index}`}
            onClick={onApprove}
            className={`fade-state rounded-control border px-3 py-1.5 text-meta ${
              resolution === 'approved' || resolution === 'edited'
                ? 'border-meridian text-meridian'
                : 'border-ink-faint text-ink-muted'
            }`}
          >
            Approve
          </button>
          {canEdit && (
            <button
              type="button"
              data-testid={`op-edit-${index}`}
              onClick={startEdit}
              className="rounded-control border border-ink-faint px-3 py-1.5 text-meta text-ink-muted"
            >
              Edit
            </button>
          )}
          <button
            type="button"
            data-testid={`op-reject-${index}`}
            onClick={onReject}
            className={`fade-state rounded-control border px-3 py-1.5 text-meta ${
              resolution === 'rejected' ? 'border-contradict text-contradict' : 'border-ink-faint text-ink-muted'
            }`}
          >
            Reject
          </button>
        </div>
      )}
    </li>
  );
}
