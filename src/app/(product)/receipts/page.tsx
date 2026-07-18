import EmptyState from "@/components/ui/EmptyState";
import ReceiptFilters from "@/components/receipt/ReceiptFilters";
import Notice from "@/components/ui/Notice";

export default function ReceiptsPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
      <div>
        <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
          Settlement receipts
        </h1>
        <p className="mt-1 text-[15px] text-muted">
          Plain-language records of completed protected payments.
        </p>
      </div>

      <div className="mt-8">
        <EmptyState
          title="No settlement receipts yet."
          description="Receipts appear after a protected payment is released or resolved."
        />
      </div>

      <ReceiptFilters className="mt-10" />

      <div className="mt-10 rounded-[--radius-card] border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          What receipts contain
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            "Original terms and amount",
            "Client and worker wallets",
            "Delivery and evidence record",
            "Release or dispute outcome",
            "Final allocation breakdown",
            "Reviewer result and vote summary",
            "Celo transaction references",
            "Attribution and verification details",
          ].map((item) => (
            <div key={item} className="flex items-start gap-2">
              <svg
                className="mt-0.5 shrink-0 text-gold"
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M2.5 7L5.5 10L11.5 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="text-[14px] text-ink">{item}</span>
            </div>
          ))}
        </div>

        <Notice variant="info" className="mt-6 !border-border">
          <p className="text-[14px] leading-relaxed">
            <strong>Receipts are free to view.</strong> No x402 payment or paid action is required
            to view, print, share, or verify your own settlement receipt. A receipt is a trust
            feature, not an upsell.
          </p>
        </Notice>
      </div>
    </div>
  );
}
