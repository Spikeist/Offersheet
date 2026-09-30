/**
 * Best trade partners for the user's team (CLAUDE.md §7, §14 item 3): teams whose spare players
 * would start for the user while the user's spare players would start for them; then one-sided fits,
 * badged by what was measured ("Would start for you"), not by the user's needs.
 */
import Link from "next/link";
import type { LeagueView, PartnerPlayer } from "@/lib/leagueView";
import { Badge, Card, CardTitle } from "../ui";

function PlayerList({ label, players }: { label: string; players: PartnerPlayer[] }) {
  return (
    <p className="mt-1.5 text-sm leading-relaxed">
      <span className="font-semibold text-muted">{label}</span>{" "}
      {players.map((p, i) => (
        <span key={p.id} title={p.title}>
          {i ? ", " : ""}
          {p.text}
        </span>
      ))}
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
                  <h3 className="font-extrabold break-words">{c.name}</h3>
                  <Badge tone="brand" className="shrink-0">
                    {c.fitText}
                  </Badge>
                </div>
                <PlayerList label="They could give:" players={c.theyCanGive} />
                {c.youCanGive.length ? (
                  <PlayerList label="You could give:" players={c.youCanGive} />
                ) : (
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">
                    <span className="font-semibold">You could give:</span> no spare player they need, so a trade would likely cost you a starter.
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Points per week are what each player would add to the other team&apos;s starting lineup. Fit combines both directions; teams with a spare player who would start for
            you, but who need nothing you can spare, come last. Trade ideas with acceptance odds come in a later update.
          </p>
        </>
      )}
    </Card>
  );
}
