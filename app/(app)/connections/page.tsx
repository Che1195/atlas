'use client';

// Connections screen (Phase M Task 6, docs/spec/10-ux-spec.md §... "Connections":
// MCP keys create/list/revoke, OAuth grants list/revoke, setup snippets for the
// ChatGPT connector (OAuth) and Codex/agents (bearer key)). Three independent
// sections; each backed by its own public query/mutation pair.
import { useAction, useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

type Scope = 'read' | 'capture' | 'propose';
const ALL_SCOPES: Scope[] = ['read', 'capture', 'propose'];

/** MCP endpoint origin for the setup snippets. Prefers the explicit env var;
 * falls back to deriving it from NEXT_PUBLIC_CONVEX_URL (Convex's *.convex.cloud
 * deployment URL and its *.convex.site HTTP-actions origin share a subdomain —
 * only the suffix differs), and finally a placeholder so the page still renders
 * something legible if neither is configured. */
function mcpSiteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (explicit !== undefined && explicit.trim() !== '') return explicit;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (convexUrl !== undefined && convexUrl.includes('.convex.cloud')) {
    return convexUrl.replace('.convex.cloud', '.convex.site');
  }
  return 'https://<your-deployment>.convex.site';
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function CopyButton({ text, testId }: { text: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="fade-state rounded-control border border-ink-faint px-2 py-1 text-meta text-ink-muted"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Inline revoke-with-confirm: one click arms it, a second confirms — no native dialog. */
function RevokeButton({
  testIdBase,
  onRevoke,
}: {
  testIdBase: string;
  onRevoke: () => void | Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        data-testid={testIdBase}
        onClick={() => setConfirming(true)}
        className="fade-state text-meta text-contradict underline"
      >
        Revoke
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2 text-meta">
      <span className="text-ink-muted">Revoke for good?</span>
      <button
        type="button"
        data-testid={`${testIdBase}-confirm`}
        onClick={onRevoke}
        className="fade-state text-contradict underline"
      >
        Yes, revoke
      </button>
      <button
        type="button"
        data-testid={`${testIdBase}-cancel`}
        onClick={() => setConfirming(false)}
        className="fade-state text-ink-muted underline"
      >
        Cancel
      </button>
    </span>
  );
}

function ApiKeysSection() {
  const keys = useQuery(api.apiKeys.list, {});
  const createKey = useAction(api.apiKeys.create);
  const revokeKey = useMutation(api.apiKeys.revoke);

  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(ALL_SCOPES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plaintext, setPlaintext] = useState<string | null>(null);

  function toggleScope(scope: Scope) {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  }

  async function create() {
    setError(null);
    setBusy(true);
    try {
      const result = await createKey({ name: name.trim(), scopes });
      setPlaintext(result.plaintext);
      setName('');
      setScopes(ALL_SCOPES);
    } catch {
      setError('Could not create key — check the name and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-body font-medium">API keys</h2>
      <p className="text-meta text-ink-muted">
        For agents that send a header themselves (Codex CLI, other MCP clients). Each key is shown once
        at creation — copy it before you leave this screen.
      </p>

      {plaintext !== null && (
        <div data-testid="key-plaintext" className="rounded-card border border-meridian bg-surface p-3">
          <p className="text-meta font-medium text-meridian">
            Copy this now — you won&rsquo;t see it again.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-control bg-paper p-2 text-meta">{plaintext}</pre>
          <div className="mt-2 flex items-center gap-2">
            <CopyButton text={plaintext} testId="key-plaintext-copy" />
            <button
              type="button"
              data-testid="key-plaintext-done"
              onClick={() => setPlaintext(null)}
              className="fade-state rounded-control border border-ink-faint px-2 py-1 text-meta text-ink-muted"
            >
              Done — I&rsquo;ve copied it
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-card border border-ink-faint bg-surface p-3">
        <input
          data-testid="key-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name (e.g. Codex CLI)"
          className="rounded-control border border-ink-faint bg-paper px-3 py-2 text-base"
        />
        <div className="flex flex-wrap gap-3" role="group" aria-label="Scopes">
          {ALL_SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-1.5 text-meta text-ink-muted">
              <input
                type="checkbox"
                data-testid={`key-scope-${scope}`}
                checked={scopes.includes(scope)}
                onChange={() => toggleScope(scope)}
              />
              {scope}
            </label>
          ))}
        </div>
        {error !== null && <p className="text-meta text-contradict">{error}</p>}
        <button
          type="button"
          data-testid="key-create"
          onClick={create}
          disabled={busy || name.trim() === '' || scopes.length === 0}
          className="fade-state w-fit rounded-control bg-meridian px-4 py-1.5 text-body text-paper disabled:opacity-50"
        >
          Create key
        </button>
      </div>

      <ul className="divide-y divide-ink-faint">
        {keys === undefined && (
          <li className="py-3" aria-hidden>
            <div className="h-4 w-2/3 rounded-control bg-ink-faint" />
          </li>
        )}
        {keys !== undefined && keys.length === 0 && (
          <li className="py-3 text-meta text-ink-muted">No API keys yet.</li>
        )}
        {keys?.map((key, i) => (
          <li
            key={key._id}
            className={`flex items-center justify-between py-3 ${key.revoked ? 'opacity-50' : ''}`}
          >
            <div>
              <p className={`text-body ${key.revoked ? 'line-through' : ''}`}>{key.name}</p>
              <p className="mt-0.5 text-meta text-ink-faint">
                {key.prefix}&hellip; &middot; created {formatDate(key.createdAt)} &middot;{' '}
                {key.lastUsedAt !== undefined ? `last used ${formatDate(key.lastUsedAt)}` : 'never used'}
                {key.revoked ? ' · revoked' : ''}
              </p>
            </div>
            {!key.revoked && (
              <RevokeButton
                testIdBase={`key-revoke-${i}`}
                onRevoke={async () => {
                  await revokeKey({ id: key._id as Id<'apiKeys'> });
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OAuthGrantsSection() {
  const grants = useQuery(api.oauth.grants.listMine, {});
  const revokeGrant = useMutation(api.oauth.grants.revokeMine);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-body font-medium">Connected apps</h2>
      <p className="text-meta text-ink-muted">
        Apps that connected via OAuth (the ChatGPT connector). Atlas never sees or stores a password —
        just a scoped, revocable grant.
      </p>
      <ul className="divide-y divide-ink-faint">
        {grants === undefined && (
          <li className="py-3" aria-hidden>
            <div className="h-4 w-2/3 rounded-control bg-ink-faint" />
          </li>
        )}
        {grants !== undefined && grants.length === 0 && (
          <li className="py-3 text-meta text-ink-muted">No connected apps yet.</li>
        )}
        {grants?.map((grant, i) => (
          <li
            key={grant._id}
            className={`flex items-center justify-between py-3 ${grant.revoked ? 'opacity-50' : ''}`}
          >
            <div>
              <p className={`text-body ${grant.revoked ? 'line-through' : ''}`}>{grant.clientName}</p>
              <p className="mt-0.5 text-meta text-ink-faint">
                {grant.scopes.join(', ')} &middot; granted {formatDate(grant.grantedAt)}
                {grant.revoked ? ' · revoked' : ''}
              </p>
            </div>
            {!grant.revoked && (
              <RevokeButton
                testIdBase={`grant-revoke-${i}`}
                onRevoke={async () => {
                  await revokeGrant({ id: grant._id as Id<'oauthGrants'> });
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SetupSnippets() {
  const mcpUrl = `${mcpSiteOrigin()}/mcp`;
  const codexSnippet = JSON.stringify(
    {
      mcpServers: {
        atlas: {
          url: mcpUrl,
          headers: { Authorization: 'Bearer <your key>' },
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-body font-medium">Set up a client</h2>

      <div className="rounded-card border border-ink-faint bg-surface p-3">
        <p className="text-body font-medium">ChatGPT</p>
        <p className="mt-1 text-meta text-ink-muted">
          Settings → Connectors → Advanced → enable Developer mode → Add connector → paste the URL
          below. ChatGPT then handles the OAuth handshake itself — you approve the connection in Atlas
          when prompted; no key needed.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <pre data-testid="snippet-chatgpt" className="flex-1 overflow-x-auto rounded-control bg-paper p-2 text-meta">
            {mcpUrl}
          </pre>
          <CopyButton text={mcpUrl} testId="snippet-copy-chatgpt" />
        </div>
      </div>

      <div className="rounded-card border border-ink-faint bg-surface p-3">
        <p className="text-body font-medium">Codex CLI &amp; other agents</p>
        <p className="mt-1 text-meta text-ink-muted">
          These clients send their own headers, so they use a bearer key (create one above) instead of
          OAuth. Adjust the shape below to your client&rsquo;s MCP config format — the URL and
          Authorization header are the parts that matter.
        </p>
        <div className="mt-2 flex items-start gap-2">
          <pre data-testid="snippet-codex" className="flex-1 overflow-x-auto rounded-control bg-paper p-2 text-meta">
            {codexSnippet}
          </pre>
          <CopyButton text={codexSnippet} testId="snippet-copy-codex" />
        </div>
      </div>
    </div>
  );
}

export default function ConnectionsPage() {
  return (
    <section className="flex flex-col gap-8 p-4" data-testid="connections">
      <h1 className="text-title font-medium">Connections</h1>
      <ApiKeysSection />
      <OAuthGrantsSection />
      <SetupSnippets />
    </section>
  );
}
