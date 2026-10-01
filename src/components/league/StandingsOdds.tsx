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
 * the top of the standings). Symbolic odds ("<1%", ">99%", "—") are spelled out for screen readers, and
 * an eliminated team says so in words ("Out"), never by color alone.
 */
import type { LeagueView, OddsCell } from "@/lib/leagueView";
import { Badge, Card, CardTitle, cx } from "../ui";

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

export function StandingsOdds({ view }: { view: LeagueView }) {
  const s = view.standings;
  if (!s) return null;
  return (
    <Card>
      <CardTitle eyebrow="Standings">Playoff odds</CardTitle>
      {s.empty ? (
        <p className="text-sm text-muted">{s.empty}</p>
      ) : (
        <>
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
          {s.notes.length ? (
            <ul className="mt-3 space-y-1 text-xs text-muted" aria-label="How the odds were made">
              {s.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </Card>
  );
}
