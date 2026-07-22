export default function ReviewPage() {
  return (
    <section className="p-6" data-testid="review-empty">
      <h1 className="text-title font-medium">Review</h1>
      <p className="mt-4 text-body text-ink-muted">
        Nothing awaits review. Capture something, or ask Atlas a question.
      </p>
      <p className="mt-2 text-meta text-ink-faint">
        AI proposals arrive in a later phase — reviewing them happens here.
      </p>
    </section>
  );
}
