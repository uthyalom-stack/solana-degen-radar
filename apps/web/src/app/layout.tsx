import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solana Degen Radar · Intelligent Trading Terminal",
  description:
    "Solana meme-coin discovery, social viral intelligence, on-chain risk analysis, simulation and non-custodial live trading platform.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}
