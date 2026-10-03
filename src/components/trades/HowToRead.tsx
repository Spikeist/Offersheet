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
 * A native <details>, closed at first; its summary is a 44 px target.
 */
import type { LeagueSettings } from "@/engine/model";
import { HARDER_TO_GET_TAG, harderToGetWho } from "@/lib/tradeView";

export type HowToReadPage = "finder" | "analyzer";

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
          <span className="font-bold">Chance they accept</span> is an estimate (Est.), rounded to 5%: it looks at the trade from the other manager&apos;s side (trade
          value, holes in their lineup, how active a trader they are). It&apos;s a guess, not a promise.
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
            them proposes the first version; the three numbers are for the trade you built.
          </p>
        ) : (
          <p>
            <span className="font-bold">How to offer it</span> shows on some ideas: offer the first version, and if they say no, add the player named, one you can
            spare (losing him costs your lineup little), which raises the chance they accept. The message to send them proposes the first version.
          </p>
        )}
        <p>
          ROS points are each player&apos;s projected points for the rest of the season. Trade values are FantasyCalc&apos;s.{" "}
          {analyzer
            ? "The Trade Finder leaves out trades that wouldn't help you, or where you'd give up much more trade value than you get; here they still show, with a warning."
            : "Trades that wouldn't help you, or where you'd give up much more trade value than you get, are left out."}
        </p>
      </div>
    </details>
  );
}
