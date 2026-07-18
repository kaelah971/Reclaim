interface ReviewerPrinciplesProps {
  className?: string;
}

const principles = [
  "Review the agreed terms first",
  "Use only supplied evidence",
  "Avoid assumptions",
  "Treat both parties fairly",
  "Do not treat the AI packet as a ruling",
  "Choose client, worker, or split based on the record",
];

export default function ReviewerPrinciples({
  className = "",
}: ReviewerPrinciplesProps) {
  return (
    <div className={className}>
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Reviewer principles
      </h3>
      <ul className="mt-3 space-y-2">
        {principles.map((p) => (
          <li key={p} className="flex items-start gap-3 text-[14px] leading-relaxed text-muted">
            <svg
              className="mt-1 shrink-0 text-gold"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="6" cy="6" r="3" fill="currentColor" />
            </svg>
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
