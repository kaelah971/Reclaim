"use client";

import { useEffect, useState } from "react";
import { useChainId, useConnection } from "wagmi";

// ---------------------------------------------------------------------------
// ChainDiagnostics — live wallet-chain source comparison (troubleshooting)
//
// Shows exactly what each chain source reports in the active session:
//   store               wagmi persisted/hydrated store chainId
//   account             useConnection()/useAccount() chainId
//   connector.getChainId()   the active connector's own read
//   provider.eth_chainId     DIRECT EIP-1193 provider read (authoritative)
// ---------------------------------------------------------------------------

interface ProviderShape {
  request(args: { method: "eth_chainId" }): Promise<string>;
  isMetaMask?: boolean;
  name?: string;
}

export default function ChainDiagnostics() {
  const storeChainId = useChainId();
  const { chainId: accountChainId, connector } = useConnection();
  const [connectorChainId, setConnectorChainId] = useState<string>("—");
  const [providerChainId, setProviderChainId] = useState<string>("—");
  const [providerLabel, setProviderLabel] = useState<string>("—");

  useEffect(() => {
    if (!connector) return;
    let cancelled = false;

    (async () => {
      try {
        const viaConnector = await connector.getChainId();
        if (!cancelled) setConnectorChainId(String(viaConnector));
      } catch {
        if (!cancelled) setConnectorChainId("error");
      }
      try {
        const rawProvider = (await connector.getProvider()) as unknown as ProviderShape;
        if (!rawProvider || typeof rawProvider.request !== "function") {
          if (!cancelled) setProviderChainId("unavailable");
          return;
        }
        const hex = await rawProvider.request({ method: "eth_chainId" });
        if (!cancelled) {
          setProviderChainId(String(Number(hex)));
          setProviderLabel(
            rawProvider.isMetaMask ? "isMetaMask" : (rawProvider.name ?? "injected"),
          );
        }
      } catch {
        if (!cancelled) setProviderChainId("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connector]);

  return (
    <div className="mt-1 space-y-0.5 text-[11px] font-[family-name:var(--font-ibm-plex-mono)] leading-relaxed text-muted">
      <div>
        store: {storeChainId ?? "undefined"}
      </div>
      <div>
        account: {accountChainId ?? "undefined"}
      </div>
      <div>
        connector.getChainId: {connectorChainId}
      </div>
      <div>
        provider.eth_chainId: {providerChainId} ({providerLabel})
      </div>
    </div>
  );
}
