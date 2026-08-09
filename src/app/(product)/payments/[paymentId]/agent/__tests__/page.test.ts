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
});
