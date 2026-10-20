"use client";
/**
 * A League page card closed by default, its heading visible (Checkpoint 7h; planner reply to Checkpoint 7g, §1: "The League page
 * fits in about 8 screens"; the lead's steps 2 and 3 for it: the positional-strength heatmap and "Best available"). The heading
 * is the control: an h2 holding a 44 px button (the disclosure pattern: aria-expanded, aria-controls naming the body), with the
 * card's eyebrow above it and a chevron that turns when it's open; the body stays in the page while closed, with the hidden
 * attribute, so a reader of the page finds its words either way (check:browser's scans, the FantasyCalc guard), and keyboard
 * focus stays on the button when it opens and closes. `bodyClassName` spaces the body under the heading.
 */
import { useId, useState, type ReactNode } from "react";
import { Card, cx } from "../ui";

export function DisclosureCard({
  title,
  eyebrow,
  children,
  defaultOpen = false,
  dataKey,
}: {
  title: string;
  eyebrow?: string | undefined;
  children: ReactNode;
  defaultOpen?: boolean | undefined;
  /** The card's `data-league-disclosure` value, for check:browser's League step (it opens each card it reads). */
  dataKey: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <Card>
      {eyebrow ? <p className="text-xs font-bold tracking-wider text-brand uppercase">{eyebrow}</p> : null}
      <h2 className="text-lg leading-tight font-extrabold tracking-tight sm:text-xl">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          data-league-disclosure={dataKey}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
        >
          <span className="min-w-0 break-words">{title}</span>
          <span aria-hidden className={cx("shrink-0 text-base text-muted transition-transform", open && "rotate-180")}>
            ▾
          </span>
        </button>
      </h2>
      <div id={id} hidden={!open} className="mt-3">
        {children}
      </div>
    </Card>
  );
}
