"use client";

import { useWalletState } from "@/hooks/wallet/useWalletState";
import { useRequireWallet } from "@/hooks/wallet/useRequireWallet";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import UnsupportedNetworkNotice from "@/components/ui/UnsupportedNetworkNotice";

export default function SignInPage() {
  const wallet = useWalletState();
  const { openWalletDialog } = useRequireWallet();

  const handleConnect = () => {
    openWalletDialog();
  };

  return (
    <section className="mx-auto max-w-[1440px] px-4 py-16 md:px-6 md:py-24">
      <div className="mx-auto max-w-lg text-center">
        <span className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          Sign in
        </span>
        <h1 className="mt-3 text-[42px] leading-[1.05] tracking-[-0.025em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[56px]">
          Your wallet opens your Payment Rooms, reviews and receipts.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-muted">
          Reclaim uses your Celo-compatible wallet to identify you. No password to
          create, no account to remember. Your wallet address is your identity in
          every Payment Room.
        </p>

        <div className="mt-10">
          {wallet.isConnected ? (
            <div className="space-y-6">
              <div className="rounded-[--radius-card] border border-border bg-surface p-6">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full bg-success" aria-hidden="true" />
                  <span className="text-[15px] font-medium text-ink">Connected</span>
                </div>
                <p className="mt-2 text-[15px] font-[family-name:var(--font-ibm-plex-mono)] font-medium text-ink break-all">
                  {wallet.address}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      wallet.chainSupported ? "bg-success" : "bg-status-disputed-text"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-[13px] text-muted">
                    {wallet.chainSupported
                      ? "Celo network"
                      : `Chain ID: ${wallet.chainId} — unsupported`}
                  </span>
                </div>
              </div>

              {!wallet.chainSupported && (
                <UnsupportedNetworkNotice />
              )}

              <div className="flex flex-col gap-3">
                {wallet.chainSupported && (
                  <Link href="/dashboard">
                    <Button size="lg" className="w-full">
                      Continue to dashboard
                    </Button>
                  </Link>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => wallet.disconnect()}
                >
                  Disconnect wallet
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <Button
                size="lg"
                onClick={handleConnect}
                disabled={wallet.isConnecting}
              >
                {wallet.isConnecting ? "Connecting…" : "Connect wallet"}
              </Button>
              {wallet.isReconnecting && (
                <p className="text-[14px] text-muted">
                  Reconnecting to your wallet…
                </p>
              )}
            </div>
          )}
        </div>

        <div className="mt-10 space-y-6 text-left">
          <div className="rounded-[--radius-card] border border-border bg-surface p-6">
            <h2 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
              How wallet access works
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              When you connect your wallet, Reclaim reads your public address to identify
              your Payment Rooms — the ones you created as a client and the ones you were
              invited to as a worker or reviewer. Your wallet signs messages to confirm
              actions, but Reclaim never has access to your private key or the ability to
              move your funds without your explicit approval.
            </p>
          </div>

          <div className="rounded-[--radius-card] border border-border bg-surface p-6">
            <h2 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
              Celo-compatible wallets
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              Reclaim supports wallets that connect to the Celo network, including
              MetaMask, Valora, MiniPay, and any WalletConnect-compatible wallet. Your
              wallet must support ERC-20 (USDC) transactions on Celo Sepolia.
            </p>
          </div>

          <Notice variant="protected" className="!border-border">
            <p className="text-[15px] leading-relaxed">
              <strong>Privacy note.</strong> Your Payment Room data, evidence, and
              communications are private and off-chain. Only wallet addresses, escrow
              states, settlement results, and verification references are recorded on
              Celo. No private evidence is published on-chain.
            </p>
          </Notice>

          <div className="rounded-[--radius-card] border border-border bg-surface p-6">
            <h2 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
              No password. No account recovery.
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              Because your identity is your wallet, there is no password to forget, no
              account to recover, and no central database of credentials. Your wallet is
              your key to your Payment Rooms. Keep your wallet recovery phrase safe; it
              is the only way to restore access.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
