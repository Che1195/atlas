export default function MorePage() {
  const upcoming = ['Experiments', 'Reviews', 'Search & Ask', 'Settings'];
  return (
    <section className="p-6" data-testid="more">
      <h1 className="text-title font-medium">More</h1>
      <ul className="mt-4 space-y-2">
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
