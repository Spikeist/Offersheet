/**
 * Best trade partners for the user's team (CLAUDE.md §7, §14 item 3): teams whose trade chips would
 * start for the user while the user's trade chips would start for them; then one-sided fits, badged by
 * what was measured ("Would start for you"), not by the user's needs. Each side lists its first few
 * chips by what they'd add per week, and says how many more there are (hover lists them; screen
 * readers hear them).
 */
import Link from "next/link";
import type { LeagueView, PartnerSide } from "@/lib/leagueView";
import { Badge, Card, CardTitle } from "../ui";

function PlayerList({ label, side }: { label: string; side: PartnerSide }) {
  return (
    <p className="mt-1.5 text-sm leading-relaxed">
      <span className="font-semibold text-muted">{label}</span>{" "}
      {side.players.map((p, i) => (
        <span key={p.id} title={p.title}>
          {i ? ", " : ""}
          {p.text}
        </span>
      ))}
      {side.more ? (
        <span title={side.more.title} className="text-muted">
          {" "}
          <span aria-hidden>{side.more.text}</span>
          <span className="sr-only">{side.more.srText}</span>
        </span>
      ) : null}
    </p>
  );
}

export function TradePartners({ view }: { view: LeagueView }) {
  const { cards, empty } = view.partners;
  return (
    <Card>
      <CardTitle eyebrow="Trade partners">Best fits for your team</CardTitle>
      {empty ? (
        <p className="text-sm text-muted">
          {empty}
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
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <li key={c.teamId} className="rounded-xl border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  {/* min-w-0 + wrap-anywhere: a long one-word team name wraps instead of widening the card past a phone's edge. */}
                  <h3 className="min-w-0 font-extrabold wrap-anywhere">{c.name}</h3>
                  <Badge tone="brand" className="shrink-0">
                    {c.fitText}
                  </Badge>
                </div>
                <PlayerList label="They could give:" side={c.theyCanGive} />
                {c.youCanGive.players.length ? (
                  <PlayerList label="You could give:" side={c.youCanGive} />
                ) : (
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">
                    <span className="font-semibold">You could give:</span> no trade chip that would start for them, so a trade would likely cost you a starter.
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Points per week are what each trade chip would add to the other team&apos;s starting lineup, after that team&apos;s best free-agent move. Fit combines both
            directions; teams with a trade chip who would start for you, when none of yours would start for them, come last. Trade ideas with acceptance odds come in a
            later update.
          </p>
        </>
      )}
    </Card>
  );
}
