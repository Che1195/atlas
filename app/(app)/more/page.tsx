'use client';

import { useClerk } from '@clerk/nextjs';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';

export default function MorePage() {
  const me = useQuery(api.account.me, {});
  const { signOut } = useClerk();
  const upcoming = ['Experiments', 'Reviews', 'Search & Ask', 'Settings'];

  return (
    <section className="p-6" data-testid="more">
      <h1 className="text-title font-medium">More</h1>

      <div className="mt-4 rounded-card border border-ink-faint bg-surface p-4">
        {me === undefined ? (
          <div className="space-y-2" aria-hidden>
            <div className="h-4 w-1/2 rounded-control bg-ink-faint" />
            <div className="h-3 w-2/3 rounded-control bg-ink-faint" />
          </div>
        ) : me === null ? (
          <p className="text-body text-ink-muted">Account not loaded.</p>
        ) : (
          <>
            <p className="text-body font-medium" data-testid="account-name">
              {me.displayName}
            </p>
            <p className="mt-1 text-meta text-ink-muted" data-testid="account-email">
              {me.email}
            </p>
            <p className="mt-1 text-meta text-ink-faint">{me.timezone}</p>
          </>
        )}
        <button
          type="button"
          data-testid="sign-out"
          onClick={() => signOut({ redirectUrl: '/' })}
          className="fade-state mt-3 rounded-control border border-ink-faint px-4 py-1.5 text-body text-ink-muted"
        >
          Sign out
        </button>
      </div>

      <ul className="mt-6 space-y-2">
        {upcoming.map((item) => (
          <li key={item} className="flex items-baseline justify-between border-b border-ink-faint pb-2">
            <span className="text-body text-ink-muted">{item}</span>
            <span className="text-meta text-ink-faint">arrives in a later phase</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
