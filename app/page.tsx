import Link from 'next/link';

export default function Home() {
  return (
    <main
      data-testid="home"
      className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col justify-center gap-6 overflow-x-clip px-6"
    >
      <p className="text-meta text-ink-muted">Atlas</p>
      <h1 className="font-statement text-title">Transform experience into understanding.</h1>
      <p className="text-body text-ink-muted">
        Capture experiences, refine them into evidence-linked knowledge, and test what you think
        you know.
      </p>
      <Link
        href="/capture"
        data-testid="open-app"
        className="w-fit rounded-control border border-meridian px-4 py-2 text-body text-meridian"
      >
        Open Atlas
      </Link>
    </main>
  );
}
