/**
 * How to read a trade card, in words (§10, §11, §13), on both trade pages: the Trade Finder's ideas and the Trade
 * Analyzer's evaluated trade (review of the planner addendum to Checkpoint 3: the Analyzer showed "Harder to get" and
 * "How to offer it" with nothing on the page saying what they mean, and a card whose message proposed a smaller trade
 * than the one built, without saying why).
 * - Helps you, per league type: in a redraft league it also counts trade value, by the "Protect my trade value"
 *   setting (planner addendum, §3); in dynasty and keeper leagues, long-term value by the Win now ↔ Future setting.
 * - Chance they accept, Overall, "Harder to get" (§2) and "How to offer it" (§4), then ROS points and trade values.
 * The Analyzer's version says what differs there: nothing is ranked or left out (a trade the Finder leaves out shows
 * there with its warning), and the trade built can itself give a player to spare along with someone else (lead
 * decision N4, case 1): the first offer leaves him out, the message proposes that offer, and the card's numbers stay
 * those of the trade built (TradeSteps.ranked "full").
 * Planner reply to Checkpoint 4: "If they say no, try:" (change 6; the Finder's cards only: the Analyzer gives none;
 * since the review of track F, a trade likelier to go through than the card, by the steps' own bar), the injury tags
 * (a week shows when the projection counts on it) and what a tagged player's projection assumes (change 6), and that a
 * player worth less than the best free agent counts at that free agent's value in the trade values, as does an open
 * roster spot (change 4).
 * Review of Phase 4b: "Chance they accept" names what moves it, the trade's effect on their starting lineup included
 * (change 2 doubled its weight in redraft and keeper leagues), and its cap (config.acceptance.pAcceptClamp: "never above
 * 85%"); "If they say no, try" has its own message, and opens in the Analyzer as one offer (no smaller first offer, the
 * Analyzer's "How to offer it" says so).
 * A native <details>, closed at first; its summary is a 44 px target.
 */
import { config } from "@/engine/config";
import type { LeagueSettings } from "@/engine/model";
import { HARDER_TO_GET_TAG, harderToGetWho } from "@/lib/tradeView";

export type HowToReadPage = "finder" | "analyzer";

/** Plan B's least Helps you, as a share of the card's (config.search.planB.minHelpsShare): "half as much", "60% as much". */
export function planBShareWords(share: number = config.search.planB.minHelpsShare): string {
  return share === 0.5 ? "half as much" : `${Math.round(share * 100)}% as much`;
}

/**
 * How much likelier a Plan B is to go through than its card (planB.ts: config.search.steps.minAcceptGain, the steps' own
 * bar): "5 percentage points" (never bare "points", which would read as fantasy points).
 */
export function planBGainWords(gain: number = config.search.steps.minAcceptGain): string {
  const n = Math.round(gain * 100);
  return `${n} percentage ${n === 1 ? "point" : "points"}`;
}

/** The most an estimate shows (config.acceptance.pAcceptClamp's top, rounded as estimates are shown): "85%". */
export function acceptCapWords(cap: number = config.acceptance.pAcceptClamp[1]): string {
  return `${Math.round(cap * 100)}%`;
}

export const HOW_TO_READ_TITLE: Record<HowToReadPage, string> = {
  finder: "How to read a trade idea",
  analyzer: "How to read the evaluation",
};

export function HowToRead({ leagueType = "redraft", page = "finder" }: { leagueType?: LeagueSettings["leagueType"] | undefined; page?: HowToReadPage | undefined }) {
  const later = leagueType === "redraft" ? null : leagueType === "keeper" ? "keeper" : "dynasty";
  const analyzer = page === "analyzer";
  return (
    <details className="rounded-2xl border border-line bg-surface shadow-sm">
      <summary className="flex min-h-11 items-center px-4 font-extrabold sm:px-5">{HOW_TO_READ_TITLE[page]}</summary>
      <div className="space-y-2 border-t border-line px-4 py-3 text-sm leading-relaxed sm:px-5">
        <p>
          <span className="font-bold">Helps you</span> (0–100) is how much the trade raises your chances this season: Offer Sheet plays out the rest of your season
          thousands of times with and without it, counting your playoff odds and, more, your title odds.
          {later
            ? ` In a ${later} league it also counts the change in your roster's long-term value, weighed by your Win now ↔ Future setting in Settings.${later === "keeper" ? " What it costs to keep a player next season isn't counted yet." : ""}`
            : " It also counts trade value, so you keep some for later deals: giving up more than you get lowers it, getting more raises it. How much depends on your “Protect my trade value” setting in Settings."}
        </p>
        <p>
          <span className="font-bold">Chance they accept</span> is an estimate (Est.), rounded to 5% and never above {acceptCapWords()}: it looks at the trade from
          the other manager&apos;s side (trade value, what it adds to or costs their starting lineup, the holes it fills, how active a trader they are). It&apos;s
          a guess, not a promise.
        </p>
        <p>
          <span className="font-bold">Overall</span> combines the two: how much it helps, discounted by the chance it happens.{" "}
          {analyzer ? "The Trade Finder ranks its trade ideas by it." : "Ideas are sorted by it unless you choose otherwise."}
        </p>
        <p>
          <span className="font-bold">{HARDER_TO_GET_TAG}</span> marks a player you&apos;d get who is {harderToGetWho("their")}: managers want a little extra for
          players like that, and the chance they accept counts it.
        </p>
        {analyzer ? (
          <p>
            <span className="font-bold">How to offer it</span> shows when the trade is worth offering in two steps: offer the first version, and if they say no,
            add the player named, one you can spare (losing him costs your lineup little), which raises the chance they accept. If the trade you built gives a
            player you can spare along with someone else, the first version leaves him out, and adding him back gives the trade you built. The message to send
            them proposes the first version; the three numbers are for the trade you built. A trade opened from a trade idea&apos;s &ldquo;If they say no,
            try&rdquo; is shown as one offer instead: they&apos;ve just turned down a trade with the same team.
          </p>
        ) : (
          <>
            <p>
              <span className="font-bold">How to offer it</span> shows on some ideas: offer the first version, and if they say no, add the player named, one you can
              spare (losing him costs your lineup little), which raises the chance they accept. The message to send them proposes the first version.
            </p>
            <p>
              <span className="font-bold">If they say no, try</span> shows on other ideas when the same team has a trade they&apos;re likelier to accept: at least{" "}
              {planBGainWords()} likelier to go through, while still helping you at least {planBShareWords()}. It&apos;s the best such trade, a different package for the
              same players of theirs when there is one, else a different set of their players, with its own three numbers, its own message to send them, and a link
              to open it in the Trade Analyzer, where it&apos;s shown as one offer.
            </p>
          </>
        )}
        <p>
          <span className="font-bold">Injury tags</span> show under any player in the trade who isn&apos;t healthy, on either side: for example &ldquo;Questionable&rdquo; or
          &ldquo;Out — expected back week 8&rdquo;. The week shows when his projection counts on it, so a questionable player whose league site doesn&apos;t expect him
          back for weeks shows that week too. A player you&apos;d get who is hurt is projected to return at full strength, blended with the trade market, which prices his
          injury in.
        </p>
        <p>
          ROS points are each player&apos;s projected points for the rest of the season. Trade values are FantasyCalc&apos;s, except that a player worth less than the
          best free agent counts at that free agent&apos;s value (he could be replaced from the waiver wire), and so does each open roster spot on the side that gets
          fewer players (an IR slot doesn&apos;t count as a roster spot).{" "}
          {analyzer
            ? "The Trade Finder leaves out trades that wouldn't help you, or where you'd give up much more trade value than you get; here they still show, with a warning."
            : "Trades that wouldn't help you, or where you'd give up much more trade value than you get, are left out."}
        </p>
      </div>
    </details>
  );
}
