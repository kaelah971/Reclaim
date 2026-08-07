"use client";

interface EvidenceRequestItem {
  id: string;
  responsibleParty: string;
  evidenceItem: string;
  reason: string;
  status: string;
  createdAt: string;
  fulfilledAt: string | null;
  cancelledAt: string | null;
}

interface AgentEvidenceRequestsProps {
  requests: EvidenceRequestItem[];
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function getStatusBadgeStyle(status: string): string {
  switch (status) {
    case "open":
      return "bg-status-pending-bg text-status-pending-text";
    case "fulfilled":
      return "bg-status-settled-bg text-status-settled-text";
    case "cancelled":
      return "bg-[#F5F0EB] text-ink/40 line-through";
    default:
      return "bg-[#F5F0EB] text-ink/50";
  }
}

export default function AgentEvidenceRequests({ requests }: AgentEvidenceRequestsProps) {
  if (requests.length === 0) {
    return null;
  }

  const openCount = requests.filter((r) => r.status === "open").length;

  return (
    <div className="rounded-[--radius-card] border border-border bg-surface p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Evidence Requests
        </h3>
        {openCount > 0 && (
          <span className="rounded-[--radius-pill] bg-gold/15 px-2.5 py-0.5 text-[12px] font-medium text-gold">
            {openCount} open
          </span>
        )}
      </div>

      {requests.length === 0 ? (
        <p className="mt-3 text-[15px] text-muted">
          No evidence has been requested yet.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {requests.map((req) => (
            <li key={req.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-ink">
                    {req.evidenceItem}
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted">
                    <span className="capitalize">{req.responsibleParty}</span> &middot;{" "}
                    {req.reason}
                  </p>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center rounded-[--radius-pill] px-2.5 py-0.5 text-[12px] font-medium leading-none ${getStatusBadgeStyle(req.status)}`}
                >
                  {req.status === "open"
                    ? "Open"
                    : req.status === "fulfilled"
                      ? "Fulfilled"
                      : "Cancelled"}
                </span>
              </div>
              <div className="mt-1 flex gap-3 text-[12px] font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-muted">
                <span>Created {formatDate(req.createdAt)}</span>
                {req.fulfilledAt && (
                  <span>Fulfilled {formatDate(req.fulfilledAt)}</span>
                )}
                {req.cancelledAt && (
                  <span>Cancelled {formatDate(req.cancelledAt)}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
