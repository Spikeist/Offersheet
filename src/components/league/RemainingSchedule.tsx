/**
 * My remaining schedule (CLAUDE.md §8 "show each remaining week's risk"; planner reply to Checkpoint 2:
 * Parker's week 13 bye crunch should show): each remaining regular-season game of mine, with the
 * opponent, both teams' projected points (the numbers the season simulation draws around), my chance to
 * win (and to beat the league median, in median leagues), and my likely starters on bye. A risky week
 * says so in words, a "Risky week" badge and its reasons, never by color alone; screen readers hear
 * the whole sentence once. Every word and number comes from buildLeagueView().
 *
 * 375 px: five columns (six with the median game), the opponent's name, the risk and the bye list
 * wrapping inside the opponent cell, like the team table's chips, so nothing scrolls sideways. The name
 * wraps anywhere if it must (wrap-anywhere: unlike break-words, it lets a long one-word team name shrink
 * the column's minimum width). A bye week's Win cell is read as "no game", not "unknown".
 */
import Link from "next/link";
import type { LeagueView } from "@/lib/leagueView";
import { Badge, Card, CardTitle, cx } from "../ui";
import { OddsText } from "./StandingsOdds";

export function RemainingSchedule({ view }: { view: LeagueView }) {
  const s = view.schedule;
  if (!s) return null;
  return (
    <Card>
      <CardTitle eyebrow="Schedule">Your remaining games</CardTitle>
      {s.empty ? (
        <p className="text-sm text-muted">
          {s.empty}
          {view.myTeam.id ? null : (
            <>
              {" "}
              <Link href="/import#your-team" className="font-semibold text-brand-strong underline underline-offset-2 dark:text-brand">
                Pick your team
              </Link>
            </>
          )}
        </p>
      ) : (
        <>
          {/* relative: keeps the cells' screen-reader text inside this scroller, not widening the page. */}
          <div className="relative -mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[18rem] text-sm">
              <caption className="sr-only">{s.caption}</caption>
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th scope="col" className="py-2 pr-2 pl-4 font-bold sm:pl-0">
                    <abbr title="NFL week">Wk</abbr>
                  </th>
                  <th scope="col" className="py-2 pr-2 font-bold">
                    Opponent
                  </th>
                  <th scope="col" className="py-2 pr-2 text-right font-bold sm:pr-3">
                    <abbr title="Your projected points">You</abbr>
                  </th>
                  <th scope="col" className="py-2 pr-2 text-right font-bold sm:pr-3">
                    <abbr title="Their projected points">Them</abbr>
                  </th>
                  <th scope="col" className={cx("py-2 text-right font-bold", s.showMedian ? "pr-2 sm:pr-3" : "pr-4 sm:pr-0")}>
                    <abbr title="Your chance to win the game">Win</abbr>
                  </th>
                  {s.showMedian ? (
                    <th scope="col" className="py-2 pr-4 text-right font-bold sm:pr-0">
                      <abbr title="Your chance of a top-half score that week (the median game)">Median</abbr>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {s.rows.map((r) => (
                  <tr key={r.week}>
                    <th scope="row" className="py-2.5 pr-2 pl-4 text-left align-top font-bold whitespace-nowrap tabular-nums sm:pl-0">
                      <span aria-hidden>{r.weekText}</span>
                      <span className="sr-only">{r.weekLabel}</span>
                    </th>
                    <td className="py-2.5 pr-2 align-top">
                      <span className="block font-bold wrap-anywhere">{r.opponent}</span>
                      {r.risk ? (
                        <span title={r.risk.text} className="mt-1 block text-xs">
                          <span aria-hidden className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                            <Badge tone="warn">{r.risk.label}</Badge>
                            <span className="font-semibold text-warn-fg">{r.risk.reasons}</span>
                          </span>
                          <span className="sr-only">{r.risk.text}</span>
                        </span>
                      ) : null}
                      {r.byes ? (
                        <span title={r.byes.title} className="mt-1 block text-xs break-words text-muted">
                          On bye: {r.byes.text}
                        </span>
                      ) : null}
                      {r.underWay ? <span className="mt-1 block text-xs text-muted italic">{r.underWay}</span> : null}
                    </td>
                    <td className="py-2.5 pr-2 text-right align-top font-semibold tabular-nums sm:pr-3">{r.mine}</td>
                    <td className="py-2.5 pr-2 text-right align-top tabular-nums sm:pr-3">
                      {r.theirs ?? (
                        <span className="text-muted">
                          <span aria-hidden>—</span>
                          <span className="sr-only">no opponent</span>
                        </span>
                      )}
                    </td>
                    <td className={cx("py-2.5 text-right align-top font-extrabold tabular-nums", s.showMedian ? "pr-2 sm:pr-3" : "pr-4 sm:pr-0")}>
                      <OddsText cell={r.win} />
                    </td>
                    {r.median ? (
                      <td className="py-2.5 pr-4 text-right align-top tabular-nums sm:pr-0">
                        <OddsText cell={r.median} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">{s.note}</p>
        </>
      )}
    </Card>
  );
}
