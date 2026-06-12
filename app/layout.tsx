import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WARD — Civic Intelligence Portal",
  description: "The city already has eyes. WARD gives it a memory — and gives you a way to ask it questions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
