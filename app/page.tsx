export default function Home() {
  return (
    <main
      data-testid="home"
      className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col justify-center gap-6 overflow-x-clip px-6"
    >
      <p className="text-meta text-ink-muted">Atlas · Phase 0</p>
      <h1 className="font-statement text-title">Transform experience into understanding.</h1>
      <p className="text-body text-ink-muted">
        Foundations online: schema, contracts, tokens, pipeline. The capture loop arrives in
        Phase 1.
      </p>
      <div className="flex items-center gap-3 text-meta">
        <span className="h-px flex-1 bg-ink-faint" aria-hidden />
        <span className="text-meridian">meridian</span>
        <span className="text-support">support</span>
        <span className="text-contradict">contradict</span>
        <span className="text-pending">pending</span>
        <span className="h-px flex-1 bg-ink-faint" aria-hidden />
      </div>
    </main>
  );
}
