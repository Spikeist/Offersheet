/**
 * "Streaming picks this week" on the League page (CLAUDE.md §7 streaming positions, §14 item 3; planner
 * reply to Checkpoint 3, model change 1): the best free-agent kickers and D/STs for the current week by
 * this week's projection, each with his opponent ("vs ARI" at home, "@ DAL" away, said in words for screen
 * readers), then which positions I stream (with a link to change them in Settings), which other teams
 * stream, and how a streamed slot counts. Every word and number comes from buildLeagueView()
 * (LeagueView.streaming); this file only lays it out. At 375 px the two position tables stack and each
 * fits: a name that can't fit wraps, the opponent and the projection stay on one line. No trade values
 * here, so no FantasyCalc credit.
 * Checkpoint 7h (planner reply to Checkpoint 7g, §1: "cut each long explanation paragraph to one line"): after which positions I
 * stream, one line (STREAMING_LINE), with who else streams and how a streamed slot counts behind "Why?" (WhyNote.tsx).
 */
import Link from "next/link";
import { SETTINGS_HREF, STREAMING_LINE, type LeagueView, type StreamingGroup } from "@/lib/leagueView";
import { Card, CardTitle } from "../ui";
import { WhyNote } from "./WhyNote";

function PickTable({ group }: { group: StreamingGroup }) {
  return (
    <div>
      <h3 className="text-sm font-extrabold tracking-tight">{group.label}</h3>
      {group.picks.length ? (
        <table className="mt-1 w-full text-sm">
          <caption className="sr-only">{group.caption}</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="py-1.5 pr-2 font-bold">
                Player
              </th>
              <th scope="col" className="py-1.5 pr-2 font-bold">
                <abbr title="This week's opponent">Opp</abbr>
              </th>
              <th scope="col" className="py-1.5 text-right font-bold">
                <abbr title="Projected points this week">Proj</abbr>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {group.picks.map((p) => (
              <tr key={p.id}>
                <th scope="row" className="py-2 pr-2 text-left font-semibold wrap-anywhere">
                  {p.name} <span className="text-xs font-normal text-muted">{p.nflTeam}</span>
                </th>
                <td className="py-2 pr-2 whitespace-nowrap" title={p.opponentLong}>
                  <span aria-hidden>{p.opponent}</span>
                  <span className="sr-only">{p.opponentLong}</span>
                </td>
                <td className="py-2 text-right font-bold whitespace-nowrap tabular-nums">{p.projection}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-1 text-sm text-muted">None projected to play this week.</p>
      )}
    </div>
  );
}

export function StreamingPicks({ view }: { view: LeagueView }) {
  const s = view.streaming;
  if (!s) return null;
  return (
    <Card>
      <CardTitle eyebrow="Streaming">Streaming picks this week</CardTitle>
      {s.groups.length ? (
        <>
          <p className="-mt-1 mb-3 text-sm text-muted">The best free agents to start in week {s.week}, by this week&apos;s projection.</p>
          {/* relative: keeps the tables' screen-reader text inside the card, not widening the page. */}
          <div className="relative grid gap-4 sm:grid-cols-2">
            {s.groups.map((g) => (
              <PickTable key={g.pos} group={g} />
            ))}
          </div>
        </>
      ) : null}
      {s.empty ? <p className="mt-2 text-sm text-muted">{s.empty}</p> : null}
      <div className="mt-3 space-y-1 text-sm leading-relaxed">
        {s.mine ? (
          <p>
            {s.mine}{" "}
            <Link href={SETTINGS_HREF} className="inline-flex min-h-11 items-center font-semibold text-brand-strong underline underline-offset-2 dark:text-brand">
              Change it in Settings
            </Link>
          </p>
        ) : null}
      </div>
      <WhyNote line={STREAMING_LINE} topic="streaming">
        {/* wrap-anywhere: a long one-word team name wraps instead of widening the card past a phone's edge. */}
        <p className="wrap-anywhere">{s.others}</p>
        <p>{s.note}</p>
      </WhyNote>
    </Card>
  );
}
