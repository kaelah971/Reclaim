import type { Metadata } from "next";
import { Newsreader, Georama, IBM_Plex_Mono } from "next/font/google";
import Web3Provider from "@/providers/Web3Provider";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const georama = Georama({
  variable: "--font-georama",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Reclaim — Pay with proof",
  description:
    "Reclaim protects cUSD payments between clients and independent workers with clear terms, delivery evidence, fair review, and on-chain settlement.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${georama.variable} ${ibmPlexMono.variable} antialiased`}
    >
      <body className="min-h-screen bg-page text-ink font-[family-name:var(--font-georama)]">
        <Web3Provider>{children}</Web3Provider>
      </body>
    </html>
  );
}
