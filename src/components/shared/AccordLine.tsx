import StatusBadge, { type BadgeVariant } from "../ui/StatusBadge";

export interface AccordStage {
  label: string;
  state: "completed" | "active" | "pending";
  statusLabel?: string;
  statusVariant?: BadgeVariant;
}

interface AccordLineProps {
  stages: readonly AccordStage[];
  className?: string;
}

function StageIcon({ state }: { state: AccordStage["state"] }) {
  if (state === "completed") {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="9" cy="9" r="8" fill="#4C8A5E" />
        <path
          d="M5.5 9L8 11.5L12.5 6.5"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (state === "active") {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="9" cy="9" r="7" fill="#B4884A" />
        <circle cx="9" cy="9" r="3.5" fill="white" />
      </svg>
    );
  }

  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="8" stroke="#E4D9C6" strokeWidth="1.5" />
    </svg>
  );
}

export default function AccordLine({ stages, className = "" }: AccordLineProps) {
  return (
    <div className={`flex items-start ${className}`} role="list" aria-label="Payment progress">
      {stages.map((stage, i) => (
        <div
          key={stage.label}
          className="flex items-center flex-1 min-w-0"
          role="listitem"
        >
          <div className="flex flex-col items-center gap-2 min-w-0">
            <StageIcon state={stage.state} />
            <span
              className={`text-center text-[12px] font-medium leading-tight whitespace-nowrap ${
                stage.state === "completed"
                  ? "text-success"
                  : stage.state === "active"
                    ? "text-gold"
                    : "text-muted"
              }`}
            >
              {stage.label}
            </span>
            {stage.statusLabel && stage.statusVariant && (
              <StatusBadge
                variant={stage.statusVariant}
                label={stage.statusLabel}
              />
            )}
          </div>

          {i < stages.length - 1 && (
            <div className="flex-1 mx-2 mt-[9px]" aria-hidden="true">
              <div
                className={`h-[1.5px] ${
                  stage.state === "completed" ? "bg-success" : "bg-border"
                }`}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
