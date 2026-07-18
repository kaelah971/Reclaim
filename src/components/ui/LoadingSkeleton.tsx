interface LoadingSkeletonProps {
  variant?: "card" | "text-block" | "list" | "detail";
  className?: string;
}

function SkeletonBar({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[--radius-button] bg-border/60 ${className}`}
      aria-hidden="true"
    />
  );
}

export default function LoadingSkeleton({
  variant = "card",
  className = "",
}: LoadingSkeletonProps) {
  if (variant === "text-block") {
    return (
      <div className={`space-y-3 ${className}`} role="status" aria-label="Loading content">
        <SkeletonBar className="h-4 w-3/4" />
        <SkeletonBar className="h-4 w-full" />
        <SkeletonBar className="h-4 w-5/6" />
        <SkeletonBar className="h-4 w-2/3" />
      </div>
    );
  }

  if (variant === "list") {
    return (
      <div className={`space-y-4 ${className}`} role="status" aria-label="Loading list">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 rounded-[--radius-card] border border-border bg-surface p-4">
            <SkeletonBar className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <SkeletonBar className="h-4 w-1/3" />
              <SkeletonBar className="h-3 w-1/2" />
            </div>
            <SkeletonBar className="h-8 w-20" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "detail") {
    return (
      <div className={`space-y-6 ${className}`} role="status" aria-label="Loading details">
        <SkeletonBar className="h-8 w-2/3" />
        <div className="grid gap-4 sm:grid-cols-2">
          <SkeletonBar className="h-20 rounded-[--radius-card]" />
          <SkeletonBar className="h-20 rounded-[--radius-card]" />
          <SkeletonBar className="h-20 rounded-[--radius-card]" />
          <SkeletonBar className="h-20 rounded-[--radius-card]" />
        </div>
        <SkeletonBar className="h-48 rounded-[--radius-card]" />
      </div>
    );
  }

  return (
    <div
      className={`rounded-[--radius-card] border border-border bg-surface p-6 space-y-4 ${className}`}
      role="status"
      aria-label="Loading card"
    >
      <SkeletonBar className="h-5 w-1/3" />
      <SkeletonBar className="h-4 w-full" />
      <SkeletonBar className="h-4 w-5/6" />
      <div className="flex gap-3 pt-2">
        <SkeletonBar className="h-10 w-24" />
        <SkeletonBar className="h-10 w-24" />
      </div>
    </div>
  );
}
