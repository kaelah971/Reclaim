// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// P6.4E EvidenceRecoveryCard — match-gated metadata-only recovery form.
//
//   - Save is DISABLED while the live form hash mismatches the on-chain
//     reference (prevents persisting a non-matching manifest).
//   - Save is ENABLED when the form matches (computed in-test via the
//     canonical buildEvidenceManifest + keccak), and onRecover receives the
//     exact form data.
//   - The component performs zero chain writes (source scan: no
//     submitEvidenceHash / writeContract / readContract imports).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "fs";
import { resolve } from "path";
import { keccak256, stringToHex } from "viem";
import { buildEvidenceManifest } from "@/lib/evidence/manifest";
import type { EvidenceFormData } from "@/lib/evidence/manifest";
import EvidenceRecoveryCard from "../EvidenceRecoveryCard";

const MATCH = {
  title: "Logo delivery",
  description: "Final logo delivery for review",
  type: "message",
  relatedClaim: "Logo",
  date: "2026-09-18",
  externalRef: "",
  pastedText: "Logo concepts attached as described — final delivery note.",
  fileHash: "",
};

const ON_CHAIN_REF = keccak256(stringToHex(buildEvidenceManifest(MATCH)));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(props: {
  initialData: Record<string, string | undefined>;
  onRecover: (data: unknown) => void;
  recovering?: boolean;
}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <EvidenceRecoveryCard
        paymentIdStr="3"
        chainId={42220}
        onChainReference={ON_CHAIN_REF}
        deliveryDayISO={MATCH.date}
        initialData={props.initialData}
        onRecover={props.onRecover as (data: EvidenceFormData) => void}
        recovering={props.recovering ?? false}
        recoverError={null}
      />,
    );
  });
  await act(async () => {});
}

function saveButton(): HTMLButtonElement {
  const btn = container!.querySelector("button");
  expect(btn).not.toBeNull();
  expect(btn!.textContent).toContain("Save details");
  return btn as HTMLButtonElement;
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container = null;
  document.body.innerHTML = "";
});

describe("EvidenceRecoveryCard — match-gated recovery", () => {
  it("save is disabled while the form hash mismatches the on-chain record", async () => {
    const onRecover = vi.fn();
    await mount({
      initialData: {
        title: "Wrong title — does not match",
        description: MATCH.description,
        type: MATCH.type,
        relatedClaim: MATCH.relatedClaim,
        pastedText: MATCH.pastedText,
        externalRef: MATCH.externalRef,
      },
      onRecover,
    });

    expect(saveButton().disabled).toBe(true);
    expect(container!.textContent).toContain(
      "Does not match the on-chain record yet.",
    );
    expect(onRecover).not.toHaveBeenCalled();
  });

  it("save is enabled on match and onRecover receives the exact form", async () => {
    const onRecover = vi.fn();
    await mount({
      initialData: {
        title: MATCH.title,
        description: MATCH.description,
        type: MATCH.type,
        relatedClaim: MATCH.relatedClaim,
        pastedText: MATCH.pastedText,
        externalRef: MATCH.externalRef,
      },
      onRecover,
    });

    expect(container!.textContent).toContain("Matches on-chain record");
    const btn = saveButton();
    expect(btn.disabled).toBe(false);

    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onRecover).toHaveBeenCalledTimes(1);
    expect(onRecover.mock.calls[0][0]).toEqual(MATCH);
  });

  it("performs zero chain writes (no tx imports in source)", () => {
    const src = readFileSync(
      resolve(__dirname, "..", "EvidenceRecoveryCard.tsx"),
      "utf-8",
    ).replace(/\r\n/g, "\n");
    // Call/import patterns for chain writes (like the existing
    // no-writeContract room asserts) — plain prose never matches these.
    for (const token of [
      "writeContract(",
      "useWriteContract",
      "submitEvidenceHash",
      "useSubmitEvidenceHash",
      "readContract(",
      "useEscrowActions",
      "requestRelease",
      "approveRelease",
    ]) {
      expect(src).not.toContain(token);
    }
    expect(src).toContain("buildEvidenceManifest");
  });
});
