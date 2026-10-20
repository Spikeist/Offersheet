/**
 * Standings and playoff odds (CLAUDE.md §8, §14 item 3; §17 Checkpoint 3: "next to the current
 * standings"): every team in today's standings order by the league's rules, with its record and
 * points for, then its chance to make the playoffs, get a first-round bye (only when the league has
 * byes) and win the title, and its projected final record under today's (the average over the
 * simulated seasons). The notes under it say how the odds were made (seasons simulated, the league's
 * tiebreaker, a week in progress). Every word and number comes from buildLeagueView().
 *
 * 375 px: a table apart from the team table (which is ranked by projected points and carries the
 * chips), so nothing scrolls sideways on a phone: points for is hidden there, the projected final
 * record sits under today's record (like ROS points' regular / playoffs split), and team names wrap,
 * anywhere if they must (wrap-anywhere: overflow-wrap anywhere, unlike break-words, lets a long one-word
 * name shrink the column's minimum width, so it can't push the Title column off-screen). A points-only
 * league is ranked by points for, so there they show on phones and the record, which decides nothing,
 * only on wider screens. With fewer than 2 playoff teams there's no Playoffs column (the title goes to
 * the top of the standings). Symbolic odds ("<1%", ">99%", a title's "<0.1%" and ">99.9%", "—") are spelled out for
 * screen readers, and an eliminated team says so in words ("Out"), never by color alone.
 *
 * Phase 4c (planner reply to Checkpoint 4b, change 9, "one baseline everywhere"): my odds lead the card ("Your odds: 59%
 * playoffs · 9.9% title", every team after its free-agent pickups, what trade ideas start from, printed as they print
 * them), with the same as rosters stand as a smaller second line and one line saying what the odds count, above the
 * table; they wrap at 375 px, between parts only (each part kept whole: final review of Checkpoint 7c, ui-UI-7C-2, since
 * the top-3 part broke "30% top | 3" and "12.0% | title" from 320 to 390 px). The Title column prints with one decimal
 * too ("9.9%", leagueView.ts titleCell), so my row reads like the headline above it; two more characters a cell, inside
 * the table's own scroller. Checkpoint 7c (planner reply to Checkpoint 7b, §6): under "Several prizes" paying 2nd or 3rd
 * place both lines carry my chance of a top-3 (top-2) finish between the playoffs and the title ("Your odds: 60% playoffs ·
 * 30% top 3 · 10.5% title"; leagueView.ts myOddsOf), laid out like the other parts; the table keeps its columns.
 * Checkpoint 7h (planner reply to Checkpoint 7g, §1: "cut each long explanation paragraph to one line"): what the odds count
 * and how they were made (StandingsView.basis and notes) are one line above the table (ODDS_LINE) with the rest behind "Why?"
 * (WhyNote.tsx); a model without the basis shows its first note as the line.
 */
import { Fragment } from "react";
import { AS_ROSTERS_STAND_LABEL, ODDS_LINE, YOUR_ODDS_LABEL, type LeagueView, type OddsCell, type OddsPart } from "@/lib/leagueView";
import { Badge, Card, CardTitle, cx } from "../ui";
import { WhyNote } from "./WhyNote";

/** Wide screens only (sm and up): hidden on phones. */
const WIDE_ONLY = "hidden sm:table-cell";

/** A probability as printed; a symbolic one ("<1%", ">99%", "—") is read out in words. */
export function OddsText({ cell }: { cell: OddsCell }) {
  if (!cell.srText) return <>{cell.text}</>;
  return (
    <>
      <span aria-hidden>{cell.text}</span>
      <span className="sr-only">{cell.srText}</span>
    </>
  );
}

const oddsCellClass = "py-2.5 pr-2 text-right align-top tabular-nums sm:pr-3";

/** Between two parts: a no-break space keeps the dot with the part before it (TradeCard.tsx's SEP). */
const SEP = `${String.fromCharCode(0xa0)}· `;

/**
 * "59% playoffs · <1% title": my odds' parts, a symbolic one read out in words, each kept on one line (the line wraps between
 * parts, after the dot, never inside "30% top 3": final review of Checkpoint 7c, ui-UI-7C-2, as the cards' odds do).
 */
function OddsParts({ parts }: { parts: readonly OddsPart[] }) {
  return parts.map((p, i) => (
    <Fragment key={p.text}>
      {i ? SEP : null}
      <span className="whitespace-nowrap">
        {p.srText ? (
          <>
            <span aria-hidden>{p.text}</span>
            <span className="sr-only">{p.srText}</span>
          </>
        ) : (
          p.text
        )}
      </span>
    </Fragment>
  ));
}

/** My odds above the table: the headline (with every team's pickups) and, smaller, the same as rosters stand. */
function MyOddsLines({ mine }: { mine: NonNullable<NonNullable<LeagueView["standings"]>["mine"]> }) {
  return (
    <div className="mb-2">
      <p className="text-base font-extrabold tabular-nums">
        {YOUR_ODDS_LABEL}: <OddsParts parts={mine.headline} />
      </p>
      {mine.asRostersStand ? (
        <p className="text-sm text-muted tabular-nums">
          {AS_ROSTERS_STAND_LABEL}: <OddsParts parts={mine.asRostersStand} />
        </p>
      ) : null}
    </div>
  );
}

export function StandingsOdds({ view }: { view: LeagueView }) {
  const s = view.standings;
  if (!s) return null;
  // One line, the rest behind "Why?" (Checkpoint 7h): what the odds count and how they were made.
  const why = s.basis ? { line: ODDS_LINE, more: [s.basis], notes: s.notes } : s.notes.length ? { line: s.notes[0] ?? "", more: [], notes: s.notes.slice(1) } : null;
  return (
    <Card>
      <CardTitle eyebrow="Standings">Playoff odds</CardTitle>
      {s.empty ? (
        <p className="text-sm text-muted">{s.empty}</p>
      ) : (
        <>
          {s.mine ? <MyOddsLines mine={s.mine} /> : null}
          {why && (why.more.length || why.notes.length) ? (
            <WhyNote line={why.line} topic="what the odds count" className="mb-2">
              {why.more.map((m) => (
                <p key={m}>{m}</p>
              ))}
              {why.notes.length ? (
                <ul className="space-y-1" aria-label="How the odds were made">
                  {why.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </WhyNote>
          ) : why ? (
            <p className="mb-2 text-xs text-muted">{why.line}</p>
          ) : null}
          {/* relative: keeps the cells' screen-reader text inside this scroller, not widening the page. */}
          <div className="relative -mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[18rem] text-sm">
              <caption className="sr-only">{s.caption}</caption>
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th scope="col" className="py-2 pr-2 pl-4 align-bottom font-bold sm:pl-0">
                    #
                  </th>
                  <th scope="col" className="py-2 pr-2 align-bottom font-bold">
                    Team
                  </th>
                  <th scope="col" className={cx("py-2 pr-2 text-right align-bottom font-bold sm:pr-3", s.pointsOnly && WIDE_ONLY)}>
                    Record
                    {s.pointsOnly ? null : (
                      <abbr title="Projected final regular-season record, on average over the simulated seasons" className="block font-normal whitespace-nowrap">
                        proj. final
                      </abbr>
                    )}
                  </th>
                  <th scope="col" className={cx("py-2 pr-2 text-right align-bottom font-bold sm:pr-3", !s.pointsOnly && WIDE_ONLY)}>
                    <abbr title="Points for, so far">PF</abbr>
                  </th>
                  {s.showPlayoffs ? (
                    <th scope="col" className="py-2 pr-2 text-right align-bottom font-bold sm:pr-3">
                      <abbr title="Chance to make the playoffs">Playoffs</abbr>
                    </th>
                  ) : null}
                  {s.showBye ? (
                    <th scope="col" className="py-2 pr-2 text-right align-bottom font-bold sm:pr-3">
                      <abbr title="Chance of a first-round playoff bye">Bye</abbr>
                    </th>
                  ) : null}
                  <th scope="col" className="py-2 pr-4 text-right align-bottom font-bold sm:pr-0">
                    <abbr title="Chance to win the title">Title</abbr>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {s.rows.map((r) => (
                  <tr key={r.teamId} className={r.isMine ? "bg-brand-soft" : undefined}>
                    <td className="py-2.5 pr-2 pl-4 align-top font-bold text-muted tabular-nums sm:pl-0">{r.rank}</td>
                    <th scope="row" className="py-2.5 pr-2 text-left align-top font-normal">
                      <span className="block font-bold wrap-anywhere">
                        {r.name}
                        {r.isMine ? (
                          <>
                            {" "}
                            <Badge tone="brand">You</Badge>
                          </>
                        ) : null}
                        {r.eliminated ? (
                          <>
                            {" "}
                            <span title="Out of the title race">
                              <Badge tone="muted">
                                <span aria-hidden>Out</span>
                                <span className="sr-only">out of the title race</span>
                              </Badge>
                            </span>
                          </>
                        ) : null}
                      </span>
                    </th>
                    <td className={cx("py-2.5 pr-2 text-right align-top whitespace-nowrap tabular-nums sm:pr-3", s.pointsOnly && WIDE_ONLY)}>
                      <span className="block font-semibold">{r.record}</span>
                      {r.finalRecord ? (
                        <span className="block text-xs text-muted">
                          <span className="sr-only">projected final record </span>
                          {r.finalRecord}
                        </span>
                      ) : null}
                    </td>
                    {/* Points-only: points for rank the teams, so they show on phones too, like the record elsewhere. */}
                    <td className={cx("py-2.5 pr-2 text-right align-top tabular-nums sm:pr-3", s.pointsOnly ? "font-semibold" : WIDE_ONLY)}>{r.pointsFor}</td>
                    {r.playoffs ? (
                      <td className={cx(oddsCellClass, "font-extrabold")}>
                        <OddsText cell={r.playoffs} />
                      </td>
                    ) : null}
                    {r.bye ? (
                      <td className={oddsCellClass}>
                        <OddsText cell={r.bye} />
                      </td>
                    ) : null}
                    {/* Without a Playoffs column, the title odds are the headline number. */}
                    <td className={cx("py-2.5 pr-4 text-right align-top tabular-nums sm:pr-0", !s.showPlayoffs && "font-extrabold")}>
                      <OddsText cell={r.title} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
