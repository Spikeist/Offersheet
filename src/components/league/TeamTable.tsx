/**
 * The League page's team table (CLAUDE.md §14 item 3): teams ranked by projected points per week,
 * with record, points for, rest-of-season points, and need and trade-chip chips (§7; the "Surplus"
 * chips became "Trade chips" at Checkpoint 2; since Checkpoint 3 a trade chip also says what he costs
 * his team per week, with a visible "starter" tag when he starts for it). On phones the chips sit under
 * the team name (a long chip wraps inside itself) and PF / ROS pts are hidden, so nothing scrolls
 * sideways at 375 px. Team names and chips (which name a team) wrap anywhere if they must
 * (wrap-anywhere: unlike break-words, it lets a long one-word team name shrink the column's minimum
 * width). The note under it says which weeks the numbers count (from the next week while one is in
 * progress). Another team's trade chip his manager would want a little extra for also carries a gold "Harder to get"
 * tag (planner addendum to Checkpoint 3, §2), in words like "starter", and the key explains it when one shows.
 */
import { HARDER_TO_GET_TAG, STARTER_TAG, type Chip, type ChipTag as ChipTagView, type LeagueView } from "@/lib/leagueView";
import { Badge, Card, CardTitle, cx } from "../ui";
import { ValuesCredit } from "./ValuesCredit";

const CHIP_CLASS: Record<Chip["kind"], string> = {
  "need-ros": "border border-warn-line bg-warn-bg text-warn-fg",
  "need-next": "border border-dashed border-warn-line text-warn-fg",
  chip: "border border-transparent bg-brand-soft text-brand-strong dark:text-brand",
};

/** A chip's visible tags ("starter", "Harder to get"): small solid pills inside the chip, text rather than color alone. */
const TAG_BASE = "ml-1 inline-block rounded-full px-1.5 text-[0.65rem] leading-4 font-extrabold tracking-wide whitespace-nowrap uppercase";
const TAG_CLASS: Record<ChipTagView["kind"], string> = {
  starter: cx(TAG_BASE, "bg-brand text-brand-contrast"),
  harder: cx(TAG_BASE, "bg-accent text-navy"),
};

/** One chip: short visible text (and its tags), the full detail on hover and for screen readers (the title says each tag in words). */
export function ChipTag({ chip }: { chip: Chip }) {
  return (
    <span title={chip.title} className={cx("inline-block max-w-full rounded-full px-2 py-0.5 text-xs font-bold wrap-anywhere", CHIP_CLASS[chip.kind])}>
      <span aria-hidden>
        {chip.text}
        {chip.tags.map((t) => (
          <span key={t.kind} className={TAG_CLASS[t.kind]}>
            {t.text}
          </span>
        ))}
      </span>
      <span className="sr-only">{chip.title}</span>
    </span>
  );
}

function LegendItem({ kind, sample, tag, text }: { kind: Chip["kind"]; sample: string; tag?: ChipTagView; text: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cx("inline-flex items-center rounded-full px-2 py-0.5 font-bold whitespace-nowrap", CHIP_CLASS[kind])}>
        {sample}
        {tag ? <span className={TAG_CLASS[tag.kind]}>{tag.text}</span> : null}
      </span>
      {tag ? <span className="sr-only">{tag.text} tag: </span> : null}
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
  const harderShown = view.teams.some((t) => t.chips.some((c) => c.tags.some((g) => g.kind === "harder")));
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
        <LegendItem kind="chip" sample="J. Doe" tag={{ text: STARTER_TAG, kind: "starter" }} text="he starts for his own team" />
        {harderShown ? <LegendItem kind="chip" sample="J. Doe" tag={{ text: HARDER_TO_GET_TAG, kind: "harder" }} text="his manager will likely want a little extra for him" /> : null}
      </ul>
      <p className="mt-2 text-xs text-muted">
        {view.teamsNote} <ValuesCredit />
      </p>
    </Card>
  );
}
