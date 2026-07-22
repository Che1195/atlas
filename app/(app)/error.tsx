'use client';

import Link from 'next/link';

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="p-6" data-testid="app-error">
      <h1 className="text-title font-medium">Something went wrong</h1>
      <p className="mt-3 text-body text-ink-muted">
        This item may not exist or is unavailable right now. Your data is unchanged.
      </p>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-control border border-ink-faint px-4 py-1.5 text-body text-ink-muted"
        >
          Try again
        </button>
        <Link href="/capture" className="rounded-control border border-meridian px-4 py-1.5 text-body text-meridian">
          Back to Capture
        </Link>
      </div>
    </section>
  );
}
