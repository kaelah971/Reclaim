interface PossibleOutcomesProps {
  className?: string;
}

export default function PossibleOutcomes({
  className = "",
}: PossibleOutcomesProps) {
  return (
    <div
      className={`rounded-[--radius-card] border border-border bg-surface p-6 ${className}`}
    >
      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
        Possible outcomes
      </h3>
      <div className="mt-4 space-y-4">
        <div>
          <h4 className="text-[15px] font-semibold text-ink">Client wins</h4>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">
            The full protected amount returns to the client. The worker receives nothing.
          </p>
        </div>
        <div>
          <h4 className="text-[15px] font-semibold text-ink">Worker wins</h4>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">
            The full protected amount is released to the worker. The client receives nothing.
          </p>
        </div>
        <div>
          <h4 className="text-[15px] font-semibold text-ink">Split settlement</h4>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">
            The protected amount is divided between client and worker according to the reviewer decision.
          </p>
        </div>
      </div>

      <p className="mt-4 border-t border-border pt-4 text-[14px] italic text-muted">
        AI prepares the case. People decide. The contract settles.
      </p>
    </div>
  );
}
