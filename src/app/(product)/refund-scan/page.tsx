"use client";

import { useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Select from "@/components/ui/Select";
import Notice from "@/components/ui/Notice";
import StatusBadge from "@/components/ui/StatusBadge";
import Dialog from "@/components/ui/Dialog";
import { useRequireWallet } from "@/hooks/wallet/useRequireWallet";

const issueTypes = [
  {
    key: "duplicate",
    label: "Duplicate charge",
    description:
      "The same or similar amount appears more than once for the same merchant within a short period.",
  },
  {
    key: "subscription-increase",
    label: "Subscription increase",
    description:
      "A recurring payment increases compared with earlier billing periods.",
  },
  {
    key: "unexpected-fee",
    label: "Unexpected fee",
    description:
      "A charge contains an additional fee that was not clear in the original amount.",
  },
];

export default function RefundScanPage() {
  const { requireWallet } = useRequireWallet();

  const [mode, setMode] = useState<"csv" | "manual">("csv");
  const [file, setFile] = useState<File | null>(null);
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState(false);

  const handleRecoveryPackage = () => {
    const hasInput = mode === "csv" ? !!file : false;
    if (!hasInput) return;
    requireWallet(() => {
      setRecoveryDialogOpen(true);
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    setFile(selected);
  };

  const handleRemoveFile = () => {
    setFile(null);
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-12">
      <div>
        <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] font-[family-name:var(--font-newsreader)] font-medium text-ink md:text-[44px]">
          Check a payment record for common billing problems.
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted max-w-2xl">
          Upload a transaction history or enter a transaction manually to check for duplicates,
          subscription increases, and unexpected fees. This is a secondary protection tool.
          For protected payments with clear terms and evidence, use{" "}
          <Link href="/payments/new" className="text-gold hover:text-gold/80 underline underline-offset-2">
            Protect a payment
          </Link>
          .
        </p>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-8">
          <div className="flex rounded-[--radius-pill] border border-border bg-input p-1 w-fit" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "csv"}
              onClick={() => setMode("csv")}
              className={`rounded-[--radius-pill] px-4 py-2 text-[14px] font-medium transition-colors ${
                mode === "csv" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              Upload CSV
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "manual"}
              onClick={() => setMode("manual")}
              className={`rounded-[--radius-pill] px-4 py-2 text-[14px] font-medium transition-colors ${
                mode === "manual" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              Manual entry
            </button>
          </div>

          {mode === "csv" && (
            <div className="space-y-6">
              <div className="rounded-[--radius-card] border border-border bg-surface p-6">
                <h2 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
                  Upload a CSV
                </h2>

                {!file ? (
                  <div className="mt-4">
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleFileChange}
                      className="block w-full text-[15px] text-muted file:mr-4 file:rounded-[--radius-button] file:border-0 file:bg-input file:px-4 file:py-2 file:text-[14px] file:font-medium file:text-ink hover:file:bg-border/50 cursor-pointer"
                    />
                    <p className="mt-3 text-[14px] text-muted">
                      Choose a CSV file from your device.
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 rounded-[--radius-card] border border-border bg-input p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[15px] font-medium text-ink">{file.name}</p>
                        <p className="mt-0.5 text-[13px] text-muted">
                          {file.type || "text/csv"} &middot; {formatSize(file.size)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge variant="pending" label="Local only" />
                        <button
                          type="button"
                          onClick={handleRemoveFile}
                          className="shrink-0 text-muted hover:text-ink transition-colors"
                          aria-label="Remove file"
                        >
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 18 18"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M1 1L17 17M17 1L1 17"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {file ? (
                  <Notice variant="info" className="mt-4 !border-border">
                    CSV selected. Transaction analysis will be enabled during product integration.
                  </Notice>
                ) : (
                  <div className="mt-6 rounded-[--radius-card] border border-dashed border-border bg-page px-6 py-10 text-center">
                    <p className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
                      No transactions scanned yet.
                    </p>
                    <p className="mt-1 text-[14px] text-muted">
                      Upload a CSV after analysis is connected.
                    </p>
                  </div>
                )}
              </div>

              <div className="rounded-[--radius-card] border border-border bg-page p-6">
                <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
                  CSV format
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-muted">
                  The CSV file should contain the following columns:
                </p>
                <div className="mt-3 rounded-[--radius-button] bg-input border border-border overflow-x-auto">
                  <table className="min-w-full text-[14px]">
                    <thead>
                      <tr className="border-b border-border">
                        {["date", "merchant", "amount", "currency", "description"].map((col) => (
                          <th
                            key={col}
                            className="px-4 py-2.5 text-left text-[13px] font-semibold text-muted uppercase tracking-wider"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="px-4 py-2.5 text-muted font-[family-name:var(--font-ibm-plex-mono)] tabular-nums">
                          2026-07-01
                        </td>
                        <td className="px-4 py-2.5 text-muted">Acme Corp</td>
                        <td className="px-4 py-2.5 text-muted font-[family-name:var(--font-ibm-plex-mono)] tabular-nums">
                          29.99
                        </td>
                        <td className="px-4 py-2.5 text-muted">USD</td>
                        <td className="px-4 py-2.5 text-muted">Monthly subscription</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-[13px] text-muted">
                  This is a format reference only. Real analysis will be available during product integration.
                </p>
              </div>

              <div className="rounded-[--radius-card] border border-dashed border-border bg-page px-6 py-10 text-center">
                <p className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
                  No findings yet.
                </p>
                <p className="mt-1 text-[14px] text-muted">
                  Upload a CSV or enter a transaction after analysis is connected.
                </p>
              </div>
            </div>
          )}

          {mode === "manual" && (
            <div className="space-y-6">
              <div className="rounded-[--radius-card] border border-border bg-surface p-6">
                <h2 className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
                  Manual transaction entry
                </h2>
                <div className="mt-5 space-y-5">
                  <Input label="Merchant" placeholder="Acme Corp" />
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="Amount" placeholder="29.99" type="number" />
                    <Input label="Currency" placeholder="USD" />
                  </div>
                  <Input label="Transaction date" type="date" />
                  <Select label="Charge type">
                    <option value="">Select charge type</option>
                    <option value="one-time">One-time</option>
                    <option value="subscription">Subscription</option>
                    <option value="other">Other</option>
                  </Select>
                  <Textarea label="Optional note" placeholder="Add any relevant details about this transaction." />
                </div>

                <div className="mt-6 rounded-[--radius-card] border border-dashed border-border bg-page px-6 py-10 text-center">
                  <p className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
                    No transactions scanned yet.
                  </p>
                  <p className="mt-1 text-[14px] text-muted">
                    Enter a transaction after analysis is connected.
                  </p>
                </div>
              </div>

              <Notice variant="info">
                Transaction analysis will be enabled during product integration. The form above validates
                locally but does not save or analyse entries.
              </Notice>

              <div className="rounded-[--radius-card] border border-dashed border-border bg-page px-6 py-10 text-center">
                <p className="text-lg font-[family-name:var(--font-georama)] font-semibold text-ink">
                  No findings yet.
                </p>
                <p className="mt-1 text-[14px] text-muted">
                  Upload a CSV or enter a transaction after analysis is connected.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="sticky top-[8rem] space-y-6">
            <div className="rounded-[--radius-card] border border-border bg-surface p-6">
              <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
                Issue types
              </h3>
              <div className="mt-4 space-y-4">
                {issueTypes.map((issue) => (
                  <div key={issue.key}>
                    <h4 className="text-[14px] font-semibold text-ink">
                      {issue.label}
                    </h4>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted">
                      {issue.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[--radius-card] border border-border bg-surface p-6">
              <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
                Recovery action
              </h3>
              <p className="mt-3 text-[14px] leading-relaxed text-muted">
                After analysis identifies potential issues, generate a structured recovery
                package for the merchant or service provider.
              </p>
              <div className="mt-4">
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={handleRecoveryPackage}
                >
                  Prepare a recovery package — 0.02 USDC
                </Button>
              </div>
            </div>

            <Notice variant="info" className="!border-border">
              <p className="text-[13px] leading-relaxed">
                <strong>Refund Scan is a secondary tool.</strong> For active payment protection
                with clear terms, delivery evidence, and on-chain settlement, use the main{" "}
                <Link
                  href="/payments/new"
                  className="text-gold hover:text-gold/80 underline underline-offset-2"
                >
                  Protect a payment
                </Link>{" "}
                flow.
              </p>
            </Notice>
          </div>
        </div>
      </div>

      <Dialog
        open={recoveryDialogOpen}
        onClose={() => setRecoveryDialogOpen(false)}
        title="Recovery package"
        primaryLabel="Got it"
        onPrimary={() => setRecoveryDialogOpen(false)}
      >
        <p>
          Recovery Package generation will be enabled during x402 and transaction-analysis
          integration.
        </p>
      </Dialog>
    </div>
  );
}
