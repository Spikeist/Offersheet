"use client";
import Link from "next/link";
import { LogoMark } from "@/components/LogoMark";
import { buttonClass } from "@/components/ui";
import "./globals.css";

/**
 * The branded last-resort error page (planner reply to Checkpoint 4c, B3: "Branded not-found and error pages"): it
 * replaces the whole document when the root layout itself fails, so it brings its own <html> and <body>, the global
 * styles and a plain version of the header (the league switcher and the nav need the layout that just failed). Next's
 * own carries inline styles and no branding. Metadata exports don't work in an error boundary (a client component), so
 * the title is React's <title>. Like the page-level one (error.tsx) it shows nothing of the error.
 */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <title>Something went wrong · Offer Sheet</title>
        <header className="bg-navy text-navy-contrast">
          <div className="mx-auto flex max-w-5xl items-center px-4 py-2">
            <Link href="/" className="-ml-1.5 flex min-h-11 items-center gap-2 rounded-lg px-1.5 font-extrabold tracking-tight">
              <LogoMark className="size-8" />
              <span className="text-lg">Offer Sheet</span>
            </Link>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-4 py-10 text-center">
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Something went wrong</h1>
          <p className="text-muted">Offer Sheet couldn&apos;t show this page. Your saved leagues, settings and feedback are still in this browser.</p>
          <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row">
            <button type="button" onClick={() => retry()} className={buttonClass("primary")}>
              Try again
            </button>
            <Link href="/" className={buttonClass("secondary")}>
              Go to the home page
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
