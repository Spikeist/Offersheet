"use client";
import Link from "next/link";
import { buttonClass } from "@/components/ui";

/**
 * The branded error page (planner reply to Checkpoint 4c, B3: "Branded not-found and error pages"): when a page breaks
 * while it renders, this takes its place inside the site's header and footer. "Try again" asks Next to fetch and render
 * the page again (retry, stable since Next 16.3); the home page is the way out. It shows nothing of the error itself
 * (its message could hold a league's names) and logs nothing more than React already does.
 */
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-4 text-center sm:py-10">
      <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Something went wrong</h1>
      <p className="text-muted">
        Offer Sheet couldn&apos;t show this page. Your saved leagues, settings and feedback are still in this browser. Try again, and if it keeps happening, the{" "}
        <Link href="/feedback" className="font-semibold underline underline-offset-2">
          feedback page
        </Link>{" "}
        says how to tell us.
      </p>
      <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row">
        <button type="button" onClick={() => retry()} className={buttonClass("primary")}>
          Try again
        </button>
        <Link href="/" className={buttonClass("secondary")}>
          Go to the home page
        </Link>
      </div>
    </div>
  );
}
