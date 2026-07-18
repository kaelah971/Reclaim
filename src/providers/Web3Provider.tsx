"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/web3/config";
import WalletGateProvider from "./WalletGateProvider";
import { useState, type ReactNode } from "react";

export default function Web3Provider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 30_000 },
        },
      })
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WalletGateProvider>{children}</WalletGateProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
