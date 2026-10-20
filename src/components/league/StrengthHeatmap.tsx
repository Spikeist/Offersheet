"use client";
/**
 * Positional strength heatmap (CLAUDE.md §14 item 3, §7 strength): rows are teams, columns are the
 * league's starting slots, each cell a team's starter points per week at that slot, colored by how
 * it compares with the league (a z-score in 5 steps). Every value is printed in its cell and the
 * step is spelled out for screen readers, so color never carries the meaning alone.
 *
 * Colors: a diverging blue ↔ red scale with a neutral gray middle (not green ↔ red, which
 * red-green colorblind readers can't tell apart), picked for light and dark mode separately, each
 * with text contrast ≥ 4.5:1: the --heat-* tokens in src/app/globals.css. At 375 px the table
 * scrolls sideways inside its card, with the team column pinned. The scroller is a named region that
 * takes keyboard focus (with the focus ring from globals.css), so the arrow keys can scroll the later
 * columns into view in every browser, Safari included, which doesn't make scrollers focusable itself.
 *
 * Checkpoint 7h (planner reply to Checkpoint 7g, §1: "The League page fits in about 8 screens"; the lead's step 2): the card is
 * closed by default, its heading the 44 px control that opens it (DisclosureCard.tsx); the table is in the page either way.
 */
import { useState } from "react";
import { HEAT_STEPS, HEAT_STEP_LABEL, type HeatStep, type Heatmap, type StrengthWindow } from "@/lib/leagueView";
import { cx } from "../ui";
import { DisclosureCard } from "./DisclosureCard";

/**
 * Fill and ink per step (theme tokens that switch for dark mode). Text contrast: 6.6, 8.2, 15.0, 7.9, 7.0 : 1 light;
 * 5.2, 6.8, 9.8, 7.2, 4.9 : 1 dark. The two arms stay apart under protan/deutan simulation (OKLab ΔE ≥ 13 for the
 * inner pair, ≥ 19 for the outer).
 */
export const HEAT_CLASS: Record<HeatStep, string> = {
  strong: "bg-heat-strong text-heat-strong-ink",
  above: "bg-heat-above text-heat-above-ink",
  average: "bg-heat-average text-heat-average-ink",
  below: "bg-heat-below text-heat-below-ink",
  weak: "bg-heat-weak text-heat-weak-ink",
};

const WINDOWS: StrengthWindow[] = ["ros", "next"];

export function StrengthHeatmap({ heatmap, initialWindow = "ros" }: { heatmap: Heatmap; initialWindow?: StrengthWindow }) {
  const [win, setWin] = useState<StrengthWindow>(initialWindow);
  return (
    <DisclosureCard eyebrow="Lineup slots" title="Positional strength" dataKey="heatmap">
      <div role="group" aria-label="Time window" className="mb-3 inline-flex rounded-xl border border-line bg-surface-muted p-1">
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            aria-pressed={win === w}
            onClick={() => setWin(w)}
            className={cx("min-h-11 rounded-lg px-3 text-sm font-bold", win === w ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground")}
          >
            {heatmap.windowLabel[w]}
          </button>
        ))}
      </div>
      <p aria-hidden className="mb-2 text-xs text-muted">
        {heatmap.caption[win]}
      </p>
      {/* relative: keeps the cells' screen-reader text inside this scroller, not widening the page. */}
      <div role="region" aria-label="Positional strength table (scrolls sideways on small screens)" tabIndex={0} className="relative -mx-4 overflow-x-auto sm:mx-0">
        <table className="border-separate border-spacing-0.5 text-sm">
          <caption className="sr-only">{heatmap.caption[win]}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-surface pr-2 pl-4 text-left text-xs font-bold text-muted sm:pl-0">
                Team
              </th>
              {heatmap.columns.map((c) => (
                <th key={c.key} scope="col" className="min-w-12 px-1 pb-1 text-center text-xs font-bold text-muted">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatmap.rows.map((r) => (
              <tr key={r.teamId}>
                <th scope="row" title={r.name} className={cx("sticky left-0 z-10 max-w-32 truncate bg-surface pr-2 pl-4 text-left text-xs sm:max-w-44 sm:pl-0", r.isMine ? "font-extrabold" : "font-semibold")}>
                  {r.name}
                  {r.isMine ? <span className="text-brand-strong dark:text-brand"> (you)</span> : null}
                </th>
                {r.cells[win].map((c) => (
                  <td key={c.key} title={c.title} className={cx("h-11 min-w-12 rounded-md px-1.5 text-center font-semibold tabular-nums", HEAT_CLASS[c.step])}>
                    {c.text}
                    <span className="sr-only">, {HEAT_STEP_LABEL[c.step].toLowerCase()}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted" aria-label="Color key">
        {HEAT_STEPS.map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cx("inline-block size-3.5 rounded-sm", HEAT_CLASS[s])} />
            {HEAT_STEP_LABEL[s]}
            {s === "below" || s === "weak" ? " (a need)" : ""}
          </li>
        ))}
      </ul>
    </DisclosureCard>
  );
}
