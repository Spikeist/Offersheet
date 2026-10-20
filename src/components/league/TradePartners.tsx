"use client";
/**
 * Best trade partners for the user's team (CLAUDE.md §7, §14 item 3): teams whose trade chips would
 * start for the user while the user's trade chips would start for them; then one-sided fits, badged by
 * what was measured ("Would start for you"), not by the user's needs. Each card leads with who to aim for
 * (planner addendum to Checkpoint 3, §2; lead decision N12; planner reply to Checkpoint 4, change 6): "Best of their
 * trade chips: <their best trade chip without the Harder to get tag, when he adds at least config.needs.bestTargetMin a
 * week>, +3.1/wk", and "Bigger upgrade, harder to get: <him>, +7.5/wk" when the single best one is tagged (alone, as
 * "Best of their trade chips, harder to get", when no untagged one adds that much); the note under the cards says so
 * (BEST_TARGET_NOTE). Then each side lists its other chips by what they'd add per week, and says how many more there are
 * (hover lists them; screen readers hear them), their tagged players marked "Harder to get" in words. Each
 * card ends with "See trade ideas with <team> →" (change 6; Phase 4 wave 2 decision M13): the Trade Finder with that
 * team picked, where the trade search turns the fit into ranked trade ideas. The link is a 44 px target that wraps a long
 * team name at 375 px; its arrow is hidden from screen readers. It carries the team's id in its address, so it's never
 * prefetched: the server sees that address only when the user opens it.
 * Checkpoint 7h (planner reply to Checkpoint 7g, §1): the paragraph under the cards is one line (PARTNERS_LINE), the rest behind
 * "Why?" (WhyNote.tsx). The lead's step 5 for the League page ("condense the trade-partner cards"): a card shows its team, its
 * fit, who to aim for (the lead lines) and its Trade Finder link; what else each side could give is behind one 44 px "More
 * players" disclosure (PARTNER_MORE_LABEL; aria-expanded, named for screen readers by the team), in the page while closed. ⚠️ Ours:
 * a card with no lead line (none of their trade chips reaches the floor) shows their trade chips as before, so it never reads as
 * a team and a fit alone; its disclosure holds mine.
 */
import Link from "next/link";
import { useId, useState } from "react";
import { BEST_TARGET_NOTE, PARTNER_MORE_LABEL, PARTNERS_LINE, type LeagueView, type PartnerCard, type PartnerSide, type PartnerTarget } from "@/lib/leagueView";
import { Badge, Card, CardTitle, buttonClass, cx } from "../ui";
import { HarderToGetBadge } from "./HarderToGetBadge";
import { WhyNote } from "./WhyNote";

function PlayerList({ side }: { side: PartnerSide }) {
  return (
    <p className="mt-1.5 text-sm leading-relaxed">
      <span className="font-semibold text-muted">{side.label}</span>{" "}
      {side.players.map((p, i) => (
        <span key={p.id} title={p.title}>
          {i ? ", " : ""}
          {p.text}
          {p.tag ? <HarderToGetBadge tag={p.tag} className="ml-1" /> : null}
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

/**
 * A lead line: "Best of their trade chips: C. Snoot, +2.1/wk" (the label says when he's harder to get). The name and the
 * number each stay on one line: at 375 px "J. Smith-Njigba" broke at its hyphen.
 */
function TargetLine({ target }: { target: PartnerTarget }) {
  return (
    <p className="mt-1.5 text-sm leading-relaxed" title={target.title}>
      <span className="font-semibold text-muted">{target.label}:</span>{" "}
      <span className="font-bold">
        <span className="whitespace-nowrap">{target.name},</span> <span className="whitespace-nowrap">{target.perWeek}</span>
      </span>
    </p>
  );
}

/**
 * What else each side of a fit could give, behind a 44 px disclosure (the file header, Checkpoint 7h): their other trade chips
 * (unless the card shows them, `theirsShown`: it has no lead line), then mine (or that none of mine would start for them).
 */
function MorePlayers({ card, theirsShown }: { card: PartnerCard; theirsShown: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="mt-1 flex min-h-11 items-center gap-1.5 text-left text-sm font-semibold text-muted">
        <span aria-hidden className={cx("inline-block text-xs transition-transform", open && "rotate-90")}>
          ▸
        </span>
        <span>
          {PARTNER_MORE_LABEL}
          <span className="sr-only">{` (${card.name})`}</span>
        </span>
      </button>
      <div id={id} hidden={!open}>
        {!theirsShown && card.theyCanGive.players.length ? <PlayerList side={card.theyCanGive} /> : null}
        {card.youCanGive.players.length ? (
          <PlayerList side={card.youCanGive} />
        ) : (
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            <span className="font-semibold">You could give:</span> no trade chip that would start for them, so a trade would likely cost you a starter.
          </p>
        )}
      </div>
    </>
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
                {c.targets.map((t) => (
                  <TargetLine key={t.id} target={t} />
                ))}
                {c.targets.length || !c.theyCanGive.players.length ? null : <PlayerList side={c.theyCanGive} />}
                <MorePlayers card={c} theirsShown={!c.targets.length} />
                <Link href={c.ideas.href} prefetch={false} className={cx(buttonClass("secondary", "sm"), "mt-2 h-auto min-h-11 py-2 text-left wrap-anywhere")}>
                  {c.ideas.text}
                  <span aria-hidden> →</span>
                </Link>
              </li>
            ))}
          </ul>
          <WhyNote line={PARTNERS_LINE} topic="trade partners" className="mt-2">
            <p>
              Points per week are what each trade chip would add to the other team&apos;s starting lineup, after that team&apos;s free-agent pickups. Fit combines both
              directions; teams with a trade chip who would start for you, when none of yours would start for them, come last. {BEST_TARGET_NOTE} &ldquo;See trade
              ideas&rdquo; opens the Trade Finder for that team: actual trades, ranked by how much they help you and how likely that team is to say yes, which can
              differ from the trade chips named here.
            </p>
          </WhyNote>
        </>
      )}
    </Card>
  );
}
