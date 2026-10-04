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
 * (a week shows when the projection counts on it) and what a tagged player's projection assumes (change 6).
 * Review of Phase 4b: "Chance they accept" names what moves it, the trade's effect on their starting lineup included
 * (change 2 doubled its weight in redraft and keeper leagues), and its cap (config.acceptance.pAcceptClamp: "never above
 * 85%"); "If they say no, try" has its own message, and opens in the Analyzer as one offer (no smaller first offer, the
 * Analyzer's "How to offer it" says so).
 * Planner reply to Checkpoint 4b (Phase 4c): Helps you weighs the title and playoff odds by "What matters most" (change
 * 8), and the card shows those odds before and after, with the weeks whose win chance moves (change 9: weeklyLineWords,
 * from config.explain; "If they say no, try" shows its own odds too); an estimate under 5% shows "<5%" (answer 5); the
 * Finder's "Chance they accept: at least" and its default (change 10: config.ranking.minChanceDefault), judged on the
 * chance the trade goes through; the card's trade values are FantasyCalc's own (change 3), while the chance they
 * accept, Helps you and the Market check count roster spots, a throw-in worth no more than W, the best free agent no team is expected to pick up,
 * adding nothing (change 2), and the Analyzer's "Details" shows those figures; my side counts the free-agent moves a card says
 * the trade counts on too (final review of Phase 4c, finding R1: evaluate.ts freeAgentMovesOf), and the weekly line lists
 * the weeks it drops first (finding R8).
 * Review of track UIC (findings 2 and 3): what it says about values follows the league's data (src/lib/tradeView.ts
 * ValueFacts, the engine's own tests, from the model inputs the page holds): Helps you counts trade value in a redraft
 * league only while FantasyCalc's values are available (`valuesOn`: B has no market term in the curve fallback, and none
 * moves without values), and long-term value in a dynasty or keeper league only when it loaded (`longTermOn`: else B is
 * the odds alone, "counts this season only" as the cards' note says); a hurt player's projection is "blended with the
 * trade market" only while the blend is on (`blendOn`). Each defaults to on, so the page reads as before while the league's
 * data loads.
 * Planner reply to Checkpoint 4c (Phase 7a, A2): Helps you's scale, the same in every league and under every goal: 63 is
 * about as good as adding 3 points a week to your lineup for the rest of the season, unless a note says otherwise
 * (helpsScaleWords, from config).
 * A native <details>, closed at first; its summary is a 44 px target.
 */
import { config } from "@/engine/config";
import type { LeagueSettings } from "@/engine/model";
import { fmtNum } from "@/lib/format";
import { HARDER_TO_GET_TAG, harderToGetWho, minChanceLabel } from "@/lib/tradeView";

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

/**
 * The card's weekly line, in words from config.explain: "by 3 percentage points or more (up to 4 weeks, the drops first,
 * then the biggest gains)" (tradeView.weeklyLine's order since the final review of Phase 4c, finding R8).
 */
export function weeklyLineWords(min: number = config.explain.weeklyLineMin, max: number = config.explain.weeklyLineMax): string {
  const n = Math.round(min * 100);
  return `by ${n} percentage ${n === 1 ? "point" : "points"} or more (up to ${max} ${max === 1 ? "week" : "weeks"}, the drops first, then the biggest gains)`;
}

/**
 * The "Helps you" scale in words (planner reply to Checkpoint 4c, A2; benefit.ts's header, the three numbers): "In every
 * league and under every goal, 63 is about as good as adding 3 points a week to your lineup for the rest of the season (28
 * for 1 point a week, 86 for 6); when that doesn't hold for your team right now, a note on the page says so." A gain of g
 * points a week reads round(100 × (1 − e^(−g / helpsGain))) when B grows in proportion to the gain (B = B₃ at helpsGain,
 * config.benefit.helpsGain). Review of track SC, SC-1: not "under every setting": the scale departs when the odds barely
 * move (the floor) or a Win now ↔ Future setting past the largest default λ, and benefit.helpsScaleNotes says so then.
 */
export function helpsScaleWords(gain: number = config.benefit.helpsGain): string {
  const at = (g: number) => Math.round(100 * (1 - Math.exp(-g / gain)));
  const low = gain / 3;
  const high = gain * 2;
  return `In every league and under every goal, ${at(gain)} is about as good as adding ${fmtNum(gain, 1)} points a week to your lineup for the rest of the season (${at(low)} for ${fmtNum(low, 1)} ${fmtNum(low, 1) === "1" ? "point" : "points"} a week, ${at(high)} for ${fmtNum(high, 1)}); when that doesn't hold for your team right now, a note on the page says so.`;
}

export const HOW_TO_READ_TITLE: Record<HowToReadPage, string> = {
  finder: "How to read a trade idea",
  analyzer: "How to read the evaluation",
};

/** What Helps you counts besides the odds, by league type and what loaded (the header), as the paragraph's last sentences. */
function helpsValueWords(later: "keeper" | "dynasty" | null, valuesOn: boolean, longTermOn: boolean): string {
  if (later && longTermOn) {
    return ` In a ${later} league it also counts the change in your roster's long-term value, weighed by your Win now ↔ Future setting in Settings.${later === "keeper" ? " What it costs to keep a player next season isn't counted yet." : ""}`;
  }
  if (later) return ` In a ${later} league it would also count the change in your roster's long-term value, but long-term trade values aren't available right now, so it counts this season only.`;
  if (valuesOn) {
    return " It also counts trade value, so you keep some for later deals: giving up more than you get lowers it, getting more raises it. How much depends on your “Protect my trade value” setting in Settings.";
  }
  return " While FantasyCalc's trade values aren't available, it leaves trade value out.";
}

export function HowToRead({
  leagueType = "redraft",
  page = "finder",
  valuesOn = true,
  longTermOn = true,
  blendOn = true,
}: {
  leagueType?: LeagueSettings["leagueType"] | undefined;
  page?: HowToReadPage | undefined;
  /** FantasyCalc's own values are available (ValueFacts.valuesOn): Helps you counts trade value in a redraft league. */
  valuesOn?: boolean | undefined;
  /** Dynasty and keeper leagues: long-term values loaded (ValueFacts.longTermOn), so Helps you counts them. */
  longTermOn?: boolean | undefined;
  /** The market blend reaches anyone (ValueFacts.blendOn): a hurt player's projection is blended with the trade market. */
  blendOn?: boolean | undefined;
}) {
  const later = leagueType === "redraft" ? null : leagueType === "keeper" ? "keeper" : "dynasty";
  const analyzer = page === "analyzer";
  const step = `${Math.round(config.acceptance.displayStep * 100)}%`;
  // Whether Helps you counts a value besides the odds (trade value in redraft, long-term value in dynasty and keeper).
  const helpsCountsValue = later ? longTermOn : valuesOn;
  return (
    <details className="rounded-2xl border border-line bg-surface shadow-sm">
      <summary className="flex min-h-11 items-center px-4 font-extrabold sm:px-5">{HOW_TO_READ_TITLE[page]}</summary>
      <div className="space-y-2 border-t border-line px-4 py-3 text-sm leading-relaxed sm:px-5">
        <p>
          <span className="font-bold">Helps you</span> (0–100) is how much the trade raises your chances this season: Offer Sheet plays out the rest of your season
          thousands of times with and without it, and weighs your title and playoff odds by your &ldquo;What matters most&rdquo; setting in Settings (the title
          counts most unless you change it). Each card shows those odds before and after the trade, and the weeks whose chance to win your game moves{" "}
          {weeklyLineWords()}.{helpsValueWords(later, valuesOn, longTermOn)} {helpsScaleWords()}
        </p>
        <p>
          <span className="font-bold">Chance they accept</span> is an estimate (Est.), rounded to 5% (&ldquo;&lt;{step}&rdquo; when it&apos;s lower) and never above{" "}
          {acceptCapWords()}: it looks at the trade from the other manager&apos;s side (trade value, what it adds to or costs their starting lineup, the holes it
          fills, how active a trader they are). It&apos;s a guess, not a promise.
          {analyzer
            ? null
            : ` “Chance they accept: at least” hides ideas below the chance you pick (${minChanceLabel(config.ranking.minChanceDefault)} unless you change it), judged on the chance the trade goes through after a possible veto.`}
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
              same players of theirs when there is one, else a different set of their players, with its own three numbers and odds, its own message to send them, and a link
              to open it in the Trade Analyzer, where it&apos;s shown as one offer.
            </p>
          </>
        )}
        <p>
          <span className="font-bold">Injury tags</span> show under any player in the trade who isn&apos;t healthy, on either side: for example &ldquo;Questionable&rdquo; or
          &ldquo;Out — expected back week 8&rdquo;. The week shows when his projection counts on it, so a questionable player whose league site doesn&apos;t expect him
          back for weeks shows that week too. A player you&apos;d get who is hurt is projected to return at full strength
          {blendOn ? ", blended with the trade market, which prices his injury in" : ""}.
        </p>
        <p>
          ROS points are each player&apos;s projected points for the rest of the season. The trade values on the card are FantasyCalc&apos;s own, the numbers anyone can
          check on FantasyCalc. The chance they accept{helpsCountsValue ? ", Helps you" : ""} and the Market check count roster spots too: every player counts at least
          what the best free agent no team is expected to pick up is worth, an extra player in an uneven trade adds nothing when he&apos;s worth no more than that (the team getting him would cut
          someone like him), and the side getting fewer players is credited the roster spot it opens (an IR slot isn&apos;t one). Your side
          also counts the free-agent moves a card says the trade counts on: a player you&apos;d cut for them counts as if you traded him.{" "}
          {analyzer
            ? "“Details” shows those figures. The Trade Finder leaves out trades that wouldn't help you, or where, counting roster spots, you'd give up much more trade value than you get; here they still show, with a warning."
            : "Trades that wouldn't help you, or where, counting roster spots, you'd give up much more trade value than you get, are left out."}
        </p>
      </div>
    </details>
  );
}
