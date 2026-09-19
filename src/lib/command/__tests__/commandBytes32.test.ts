// ---------------------------------------------------------------------------
// P6.4C — contract-safe bytes32 evidence handoff (pure, no tx, no network).
//
// Proves the command → contract evidence handoff never produces an
// executable-but-oversize policy:
//   - generic guidance canonicalizes to "Delivery evidence"
//   - short labels pass through byte-exact
//   - long requirements truncate at word boundaries without invented words
//   - multibyte input never exceeds 32 UTF-8 bytes and never splits a char
//   - draftToPolicy keeps the rich copy for UI while the on-chain label fits
//   - the original Payment #3 command is transaction-ready end to end
//   - PolicyConfirmationCard still renders the rich human-facing fallback
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePaymentCommand } from "../parseCommand";
import {
  draftToPolicy,
  toOnChainEvidenceLabel,
  GENERIC_EVIDENCE_GUIDANCE,
  GENERIC_EVIDENCE_ONCHAIN_LABEL,
} from "../paymentIntent";
import {
  utf8ByteLength,
  MAX_BYTES32_LABEL_BYTES,
} from "@/lib/contracts/types";

const WORKER = "0x85522bdE267d05bf8CE8813F97c75417b7894A33";

function futureDate(daysAhead = 7): string {
  const d = new Date(Date.now() + daysAhead * 86400000);
  return d.toISOString().slice(0, 10);
}

function wordsLower(s: string): string[] {
  return s.toLowerCase().split(/\s+/).filter(Boolean);
}

describe("P6.4C contract-safe evidence label", () => {
  it("generic guidance maps to the canonical on-chain label", () => {
    expect(toOnChainEvidenceLabel(GENERIC_EVIDENCE_GUIDANCE)).toBe(
      "Delivery evidence",
    );
    expect(toOnChainEvidenceLabel(GENERIC_EVIDENCE_ONCHAIN_LABEL)).toBe(
      "Delivery evidence",
    );
    // Case-insensitive match of the generic fallback.
    expect(
      toOnChainEvidenceLabel("delivery note / files / links as applicable"),
    ).toBe("Delivery evidence");
    expect(
      utf8ByteLength(toOnChainEvidenceLabel(GENERIC_EVIDENCE_GUIDANCE)),
    ).toBeLessThanOrEqual(MAX_BYTES32_LABEL_BYTES);
  });

  it("short labels pass through byte-exact", () => {
    expect(toOnChainEvidenceLabel("GitHub repository")).toBe(
      "GitHub repository",
    );
    expect(toOnChainEvidenceLabel("Figma link")).toBe("Figma link");
    expect(toOnChainEvidenceLabel("")).toBe("");
    expect(toOnChainEvidenceLabel("   ")).toBe("");
  });

  it("prefers the first delimited segment when it fits", () => {
    expect(
      toOnChainEvidenceLabel(
        "Screenshots / video walkthrough of the final delivered homepage design",
      ),
    ).toBe("Screenshots");
  });

  it("long explicit requirement truncates at a word boundary without inventing words", () => {
    const input =
      "Final signed brand guidelines PDF with all logo variants and usage rules";
    expect(utf8ByteLength(input)).toBeGreaterThan(MAX_BYTES32_LABEL_BYTES);
    const result = toOnChainEvidenceLabel(input);
    expect(result.length).toBeGreaterThan(0);
    expect(utf8ByteLength(result)).toBeLessThanOrEqual(
      MAX_BYTES32_LABEL_BYTES,
    );
    // Word boundary: a prefix cut at a space, or the first-segment rule.
    const isWordPrefix =
      input.startsWith(result) &&
      (result.length === input.length || input[result.length] === " ");
    const firstSegment = input.split(/[/;(,]/)[0]!.trim();
    expect(isWordPrefix || result === firstSegment).toBe(true);
    // No invented words: every result word appears in the input.
    const inputWords = new Set(wordsLower(input));
    for (const w of wordsLower(result)) {
      expect(inputWords.has(w)).toBe(true);
    }
  });

  it("multibyte input never exceeds 32 bytes and decodes cleanly", () => {
    const inputs = [
      "USA₮ payment proof document with signatures and timestamps",
      "🎨🎨🎨🎨🎨🎨🎨🎨🎨🎨 final logo files and brand assets",
      "Figma link with schëma übersicht designs ✓✓✓ and more text here",
    ];
    for (const input of inputs) {
      expect(utf8ByteLength(input)).toBeGreaterThan(MAX_BYTES32_LABEL_BYTES);
      const result = toOnChainEvidenceLabel(input);
      expect(result.length).toBeGreaterThan(0);
      expect(utf8ByteLength(result)).toBeLessThanOrEqual(
        MAX_BYTES32_LABEL_BYTES,
      );
      // Never split a multi-byte char: no replacement chars, code-point
      // round-trip is stable, TextDecoder agrees.
      expect(result).not.toContain("�");
      expect([...result].join("")).toBe(result);
      expect(
        new TextDecoder().decode(new TextEncoder().encode(result)),
      ).toBe(result);
    }
  });

  it("draftToPolicy canonicalizes generic evidence but keeps the rich copy", () => {
    const { policy, errors } = draftToPolicy({
      recipient: WORKER,
      amount: "10",
      asset: "USA₮",
      purpose: "Logo design",
      deliverables: ["Logo"],
      deadlineDate: futureDate(),
      releaseMode: "manual",
      evidenceRequirements: [GENERIC_EVIDENCE_GUIDANCE],
    });
    expect(errors).toEqual([]);
    expect(policy).not.toBeNull();
    expect(policy!.evidenceExpectation).toBe("Delivery evidence");
    expect(policy!.evidenceRequirements).toEqual([GENERIC_EVIDENCE_GUIDANCE]);
    for (const field of [
      policy!.title,
      policy!.deliverableSummary,
      policy!.deliveryFormat,
      policy!.releaseRule,
      policy!.evidenceExpectation,
    ]) {
      expect(utf8ByteLength(field)).toBeLessThanOrEqual(
        MAX_BYTES32_LABEL_BYTES,
      );
    }
  });

  it("Payment #3 command is transaction-ready: every contract-bound field fits", async () => {
    const first = await parsePaymentCommand({
      message:
        "Protect 0.01 USA₮ for a designer to deliver a logo tomorrow. Ask me before releasing.",
      aiEnrich: null,
    });
    expect(first.missingFields).toContain("recipient");
    const second = await parsePaymentCommand({
      message: WORKER,
      priorDraft: first.draft,
      priorMessagesText:
        "Protect 0.01 USA₮ for a designer to deliver a logo tomorrow. Ask me before releasing.",
      aiEnrich: null,
    });
    const { policy, errors } = draftToPolicy(second.draft);
    expect(errors).toEqual([]);
    expect(policy).not.toBeNull();
    for (const field of [
      policy!.title,
      policy!.deliverableSummary,
      policy!.deliveryFormat,
      policy!.releaseRule,
      policy!.evidenceExpectation,
    ]) {
      expect(utf8ByteLength(field)).toBeLessThanOrEqual(
        MAX_BYTES32_LABEL_BYTES,
      );
    }
  });

  it("PolicyConfirmationCard still renders the rich evidence fallback", () => {
    const card = readFileSync(
      resolve(__dirname, "../../../components/command/PolicyConfirmationCard.tsx"),
      "utf-8",
    );
    expect(card).toContain("Delivery note / files / links as applicable");
  });
});
