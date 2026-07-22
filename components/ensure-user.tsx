'use client';

import { useMutation } from 'convex/react';
import { useEffect, useState } from 'react';
import { api } from '@/convex/_generated/api';

/**
 * Lazy provisioning (spec 09 §2): first authenticated render upserts the users
 * row with the client-detected IANA timezone. Children render only after the
 * row exists, so every downstream query can requireUser() safely.
 */
export function EnsureUser({ children }: { children: React.ReactNode }) {
  const ensureUser = useMutation(api.account.ensureUser);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    ensureUser({ timezone })
      .then(() => setReady(true))
      .catch(() => setFailed(true));
  }, [ensureUser]);

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
