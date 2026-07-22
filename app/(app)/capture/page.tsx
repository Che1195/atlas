'use client';

import { useMutation, useQuery } from 'convex/react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/convex/_generated/api';
import { ENTRY_KINDS, formatWhen, toLocalInputValue, type EntryKind } from '@/components/entry-meta';

const DRAFT_KEY = 'atlas.capture-draft';

export default function CapturePage() {
  const createEntry = useMutation(api.entries.create);
  const recent = useQuery(api.entries.list, {});
  const [kind, setKind] = useState<EntryKind>('journal');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [occurredAt, setOccurredAt] = useState<string>(''); // '' = now
  const [showWhen, setShowWhen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restored = useRef(false);

  // Restore draft once; persist on every change (AC-2.2's local-draft half).
  // The restore itself runs in a microtask (rather than setting state directly
  // in the effect body) so it doesn't trip react-hooks/set-state-in-effect —
  // same pattern EnsureUser uses for its post-mount mutation.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    Promise.resolve().then(() => {
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (raw !== null) {
          const draft = JSON.parse(raw) as { kind?: EntryKind; title?: string; body?: string };
          if (draft.kind) setKind(draft.kind);
          if (draft.title) setTitle(draft.title);
          if (draft.body) setBody(draft.body);
        }
      } catch {
        // corrupt draft: start clean
      }
    });
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    if (body === '' && title === '') localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify({ kind, title, body }));
  }, [kind, title, body]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await createEntry({
        kind,
        title: title.trim() === '' ? undefined : title.trim(),
        body,
        occurredAt: occurredAt === '' ? Date.now() : new Date(occurredAt).getTime(),
      });
      setTitle('');
      setBody('');
      setOccurredAt('');
      setShowWhen(false);
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      setError('Could not save. Your draft is still on this device.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 p-4">
      <textarea
        data-testid="capture-input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What happened, and what did you notice?"
        rows={5}
        className="w-full resize-y rounded-card border border-ink-faint bg-surface p-3 text-base"
      />
      <input
        data-testid="capture-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="w-full rounded-control border border-ink-faint bg-surface px-3 py-2 text-base"
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-control border border-ink-faint" role="group" aria-label="Kind">
          {ENTRY_KINDS.map((entryKind) => (
            <button
              key={entryKind.value}
              type="button"
              data-testid={`capture-kind-${entryKind.value}`}
              onClick={() => setKind(entryKind.value)}
              className={`fade-state px-3 py-1.5 text-meta ${
                kind === entryKind.value ? 'bg-ink text-paper' : 'text-ink-muted'
              }`}
            >
              {entryKind.label}
            </button>
          ))}
        </div>
        {showWhen ? (
          <input
            type="datetime-local"
            data-testid="capture-occurred-at"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="rounded-control border border-ink-faint bg-surface px-2 py-1.5 text-base"
          />
        ) : (
          <button
            type="button"
            data-testid="capture-when-chip"
            onClick={() => {
              // Snapshot "now" at click time (impure call belongs in an event handler, not render).
              setOccurredAt(toLocalInputValue(Date.now()));
              setShowWhen(true);
            }}
            className="rounded-control border border-ink-faint px-3 py-1.5 text-meta text-ink-muted"
          >
            Now
          </button>
        )}
        <button
          type="button"
          data-testid="capture-save"
          onClick={save}
          disabled={saving || body.trim() === ''}
          className="fade-state ml-auto rounded-control bg-meridian px-4 py-1.5 text-body text-paper disabled:opacity-50"
        >
          Save
        </button>
      </div>
      {error !== null && <p className="text-meta text-contradict">{error}</p>}
      {body !== '' && <p className="text-meta text-ink-faint">Draft saved on this device.</p>}

      <h2 className="mt-4 text-meta text-ink-muted">Recent entries</h2>
      <ul className="divide-y divide-ink-faint">
        {recent === undefined && (
          <li className="py-3" aria-hidden>
            <div className="h-4 w-2/3 rounded-control bg-ink-faint" />
          </li>
        )}
        {recent !== undefined && recent.length === 0 && (
          <li className="py-3 text-body text-ink-muted">
            Nothing captured yet. Entries are the raw material knowledge is refined from.
          </li>
        )}
        {recent?.map((entry) => (
          <li key={entry._id}>
            <Link
              href={`/entries/${entry._id}`}
              data-testid="entry-row"
              className="block py-3"
            >
              <p className="truncate text-body">{entry.title ?? entry.excerpt}</p>
              <p className="text-meta text-ink-faint">
                {entry.kind} · {formatWhen(entry.occurredAt)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
