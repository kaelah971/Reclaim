// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// WalletDialog — requiredChainId switch-target rendering tests (no real tx).
//
// Omitted requiredChainId keeps the historical Sepolia copy (backward
// compatible); an explicit Mainnet ID renders the canonical Mainnet name +
// chain ID resolved via getChainName (never hardcoded per-network strings).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WalletDialog from "../WalletDialog";
import {
  CELO_CHAIN_ID,
  CELO_MAINNET_CHAIN_ID,
  CELO_NETWORK_NAME,
} from "@/lib/web3/chains";

let root: Root | null = null;

async function mountSwitchDialog(props?: { requiredChainId?: number }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <WalletDialog
        open
        mode="switch"
        options={[]}
        currentChainId={1}
        {...props}
        isConnecting={false}
        isSwitching={false}
        error={null}
        onSelectOption={vi.fn()}
        onSwitchNetwork={vi.fn()}
        onClose={vi.fn()}
      />,
    );
  });
  await act(async () => {});
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
});

describe("WalletDialog — switch target", () => {
  it("defaults to the Sepolia escrow chain (backward compatible)", async () => {
    await mountSwitchDialog();
    const text = document.body.textContent ?? "";
    expect(text).toContain(CELO_NETWORK_NAME);
    expect(text).toContain(String(CELO_CHAIN_ID));
    expect(text).toContain(`Switch to ${CELO_NETWORK_NAME}`);
  });

  it("renders the canonical Mainnet name + chain ID when requiredChainId is 42220", async () => {
    await mountSwitchDialog({ requiredChainId: CELO_MAINNET_CHAIN_ID });
    const text = document.body.textContent ?? "";
    expect(text).toContain("Celo Mainnet");
    expect(text).toContain("42220");
    expect(text).toContain("Switch to Celo Mainnet to continue.");
    expect(text).not.toContain(CELO_NETWORK_NAME);
  });
});
