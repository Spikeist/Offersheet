import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Page not found" };

/**
 * The branded 404 page (planner reply to Checkpoint 4c, B3; Next's own carries inline styles and no branding): any
 * address the app doesn't have, inside the site's header and footer. Next answers it with HTTP 404 and asks search
 * engines not to index it. The way back: the home page, or your league (the League page says what to do when none is
 * imported yet).
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-4 text-center sm:py-10">
      <p className="text-xs font-bold tracking-widest text-brand-strong uppercase dark:text-brand">Error 404</p>
      <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Page not found</h1>
      <p className="text-muted">There&apos;s no page at this address. The link may be cut short, or the page may have moved.</p>
      <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row">
        <Link href="/" className={buttonClass("primary")}>
          Go to the home page
        </Link>
        <Link href="/league" className={buttonClass("secondary")}>
          Open your league
        </Link>
      </div>
    </div>
  );
}
