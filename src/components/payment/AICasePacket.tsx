interface AICasePacketProps {
  clientClaim?: string;
  workerClaim?: string;
  agreedTerms?: string;
  timeline?: string;
  evidenceInventory?: string;
  missingEvidence?: readonly string[];
  contradictions?: readonly string[];
  reviewerQuestions?: readonly string[];
  className?: string;
}

export default function AICasePacket({
  clientClaim,
  workerClaim,
  agreedTerms,
  timeline,
  evidenceInventory,
  missingEvidence,
  contradictions,
  reviewerQuestions,
  className = "",
}: AICasePacketProps) {
  const hasContent =
    clientClaim || workerClaim || agreedTerms || timeline || evidenceInventory;

  return (
    <div
      className={`rounded-[--radius-card] border border-border bg-surface p-6 ${className}`}
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          AI case packet
        </h3>
        {hasContent && (
          <span className="shrink-0 rounded-[--radius-pill] border border-border bg-input px-2 py-0.5 text-[12px] text-muted">
            AI-prepared
          </span>
        )}
      </div>

      {!hasContent ? (
        <p className="mt-3 text-[15px] text-muted">
          The AI case packet will be generated if a dispute is opened. It organises claims,
          evidence, and timelines for reviewer assessment.
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {clientClaim && (
            <div>
              <h4 className="text-[14px] font-semibold text-ink">
                Client claim
              </h4>
              <p className="mt-1 text-[15px] leading-relaxed text-muted">
                {clientClaim}
              </p>
            </div>
          )}
          {workerClaim && (
            <div>
              <h4 className="text-[14px] font-semibold text-ink">
                Worker claim
              </h4>
              <p className="mt-1 text-[15px] leading-relaxed text-muted">
                {workerClaim}
              </p>
            </div>
          )}
          {agreedTerms && (
            <div>
              <h4 className="text-[14px] font-semibold text-ink">
                Agreed terms
              </h4>
              <p className="mt-1 text-[15px] leading-relaxed text-muted">
                {agreedTerms}
              </p>
            </div>
          )}
          {timeline && (
            <div>
              <h4 className="text-[14px] font-semibold text-ink">Timeline</h4>
              <p className="mt-1 text-[15px] leading-relaxed text-muted">
                {timeline}
              </p>
            </div>
          )}
          {evidenceInventory && (
            <div>
              <h4 className="text-[14px] font-semibold text-ink">
                Evidence inventory
              </h4>
              <p className="mt-1 text-[15px] leading-relaxed text-muted">
                {evidenceInventory}
              </p>
            </div>
          )}
          {missingEvidence && missingEvidence.length > 0 && (
            <div>
              <h4 className="text-[14px] font-semibold text-ink">
                Missing evidence
              </h4>
              <ul className="mt-1 list-inside list-disc text-[15px] leading-relaxed text-muted">
                {missingEvidence.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {contradictions && contradictions.length > 0 && (
            <div>
              <h4 className="text-[14px] font-semibold text-ink">
                Contradictions
              </h4>
              <ul className="mt-1 list-inside list-disc text-[15px] leading-relaxed text-muted">
                {contradictions.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {reviewerQuestions && reviewerQuestions.length > 0 && (
            <div>
              <h4 className="text-[14px] font-semibold text-ink">
                Questions for reviewers
              </h4>
              <ul className="mt-1 list-inside list-disc text-[15px] leading-relaxed text-muted">
                {reviewerQuestions.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="mt-6 border-t border-border pt-4 text-[14px] italic text-muted">
        AI organises the claims and evidence. It did not decide the outcome.
      </p>
    </div>
  );
}
