import Notice from "@/components/ui/Notice";

const integrationSurfaces = [
  {
    title: "Protected payment links",
    description:
      "Generate a link that creates a Payment Room with pre-filled terms. Share it with a client or worker to start a protected cUSD payment immediately.",
  },
  {
    title: "Checkout component",
    description:
      "Embed a protected-payment checkout in your marketplace or service site. Buyers define terms, deposit cUSD, and track evidence — all without leaving your app.",
  },
  {
    title: "Escrow lifecycle API",
    description:
      "Programmatic access to the full protected-payment lifecycle: create payments, check status, retrieve terms, verify settlement, and issue receipts.",
  },
  {
    title: "x402 Terms Risk Check",
    description:
      "Call the x402 endpoint to analyse payment terms before deposit. Returns a report flagging missing deadlines, vague deliverables, unclear release rules, or incomplete evidence expectations.",
  },
  {
    title: "x402 Evidence Strength Check",
    description:
      "Call the x402 endpoint to review submitted evidence against the agreed terms. Flags missing proof, weak documentation, or timeline conflicts.",
  },
  {
    title: "x402 Dispute Packet",
    description:
      "Call the x402 endpoint to generate a neutral, reviewer-ready dispute packet: claims, timeline, evidence inventory, contradictions, and unresolved questions.",
  },
  {
    title: "Settlement receipts",
    description:
      "Retrieve plain-language settlement receipts with transaction references and Celo verification links. Receipts are designed to be embedded, printed, or shared without decoding on-chain data.",
  },
];

export default function DevelopersPage() {
  return (
    <>
      <section className="bg-hero">
        <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-14 md:px-6 md:pb-24 md:pt-20">
          <div className="mx-auto max-w-3xl">
            <span className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
              Developers
            </span>
            <h1 className="mt-3 text-[42px] leading-[1.05] tracking-[-0.025em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[64px]">
              Build protected cUSD payments into your product
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
              Reclaim is designed as a plug-and-play protection layer for Celo apps, marketplaces, and agentic commerce. Integrate protected payments without building escrow, disputes, or settlement from scratch.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-[28px] leading-[1.2] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink">
            Planned integration surfaces
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            The following integration surfaces are planned for the Reclaim API.
            Developer access and detailed documentation will be provided during product integration.
          </p>

          <div className="mt-10 space-y-6">
            {integrationSurfaces.map((surface) => (
              <div
                key={surface.title}
                className="rounded-[--radius-card] border border-dashed border-border bg-surface p-6"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
                      {surface.title}
                    </h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-muted">
                      {surface.description}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-[--radius-pill] border border-border bg-input px-3 py-1 text-[12px] font-medium text-muted">
                    Planned integration surface
                  </span>
                </div>
              </div>
            ))}
          </div>

          <Notice variant="info" className="mt-10">
            <p className="text-[15px] leading-relaxed">
              <strong>Developer access is coming during integration.</strong> Reclaim will
              provide API keys, endpoint documentation, Celo-compatible wallet libraries,
              and a sandbox environment. No fake API keys, sample responses, or live endpoints
              are shown here.
            </p>
          </Notice>

          <div className="mt-14 rounded-[--radius-card] border border-border bg-surface p-8">
            <h2 className="text-[22px] leading-tight font-[family-name:var(--font-newsreader)] font-medium text-ink">
              Agent-to-agent commerce
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">
              Reclaim&apos;s x402 endpoints are designed to be called by agents, not just humans.
              An agent can request a Terms Risk Check before committing funds, trigger an Evidence
              Strength Check after delivery, or generate a Dispute Packet when a counterparty
              agent contests a payment. Every x402 action produces a concrete, auditable output
              that both the agent and its operator can review.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
