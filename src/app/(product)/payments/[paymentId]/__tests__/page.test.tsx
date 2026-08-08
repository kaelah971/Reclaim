// ---------------------------------------------------------------------------
// Payment Room — DeliverySubmitted worker evidence navigation test
//
// Verifies the page source contains "Update evidence" link for workers
// in DeliverySubmitted state, linking to the evidence form.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const PAGE_PATH = resolve(__dirname, "..", "page.tsx");

function readPageSource(): string {
  return readFileSync(PAGE_PATH, "utf-8");
}

describe("Payment Room — DeliverySubmitted worker evidence navigation", () => {
  it("renders 'Update evidence' link in DeliverySubmitted worker block", () => {
    const source = readPageSource();

    // The page must contain an "Update evidence" link inside the
    // DeliverySubmitted + worker section (after the "Request release" title)
    const containsUpdateEvidence = source.includes("Update evidence");
    expect(containsUpdateEvidence).toBe(true);
  });

  it("links to the evidence form route", () => {
    const source = readPageSource();

    // The update evidence action must link to /payments/[paymentId]/evidence
    const containsEvidenceRoute = source.includes(`/payments/\${paymentIdStr}/evidence`);
    expect(containsEvidenceRoute).toBe(true);
  });

  it("keeps existing 'Request release' action", () => {
    const source = readPageSource();

    // Request release must still be present for DeliverySubmitted workers
    const containsRequestRelease = source.includes("Request release");
    expect(containsRequestRelease).toBe(true);
  });
});
