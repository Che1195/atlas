const CONFIDENCE_LABELS: Record<string, string> = {
  hypothesis: 'Hypothesis',
  tentative: 'Tentative',
  supported: 'Supported',
  strong: 'Strongly supported',
  mixed: 'Mixed evidence',
  contradicted: 'Contradicted',
};

export function ConfidenceLabel({
  confidence,
  supports,
  contradicts,
}: {
  confidence: string;
  supports?: number;
  contradicts?: number;
}) {
  const showMath = supports !== undefined && contradicts !== undefined && supports + contradicts > 0;
  return (
    <span className={`text-meta ${confidence === 'contradicted' ? 'text-contradict' : 'text-ink-muted'}`}>
      {CONFIDENCE_LABELS[confidence] ?? confidence}
      {showMath &&
        ` — ${supports} supporting, ${contradicts} contradicting`}
    </span>
  );
}

/** Thin S:C proportion bar — never a progress bar toward anything (10 §1). */
export function EvidenceBar({ supports, contradicts }: { supports: number; contradicts: number }) {
  const total = supports + contradicts;
  if (total === 0) return <div className="h-0.5 w-full bg-ink-faint" aria-hidden />;
  return (
    <div className="flex h-0.5 w-full overflow-hidden" aria-hidden>
      <div className="bg-support" style={{ width: `${(supports / total) * 100}%` }} />
      <div className="bg-contradict" style={{ width: `${(contradicts / total) * 100}%` }} />
    </div>
  );
}
