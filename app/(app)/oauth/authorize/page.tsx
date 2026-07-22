'use client';

// OAuth 2.1 consent screen (Phase M Task 5, docs/spec/06-mcp-interface.md §1).
// Lives inside the Clerk-authed (app) layout — by the time this renders, the
// user is signed in. Approve issues a code via api.oauth.grants.approveGrant
// and redirects back to the client's redirect_uri; Deny redirects with the
// RFC 6749 `error=access_denied` shape. EVERY redirect target is validated
// against the client's registered redirect_uris first — an unregistered or
// unknown redirect_uri never gets a redirect at all (open-redirect guard).
import { useAction, useQuery } from 'convex/react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api } from '@/convex/_generated/api';

const ALL_SCOPES = ['read', 'capture', 'propose'] as const;
type Scope = (typeof ALL_SCOPES)[number];

const SCOPE_COPY: Record<Scope, string> = {
  read: 'Read your knowledge, entries, proposals, and experiments.',
  capture: 'Create new entries on your behalf.',
  propose: 'Submit proposed changes to your knowledge base — you always approve them before they take effect.',
};

function ErrorScreen({ message }: { message: string }) {
  return (
    <section className="p-6" data-testid="oauth-authorize-error">
      <h1 className="text-title font-medium">Can&rsquo;t connect</h1>
      <p className="mt-2 text-body text-ink-muted">{message}</p>
    </section>
  );
}

function AuthorizeScreen() {
  const params = useSearchParams();
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const state = params.get('state');
  const codeChallenge = params.get('code_challenge');
  const codeChallengeMethod = params.get('code_challenge_method');
  const scopeParam = params.get('scope');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestedScopes: Scope[] =
    scopeParam === null || scopeParam.trim() === ''
      ? [...ALL_SCOPES]
      : scopeParam.split(' ').filter((s): s is Scope => (ALL_SCOPES as readonly string[]).includes(s));

  // convex/react's useQuery accepts 'skip' to defer the call — see the Convex
  // docs pattern for conditional queries.
  const client = useQuery(api.oauth.grants.getClient, clientId === null ? 'skip' : { clientId });
  const approveGrant = useAction(api.oauth.grants.approveGrant);

  if (clientId === null || redirectUri === null || codeChallenge === null) {
    return <ErrorScreen message="This authorization request is missing required parameters." />;
  }
  if (codeChallengeMethod !== 'S256') {
    return <ErrorScreen message="This client didn't request PKCE with S256, which Atlas requires." />;
  }
  if (client === undefined) {
    return (
      <section className="space-y-2 p-6" aria-hidden>
        <div className="h-4 w-2/3 rounded-control bg-ink-faint" />
        <div className="h-4 w-1/2 rounded-control bg-ink-faint" />
      </section>
    );
  }
  if (client === null) {
    return <ErrorScreen message="Unknown client." />;
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return <ErrorScreen message="The redirect address doesn't match this client's registration." />;
  }

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const { code } = await approveGrant({
        clientId: clientId as string,
        redirectUri: redirectUri as string,
        scopes: requestedScopes,
        codeChallenge: codeChallenge as string,
      });
      const url = new URL(redirectUri as string);
      url.searchParams.set('code', code);
      if (state !== null) url.searchParams.set('state', state);
      window.location.assign(url.toString());
    } catch {
      setError('Could not complete authorization. Try again.');
      setBusy(false);
    }
  }

  function deny() {
    const url = new URL(redirectUri as string);
    url.searchParams.set('error', 'access_denied');
    if (state !== null) url.searchParams.set('state', state);
    window.location.assign(url.toString());
  }

  return (
    <section className="p-6" data-testid="oauth-authorize">
      <h1 className="text-title font-medium">Connect {client.name}</h1>
      <p className="mt-2 text-body text-ink-muted">{client.name} is requesting access to your Atlas account:</p>
      <ul className="mt-4 space-y-2">
        {requestedScopes.map((scope) => (
          <li key={scope} className="rounded-card border border-ink-faint bg-surface p-3 text-body">
            {SCOPE_COPY[scope]}
          </li>
        ))}
      </ul>
      {error !== null && <p className="mt-3 text-meta text-contradict">{error}</p>}
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          data-testid="consent-approve"
          onClick={approve}
          disabled={busy}
          className="fade-state rounded-control bg-meridian px-4 py-1.5 text-body text-paper disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          data-testid="consent-deny"
          onClick={deny}
          disabled={busy}
          className="fade-state rounded-control border border-ink-faint px-4 py-1.5 text-body text-ink-muted disabled:opacity-50"
        >
          Deny
        </button>
      </div>
    </section>
  );
}

export default function OAuthAuthorizePage() {
  return (
    <Suspense fallback={null}>
      <AuthorizeScreen />
    </Suspense>
  );
}
