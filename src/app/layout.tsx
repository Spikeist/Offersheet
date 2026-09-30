import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Offer Sheet", template: "%s · Offer Sheet" },
  description:
    "Fantasy football trade ideas that help your team, ranked by how much they help and how likely the other manager is to say yes. Free and read-only.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0b1f33" },
    { media: "(prefers-color-scheme: dark)", color: "#060d18" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <a href="#main" className="sr-only rounded-lg bg-accent px-3 py-2 font-bold text-navy focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-8">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
