'use client';

import { useQuery } from 'convex/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/convex/_generated/api';
import { ConfidenceLabel, EvidenceBar } from '@/components/confidence-display';

const TYPES = ['observation', 'insight', 'pattern', 'principle', 'question'] as const;
type UiType = (typeof TYPES)[number];

export default function KnowledgePage() {
  const [type, setType] = useState<UiType | undefined>(undefined);
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const rows = useQuery(api.knowledge.list, { type, status });

  return (
    <section className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-title font-medium">Knowledge</h1>
        <Link
          href="/knowledge/new"
          data-testid="knowledge-new"
          className="rounded-control border border-meridian px-3 py-1.5 text-meta text-meridian"
        >
          New
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          data-testid="knowledge-filter-type"
          value={type ?? ''}
          onChange={(e) => setType(e.target.value === '' ? undefined : (e.target.value as UiType))}
          className="rounded-control border border-ink-faint bg-surface px-2 py-1.5 text-base"
        >
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          data-testid="knowledge-filter-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as 'active' | 'archived')}
          className="rounded-control border border-ink-faint bg-surface px-2 py-1.5 text-base"
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <ul className="divide-y divide-ink-faint">
        {rows === undefined && (
          <li className="py-3" aria-hidden>
            <div className="h-4 w-2/3 rounded-control bg-ink-faint" />
          </li>
        )}
        {rows !== undefined && rows.length === 0 && (
          <li className="py-6 text-body text-ink-muted">
            Knowledge appears here after you review Atlas&rsquo;s proposals. Start by capturing an
            experience — or create knowledge yourself with New.
          </li>
        )}
        {rows?.map((k) => (
          <li key={k._id}>
            <Link href={`/knowledge/${k._id}`} data-testid="knowledge-row" className="block py-3">
              <p className="font-statement text-statement">{k.statement}</p>
              <p className="mt-1 flex items-center gap-2 text-meta text-ink-faint">
                <span>{k.type}</span>
                <ConfidenceLabel confidence={k.confidence} />
              </p>
              <div className="mt-2">
                <EvidenceBar supports={k.supports} contradicts={k.contradicts} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
