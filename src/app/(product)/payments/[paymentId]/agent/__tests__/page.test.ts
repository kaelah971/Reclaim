// ---------------------------------------------------------------------------
// Agent Control Room — Review case navigation (RA1R.8B)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const PAGE_PATH = resolve(__dirname, "..", "page.tsx");

describe("Agent Control Room — Review case navigation", () => {
  it("renders a 'Review case' link to /payments/[paymentId]/review", () => {
    const source = readFileSync(PAGE_PATH, "utf-8");
    expect(source).toContain("Review case");
    expect(source).toContain("/payments/${paymentId}/review");
  });

  it("loads the real review-packet state (read-only) and wires it to AgentReadyState", () => {
    const source = readFileSync(PAGE_PATH, "utf-8");
    // The control room must load the packet availability so it stops showing
    // the stale "still assessing" state when review_packet_prepared exists.
    expect(source).toContain("/api/payments/${paymentId}/review-packet");
    expect(source).toContain("hasReviewPacket");
    expect(source).toContain("reviewHref");
  });
});
