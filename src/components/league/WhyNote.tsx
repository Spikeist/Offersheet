"use client";
/**
 * A long explanation cut to one line (Checkpoint 7h; planner reply to Checkpoint 7g, §1: "League page: cut each long explanation
 * paragraph to one line. The rest goes behind a "Why?" control or moves to How to read."; the lead's item 7): the line, and beside
 * it on the right a 44 px "Why?" button (a disclosure: aria-expanded, aria-controls naming the rest, its topic said to screen
 * readers, since a page has several), the rest under them, kept in the page while closed with the hidden attribute (so a reader of
 * the page finds its words either way, and focus stays on the button). The line can hold a link (a "Values: FantasyCalc" credit):
 * the button is beside it, never around it.
 */
import { useId, useState, type ReactNode } from "react";
import { WHY_LABEL } from "@/lib/leagueView";
import { cx } from "../ui";

export function WhyNote({ line, topic, children, className }: { line: ReactNode; topic: string; children: ReactNode; className?: string | undefined }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={cx("text-xs text-muted", className)}>
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 leading-relaxed">{line}</p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-11 shrink-0 items-center px-1 font-semibold text-brand-strong underline underline-offset-2 dark:text-brand"
        >
          {WHY_LABEL}
          <span className="sr-only"> ({topic})</span>
        </button>
      </div>
      <div id={id} hidden={!open} className="mb-1 space-y-1 leading-relaxed">
        {children}
      </div>
    </div>
  );
}
