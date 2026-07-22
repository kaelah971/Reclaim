"use client";

// ---------------------------------------------------------------------------
// I5: AICaseBriefDisplay — renders the AI-generated dispute case brief
//
// Displays the full brief with sections for on-chain facts, claims, evidence,
// timeline, and reviewer notes. AI attribution and generation mode are shown
// alongside standard disclaimers.
// ---------------------------------------------------------------------------

interface Party {
  label: string;
  address: string;
}

interface TimelineEntry {
  date: string;
  description: string;
}

interface AICaseBriefData {
  briefId?: string;
  generatedAt?: string;
  paymentId?: string;
  generationMode?: string;
  provider?: string;
  model?: string;
  caseTitle?: string;
  neutralCaseTitle?: string;
  parties?: { client: Party; worker: Party };
  protectedAmount?: string;
  token?: string;
  network?: string;
  currentOnChainState?: string;
  agreementSummary?: string;
  clientClaim?: string;
  claimedIssue?: string;
  workerPosition?: string | null;
  requestedOutcome?: string;
  evidenceInventory?: string[];
  missingEvidence?: string[];
  timeline?: TimelineEntry[];
  undisputedFacts?: string[];
  disputedFacts?: string[];
  contradictions?: string[] | null;
  ambiguities?: string[] | null;
  proceduralIssues?: string[] | null;
  questionsForReviewer?: string[];
  questionsRequiringHumanReview?: string[];
  recommendedNextEvidence?: string[] | null;
  riskFlags?: string[] | null;
  confidenceNotes?: string | null;
  limitations?: string;
  limitationsStatement?: string;
  proceduralNextSteps?: string[];
}

interface AICaseBriefDisplayProps {
  brief: AICaseBriefData;
  generationMode?: string;
  usedFallback?: boolean;
  className?: string;
}

function Section({
  title,
  children,
  variant = "default",
}: {
  title: string;
  children: React.ReactNode;
  variant?: "default" | "warning" | "muted";
}) {
  const borderColor =
    variant === "warning"
      ? "border-gold/30"
      : variant === "muted"
        ? "border-border/50"
        : "border-border";
  const bgColor =
    variant === "warning" ? "bg-gold/5" : variant === "muted" ? "bg-page/50" : "";

  return (
    <div className={`rounded-[--radius-card] border ${borderColor} ${bgColor} p-4 space-y-2`}>
      <h4 className="text-[12px] font-semibold text-muted uppercase tracking-wider">
        {title}
      </h4>
      {children}
    </div>
  );
}

function StringList({ items }: { items: string[] }) {
  if (!items || items.length === 0) return <p className="text-[14px] text-muted italic">None listed.</p>;
  return (
    <ul className="list-inside list-disc text-[14px] leading-relaxed text-ink space-y-1">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export default function AICaseBriefDisplay({
  brief,
  generationMode,
  usedFallback,
  className = "",
}: AICaseBriefDisplayProps) {
  if (!brief) return null;

  const title = brief.caseTitle || brief.neutralCaseTitle || "Dispute Case Brief";
  const clientClaim = brief.clientClaim || brief.claimedIssue || "Not specified";
  const requestedOutcome = brief.requestedOutcome || "Not specified";
  const questions =
    brief.questionsForReviewer || brief.questionsRequiringHumanReview || [];
  const limitations =
    brief.limitations || brief.limitationsStatement || "";
  const mode = generationMode || brief.generationMode || "unknown";
  const isAI = mode === "ai";

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="rounded-[--radius-card] border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
            {brief.paymentId && (
              <p className="mt-1 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-muted">
                Payment #{brief.paymentId}
              </p>
            )}
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            <span
              className={`rounded-[--radius-pill] border px-2 py-0.5 text-[12px] ${
                isAI
                  ? "border-gold/40 bg-gold/10 text-gold"
                  : "border-border bg-page text-muted"
              }`}
            >
              {isAI ? "AI-prepared" : "Standard brief"}
            </span>
            {usedFallback && (
              <span className="rounded-[--radius-pill] border border-border bg-page px-2 py-0.5 text-[11px] text-muted">
                Fallback used
              </span>
            )}
            {brief.provider && brief.model && (
              <span className="text-[11px] text-muted">
                {brief.provider} / {brief.model}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Parties */}
      {brief.parties && (
        <Section title="Parties">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-[12px] font-medium text-muted">
                {brief.parties.client.label}
              </span>
              <p className="mt-0.5 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-ink break-all">
                {brief.parties.client.address}
              </p>
            </div>
            <div>
              <span className="text-[12px] font-medium text-muted">
                {brief.parties.worker.label}
              </span>
              <p className="mt-0.5 text-[13px] font-[family-name:var(--font-ibm-plex-mono)] text-ink break-all">
                {brief.parties.worker.address}
              </p>
            </div>
          </div>
        </Section>
      )}

      {/* Quick info */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {brief.protectedAmount && (
          <div className="rounded-[--radius-card] border border-border bg-page p-3">
            <span className="text-[11px] text-muted uppercase tracking-wider">Amount</span>
            <p className="mt-0.5 text-[14px] font-semibold tabular-nums text-ink">
              {brief.protectedAmount}
            </p>
          </div>
        )}
        {brief.currentOnChainState && (
          <div className="rounded-[--radius-card] border border-border bg-page p-3">
            <span className="text-[11px] text-muted uppercase tracking-wider">On-chain state</span>
            <p className="mt-0.5 text-[14px] font-semibold text-ink">
              {brief.currentOnChainState}
            </p>
          </div>
        )}
        {brief.network && (
          <div className="rounded-[--radius-card] border border-border bg-page p-3">
            <span className="text-[11px] text-muted uppercase tracking-wider">Network</span>
            <p className="mt-0.5 text-[14px] font-semibold text-ink">
              {brief.network}
            </p>
          </div>
        )}
      </div>

      {/* Agreement */}
      {brief.agreementSummary && (
        <Section title="Agreement Summary">
          <p className="text-[14px] leading-relaxed text-ink">{brief.agreementSummary}</p>
        </Section>
      )}

      {/* Client Claim */}
      <Section title="Client Claim">
        <p className="text-[14px] leading-relaxed text-ink">{clientClaim}</p>
        <p className="text-[13px] text-muted">
          Requested outcome: {requestedOutcome}
        </p>
      </Section>

      {/* Worker Position */}
      {brief.workerPosition && (
        <Section title="Worker Position" variant="muted">
          <p className="text-[14px] leading-relaxed text-ink">{brief.workerPosition}</p>
        </Section>
      )}

      {/* Evidence Inventory */}
      {brief.evidenceInventory && (
        <Section title="Evidence Inventory">
          <StringList items={brief.evidenceInventory} />
        </Section>
      )}

      {/* Missing Evidence */}
      {brief.missingEvidence && brief.missingEvidence.length > 0 && (
        <Section title="Missing Evidence" variant="warning">
          <StringList items={brief.missingEvidence} />
        </Section>
      )}

      {/* Timeline */}
      {brief.timeline && brief.timeline.length > 0 && (
        <Section title="Timeline">
          <div className="space-y-2">
            {brief.timeline.map((entry, i) => (
              <div key={i} className="flex gap-3 text-[13px]">
                <span className="shrink-0 font-[family-name:var(--font-ibm-plex-mono)] text-muted tabular-nums w-24">
                  {entry.date}
                </span>
                <span className="text-ink">{entry.description}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Undisputed Facts */}
      {brief.undisputedFacts && brief.undisputedFacts.length > 0 && (
        <Section title="Undisputed Facts (verified on-chain)">
          <StringList items={brief.undisputedFacts} />
        </Section>
      )}

      {/* Disputed Facts */}
      {brief.disputedFacts && brief.disputedFacts.length > 0 && (
        <Section title="Disputed Facts" variant="warning">
          <StringList items={brief.disputedFacts} />
        </Section>
      )}

      {/* Contradictions */}
      {brief.contradictions && brief.contradictions.length > 0 && (
        <Section title="Contradictions" variant="warning">
          <StringList items={brief.contradictions} />
        </Section>
      )}

      {/* Ambiguities */}
      {brief.ambiguities && brief.ambiguities.length > 0 && (
        <Section title="Ambiguities" variant="muted">
          <StringList items={brief.ambiguities} />
        </Section>
      )}

      {/* Questions for Reviewer */}
      {questions.length > 0 && (
        <Section title="Questions for Reviewer">
          <StringList items={questions} />
        </Section>
      )}

      {/* Recommended Next Evidence */}
      {brief.recommendedNextEvidence && brief.recommendedNextEvidence.length > 0 && (
        <Section title="Recommended Next Evidence">
          <StringList items={brief.recommendedNextEvidence} />
        </Section>
      )}

      {/* Risk Flags */}
      {brief.riskFlags && brief.riskFlags.length > 0 && (
        <Section title="Risk Flags" variant="warning">
          <StringList items={brief.riskFlags} />
        </Section>
      )}

      {/* Confidence Notes */}
      {brief.confidenceNotes && (
        <Section title="Confidence Notes" variant="muted">
          <p className="text-[14px] leading-relaxed text-ink">{brief.confidenceNotes}</p>
        </Section>
      )}

      {/* Limitations */}
      {limitations && (
        <Section title="Limitations" variant="muted">
          <p className="text-[14px] leading-relaxed text-muted italic">{limitations}</p>
        </Section>
      )}

      {/* Disclaimer */}
      <div className="rounded-[--radius-card] border border-border/50 bg-page/30 p-4">
        <p className="text-[13px] text-muted italic leading-relaxed">
          AI prepares the case. People decide. The contract settles.
        </p>
        <p className="mt-1 text-[12px] text-muted">
          This brief does not determine truth, select a winner, or provide legal advice.
          Generation mode: {mode}.{brief.provider ? ` Provider: ${brief.provider}.` : ""}
        </p>
      </div>
    </div>
  );
}
