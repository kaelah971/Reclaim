// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// P4.3b EvidenceMap — chain-aware internals, backward-compatible props,
// strict hash-only privacy (mocks only, no RPC).
//
//   - Existing callers (items [+ className]) render unchanged.
//   - Optional chainId/paymentId props only — never required.
//   - Validated ?chainId= resolves internally without room-page changes;
//     invalid values fail closed to Sepolia.
//   - Anonymous stays hash-only: the component never fetches plaintext
//     (asserted via a stubbed global fetch).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import EvidenceMap, {
  resolveEvidenceMapChainId,
  type EvidenceItemData,
} from "../EvidenceMap";

const ITEMS: readonly EvidenceItemData[] = [
  {
    id: "evidence-1",
    title: "Delivery evidence (hash)",
    type: "Evidence reference",
    owner: "0x85522bdE267d05bf8CE8813F97c75417b7894A33",
    status: "submitted",
    verificationRef:
      "0x1bb11c9d819f4a69fc88c2eccb8fcf4343f07d965b1c87f7e3d3d7e5f94abb99",
  },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(props: Parameters<typeof EvidenceMap>[0]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<EvidenceMap {...props} />);
  });
  await act(async () => {});
}

function setSearch(search: string) {
  window.history.replaceState({}, "", search === "" ? "/" : `/${search}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearch("");
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container = null;
  document.body.innerHTML = "";
  setSearch("");
  vi.unstubAllGlobals();
});

describe("P4.3b EvidenceMap — backward compatibility", () => {
  it("renders legacy props unchanged (hash-only item)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mount({ items: ITEMS });

    const text = container!.textContent ?? "";
    expect(text).toContain("Evidence map");
    expect(text).toContain("Delivery evidence (hash)");
    expect(text).toContain(
      "0x1bb11c9d819f4a69fc88c2eccb8fcf4343f07d965b1c87f7e3d3d7e5f94abb99",
    );
    expect(container!.querySelector("[data-escrow-chain-id]")?.getAttribute("data-escrow-chain-id")).toBe(
      "11142220",
    );
    // Hash-only: no plaintext fetch is ever issued, even for anonymous users.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders the empty state without new props", async () => {
    await mount({ items: [] });
    expect(container!.textContent ?? "").toContain(
      "No evidence has been submitted yet.",
    );
  });
});

describe("P4.3b EvidenceMap — internal chain awareness", () => {
  it("accepts an explicit Mainnet chainId prop (optional addition)", async () => {
    await mount({ items: ITEMS, chainId: 42220, paymentId: "7" });
    const el = container!.querySelector("[data-escrow-chain-id]");
    expect(el?.getAttribute("data-escrow-chain-id")).toBe("42220");
    expect(el?.getAttribute("data-payment-id")).toBe("7");
  });

  it("resolves a validated ?chainId= without room-page changes", async () => {
    setSearch("?chainId=42220");
    await mount({ items: ITEMS });
    expect(
      container!.querySelector("[data-escrow-chain-id]")?.getAttribute("data-escrow-chain-id"),
    ).toBe("42220");
  });

  it("fails closed to Sepolia for an invalid ?chainId=", async () => {
    setSearch("?chainId=1");
    await mount({ items: ITEMS });
    expect(
      container!.querySelector("[data-escrow-chain-id]")?.getAttribute("data-escrow-chain-id"),
    ).toBe("11142220");
  });
});

describe("P4.3b resolveEvidenceMapChainId — pure resolution", () => {
  it("prefers the explicit prop, then the URL, then the Sepolia default", () => {
    expect(resolveEvidenceMapChainId(42220, "?chainId=11142220")).toBe(42220);
    expect(resolveEvidenceMapChainId(undefined, "?chainId=42220")).toBe(42220);
    expect(resolveEvidenceMapChainId(undefined, "")).toBe(11142220);
    expect(resolveEvidenceMapChainId(undefined, undefined)).toBe(11142220);
  });

  it("fails closed to Sepolia for invalid prop or URL values", () => {
    expect(resolveEvidenceMapChainId("1", "?chainId=42220")).toBe(42220);
    expect(resolveEvidenceMapChainId("abc", "?chainId=1")).toBe(11142220);
    expect(resolveEvidenceMapChainId(undefined, "?chainId=abc")).toBe(11142220);
  });
});
