"use client";

// ---------------------------------------------------------------------------
// EvidenceQualityResult — renders the AI evidence quality assessment
//
// Follows Reclaim's Proof Ledger visual language with warm card styling,
// Newsreader headings, and document-like expandable sections.
// ---------------------------------------------------------------------------

import { useState } from "react";
import Button from "../ui/Button";
import Notice from "../ui/Notice";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvidenceQualityResultData {
  overallAssessment: string;
  readiness: "ready" | "needs-improvement" | "insufficient";
  completenessScore: number;
  relevanceScore: number;
  specificityScore: number;
  consistencyScore: number;
  strengths: string[];
  missingEvidence: string[];
  ambiguities: string[];
  contradictionsOrRisks: string[];
  claimAlignment: string[];
  recommendedImprovements: string[];
  reviewerQuestions: string[];
  disclaimer: string;
  generationMode?: string;
}

interface EvidenceQualityResultProps {
  result: EvidenceQualityResultData;
  onImproveEvidence?: () => void;
  onCopyJson?: () => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const READINESS_CONFIG = {
  ready: {
    label: "Ready to submit",
    color: "#4C8A5E",
    bg: "rgba(76, 138, 94, 0.1)",
    border: "rgba(76, 138, 94, 0.3)",
  },
  "needs-improvement": {
    label: "Needs improvement",
    color: "#B4884A",
    bg: "rgba(180, 136, 74, 0.1)",
    border: "rgba(180, 136, 74, 0.3)",
  },
  insufficient: {
    label: "Insufficient",
    color: "#8A7F6E",
    bg: "rgba(138, 127, 110, 0.1)",
    border: "rgba(138, 127, 110, 0.3)",
  },
} as const;

const SCORE_LABELS: Record<string, string> = {
  completenessScore: "Completeness",
  relevanceScore: "Relevance",
  specificityScore: "Specificity",
  consistencyScore: "Consistency",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ScoreBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const color =
    pct >= 80 ? "#4C8A5E" : pct >= 60 ? "#B4884A" : "#8A7F6E";

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-page overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span
        className="text-[13px] font-[family-name:var(--font-ibm-plex-mono)] tabular-nums font-medium w-9 text-right"
        style={{ color }}
      >
        {pct}
      </span>
    </div>
  );
}

interface CollapsibleSectionProps {
  title: string;
  count: number;
  variant?: "default" | "warning" | "muted";
  children: React.ReactNode;
}

function CollapsibleSection({
  title,
  count,
  variant = "default",
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(
    variant === "warning" || variant === "default"
  );

  const borderColor =
    variant === "warning"
      ? "border-gold/30"
      : variant === "muted"
        ? "border-border/50"
        : "border-border";
  const bgColor =
    variant === "warning"
      ? "bg-gold/5"
      : variant === "muted"
        ? "bg-page/50"
        : "";

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className={`rounded-[--radius-card] border ${borderColor} ${bgColor} group`}
    >
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 select-none list-none">
        <span className="text-[13px] font-semibold text-ink">
          {title}
          <span className="ml-2 text-[12px] font-normal text-muted">
            ({count})
          </span>
        </span>
        <svg
          className="h-4 w-4 text-muted transition-transform group-open:rotate-180"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 6L8 10L12 6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

function StringList({ items }: { items: string[] }) {
  if (!items || items.length === 0)
    return (
      <p className="text-[14px] text-muted italic">None identified.</p>
    );
  return (
    <ul className="list-inside list-disc text-[14px] leading-relaxed text-ink space-y-1">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EvidenceQualityResult({
  result,
  onImproveEvidence,
  onCopyJson,
  className = "",
}: EvidenceQualityResultProps) {
  if (!result) return null;

  const readinessCfg = READINESS_CONFIG[result.readiness];
  const overallScore = Math.round(
    (result.completenessScore +
      result.relevanceScore +
      result.specificityScore +
      result.consistencyScore) /
      4
  );
  const overallColor =
    overallScore >= 80 ? "#4C8A5E" : overallScore >= 60 ? "#B4884A" : "#8A7F6E";

  const scores = [
    { key: "completenessScore", value: result.completenessScore },
    { key: "relevanceScore", value: result.relevanceScore },
    { key: "specificityScore", value: result.specificityScore },
    { key: "consistencyScore", value: result.consistencyScore },
  ] as const;

  return (
    <div className={`space-y-5 ${className}`}>
      {/* ---- Header ---- */}
      <div>
        <h3 className="text-[20px] leading-[1.2] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[24px]">
          Evidence Quality Assessment
        </h3>
        {result.generationMode && (
          <p className="mt-1 text-[12px] font-[family-name:var(--font-ibm-plex-mono)] text-muted">
            Generation mode: {result.generationMode}
          </p>
        )}
      </div>

      {/* ---- Readiness badge ---- */}
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center rounded-[--radius-pill] border px-3 py-1 text-[13px] font-semibold"
          style={{
            color: readinessCfg.color,
            backgroundColor: readinessCfg.bg,
            borderColor: readinessCfg.border,
          }}
        >
          {readinessCfg.label}
        </span>
      </div>

      {/* ---- Overall score ---- */}
      <div className="rounded-[--radius-card] border border-border bg-page p-5">
        <p className="text-[12px] font-semibold text-muted uppercase tracking-wider">
          Overall evidence score
        </p>
        <div className="mt-2 flex items-baseline gap-1">
          <span
            className="text-[44px] leading-none font-[family-name:var(--font-ibm-plex-mono)] font-medium tabular-nums"
            style={{ color: overallColor }}
          >
            {overallScore}
          </span>
          <span className="text-[16px] text-muted">/ 100</span>
        </div>
      </div>

      {/* ---- Score breakdown ---- */}
      <div className="rounded-[--radius-card] border border-border bg-surface p-5 space-y-4">
        <p className="text-[12px] font-semibold text-muted uppercase tracking-wider">
          Score breakdown
        </p>
        {scores.map(({ key, value }) => (
          <div key={key} className="space-y-1">
            <span className="text-[13px] font-medium text-ink">
              {SCORE_LABELS[key]}
            </span>
            <ScoreBar value={value} />
          </div>
        ))}
      </div>

      {/* ---- Overall assessment ---- */}
      <div className="rounded-[--radius-card] border border-border bg-surface p-5">
        <p className="text-[12px] font-semibold text-muted uppercase tracking-wider mb-2">
          Assessment
        </p>
        <p className="text-[14px] leading-relaxed text-ink">
          {result.overallAssessment}
        </p>
      </div>

      {/* ---- Expandable sections ---- */}
      <div className="space-y-2">
        <CollapsibleSection
          title="Strengths"
          count={result.strengths.length}
          variant="default"
        >
          <StringList items={result.strengths} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Missing evidence"
          count={result.missingEvidence.length}
          variant="warning"
        >
          <StringList items={result.missingEvidence} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Ambiguities"
          count={result.ambiguities.length}
          variant="muted"
        >
          <StringList items={result.ambiguities} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Claim alignment"
          count={result.claimAlignment.length}
          variant="default"
        >
          <StringList items={result.claimAlignment} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Recommended improvements"
          count={result.recommendedImprovements.length}
          variant="muted"
        >
          <StringList items={result.recommendedImprovements} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Reviewer questions"
          count={result.reviewerQuestions.length}
          variant="default"
        >
          <StringList items={result.reviewerQuestions} />
        </CollapsibleSection>

        {result.contradictionsOrRisks.length > 0 && (
          <CollapsibleSection
            title="Contradictions or risks"
            count={result.contradictionsOrRisks.length}
            variant="warning"
          >
            <StringList items={result.contradictionsOrRisks} />
          </CollapsibleSection>
        )}
      </div>

      {/* ---- Disclaimer ---- */}
      <Notice variant="info">
        <p className="text-[13px] italic leading-relaxed text-muted">
          {result.disclaimer || "AI prepares the case. People decide. The contract settles."}
        </p>
      </Notice>

      {/* ---- Action buttons ---- */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        {onImproveEvidence && (
          <Button variant="secondary" size="sm" onClick={onImproveEvidence}>
            Improve evidence
          </Button>
        )}
        {onCopyJson && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(
                JSON.stringify(result, null, 2)
              );
              onCopyJson();
            }}
          >
            Copy JSON
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const blob = new Blob(
              [JSON.stringify(result, null, 2)],
              { type: "application/json" }
            );
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "reclaim-evidence-quality.json";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download JSON
        </Button>
      </div>
    </div>
  );
}
