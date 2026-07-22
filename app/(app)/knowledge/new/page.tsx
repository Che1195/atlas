'use client';

import { useMutation } from 'convex/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/convex/_generated/api';

const TYPES = ['observation', 'insight', 'pattern', 'principle', 'question'] as const;
const STATEMENT_MAX = 280;

export default function NewKnowledgePage() {
  const createKnowledge = useMutation(api.knowledge.create);
  const router = useRouter();
  const [type, setType] = useState<(typeof TYPES)[number]>('insight');
  const [statement, setStatement] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    try {
      const id = await createKnowledge({
        type,
        statement,
        body: body.trim() === '' ? undefined : body,
      });
      router.push(`/knowledge/${id}`);
    } catch {
      setError('Could not create — check the statement and try again.');
    }
  }

  return (
    <section className="flex flex-col gap-4 p-4">
      <h1 className="text-title font-medium">New knowledge</h1>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Type">
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`knowledge-type-${t}`}
            onClick={() => setType(t)}
            className={`fade-state rounded-control border px-3 py-1.5 text-meta ${
              type === t ? 'border-meridian text-meridian' : 'border-ink-faint text-ink-muted'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div>
        <textarea
          data-testid="knowledge-statement-input"
          value={statement}
          onChange={(e) => setStatement(e.target.value.slice(0, STATEMENT_MAX))}
          placeholder="The claim, first person, one sentence."
          rows={3}
          className="w-full resize-y rounded-card border border-ink-faint bg-surface p-3 font-statement text-base"
        />
        <p className="mt-1 text-right text-meta text-ink-faint">
          {statement.length}/{STATEMENT_MAX}
        </p>
      </div>
      <textarea
        data-testid="knowledge-body-input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Elaboration (optional)"
        rows={4}
        className="w-full resize-y rounded-card border border-ink-faint bg-surface p-3 text-base"
      />
      {error !== null && <p className="text-meta text-contradict">{error}</p>}
      <button
        type="button"
        data-testid="knowledge-create"
        onClick={create}
        disabled={statement.trim() === ''}
        className="fade-state w-fit rounded-control bg-meridian px-4 py-1.5 text-body text-paper disabled:opacity-50"
      >
        Create
      </button>
    </section>
  );
}
