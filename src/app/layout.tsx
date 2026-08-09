import type { Metadata } from "next";
import { cookies } from "next/headers";
import { cookieToInitialState } from "wagmi";
import { wagmiConfig } from "@/lib/web3/config";
import Web3Provider from "@/providers/Web3Provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reclaim — Pay with proof",
  description:
    "Reclaim protects cUSD payments between clients and independent workers with clear terms, delivery evidence, fair review, and on-chain settlement.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieHeader = (await cookies()).toString();
  const initialState = cookieToInitialState(wagmiConfig, cookieHeader);

  return (
    <html lang="en" className="antialiased">
      <body className="min-h-screen bg-page text-ink font-[family-name:var(--font-georama)]">
        <Web3Provider initialState={initialState}>{children}</Web3Provider>
      </body>
    </html>
  );
}
