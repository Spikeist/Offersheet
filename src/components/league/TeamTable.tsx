/**
 * The League page's team table (CLAUDE.md §14 item 3): teams ranked by projected points per week,
 * with record, points for, rest-of-season points, and need and trade-chip chips (§7; the "Surplus"
 * chips became "Trade chips" at Checkpoint 2). On phones the chips sit under the team name (a long
 * chip wraps inside itself) and PF / ROS pts are hidden, so nothing scrolls sideways at 375 px. Team
 * names and chips (which name a team) wrap anywhere if they must (wrap-anywhere: unlike break-words, it
 * lets a long one-word team name shrink the column's minimum width). The note under it says which weeks
 * the numbers count (from the next week while one is in progress).
 */
import type { Chip, LeagueView } from "@/lib/leagueView";
import { Badge, Card, CardTitle, cx } from "../ui";
import { ValuesCredit } from "./ValuesCredit";

const CHIP_CLASS: Record<Chip["kind"], string> = {
  "need-ros": "border border-warn-line bg-warn-bg text-warn-fg",
  "need-next": "border border-dashed border-warn-line text-warn-fg",
  chip: "border border-transparent bg-brand-soft text-brand-strong dark:text-brand",
};

/** One chip: short visible text, the full detail on hover and for screen readers. */
export function ChipTag({ chip }: { chip: Chip }) {
  return (
    <span title={chip.title} className={cx("inline-block max-w-full rounded-full px-2 py-0.5 text-xs font-bold wrap-anywhere", CHIP_CLASS[chip.kind])}>
      <span aria-hidden>{chip.text}</span>
      <span className="sr-only">{chip.title}</span>
    </span>
  );
}

function LegendItem({ kind, sample, text }: { kind: Chip["kind"]; sample: string; text: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cx("inline-flex items-center rounded-full px-2 py-0.5 font-bold whitespace-nowrap", CHIP_CLASS[kind])}>
        {sample}
      </span>
      {text}
    </li>
  );
}

function ChipLine({ label, chips }: { label: string; chips: Chip[] }) {
  if (!chips.length) return null;
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="mr-0.5 text-xs font-semibold text-muted">{label}</span>
      {chips.map((c) => (
        <ChipTag key={c.key} chip={c} />
      ))}
    </p>
  );
}

export function TeamTable({ view }: { view: LeagueView }) {
  const nextLabel = view.heatmap.windowLabel.next.toLowerCase();
  return (
    <Card>
      <CardTitle eyebrow="Teams">Projected strength</CardTitle>
      {/* relative: keeps the chips' screen-reader text inside this scroller, not widening the page. */}
      <div className="relative -mx-4 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-[18rem] text-sm">
          <caption className="sr-only">Teams ranked by projected points per week, with each team&apos;s needs and trade chips</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-2 pl-4 font-bold sm:pl-0">
                #
              </th>
              <th scope="col" className="py-2 pr-3 font-bold">
                Team
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-bold">
                Record
              </th>
              <th scope="col" className="hidden py-2 pr-3 text-right font-bold sm:table-cell">
                <abbr title="Points for, so far">PF</abbr>
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-bold sm:pr-3">
                <abbr title="Projected starting-lineup points per week">Proj/wk</abbr>
              </th>
              <th scope="col" className="hidden py-2 text-right font-bold sm:table-cell">
                <abbr title="Projected starting-lineup points over the rest of the season">ROS pts</abbr>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {view.teams.map((t) => (
              <tr key={t.id} className={t.isMine ? "bg-brand-soft" : undefined}>
                <td className="py-2.5 pr-2 pl-4 align-top font-bold text-muted tabular-nums sm:pl-0">{t.rank}</td>
                <th scope="row" className="py-2.5 pr-3 text-left align-top font-normal">
                  <span className="block font-bold wrap-anywhere">
                    {t.name} {t.isMine ? <Badge tone="brand">You</Badge> : null}
                  </span>
                  <ChipLine label="Needs" chips={t.needs} />
                  <ChipLine label="Trade chips" chips={t.chips} />
                </th>
                <td className="py-2.5 pr-3 text-right align-top font-semibold whitespace-nowrap tabular-nums">{t.record}</td>
                <td className="hidden py-2.5 pr-3 text-right align-top tabular-nums sm:table-cell">{t.pointsFor}</td>
                <td className="py-2.5 pr-4 text-right align-top font-extrabold tabular-nums sm:pr-3">{t.perWeekText}</td>
                <td className="hidden py-2.5 text-right align-top tabular-nums sm:table-cell">{t.rosText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Chip key">
        <LegendItem kind="need-ros" sample="RB2" text="need, rest of season" />
        <LegendItem kind="need-next" sample="RB2" text={`need, ${nextLabel} only`} />
        <LegendItem kind="chip" sample="J. Doe: +12" text={view.chipLegend} />
      </ul>
      <p className="mt-2 text-xs text-muted">
        {view.teamsNote} <ValuesCredit />
      </p>
    </Card>
  );
}
