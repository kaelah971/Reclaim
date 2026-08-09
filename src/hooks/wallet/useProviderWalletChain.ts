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
//
// LISTENER LIFECYCLE (critical):
//   The provider instance captured for the subscription (`providerForEffect`)
//   is the SAME object used for cleanup, with DIRECT method invocation:
//     providerForEffect.on("chainChanged", handler)
//     providerForEffect.removeListener("chainChanged", handler)
//   removeListener is NEVER copied, destructured, or unbound from the
//   provider — MetaMask's EventEmitter methods read instance state via
//   `this` (e.g. `this._events`), so an unbound call crashes.
//   An effect-local `cancelled` guard prevents an obsolete async provider
//   lookup from installing a listener after cleanup.
// ---------------------------------------------------------------------------

interface Eip1193Provider {
  request(args: { method: "eth_chainId" }): Promise<string>;
  on?(event: "chainChanged", handler: (chainId: string) => void): void;
  removeListener?(event: "chainChanged", handler: (chainId: string) => void): void;
}

/** Same shape as Eip1193Provider but with non-optional event methods —
 *  only reachable after runtime guards, so the cleanup closure never needs
 *  to copy/unbind the methods. */
interface Eip1193ChainEvents {
  on(event: "chainChanged", handler: (chainId: string) => void): void;
  removeListener(event: "chainChanged", handler: (chainId: string) => void): void;
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
        const providerForEffect = rawProvider as unknown as Eip1193Provider;
        if (!providerForEffect || typeof providerForEffect.request !== "function") {
          if (!cancelled) setProviderChainId(undefined);
          return;
        }

        return providerForEffect
          .request({ method: "eth_chainId" })
          .then((hexChainId) => {
            if (cancelled) return;
            const parsed = parseChainId(hexChainId);
            if (parsed === undefined) {
              setProviderChainId(undefined);
              return;
            }
            setProviderChainId(parsed);

            if (
              typeof providerForEffect.on === "function" &&
              typeof providerForEffect.removeListener === "function"
            ) {
              // Narrowed cast of the SAME provider instance — no copying.
              const eventedProvider = providerForEffect as Eip1193ChainEvents;

              const handleChainChanged = (chain: string) => {
                const next = parseChainId(chain);
                if (next !== undefined) setProviderChainId(next);
              };

              // Subscribe on the captured instance…
              eventedProvider.on("chainChanged", handleChainChanged);
              // …and clean up on the SAME instance via direct method
              // invocation so `this` (EventEmitter state) is preserved.
              removeListener = () =>
                eventedProvider.removeListener("chainChanged", handleChainChanged);
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
