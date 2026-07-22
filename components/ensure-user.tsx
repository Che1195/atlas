'use client';

import { useUser } from '@clerk/nextjs';
import { useMutation } from 'convex/react';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/convex/_generated/api';

/**
 * Lazy provisioning (spec 09 §2): first authenticated render upserts the users
 * row with the client-detected IANA timezone. Children render only after the
 * row exists, so every downstream query can requireUser() safely.
 *
 * displayName and email are passed from Clerk's client-side user because the
 * Convex integration's token omits BOTH the `name` claim (observed
 * 2026-07-21) and the `email` claim (observed 2026-07-22, via the E2E
 * harness); the mutation prefers each claim when present and falls back to
 * these args.
 */
export function EnsureUser({ children }: { children: React.ReactNode }) {
  const ensureUser = useMutation(api.account.ensureUser);
  const { user, isLoaded } = useUser();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!isLoaded || started.current) return;
    started.current = true;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    ensureUser({
      timezone,
      displayName: user?.fullName ?? undefined,
      email: user?.primaryEmailAddress?.emailAddress ?? undefined,
    })
      .then(() => setReady(true))
      .catch(() => setFailed(true));
  }, [ensureUser, isLoaded, user]);

  if (failed) {
    return (
      <p className="p-6 text-body text-ink-muted" data-testid="ensure-user-error">
        Could not load your account. Check your connection and reload.
      </p>
    );
  }
  if (!ready) {
    return (
      <div className="space-y-3 p-6" aria-hidden data-testid="ensure-user-loading">
        <div className="h-4 w-2/3 rounded-control bg-ink-faint" />
        <div className="h-4 w-1/2 rounded-control bg-ink-faint" />
      </div>
    );
  }
  return <>{children}</>;
}
