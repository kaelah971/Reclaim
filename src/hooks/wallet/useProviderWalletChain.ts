"use client";

import { useEffect, useState } from "react";
import { useConnection } from "wagmi";

// ---------------------------------------------------------------------------
// useProviderWalletChain — authoritative wallet chain resolver
//
// The wagmi store/hydrated chainId and connector.getChainId() are NOT the
// final truth: the store value can be a stale hydrated cookie value, and
// connector.getChainId() can fail (e.g. when the connection still holds the
// persisted connector stub) or read a non-authoritative provider.
//
// The authoritative value is the DIRECT EIP-1193 provider read:
//   await connector.getProvider()
//   await provider.request({ method: "eth_chainId" })
//
// The provider's "chainChanged" event keeps the resolved chain fresh and is
// the ONLY way the chain updates after the wallet switches networks.
// While the chain is unresolved (or wagmi is still reconnecting), undefined
// is exposed instead of any stale hydrated value.
// ---------------------------------------------------------------------------

interface Eip1193Provider {
  request(args: { method: "eth_chainId" }): Promise<string>;
  on?(event: "chainChanged", handler: (chainId: string) => void): void;
  removeListener?(event: "chainChanged", handler: (chainId: string) => void): void;
}

function parseChainId(hexOrDec: string | number): number | undefined {
  const parsed = Number(hexOrDec);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return parsed;
}

export function useProviderWalletChain(): number | undefined {
  const { connector, isConnected, isReconnecting } = useConnection();
  const [providerChainId, setProviderChainId] = useState<number | undefined>();

  useEffect(() => {
    if (!isConnected || !connector) return;

    let cancelled = false;
    let removeListener: (() => void) | undefined;

    connector
      .getProvider()
      .then((rawProvider) => {
        if (cancelled) return;
        const provider = rawProvider as unknown as Eip1193Provider;
        if (!provider || typeof provider.request !== "function") {
          if (!cancelled) setProviderChainId(undefined);
          return;
        }

        return provider
          .request({ method: "eth_chainId" })
          .then((hexChainId) => {
            if (cancelled) return;
            const parsed = parseChainId(hexChainId);
            if (parsed === undefined) {
              setProviderChainId(undefined);
              return;
            }
            setProviderChainId(parsed);

            // Subscribe to live chain changes on the provider itself.
            if (
              typeof provider.on === "function" &&
              typeof provider.removeListener === "function"
            ) {
              const handleChainChanged = (chain: string) => {
                const next = parseChainId(chain);
                if (next !== undefined) setProviderChainId(next);
              };
              const removeListenerFn = provider.removeListener;
              provider.on("chainChanged", handleChainChanged);
              removeListener = () =>
                removeListenerFn("chainChanged", handleChainChanged);
            }
          });
      })
      .catch(() => {
        if (!cancelled) setProviderChainId(undefined);
      });

    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, [connector, isConnected]);

  return !isConnected || isReconnecting ? undefined : providerChainId;
}
