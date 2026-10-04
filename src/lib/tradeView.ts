/**
 * Trade Finder and Trade Analyzer view models (CLAUDE.md §10 "three numbers", §11 labels and "Est.", §13 "Each trade
 * card shows", §14 items 4–5; Phase 4 wave 2 decision M13). PURE functions from the engine's results and the
 * snapshot to plain-English words and numbers, so the pages only lay things out and every word is unit-tested.
 *
 * A trade card (buildTradeCard) says, in this order:
 * - who it's with, what I give and what I get (each player with position, NFL team and an injury tag in words);
 * - the three numbers: "Helps you" (the Trade Score, 0–100), "Chance they accept" (the estimate rounded to 5%,
 *   labeled "Est." and with its label: Long shot, Possible, Decent, Likely) and "Overall" (0–100). A trade that
 *   doesn't help me (B ≤ 0, only the Analyzer shows one) scores 0; one whose odds couldn't be simulated shows "—".
 *   When the league's review could veto it (the veto rule, §11), the chance it goes through is shown too;
 * - the risk flags, apart from the numbers (§10 guards): "Depends on an injured player" (with what his projection
 *   assumes: see the injury tags below), "Market check" (and, in the Analyzer, that a trade is normally hidden: it doesn't
 *   help me, saying what pulled it down (noHelpText), or the market check's hiding line);
 * - the numbers behind the score in words (§10 "always show"): my lineup's change per week (regular season and
 *   playoffs), my playoff and title odds in percentage points ("Playoff odds +4.1 percentage points (62% to 66%)":
 *   never "points", which would read as fantasy points next to the lineup's; the end percents only when my odds before
 *   any trade are known and the whole percent moves), long-term value in dynasty and
 *   keeper leagues, trade value given and received (the page puts "Values: FantasyCalc" beside it, §2.9; since the
 *   value floor on both sides, planner reply to Checkpoint 4, change 4, it says that a player worth less than the best
 *   free agent counts at that free agent's value, and so does an open roster spot: ⚠️ always, since the card can't
 *   tell which players the floor lifted; with an IR player in the trade, review of track E, that only my active roster's
 *   spots count, since an IR slot isn't one: valueBasisText), the partner's weekly lineup change, and "You get 142 ROS
 *   pts, give 118" (§13), with a line when my starting lineup moves the other way (review of Phase 4b: "You get 96 ROS
 *   pts, give 295" read like a lopsided loss on a trade that gives a backup QB who never starts): "Your starting lineup
 *   still gains 25 ROS pts: …" (rosNoteOf, from TradeDetail.weekly);
 * - the roster moves the trade forces (§7 roster legality: drops and adds for either side; Phase 4b's IR players: a
 *   received IR player who goes into an open IR slot, RosterChange.toIR, and a player dropped from the week an IR player
 *   comes back, RosterChange.displaced);
 * - the reasons and the pitch message (src/engine/explain.ts wrote them; shown as they are, except explain.ts's
 *   "Depends on an injured player" caveat, which the card's flag already says: INJURED_REASON).
 *
 * Planner reply to Checkpoint 4, change 6:
 * - Injury tags in words on every injury-tagged player on either side (TradeEvaluation.flags.tagged; when an evaluation
 *   lacks them, the Analyzer's, tags from the snapshot with the week now: explain.injuryTags): "Questionable", "Out —
 *   expected back week 8", "On IR — expected back week 8", "Out for the season", "Suspended", "Not an active NFL player"
 *   (injuryTagText). A return week is said whenever the tag carries one, and explain.injuryTags keeps it only when his
 *   projection counts on it (review of track F): OUT from next week on, IR, PUP and SUSPENDED after this week (an older
 *   date is stale), and a Probable, Questionable or Doubtful player's far ESPN date only when his projection follows it
 *   (§6 step 3's conflict), said as the platform's: "Questionable — ESPN expects him back week 8" (Josh Jacobs on
 *   Parker's league, out until then in his numbers, read just "Questionable"). The search's evaluations and the
 *   Analyzer's both carry tags that know which conflicted players follow their date (evaluate.ts withWords sets
 *   flags.tagged with explain.tagContextOf, the League model's word); only an evaluation without them (a core) reads the
 *   snapshot, where such a player reads just "Questionable". When a player I'd get is tagged with an injury status
 *   (Probable, Questionable, Doubtful, Out, IR or PUP; not Suspended or NA), the card says once why his numbers can still
 *   look good: "Josh Jacobs: his projection assumes he returns at full strength, blended with the trade market." ⚠️ The
 *   tag doesn't say whether the market blend reached him (a player without a real FantasyCalc value, or a K or D/ST when
 *   they're included, isn't blended), so the sentence is said for every such player. Review of Phase 4b: a player I'd
 *   get who is Out, on IR or on the PUP list was said four times (his tag, that sentence, the "Depends on an injured
 *   player" flag and explain.ts's caveat repeating the flag), so for him the sentence joins the flag ("Depends on an
 *   injured player: Jadarian Price (injured reserve). His projection assumes he returns at full strength, blended with
 *   the trade market.") and the caveat isn't repeated among the reasons: his tag and the flag say it. The sentence under
 *   the two lists stays for the other tagged players I'd get (Probable, Questionable, Doubtful), whom no flag names.
 * - "If they say no, try:" (TradeEvaluation.planB, the Trade Finder's cards without steps; since the review of track F a
 *   trade likelier to go through than the card): the other trade in words, each tagged player with his tag (the card's
 *   own for a player it shares with the card, else the search's tag for him on another idea, which knows his far date,
 *   else the snapshot's: ⚠️ PlanB carries no tags of its own), whether it's the same players of theirs or "A different
 *   set of their players", its three numbers (with the chance it goes through when a veto could cut it), "Also shown as
 *   trade idea 6." when the list shows it as a card of its own (its place in the sort shown), its own message to send
 *   them (planBPitch: a follow-up naming the trade from their side) and its own "Open in Analyzer" link, which says it
 *   comes from "If they say no, try:" (`from=planB`), so the Analyzer shows that trade as one offer, without "How to
 *   offer it" (review of Phase 4b: its first offer could be smaller than the trade they had just turned down, and its
 *   message proposed that smaller offer).
 * - Feedback versions (TradeCardView.versions): the versions the card shows, for "Which version did you send?" (the
 *   first offer and the full one with steps; this trade and Plan B's; this trade alone otherwise). The "Version:" line
 *   under the outcome buttons (versionLine) names the recorded version only when its key is one the card shows; a
 *   recorded version the card no longer shows (its Plan B or throw-in changed since, or the Analyzer's card for the same
 *   trade) reads "an earlier one" with its players, read from its key (CardFeedback.versionWords).
 *
 * The chance a version goes through when the league's review could veto it (throughText) is said when it prints
 * differently from the chance they accept, and as "under 5%" when both print as the display's floor while the veto cut
 * it below (review of Phase 4b: "5% … about 5% it goes through" next to a reason saying the veto halves the chance).
 *
 * Planner addendum to Checkpoint 3 (lead decisions N2, N8):
 * - "Harder to get" next to each player I'd get whose premium for his manager earns the tag (TradeDetail.premium:
 *   one of their two most valuable players who is also a top-12 one), in words with why on hover;
 * - "How to offer it" when the trade has steps (TradeEvaluation.steps, §4): "Offer first: Wiggleton Spoons for
 *   Cornelius Snoot · Est. 35%" and "If they say no, add Tobias Thimble · Est. 55%", each with its own estimate (the
 *   chance they accept, like the card's; with the chance it goes through when the league's review could veto that
 *   version). The card's numbers stay the ranked trade's (its give and get: the full trade, or the first offer).
 *   The pitch (explain.ts) proposes the first offer.
 * The evaluation's own notes (TradeDetail.notes: the week in progress on game days, keeper costs not modeled, …)
 * aren't repeated per card: the Finder lists every distinct one once with the search's notes (the week in progress
 * worded for the whole list: listNote), and the Analyzer shows its notes with its result, leaving out any its card's
 * reasons already say (explain.ts words some of them).
 *
 * My odds before any trade (baselineLines; review of Phase 4): the Finder says them above its ideas ("Your odds before
 * any trade: 71% to make the playoffs, 15% to win the title.") and the Analyzer above its card ("before this trade";
 * the worker sends them with the evaluation), each with what they count: every team after the free-agent pickups
 * that would help it, the baseline every trade's numbers are measured from (§7), so they can differ from the League
 * page's odds, which take rosters as they stand (lead decision L3). The cards' end percents start from the same odds.
 *
 * The Finder's empty state says why there's nothing: the search's notes when it stopped before screening anything
 * (no team, season over, deadline passed, no odds, must-include players that can't work: TradeSearchResult.counts.
 * screened 0), else what the guards left out ("No trade ideas that help you"), else that nothing was found. Notes
 * that didn't stop the search (the K/D/ST note almost always) stay in the notes list.
 *
 * Numbers print like the League page's (src/lib/format.ts): one decimal for points per week, whole percents and whole
 * values, a real minus sign. No jargon ("EV", "σ", "V*", "g_mkt" never appear).
 *
 * Also here: the Finder's list (buildFinderView: the cards in the chosen sort through rank.ts sortTrades, the hidden
 * counts, notes and warnings, the empty states), the search's progress in words (progressView), the Analyzer's
 * choices (analyzerChoices) and the links between the pages (finderHref, analyzerHref and what they carry back:
 * a team id and player ids only, never league ids or names; ⚠️ a URL query, as M13 says, so the server that serves the
 * page sees those ids like any address: the privacy page says so).
 */
import { displayAcceptance } from "@/engine/acceptance";
import { config } from "@/engine/config";
import type { TradeAnalysis } from "@/engine/evaluate";
import { injuryTags } from "@/engine/explain";
import { tradeActiveSpots } from "@/engine/irSlots";
import { POSITIONS, type InjuryStatus, type LeagueSnapshot, type PlayerInfo, type Pos } from "@/engine/model";
import { sortTrades } from "@/engine/rank";
import type { TradeSettings } from "@/engine/settings";
import type {
  InjuryTag,
  PlanB,
  PremiumFact,
  RosterChange,
  TradeAsset,
  TradeDetail,
  TradeEvaluation,
  TradeProposal,
  TradeSearchProgress,
  TradeSearchResult,
  TradeSearchStage,
  TradeSort,
  TradeStep,
} from "@/engine/tradeModel";
import { feedbackFor, type FeedbackOutcome, type FeedbackReason, type FeedbackRecord, type FeedbackSent, type FeedbackVersion } from "./feedbackStore";
import { fmtNum, fmtSigned, fmtWhole, plural } from "./format";
import { INJURY_LABEL, PLATFORM_LABEL, posLabel } from "./labels";

/** What the views read of the snapshot; currentWeek (the injury tags' week now) is optional so partial fixtures fit. */
export type SnapshotPart = Pick<LeagueSnapshot, "platform" | "teams" | "players" | "settings"> & Partial<Pick<LeagueSnapshot, "currentWeek">>;

export const FINDER_PATH = "/trades";
export const ANALYZER_PATH = "/analyzer";

/** The sort options (§13), Overall first (the default). */
export const SORT_OPTIONS: readonly { value: TradeSort; label: string }[] = [
  { value: "overall", label: "Overall" },
  { value: "helps", label: "Helps you" },
  { value: "accept", label: "Chance they accept" },
];

export function isTradeSort(x: unknown): x is TradeSort {
  return SORT_OPTIONS.some((o) => o.value === x);
}

// ---------------------------------------------------------------------------------------------
// Small words

const MINUS = "−";

/** A probability as a whole percent; "<1%" and ">99%" when it only rounds to 0 or 100. */
export function percentText(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p > 0 && p < 0.005) return "<1%";
  if (p < 1 && p > 0.995) return ">99%";
  return `${Math.round(p * 100)}%`;
}

/** An acceptance estimate as shown (§11: the nearest 5%). */
export function acceptText(p: number): string {
  return `${Math.round(displayAcceptance(p) * 100)}%`;
}

/**
 * The chance a version goes through when the league's review could veto it, next to the chance they accept (the file
 * header): "about 20%" when it prints differently; "under 5%" when both print as the display's floor (§11: an estimate is
 * never shown below displayStep) while the veto cut it below that floor; null when there's nothing more to say (it
 * prints the same and isn't below the floor: the reason that the league reviews trades says the rest).
 */
export function throughText(pAccept: number, pComplete: number): string | null {
  if (!Number.isFinite(pComplete)) return null;
  if (Math.abs(displayAcceptance(pComplete) - displayAcceptance(pAccept)) > 1e-9) return `about ${acceptText(pComplete)}`;
  const floor = config.acceptance.displayStep;
  return pComplete > 0 && pComplete < floor - 1e-12 && pComplete < pAccept - 1e-12 ? `under ${Math.round(floor * 100)}%` : null;
}

/**
 * A change in a probability, in percentage points: "+4.1 percentage points", "+1 percentage point", "no change"
 * (one decimal, as the reasons print it). Never just "points": next to the lineup's points it would read as fantasy
 * points.
 */
export function pointsChange(d: number): string {
  const text = fmtSigned(d * 100, 1);
  return text === "0" ? "no change" : `${text} ${text === "+1" || text === `${MINUS}1` ? "percentage point" : "percentage points"}`;
}

/** A whole number with its sign and thousands separators: "+1,200", "−300", "0". */
function signedWhole(n: number): string {
  const text = fmtWhole(n);
  return Math.round(n) > 0 ? `+${text}` : text;
}

/** Points per week, signed, one decimal: "+2.3 pts a week", "−1 pt a week" (singular when it prints as 1: review of Phase 4). */
export function perWeek(d: number): string {
  const text = fmtSigned(d, 1);
  return `${text} ${text === "+1" || text === `${MINUS}1` ? "pt" : "pts"} a week`;
}

/** "1 second", "4.2 seconds" (one decimal; singular when it prints as 1: review of Phase 4). */
export function secondsText(ms: number): string {
  const text = fmtNum(ms / 1000, 1);
  return `${text} ${text === "1" ? "second" : "seconds"}`;
}

/** "a", "a and b", "a, b and c". */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export type InjuryTone = "muted" | "warn" | "danger";

const INJURY_TONE: Record<InjuryStatus, InjuryTone> = {
  ACTIVE: "muted",
  PROBABLE: "muted",
  QUESTIONABLE: "warn",
  DOUBTFUL: "warn",
  OUT: "danger",
  IR: "danger",
  PUP: "danger",
  SUSPENDED: "danger",
  NA: "muted",
};

/** A name's possessive: "Team 2's", "Gravel Gophers'" (a name ending in s takes the apostrophe alone). */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/** A team's name, or a stand-in when the snapshot doesn't have it. */
export function teamNameOf(snapshot: Pick<LeagueSnapshot, "teams">, teamId: string): string {
  return snapshot.teams.find((t) => t.id === teamId)?.name ?? "The other team";
}

// ---------------------------------------------------------------------------------------------
// Players and assets

export interface AssetView {
  /** The player's id ("pick:2027:1:4" for a draft pick). */
  id: string;
  name: string;
  /** "RB · DAL" (a pick: whose it was). */
  detail: string;
  /** An injury tag ("Q", "IR") with its words, or null when healthy. */
  injury: { short: string; long: string; tone: InjuryTone } | null;
  /**
   * On a trade card: his injury tag in words (planner reply to Checkpoint 4, change 6; injuryTagText: "Out — expected back
   * week 8"), with its tone; null when he isn't tagged; absent outside a card.
   */
  status?: { text: string; tone: InjuryTone } | null;
  /** "Harder to get" (a player I'd get whom his manager values above market: the file header), with why on hover; null otherwise. */
  tag: { text: string; title: string } | null;
}

function playerDetail(info: PlayerInfo, platform: LeagueSnapshot["platform"]): string {
  return `${posLabel(info.pos, platform)} · ${info.nflTeam ?? "no NFL team"}`;
}

function injuryOf(info: PlayerInfo | undefined): AssetView["injury"] {
  if (!info) return null;
  const label = INJURY_LABEL[info.injury];
  return label ? { ...label, tone: INJURY_TONE[info.injury] } : null;
}

export function assetView(asset: TradeAsset, snapshot: SnapshotPart): AssetView {
  if (asset.kind === "pick") {
    return { id: `pick:${asset.season}:${asset.round}:${asset.originalTeamId}`, name: `${asset.season} round ${asset.round} pick`, detail: `Original owner: ${teamNameOf(snapshot, asset.originalTeamId)}`, injury: null, tag: null };
  }
  const info = snapshot.players[asset.id];
  if (!info) return { id: asset.id, name: "A player who's no longer in this league's data", detail: "", injury: null, tag: null };
  return { id: asset.id, name: info.name, detail: playerDetail(info, snapshot.platform), injury: injuryOf(info), tag: null };
}

// ---------------------------------------------------------------------------------------------
// "Harder to get" (planner addendum to Checkpoint 3, §2): shared with the League page (src/lib/leagueView.ts)

/** The tag's words (lead decision N2: text, never color alone). */
export const HARDER_TO_GET_TAG = "Harder to get";

/** "most valuable", "second most valuable", "third most valuable", "4th most valuable". */
function valueRankWords(rank: number): string {
  if (rank === 1) return "most valuable";
  if (rank === 2) return "second most valuable";
  if (rank === 3) return "third most valuable";
  const tens = rank % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][rank % 10] ?? "th");
  return `${rank}${suffix} most valuable`;
}

/**
 * What makes a manager want a little extra for one of his players (the League model's PlayerPremium, a trade's
 * PremiumFact): his rank by trade value on the roster, when that rank carries a premium (config.acceptance.starPremium.
 * rank), and being among the top eliteTop players by FantasyCalc value. `whose` names the roster ("his team's" on the
 * League page, "their" on a trade card): ["his team's most valuable player", "one of the top 12 players by trade value"].
 */
export function premiumReasons(p: Pick<PremiumFact, "rank" | "elite">, whose: string): string[] {
  const sp = config.acceptance.starPremium;
  const out: string[] = [];
  if (Number.isInteger(p.rank) && p.rank >= 1 && (sp.rank[p.rank - 1] ?? 0) > 0) out.push(`${whose} ${valueRankWords(p.rank)} player`);
  if (p.elite) out.push(`one of the top ${sp.eliteTop} players by trade value`);
  return out;
}

const NUMBER_WORD: Readonly<Record<number, string>> = { 2: "two", 3: "three", 4: "four", 5: "five" };

/**
 * Who carries "Harder to get", from config.acceptance.starPremium (the roster ranks whose premium, with the
 * top-eliteTop one, reaches harderToGetMin): "one of their two most valuable players and one of the top 12 players by
 * trade value" (`whose` "their"; the League page says "his team's").
 */
export function harderToGetWho(whose: string): string {
  const sp = config.acceptance.starPremium;
  const ranks = sp.rank.filter((r) => r > 0 && r + sp.elite >= sp.harderToGetMin - 1e-9).length;
  const which = ranks <= 1 ? `${whose} most valuable player` : `one of ${whose} ${NUMBER_WORD[ranks] ?? ranks} most valuable players`;
  return `${which} and one of the top ${sp.eliteTop} players by trade value`;
}

/** A player I'd get whom his manager would want a little extra for (PremiumFact.harderToGet): the card's tag, or null. */
function harderToGetOf(fact: PremiumFact | undefined): AssetView["tag"] {
  if (!fact?.harderToGet) return null;
  const why = premiumReasons(fact, "their");
  return { text: HARDER_TO_GET_TAG, title: `${HARDER_TO_GET_TAG}: ${why.length ? `${listText(why)}, so expect` : "expect"} them to want a little extra for him.` };
}

// ---------------------------------------------------------------------------------------------
// Injury tags (planner reply to Checkpoint 4, change 6; the file header)

/** A tag's status in words. */
const TAG_WORDS: Readonly<Record<InjuryTag["status"], string>> = {
  PROBABLE: "Probable",
  QUESTIONABLE: "Questionable",
  DOUBTFUL: "Doubtful",
  OUT: "Out",
  IR: "On IR",
  PUP: "On the PUP list",
  SUSPENDED: "Suspended",
  NA: "Not an active NFL player",
};

/** Game-time statuses (he may play this week): a return week on such a tag is the platform's far date his projection follows. */
const GAME_TIME: ReadonlySet<InjuryTag["status"]> = new Set<InjuryTag["status"]>(["PROBABLE", "QUESTIONABLE", "DOUBTFUL"]);

/** Statuses of a player I'd get that the card's once-per-card sentence covers: an injury (not a suspension, not NA). */
const INJURED_NOTE: ReadonlySet<InjuryTag["status"]> = new Set<InjuryTag["status"]>(["PROBABLE", "QUESTIONABLE", "DOUBTFUL", "OUT", "IR", "PUP"]);

/**
 * An injury tag in words (the file header): his status, and his return week when the tag carries one (explain.injuryTags
 * keeps it only when his projection counts on it): "Out — expected back week 8" ("Suspended — back week 8": a
 * suspension's end is known), or "Out for the season" ("Suspended for the season") when it comes after `seasonEnd`
 * (seasonEndOf); without a season end, the week is said. A Probable, Questionable or Doubtful tag with a week is the
 * platform's far return date his projection follows (§6 step 3's conflict), said as the platform's (`source`, "ESPN"):
 * "Questionable — ESPN expects him back week 8", "Questionable — ESPN expects him out for the season". NA never says a
 * week.
 */
export function injuryTagText(tag: Pick<InjuryTag, "status" | "returnWeek">, seasonEnd?: number, source?: string): string {
  const base = TAG_WORDS[tag.status] ?? "Injured";
  const r = tag.returnWeek;
  if (tag.status === "NA" || r === undefined || !Number.isFinite(r)) return base;
  const afterSeason = seasonEnd !== undefined && Number.isFinite(seasonEnd) && r > seasonEnd;
  if (GAME_TIME.has(tag.status)) {
    const who = source ? `${source} expects him` : "expected";
    return `${base} — ${who} ${afterSeason ? "out for the season" : `back week ${r}`}`;
  }
  if (afterSeason) return tag.status === "SUSPENDED" ? "Suspended for the season" : "Out for the season";
  return `${base} — ${tag.status === "SUSPENDED" ? "back" : "expected back"} week ${r}`;
}

/** Whose return dates a league's tags quote (injuryTagText's `source`): the platform's name; none for a manual league. */
function dateSourceOf(snapshot: Pick<LeagueSnapshot, "platform">): string | undefined {
  return snapshot.platform === "manual" ? undefined : PLATFORM_LABEL[snapshot.platform];
}

/**
 * A trade's injury tags (the file header): the evaluation's own (the search's and the Analyzer's, which know which
 * conflicted players follow their date), else explain.injuryTags from the snapshot with the week now (an evaluation
 * without them: no such date).
 */
function tagsOf(e: Pick<TradeEvaluation, "proposal" | "flags">, snapshot: SnapshotPart): InjuryTag[] {
  return e.flags.tagged ?? injuryTags(e.proposal, snapshot.players, { currentWeek: snapshot.currentWeek });
}

/**
 * The last week a return can come in time to count, for "Out for the season": the NFL regular season's last week when
 * the schedule gave it (ModelInputs.nfl.lastWeek: a return week after it is ESPN's out-for-season marker, §4), else ⚠️ the
 * league's last fantasy week (a return after it plays no game for this league); undefined when neither is known.
 */
export function seasonEndOf(settings: Pick<LeagueSnapshot["settings"], "regularSeasonWeeks" | "playoffWeeks">, lastNflWeek?: number): number | undefined {
  if (lastNflWeek !== undefined && Number.isFinite(lastNflWeek)) return lastNflWeek;
  const weeks = [...settings.regularSeasonWeeks, ...settings.playoffWeeks].filter((w) => Number.isFinite(w));
  return weeks.length ? Math.max(...weeks) : undefined;
}

/** What a hurt player's projection assumes (the file header), for one player or several. */
function assumesFullReturn(several: boolean): string {
  return several ? "their projections assume they return at full strength, blended with the trade market." : "his projection assumes he returns at full strength, blended with the trade market.";
}

/**
 * The card's once-per-card sentence for the players I'd get who carry an injury tag (the file header): "Josh Jacobs: his
 * projection assumes he returns at full strength, blended with the trade market." (their projections, for several); null
 * when none does. `flagged` (the "Depends on an injured player" flag's players, TradeEvaluation.flags.injured) are left
 * out: the flag says it for them (review of Phase 4b).
 */
export function incomingInjuryNote(tags: readonly InjuryTag[], snapshot: Pick<LeagueSnapshot, "players">, flagged: readonly string[] = []): string | null {
  const names = tags
    .filter((t) => t.side === "get" && INJURED_NOTE.has(t.status) && !flagged.includes(t.playerId))
    .map((t) => snapshot.players[t.playerId]?.name ?? "A player who's no longer in this league's data");
  if (!names.length) return null;
  return `${listText(names)}: ${assumesFullReturn(names.length > 1)}`;
}

/**
 * explain.ts's caveat for a trade that depends on an injured player ("Depends on an injured player: … and the numbers
 * assume he returns as expected."): the card's flag says it, with what his projection assumes, so the card's reasons
 * leave it out (the file header). ⚠️ Matched on the engine's words: should they change, the caveat just shows again.
 */
export const INJURED_REASON = /^Depends on (an injured player|injured players): /;

/** "Bo Nix (QB, DEN)" for sentences. */
function playerPhrase(id: string, snapshot: SnapshotPart): string {
  const info = snapshot.players[id];
  if (!info) return "a player who's no longer in this league's data";
  return `${info.name} (${posLabel(info.pos, snapshot.platform)}, ${info.nflTeam ?? "no NFL team"})`;
}

// ---------------------------------------------------------------------------------------------
// The card

export interface NumberView {
  /** What's printed ("57", "45%", "—"). */
  value: string;
  /** The same for screen readers when the print alone is unclear ("not scored"); null when the print says it. */
  srText: string | null;
}

export interface FlagView {
  kind: "injured" | "market" | "hiddenByMarket" | "noHelp" | "noOdds";
  text: string;
}

export interface FactView {
  label: string;
  value: string;
  /** "values": the trade values (the page adds the "Values: FantasyCalc" link beside them). */
  kind?: "values";
}

/** One step of "How to offer it" (TradeEvaluation.steps; the file header). */
export interface StepView {
  /** "Offer first:" or "If they say no, add" (bold on the card). */
  lead: string;
  /** The first offer in words ("Wiggleton Spoons for Cornelius Snoot"), or the player to add ("Tobias Thimble"). */
  what: string;
  /** "Est. 35%": the chance they accept, rounded like the card's (kept on one line). */
  est: string;
  /**
   * "about 20% it goes through" when the league's review could veto this version and that rounds differently ("under 5%
   * it goes through" below the display's floor: throughText); else null.
   */
  through: string | null;
  /** The estimate for screen readers: "an estimated 35% chance they accept" (", about 20% that it goes through"). */
  acceptSr: string;
  /** The whole line: "Offer first: Wiggleton Spoons for Cornelius Snoot · Est. 35%". */
  text: string;
}

export interface StepsView {
  /** "How to offer it". */
  heading: string;
  /** Offer first, then what to add if they say no. */
  items: [StepView, StepView];
}

/** "If they say no, try:" (TradeEvaluation.planB; the file header). */
export interface PlanBView {
  /** "If they say no, try:". */
  heading: string;
  /** "The same players of theirs, a different package" or "A different set of their players". */
  kindText: string;
  /**
   * My players in words ("Wiggleton Spoons and Tobias Thimble"; "nothing"), and theirs, each injury-tagged one with his tag
   * in words after his name ("Dallas Goedert (Out — expected back week 5)").
   */
  give: string;
  get: string;
  /** "Helps you 45 · Chance they accept 40% (Est. · Decent) · Overall 20". */
  numbers: string;
  /**
   * The same three numbers one by one, each kept on one line by the card (review of Phase 4b: a 375 px break inside "(Est.
   * · Likely)"), the estimate's label apart so a 320 px phone can still wrap before it: [{ text: "Helps you 45" }, { text:
   * "Chance they accept 40%", label: "(Est. · Decent)" }, { text: "Overall 20" }].
   */
  numberParts: { text: string; label?: string }[];
  /**
   * "Counting a league veto vote, about 20% it goes through." when the veto rule cuts it and that prints differently
   * ("under 5%" below the display's floor: throughText); else null.
   */
  acceptNote: string | null;
  /** "Also shown as trade idea 6." when the Finder's list shows the same trade as a card of its own (its place in the sort shown); else null. */
  also: string | null;
  /** Its own message to send them (planBPitch): a follow-up naming this trade from their side. */
  pitch: string;
  /** The Trade Analyzer, prefilled with it and marked as a Plan B (`from=planB`: shown there as one offer, without "How to offer it"). */
  analyzerHref: string;
  /** Its trade key. */
  key: string;
  /** The whole Plan B in one line (tests, hover): "Wiggleton Spoons for Mortimer Gloop · Helps you 45 · …". */
  text: string;
}

/** One version of a trade idea the user may have sent (the feedback's "Which version did you send?"), with its words. */
export interface VersionChoice extends FeedbackSent {
  /** "The first offer", "With Tobias Thimble added", "This trade" or "The “If they say no” trade". */
  label: string;
}

export interface TradeCardView {
  key: string;
  partnerId: string;
  /** "Trade with Gravel Gophers". */
  heading: string;
  partnerName: string;
  give: AssetView[];
  get: AssetView[];
  numbers: {
    helps: NumberView;
    accept: NumberView;
    /** "Est. · Decent": the estimate's label (§11). */
    acceptLabel: string;
    /** When a veto could stop it: "Counting a possible veto, about 20% it goes through." */
    acceptNote: string | null;
    overall: NumberView;
  };
  /** "How to offer it" (offer first, then what to add if they say no), or null when the trade has no steps. */
  steps: StepsView | null;
  /** "If they say no, try:" (Plan B), or null when the trade has none (it has steps, nothing qualified, or it's the Analyzer's). */
  planB: PlanBView | null;
  /**
   * Once per card, for injury-tagged players I'd get whom the "Depends on an injured player" flag doesn't name (the flag
   * says it for them): "Josh Jacobs: his projection assumes he returns at full strength, …"; else null.
   */
  injuryNote: string | null;
  /** The versions of the trade this card shows, in the card's order (the feedback asks which one was sent when there are two). */
  versions: VersionChoice[];
  flags: FlagView[];
  facts: FactView[];
  /** "You get 142 ROS pts, give 118" (§13). */
  ros: string;
  /**
   * When my starting lineup moves the other way from those ROS points (rosNoteOf): "Your starting lineup still gains 25 ROS
   * pts: …"; else null.
   */
  rosNote: string | null;
  /** The roster moves the trade forces (§7; Phase 4b's IR slots and returns too), in sentences; empty when none. */
  required: string[];
  reasons: string[];
  pitch: string;
  /** The Trade Analyzer, prefilled with this trade. */
  analyzerHref: string;
  /** The evaluation behind the card (the feedback buttons save its numbers). */
  evaluation: TradeEvaluation;
}

export interface CardContext {
  snapshot: SnapshotPart;
  /**
   * My odds before any trade, every team after its helpful free-agent pickups: the search's baseline, or the one the
   * worker sends with an Analyzer evaluation (null fields when unknown; absent: the card shows the changes alone).
   */
  baseline?: { pPlayoffs: number | null; pTitle: number | null } | null;
  /** The NFL regular season's last week (ModelInputs.nfl.lastWeek), for "Out for the season" (seasonEndOf); absent: the league's last week. */
  lastNflWeek?: number | undefined;
  /**
   * Injury tags the search made for players on its other ideas (knownTagsOf), by player: a Plan B's player reads his tag
   * from there when the card doesn't have him (it knows his far ESPN date; PlanB carries no tags of its own).
   */
  knownTags?: ReadonlyMap<string, InjuryTag> | undefined;
}

/** A 0–100 score as printed: its number; 0 for a trade that doesn't help me (B ≤ 0); "—" when B is unknown. */
function scoreView(score: number | null, b: number | null): NumberView {
  if (score !== null && Number.isFinite(score)) return { value: String(score), srText: null };
  if (b !== null && Number.isFinite(b) && b <= 0) return { value: "0", srText: null };
  return { value: "—", srText: "not scored: the season couldn't be simulated" };
}

/** "+4.1 percentage points (62% to 66%)": the end percents only when my odds before any trade are known and the whole percent moves. */
function oddsFact(d: number | null, before: number | null | undefined): string {
  if (d === null || !Number.isFinite(d)) return "Unknown";
  const change = pointsChange(d);
  if (before === null || before === undefined || !Number.isFinite(before)) return change;
  const after = Math.min(1, Math.max(0, before + d));
  return percentText(after) !== percentText(before) ? `${change} (${percentText(before)} to ${percentText(after)})` : change;
}

/**
 * Why a trade that doesn't help me (B ≤ 0: trade ideas leave it out, only the Analyzer shows it) doesn't, by what pulled
 * B down (§10). Review of Phase 4: "it wouldn't raise your chances this season" also showed on trades that do raise them,
 * whose B the trade-value term ("Protect my trade value", planner addendum to Checkpoint 3 §3) or long-term value pulled
 * to 0 or below, next to the card's own "Playoff odds +1.8 percentage points".
 * - Dynasty and keeper leagues with long-term values (λ and B_future known, §10): this season against long-term value,
 *   weighed by the Win now ↔ Future setting.
 * - Redraft: my chances go up (B_win > 0) while I'd give up more trade value than I get (g_mkt(me) < 0, as the card's
 *   values show) → that trade value, weighed by "Protect my trade value". Since the value floor on both sides (planner
 *   reply to Checkpoint 4, change 4, which replaced lead decision N10) the market term and the card's values read the same
 *   g_mkt(me), so a B ≤ 0 with B_win > 0 always has g_mkt(me) < 0; only numbers that break that rule fall back to
 *   "overall", which stays true.
 * - Otherwise: it wouldn't raise my chances this season.
 */
function noHelpText(e: Pick<TradeEvaluation, "bWin" | "bFuture" | "lambda" | "gMine">): string {
  const up = (x: number | null) => x !== null && Number.isFinite(x) && x > 0;
  const leave = "so trade ideas leave it out.";
  if (e.lambda !== null && e.bFuture !== null && Number.isFinite(e.bFuture)) {
    if (up(e.bWin) && !up(e.bFuture)) return `Doesn't help you overall: it raises your chances this season, but you'd lose more long-term value than that's worth at your Win now ↔ Future setting, ${leave}`;
    if (!up(e.bWin) && up(e.bFuture)) return `Doesn't help you overall: it adds long-term value, but it costs more of your chances this season than that's worth at your Win now ↔ Future setting, ${leave}`;
    return `Doesn't help you: it wouldn't raise your chances this season or your long-term value, ${leave}`;
  }
  if (up(e.bWin)) {
    return Number.isFinite(e.gMine) && e.gMine < 0
      ? `Doesn't help you overall: it raises your chances this season, but you'd give up more trade value than that's worth at your “Protect my trade value” setting, ${leave}`
      : `Doesn't help you overall, ${leave}`;
  }
  return `Doesn't help you: it wouldn't raise your chances this season, ${leave}`;
}

const REVIEW_WORDS: Record<LeagueSnapshot["settings"]["tradeReview"], string> = {
  none: "a veto",
  commissioner: "the commissioner's review",
  league_vote: "a league veto vote",
};

/** A trade in words for a step: "Wiggleton Spoons and Glimmer Oddfellow for Cornelius Snoot" ("nothing" for an empty side). */
export function tradeWords(p: Pick<TradeProposal, "give" | "get">, snapshot: SnapshotPart): string {
  const side = (assets: readonly TradeAsset[]) => (assets.length ? listText(assets.map((a) => assetView(a, snapshot).name)) : "nothing");
  return `${side(p.give)} for ${side(p.get)}`;
}

/**
 * A step's estimate, the way the card shows its own: the chance they accept, and the chance it goes through when the
 * league's review could veto that version, only when it prints differently ("Est. 5%, about 5% it goes through" said
 * nothing more; the card's own note already says a veto vote could stop the ranked trade), or as "under 5%" below the
 * display's floor (throughText).
 */
function stepAccept(s: Pick<TradeStep, "pAccept" | "pComplete">): { est: string; through: string | null; sr: string } {
  const est = acceptText(s.pAccept);
  const through = throughText(s.pAccept, s.pComplete);
  if (!through) return { est: `Est. ${est}`, through: null, sr: `an estimated ${est} chance they accept` };
  return { est: `Est. ${est}`, through: `${through} it goes through`, sr: `an estimated ${est} chance they accept, ${through} that it goes through` };
}

/** "How to offer it" (TradeEvaluation.steps; the file header), or null without steps. */
export function stepsView(steps: TradeEvaluation["steps"], snapshot: SnapshotPart): StepsView | null {
  if (!steps) return null;
  const item = (lead: string, what: string, step: TradeStep): StepView => {
    const accept = stepAccept(step);
    return { lead, what, est: accept.est, through: accept.through, acceptSr: accept.sr, text: `${lead} ${what} · ${accept.est}${accept.through ? `, ${accept.through}` : ""}` };
  };
  return {
    heading: "How to offer it",
    items: [
      item("Offer first:", tradeWords(steps.offerFirst.proposal, snapshot), steps.offerFirst),
      item("If they say no, add", assetView({ kind: "player", id: steps.ifNo.add }, snapshot).name, steps.ifNo.full),
    ],
  };
}

/** Plan B's heading on the card (the planner's words). */
export const PLAN_B_HEADING = "If they say no, try:";

/**
 * Which kind of Plan B it is (review of track F: "Different players of theirs" read wrong for a Plan B that keeps one of
 * the card's players, such as Luther Burden III alone for Burden and Kalif Raymond).
 */
const PLAN_B_KIND: Readonly<Record<PlanB["kind"], string>> = {
  samePlayers: "The same players of theirs, a different package",
  otherTarget: "A different set of their players",
};

/** What planBView reads besides the Plan B: the card's own injury tags, the search's tags for its other ideas (CardContext.knownTags) and the season's end (seasonEndOf). */
export interface PlanBContext {
  cardTags?: readonly InjuryTag[] | undefined;
  knownTags?: ReadonlyMap<string, InjuryTag> | undefined;
  seasonEnd?: number | undefined;
}

/**
 * The Plan B's own message to send them (PlanBView.pitch; review of Phase 4b: the box had none, and the Analyzer's
 * proposed a smaller first offer): templates only, like explain.ts's pitch, which it follows — no team name, the trade
 * named from their side, never what I gain — as a follow-up to the trade they turned down ("Thanks for considering it!
 * Would you trade Carnell Tate for Kyle Monangai and Bo Nix instead? Let me know what you think!"). ⚠️ PlanB carries no
 * partner-side facts (the hole it fills, their lineup's gain), so it doesn't lead with them; the Trade Analyzer's message
 * for the same trade (its "Open in Analyzer") does.
 */
export function planBPitch(p: Pick<TradeProposal, "give" | "get">, snapshot: SnapshotPart): string {
  const names = (assets: readonly TradeAsset[]) => listText(assets.map((a) => assetView(a, snapshot).name));
  let ask = "";
  if (p.give.length && p.get.length) ask = `Would you trade ${names(p.get)} for ${names(p.give)} instead?`;
  else if (p.get.length) ask = `Would you send me ${names(p.get)} instead?`;
  else if (p.give.length) ask = `Would you take ${names(p.give)} instead, with nothing needed back?`;
  return ["Thanks for considering it!", ask, "Let me know what you think!"].filter((s) => s.length > 0).join(" ");
}

/**
 * "If they say no, try:" (TradeEvaluation.planB; the file header), or null without one: the trade in words (each
 * injury-tagged player with his tag: the card's own tag for a player the card has on the same side, so a player reads the
 * same in both places, else the search's tag for him on another idea (`knownTags`: it knows his far ESPN date), else
 * explain.injuryTags from the snapshot with the week now; ⚠️ PlanB carries no tags of its own, so a conflicted Probable,
 * Questionable or Doubtful player only Plan B has gets no far date), which kind it is, its three numbers as the card prints
 * its own (Helps you, the chance they accept rounded to 5% with "Est." and its label, Overall), the chance it goes
 * through when a veto could cut it (throughText), its own message (planBPitch) and its Analyzer link (marked
 * `from=planB`). `also` is the Finder list's to fill (buildFinderView).
 */
export function planBView(planB: TradeEvaluation["planB"], snapshot: SnapshotPart, ctx: PlanBContext = {}): PlanBView | null {
  if (!planB) return null;
  const own = injuryTags(planB.proposal, snapshot.players, { currentWeek: snapshot.currentWeek });
  const source = dateSourceOf(snapshot);
  const named = (a: TradeAsset, which: InjuryTag["side"]): string => {
    const name = assetView(a, snapshot).name;
    if (a.kind !== "player") return name;
    const known = ctx.knownTags?.get(a.id);
    const t = ctx.cardTags?.find((x) => x.playerId === a.id && x.side === which) ?? (known ? { ...known, side: which } : undefined) ?? own.find((x) => x.playerId === a.id && x.side === which);
    return t ? `${name} (${injuryTagText(t, ctx.seasonEnd, source)})` : name;
  };
  const side = (assets: readonly TradeAsset[], which: InjuryTag["side"]) => (assets.length ? listText(assets.map((a) => named(a, which))) : "nothing");
  const numberParts = [{ text: `Helps you ${planB.tradeScore}` }, { text: `Chance they accept ${acceptText(planB.pAccept)}`, label: `(Est. · ${planB.acceptLabel})` }, { text: `Overall ${planB.overall}` }];
  const numbers = numberParts.map((p) => (p.label ? `${p.text} ${p.label}` : p.text)).join(" · ");
  const through = throughText(planB.pAccept, planB.pComplete);
  const acceptNote = through ? `Counting ${REVIEW_WORDS[snapshot.settings.tradeReview]}, ${through} it goes through.` : null;
  const give = side(planB.proposal.give, "give");
  const get = side(planB.proposal.get, "get");
  return {
    heading: PLAN_B_HEADING,
    kindText: PLAN_B_KIND[planB.kind],
    give,
    get,
    numbers,
    numberParts,
    acceptNote,
    also: null,
    pitch: planBPitch(planB.proposal, snapshot),
    analyzerHref: analyzerHref(planB.proposal, { from: "planB" }),
    key: planB.key,
    text: `${give} for ${get} · ${numbers}${acceptNote ? ` · ${acceptNote}` : ""}`,
  };
}

/** "Also shown as trade idea 6." (PlanBView.also). */
export function planBAlsoText(place: number): string {
  return `Also shown as trade idea ${place}.`;
}

/**
 * The versions of a trade idea its card shows (TradeCardView.versions; the feedback's "Which version did you send?"),
 * each with its key and estimate: with steps, the first offer and the full version (the throw-in added); with a Plan
 * B, this trade and Plan B's; else this trade alone ("full").
 */
export function versionChoices(e: Pick<TradeEvaluation, "key" | "pAccept" | "pComplete" | "steps" | "planB">, snapshot: SnapshotPart): VersionChoice[] {
  const s = e.steps;
  if (s) {
    return [
      { version: "offerFirst", key: s.offerFirst.key, pAccept: s.offerFirst.pAccept, pComplete: s.offerFirst.pComplete, label: "The first offer" },
      { version: "full", key: s.ifNo.full.key, pAccept: s.ifNo.full.pAccept, pComplete: s.ifNo.full.pComplete, label: `With ${assetView({ kind: "player", id: s.ifNo.add }, snapshot).name} added` },
    ];
  }
  const self: VersionChoice = { version: "full", key: e.key, pAccept: e.pAccept, pComplete: e.pComplete, label: "This trade" };
  const p = e.planB;
  return p ? [self, { version: "planB", key: p.key, pAccept: p.pAccept, pComplete: p.pComplete, label: "The “If they say no” trade" }] : [self];
}

/**
 * What my "Trade value" counts besides FantasyCalc's values (the file header): a player worth less than the best free
 * agent at that free agent's value (planner reply to Checkpoint 4, change 4), and an open roster spot at it too (§9).
 * Without an IR player in the trade, the side getting fewer players gets the spot (the two packages mirror each other).
 * With one (review of track E), only my active roster counts, since an IR slot isn't a roster spot: an open spot on it
 * adds to what I get, a spot it fills to what I give, and none when it gains and loses as many players
 * (returners.tradeActiveSpots, the engine's rule 5 read from the league).
 */
function valueBasisText(e: TradeEvaluation, snapshot: SnapshotPart): string {
  const floor = "a player worth less than the best free agent counts at that free agent's value";
  const give = e.proposal.give.flatMap((a) => (a.kind === "player" ? [a.id] : []));
  const get = e.proposal.get.flatMap((a) => (a.kind === "player" ? [a.id] : []));
  const { spots, irMoved } = tradeActiveSpots(snapshot, e.detail.myTeamId, e.proposal.partnerId, give, get);
  if (!irMoved) return e.proposal.give.length !== e.proposal.get.length ? "an open roster spot on the side getting fewer players counts at the best free agent's value, and so does any player worth less than that free agent" : floor;
  const notIr = "an IR slot isn't a roster spot";
  if (spots.give > spots.recv) return `an open spot on your active roster counts at the best free agent's value, as does any player worth less than that free agent; ${notIr}`;
  if (spots.recv > spots.give) return `each spot your active roster fills counts at the best free agent's value, as does any player worth less than that free agent; ${notIr}`;
  return `${floor}; ${notIr}, so no open spot counts`;
}

/**
 * The change in my starting lineup over the rest of the season, in ROS points (Σ after − before over TradeDetail.weekly:
 * my V* lineups' starting points per remaining week; a week in progress is the same both times), when it moves the other
 * way from the players' ROS points the card prints ("You get 96 ROS pts, give 295" on a helpful trade that gives a backup
 * QB who never starts: review of Phase 4b): "Your starting lineup still gains 25 ROS pts: …"; null otherwise (the two
 * agree, either rounds to nothing, or the weeks are unknown).
 */
export function rosNoteOf(e: Pick<TradeEvaluation, "ros"> & { detail: Pick<TradeDetail, "weekly"> }): string | null {
  let lineup = 0;
  for (const w of e.detail.weekly ?? []) if (Number.isFinite(w.before) && Number.isFinite(w.after)) lineup += w.after - w.before;
  const change = Math.round(lineup);
  const given = Math.round(e.ros.given);
  const received = Math.round(e.ros.received);
  if (!Number.isFinite(given) || !Number.isFinite(received)) return null;
  const why = "ROS points count each player's projected points whether he starts or not.";
  const pts = (n: number) => `${fmtWhole(n)} ROS ${n === 1 ? "pt" : "pts"}`;
  if (given > received && change > 0) return `Your starting lineup still gains ${pts(change)}: ${why}`;
  if (received > given && change < 0) return `Your starting lineup loses ${pts(-change)} even so: ${why}`;
  return null;
}

/**
 * The roster moves a trade forces on one side (§7 legality; Phase 4b's IR players), in sentences, the side's own words
 * (`who`): drops and adds as before; a received IR player who goes into an open IR slot ("Jordan Mason goes to your IR
 * slot (no roster spot until he's back)."); and a player dropped from the week an IR player comes back ("From week 7,
 * when Alec Pierce comes back from IR, you'd drop Marvin Harrison Jr. (WR, ARI)."). The IR fields may be absent
 * (RosterChange: none).
 */
function requiredLines(change: RosterChange, who: { drop: string; dropLater: string; pickUp: string; their: string; ir: string }, snapshot: SnapshotPart): string[] {
  const phrase = (id: string) => playerPhrase(id, snapshot);
  const plain = (id: string) => snapshot.players[id]?.name ?? "a player who's no longer in this league's data";
  const out: string[] = [];
  if (change.drops.length) out.push(`${who.drop} ${listText(change.drops.map(phrase))} to stay within ${who.their} roster limits.`);
  if (change.adds.length) out.push(`${who.pickUp} ${listText(change.adds.map(phrase))} from free agents to fill ${who.their} roster.`);
  const toIR = [...new Set(change.toIR ?? [])];
  if (toIR.length) {
    const one = toIR.length === 1;
    const names = listText(toIR.map(plain));
    out.push(`${names.charAt(0).toUpperCase()}${names.slice(1)} ${one ? "goes" : "go"} to ${who.ir} IR ${one ? "slot" : "slots"} (no roster ${one ? "spot" : "spots"} until ${one ? "he's" : "they're"} back).`);
  }
  for (const d of change.displaced ?? []) {
    if (!d || typeof d.playerId !== "string") continue;
    const when = Number.isFinite(d.week) ? `From week ${d.week}, when ${plain(d.returner)} comes back from IR, ` : `When ${plain(d.returner)} comes back from IR, `;
    out.push(`${when}${who.dropLater} ${phrase(d.playerId)}.`);
  }
  return out;
}

export function buildTradeCard(e: TradeEvaluation, ctx: CardContext): TradeCardView {
  const { snapshot } = ctx;
  const partnerName = teamNameOf(snapshot, e.proposal.partnerId);
  const showsVeto = e.detail.vetoRisk || Math.abs(displayAcceptance(e.pComplete) - displayAcceptance(e.pAccept)) > 1e-9;
  const through = showsVeto ? throughText(e.pAccept, e.pComplete) : null;
  const flagged = [...new Set(e.flags.injured)];

  const flags: FlagView[] = [];
  if (flagged.length) {
    const who = flagged.map((id) => {
      const info = snapshot.players[id];
      const status = info ? INJURY_LABEL[info.injury]?.long.toLowerCase() : undefined;
      return `${info?.name ?? "a player"}${status ? ` (${status})` : ""}`;
    });
    // What his projection assumes joins the flag (the file header: said once, not again under the lists or in the reasons).
    const assumes = assumesFullReturn(flagged.length > 1);
    flags.push({ kind: "injured", text: `Depends on ${flagged.length === 1 ? "an injured player" : "injured players"}: ${listText(who)}. ${assumes.charAt(0).toUpperCase()}${assumes.slice(1)}` });
  }
  if (e.flags.hiddenByBenefit) flags.push({ kind: "noHelp", text: noHelpText(e) });
  if (e.flags.marketCheck && Number.isFinite(e.gMine)) {
    const less = `you'd get ${Math.round(-e.gMine * 100)}% less trade value than you give`;
    flags.push(
      e.flags.hiddenByMarket
        ? { kind: "hiddenByMarket", text: `Market check: ${less}, so trade ideas leave it out.` }
        : { kind: "market", text: `Market check: ${less}.` },
    );
  }
  if (e.b === null && !e.flags.hiddenByBenefit) flags.push({ kind: "noOdds", text: "Not scored: your playoff odds couldn't be worked out, so this trade has no Helps you or Overall number." });

  const facts: FactView[] = [
    { label: "Your lineup", value: `${perWeek(e.dPPW)} in the regular season, ${fmtSigned(e.dPPWPlayoffs, 1)} in the playoffs` },
    { label: "Playoff odds", value: oddsFact(e.dPO, ctx.baseline?.pPlayoffs) },
    { label: "Title odds", value: oddsFact(e.dCH, ctx.baseline?.pTitle) },
  ];
  if (e.dDyn !== null && Number.isFinite(e.dDyn)) facts.push({ label: "Long-term value", value: `${signedWhole(e.dDyn)} for your roster` });
  else if (e.dynMissing) facts.push({ label: "Long-term value", value: "Unknown: long-term values didn't load" });
  // The value floor on both sides (planner reply to Checkpoint 4, change 4) and the open-spot credit: said on every card
  // (the file header, valueBasisText).
  facts.push({ label: "Trade value", value: `You give ${fmtWhole(e.value.given)}, you get ${fmtWhole(e.value.received)} (${valueBasisText(e, snapshot)})`, kind: "values" });
  facts.push({ label: "Their lineup", value: perWeek(e.partnerDeltaLineup) });

  // The roster moves the trade forces, mine first (§7; Phase 4b's IR slots and returns: requiredLines).
  const required = [
    ...requiredLines(e.required.me, { drop: "You'd drop", dropLater: "you'd drop", pickUp: "You'd pick up", their: "your", ir: "your" }, snapshot),
    ...requiredLines(e.required.partner, { drop: `${partnerName} would drop`, dropLater: `${partnerName} would drop`, pickUp: `${partnerName} would pick up`, their: "their", ir: possessive(partnerName) }, snapshot),
  ];

  // Injury tags in words on both sides (the evaluation's; else, a core without them, tags from the snapshot: tagsOf).
  const tags = tagsOf(e, snapshot);
  const end = seasonEndOf(snapshot.settings, ctx.lastNflWeek);
  const source = dateSourceOf(snapshot);
  const statusOf = (a: TradeAsset, side: InjuryTag["side"]): AssetView["status"] => {
    const t = a.kind === "player" ? tags.find((x) => x.playerId === a.id && x.side === side) : undefined;
    return t ? { text: injuryTagText(t, end, source), tone: INJURY_TONE[t.status] } : null;
  };

  return {
    key: e.key,
    partnerId: e.proposal.partnerId,
    heading: `Trade with ${partnerName}`,
    partnerName,
    give: e.proposal.give.map((a) => ({ ...assetView(a, snapshot), status: statusOf(a, "give") })),
    // Players I'd get carry "Harder to get" when their manager values them above market (TradeDetail.premium).
    get: e.proposal.get.map((a) => {
      const view = { ...assetView(a, snapshot), status: statusOf(a, "get") };
      return a.kind === "player" ? { ...view, tag: harderToGetOf(e.detail.premium?.find((f) => f.playerId === a.id)) } : view;
    }),
    numbers: {
      helps: scoreView(e.tradeScore, e.b),
      accept: { value: acceptText(e.pAccept), srText: null },
      acceptLabel: `Est. · ${e.acceptLabel}`,
      acceptNote: through ? `Counting ${REVIEW_WORDS[snapshot.settings.tradeReview]}, ${through} it goes through.` : null,
      overall: scoreView(e.overall, e.b),
    },
    steps: stepsView(e.steps, snapshot),
    planB: planBView(e.planB, snapshot, { cardTags: tags, knownTags: ctx.knownTags, seasonEnd: end }),
    injuryNote: incomingInjuryNote(tags, snapshot, flagged),
    versions: versionChoices(e, snapshot),
    flags,
    facts,
    ros: `You get ${fmtWhole(e.ros.received)} ROS pts, give ${fmtWhole(e.ros.given)}`,
    rosNote: rosNoteOf(e),
    required,
    // The injured caveat is the flag's to say (INJURED_REASON); every other reason as explain.ts wrote it.
    reasons: flagged.length ? e.reasons.filter((r) => !INJURED_REASON.test(r)) : [...e.reasons],
    pitch: e.pitch,
    analyzerHref: analyzerHref(e.proposal),
    evaluation: e,
  };
}

// ---------------------------------------------------------------------------------------------
// My odds before any trade (both pages)

/**
 * My odds before any trade in words (the Finder's line above its ideas, the Analyzer's above its card) and what they
 * count: every team after the free-agent pickups that would help it (§7's baseline, the one every trade's numbers are
 * measured from), where the League page's odds take rosters as they stand (lead decision L3). Review of Phase 4: the
 * Finder said "Your odds now: 71%" while the League page said 76%, so a card's "(71% to 77%)" read as a 1-point gain.
 * Null when the season wasn't simulated.
 */
export function baselineLines(baseline: CardContext["baseline"], page: "finder" | "analyzer"): { text: string; note: string } | null {
  if (!baseline || baseline.pPlayoffs === null || !Number.isFinite(baseline.pPlayoffs)) return null;
  const title = baseline.pTitle !== null && Number.isFinite(baseline.pTitle) ? `, ${percentText(baseline.pTitle)} to win the title` : "";
  return {
    text: `Your odds ${page === "finder" ? "before any trade" : "before this trade"}: ${percentText(baseline.pPlayoffs)} to make the playoffs${title}.`,
    note: `Like ${page === "finder" ? "every trade idea's numbers" : "the trade's numbers"}, they count the free-agent pickups that would help each team, so they can differ from the League page's odds, which take rosters as they stand.`,
  };
}

// ---------------------------------------------------------------------------------------------
// The Trade Finder

export interface FinderView {
  /** "Your odds before any trade: 62% to make the playoffs, 9% to win the title." (null when not simulated; baselineLines). */
  baseline: string | null;
  /** What those odds count, and why they can differ from the League page's (null with no baseline). */
  baselineNote: string | null;
  cards: TradeCardView[];
  /** "25 trade ideas, sorted by Overall." ("" when none). */
  countText: string;
  /** The status line once the search is done: "Found 25 trade ideas." or the empty state's title. */
  statusText: string;
  /** "Left out: 10 that wouldn't help you, and 2 …" (null when none). */
  hidden: string | null;
  /** "Looked at 1,234 trade ideas, checked the best 200 closely, … That took 4.2 seconds." */
  searched: string | null;
  notes: string[];
  warnings: string[];
  /** Why there's nothing to show, when there isn't (its text includes the notes that explain it). */
  empty: { title: string; text: string[] } | null;
}

function hiddenText(hidden: TradeSearchResult["hidden"]): string | null {
  const parts: string[] = [];
  if (hidden.byBenefit > 0) parts.push(`${plural(hidden.byBenefit, "trade idea")} that wouldn't help you`);
  if (hidden.byMarket > 0) parts.push(`${plural(hidden.byMarket, "trade idea")} where you'd get over ${Math.round(-config.benefit.marketHideBelow * 100)}% less trade value than you give`);
  return parts.length ? `Left out on purpose: ${listText(parts)}.` : null;
}

function searchedText(result: TradeSearchResult): string | null {
  const c = result.counts;
  if (!c.screened) return null;
  const total = result.timings.total;
  const time = typeof total === "number" && Number.isFinite(total) ? ` That took ${secondsText(total)}.` : "";
  const sims = c.simFinal ? `, and played out your season ${fmtWhole(config.simulation.finalSims)} times with each of the best ${fmtWhole(c.simFinal)}` : "";
  return `Looked at ${fmtWhole(c.screened)} ${c.screened === 1 ? "trade idea" : "trade ideas"}, checked the best ${fmtWhole(c.exact)} closely${sims}.${time}`;
}

/**
 * An evaluation's note as the Finder lists it, once for all its ideas. The engine words the week in progress for one
 * trade (evaluate.ts: "Week 4 is under way, so this trade can't change it: its odds count week 4 as it stands.", right
 * under the Analyzer's card), which read oddly under a list of 18 (review of Phase 4: "this trade" named none of them).
 * ⚠️ Matched on the engine's words: any other note passes through as it is.
 */
export function listNote(note: string): string {
  const m = /^Week (\d+) is under way, so this trade can't change it\b/.exec(note);
  return m ? `Week ${m[1]} is under way, so no trade can change it: every idea's odds count week ${m[1]} as it stands.` : note;
}

/**
 * The injury tags the search made for the players on its ideas (TradeEvaluation.flags.tagged), by player: the first one
 * for each (a player's tag doesn't depend on the idea or the side), for a Plan B's players (CardContext.knownTags).
 */
export function knownTagsOf(trades: readonly Pick<TradeEvaluation, "flags">[]): Map<string, InjuryTag> {
  const out = new Map<string, InjuryTag>();
  for (const e of trades) for (const t of e.flags.tagged ?? []) if (!out.has(t.playerId)) out.set(t.playerId, t);
  return out;
}

export function buildFinderView(args: { result: TradeSearchResult; sort: TradeSort; snapshot: SnapshotPart; partnerId: string | null; lastNflWeek?: number | undefined }): FinderView {
  const { result, snapshot } = args;
  const baseline = result.baseline;
  const knownTags = knownTagsOf(result.trades);
  const sorted = sortTrades(result.trades, args.sort).map((e) => buildTradeCard(e, { snapshot, baseline, lastNflWeek: args.lastNflWeek, knownTags }));
  // A Plan B that is also a card of its own says so, with that card's place in this sort (review of track F: the same
  // trade showed twice without a word).
  const place = new Map(sorted.map((c, i) => [c.key, i + 1]));
  const cards = sorted.map((c) => {
    const at = c.planB ? place.get(c.planB.key) : undefined;
    return c.planB && at !== undefined ? { ...c, planB: { ...c.planB, also: planBAlsoText(at) } } : c;
  });
  const sortLabel = SORT_OPTIONS.find((o) => o.value === args.sort)?.label ?? "Overall";
  const odds = baselineLines(baseline, "finder");
  const hidden = hiddenText(result.hidden);
  let empty: FinderView["empty"] = null;
  // The search's notes, then each distinct note of the evaluations themselves (TradeDetail.notes), once, worded for the list.
  let notes = [...result.notes];
  for (const e of result.trades) {
    for (const n of e.detail.notes) {
      const note = listNote(n);
      if (!notes.includes(note)) notes.push(note);
    }
  }
  if (!cards.length) {
    // Notes explain the emptiness only when the search stopped before screening anything (see the header).
    if (result.counts.screened === 0 && notes.length) {
      empty = { title: "No trade ideas right now", text: notes };
      notes = [];
    } else if (hidden) {
      empty = { title: "No trade ideas that help you", text: [hidden] };
    } else {
      const who = args.partnerId ? `with ${teamNameOf(snapshot, args.partnerId)}` : "with any team";
      empty = {
        title: "No trade ideas found",
        text: [`No trade ${who} helps your team and has a fair chance of being accepted. Allowing more players per side in Settings, or fewer untouchables, can turn up more.`],
      };
    }
  }
  return {
    baseline: odds?.text ?? null,
    baselineNote: odds?.note ?? null,
    cards,
    countText: cards.length ? `${plural(cards.length, "trade idea")}, sorted by ${sortLabel}.` : "",
    statusText: cards.length ? `Found ${plural(cards.length, "trade idea")}.` : `${empty?.title ?? "No trade ideas right now"}.`,
    // Said once: in the empty state when that's where it is.
    hidden: hidden !== null && empty?.text.includes(hidden) ? null : hidden,
    searched: searchedText(result),
    notes,
    warnings: [...result.warnings],
    empty,
  };
}

/**
 * What the search's settings let a trade idea be, in one line ("Up to 2 players a side and 1 untouchable."), and, in a
 * redraft league whose "Protect my trade value" isn't the default, that setting too (it changes how ideas are scored).
 */
export function settingsSummary(settings: TradeSettings, platform: LeagueSnapshot["platform"], leagueType: LeagueSnapshot["settings"]["leagueType"] = "redraft"): string {
  const pos = (ps: readonly Pos[]) => listText(ps.map((p) => posLabel(p, platform)));
  const parts = [`up to ${plural(settings.maxPerSide, "player")} a side`];
  if (settings.untouchables.length) parts.push(plural(settings.untouchables.length, "untouchable"));
  if (settings.mustInclude.length) parts.push(plural(settings.mustInclude.length, "must-include player"));
  if (settings.targetPositions.length) parts.push(`only getting ${pos(settings.targetPositions)}`);
  if (settings.avoidPositions.length) parts.push(`never getting ${pos(settings.avoidPositions)}`);
  if (settings.includeKDefIdp) parts.push(`kickers, ${platform === "espn" ? "D/STs" : "team defenses"} and IDP players included`);
  const text = listText(parts);
  // The level as the Settings page names it ("High", "Low").
  const level = `${settings.protectValue.charAt(0).toUpperCase()}${settings.protectValue.slice(1)}`;
  const protect = leagueType === "redraft" && settings.protectValue !== config.benefit.protectValueDefault ? ` Protect my trade value: ${level}.` : "";
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.${protect}`;
}

// ---------------------------------------------------------------------------------------------
// Progress (M14's progress bar)

const STAGE_ORDER: readonly TradeSearchStage[] = ["setup", "screening", "exact", "simScreen", "simFinal", "rank"];
/** Each stage's share of the bar: a rough guide to where the time goes, not a measurement. */
const STAGE_WEIGHT: Record<TradeSearchStage, number> = { setup: 0.1, screening: 0.3, exact: 0.25, simScreen: 0.2, simFinal: 0.13, rank: 0.02 };

/** Each stage in plain words. */
export const STAGE_LABEL: Record<TradeSearchStage, string> = {
  setup: "Getting your league ready",
  screening: "Screening trade ideas",
  exact: "Checking the best ideas closely",
  simScreen: "Playing out your season with each idea",
  simFinal: `Playing out the best ideas ${fmtWhole(config.simulation.finalSims)} times`,
  rank: "Ranking the trade ideas",
};

export interface ProgressView {
  label: string;
  /** "120 of 480" (null when a stage has one step). */
  detail: string | null;
  /** 0–99 while it runs. */
  percent: number;
  /** For the progress bar's aria-valuetext. */
  valueText: string;
}

export function progressView(p: TradeSearchProgress | null): ProgressView {
  const stage = p?.stage ?? "setup";
  const index = Math.max(0, STAGE_ORDER.indexOf(stage));
  const before = STAGE_ORDER.slice(0, index).reduce((s, st) => s + STAGE_WEIGHT[st], 0);
  const share = p && p.total > 0 ? Math.min(1, Math.max(0, p.done / p.total)) : 0;
  const percent = Math.min(99, Math.max(0, Math.floor((before + STAGE_WEIGHT[stage] * share) * 100)));
  const detail = p && p.total > 1 ? `${fmtWhole(Math.min(p.done, p.total))} of ${fmtWhole(p.total)}` : null;
  const label = STAGE_LABEL[stage];
  return { label, detail, percent, valueText: detail ? `${label}: ${detail}` : label };
}

// ---------------------------------------------------------------------------------------------
// Links between the pages (a team id and player ids only)

/** The Trade Finder, for one partner or every team. */
export function finderHref(partnerId: string | null): string {
  return partnerId ? `${FINDER_PATH}?${new URLSearchParams({ partner: partnerId }).toString()}` : FINDER_PATH;
}

/**
 * Where an Analyzer trade came from, when that changes how it's shown: "planB", a card's "If they say no, try:" (the
 * Analyzer shows it as one offer, without "How to offer it": review of Phase 4b, whose first offer could be smaller than
 * the trade they had just turned down).
 */
export type AnalyzerFrom = "planB";

/** The Trade Analyzer, prefilled with a trade (players only: picks wait for Phase 5, M11), and where it came from (`from=planB`). */
export function analyzerHref(p: Pick<TradeProposal, "partnerId" | "give" | "get">, opts: { from?: AnalyzerFrom | null | undefined } = {}): string {
  const q = new URLSearchParams();
  q.set("partner", p.partnerId);
  for (const a of p.give) if (a.kind === "player") q.append("give", a.id);
  for (const a of p.get) if (a.kind === "player") q.append("get", a.id);
  if (opts.from) q.set("from", opts.from);
  return `${ANALYZER_PATH}?${q.toString()}`;
}

/** Where the Analyzer's address says its trade came from (`?from=planB`), else null. */
export function readAnalyzerFrom(search: string | null | undefined): AnalyzerFrom | null {
  return new URLSearchParams(search ?? "").get("from") === "planB" ? "planB" : null;
}

/** The Analyzer's note for a trade opened from "If they say no, try:" (buildAnalysisView). */
export const FROM_PLAN_B_NOTE =
  "You opened this from “If they say no, try:” on a trade idea, so it's shown as one offer, without a smaller first offer to try before it: they've just turned down a trade with the same team.";

/**
 * A trade's key read back into a proposal (TradeEvaluation.key, evaluate.ts proposalKey: "<partner>|give:<ids>|get:<ids>",
 * each side's assets sorted, a pick as "pick:<season>:<round>:<original team>"; the test fixtures' "<partner>|<ids>|<ids>"
 * too), for naming a recorded version the card no longer shows (CardFeedback.versionWords); null when it isn't one.
 */
export function proposalFromKey(key: string | null | undefined): TradeProposal | null {
  if (typeof key !== "string") return null;
  const parts = key.split("|");
  if (parts.length !== 3) return null;
  const [partnerId = "", give = "", get = ""] = parts;
  if (!partnerId) return null;
  const side = (text: string, prefix: string): TradeAsset[] | null => {
    const list = text.startsWith(prefix) ? text.slice(prefix.length) : text;
    if (!list) return [];
    const out: TradeAsset[] = [];
    for (const id of list.split(",")) {
      if (!id) return null;
      const pick = /^pick:(\d+):(\d+):(.+)$/.exec(id);
      out.push(pick ? { kind: "pick", season: Number(pick[1]), round: Number(pick[2]), originalTeamId: pick[3] ?? "" } : { kind: "player", id });
    }
    return out;
  };
  const g = side(give, "give:");
  const r = side(get, "get:");
  return g && r && g.length + r.length > 0 ? { partnerId, give: g, get: r } : null;
}

/** Another team in this league (never mine), or null. */
export function partnerOrNull(snapshot: Pick<LeagueSnapshot, "teams">, myTeamId: string | null, id: string | null | undefined): string | null {
  return id && id !== myTeamId && snapshot.teams.some((t) => t.id === id) ? id : null;
}

/** The Finder's partner from its address (`?partner=`): another team in this league, else null (every team). */
export function readFinderPartner(search: string | null | undefined, snapshot: Pick<LeagueSnapshot, "teams">, myTeamId: string | null): string | null {
  return partnerOrNull(snapshot, myTeamId, new URLSearchParams(search ?? "").get("partner"));
}

/** The Analyzer's trade being built: the partner, and the players I give and get (canonical ids). */
export interface AnalyzerDraft {
  partnerId: string | null;
  give: string[];
  get: string[];
}

export const EMPTY_DRAFT: AnalyzerDraft = { partnerId: null, give: [], get: [] };

/** At most this many players a side in the Analyzer (config.search.analyzerMaxPerSide). */
export const ANALYZER_MAX_PER_SIDE: number = Math.max(1, Math.floor(config.search.analyzerMaxPerSide));

/**
 * The players a team can trade here: its active roster, then its IR (Phase 4b: IR players are tradable, planner reply to
 * Checkpoint 4, change 5; the engine places a received one, evaluate.ts rule 5), each once. Taxi players aren't tradable.
 */
function tradableRoster(snapshot: Pick<LeagueSnapshot, "teams">, teamId: string | null): string[] {
  const team = teamId ? snapshot.teams.find((t) => t.id === teamId) : undefined;
  return team ? [...new Set([...team.roster, ...team.ir])] : [];
}

/** A team's IR players (an Analyzer choice says so). */
function irOf(snapshot: Pick<LeagueSnapshot, "teams">, teamId: string | null): ReadonlySet<string> {
  return new Set(teamId ? (snapshot.teams.find((t) => t.id === teamId)?.ir ?? []) : []);
}

function keepIds(ids: readonly string[], allowed: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) if (allowed.includes(id) && !out.includes(id) && out.length < ANALYZER_MAX_PER_SIDE) out.push(id);
  return out;
}

/**
 * The Analyzer's trade from its address (`?partner=&give=&get=`): only another team of this league, my players to give and
 * the partner's to get from the active rosters and IR (Phase 4b; taxi players aren't tradable), each once, at most
 * ANALYZER_MAX_PER_SIDE a side. Anything else is ignored.
 */
export function readAnalyzerDraft(search: string | null | undefined, snapshot: Pick<LeagueSnapshot, "teams">, myTeamId: string | null): AnalyzerDraft {
  const q = new URLSearchParams(search ?? "");
  const partnerId = partnerOrNull(snapshot, myTeamId, q.get("partner"));
  return { partnerId, give: keepIds(q.getAll("give"), tradableRoster(snapshot, myTeamId)), get: keepIds(q.getAll("get"), tradableRoster(snapshot, partnerId)) };
}

/** The trade being built in a sentence ("You give Bo Nix; you get Travis Kelce."), null before any player is picked. */
export function draftSummary(draft: AnalyzerDraft, snapshot: Pick<LeagueSnapshot, "players">): string | null {
  if (!draft.give.length && !draft.get.length) return null;
  const names = (ids: readonly string[]) => listText(ids.map((id) => snapshot.players[id]?.name ?? "a player"));
  const text = `You give ${draft.give.length ? names(draft.give) : "nothing"}; you get ${draft.get.length ? names(draft.get) : "nothing"}`;
  // A name can end the sentence with its own period ("Jr.").
  return text.endsWith(".") ? text : `${text}.`;
}

/** The draft as a proposal, once it names a partner and at least one player. */
export function draftProposal(draft: AnalyzerDraft): TradeProposal | null {
  if (!draft.partnerId || draft.give.length + draft.get.length === 0) return null;
  return { partnerId: draft.partnerId, give: draft.give.map((id) => ({ kind: "player", id })), get: draft.get.map((id) => ({ kind: "player", id })) };
}

/** A draft's identity, whatever the order its players were picked in (to tell whether a result is for it). */
export function draftKey(draft: AnalyzerDraft): string {
  return `${draft.partnerId ?? "-"}|${[...draft.give].sort().join(",")}|${[...draft.get].sort().join(",")}`;
}

export interface PlayerChoice {
  id: string;
  name: string;
  detail: string;
  injury: AssetView["injury"];
  checked: boolean;
  /** Unchecked while the side is full. */
  disabled: boolean;
}

export interface AnalyzerChoices {
  partners: { id: string; name: string }[];
  mine: PlayerChoice[];
  theirs: PlayerChoice[];
  /** "Up to 4 players a side." */
  limitText: string;
}

const POS_RANK = new Map<Pos, number>(POSITIONS.map((p, i) => [p, i]));

/** Words after an IR player's position and team in an Analyzer choice. */
export const IR_SLOT_TEXT = "IR slot";

function choices(snapshot: SnapshotPart, ids: readonly string[], picked: readonly string[], ir: ReadonlySet<string> = new Set()): PlayerChoice[] {
  const full = picked.length >= ANALYZER_MAX_PER_SIDE;
  const rank = (id: string) => POS_RANK.get(snapshot.players[id]?.pos as Pos) ?? POSITIONS.length;
  return [...ids]
    .sort((a, b) => rank(a) - rank(b) || (snapshot.players[a]?.name ?? a).localeCompare(snapshot.players[b]?.name ?? b) || (a < b ? -1 : a > b ? 1 : 0))
    .map((id) => {
      const view = assetView({ kind: "player", id }, snapshot);
      const checked = picked.includes(id);
      const detail = ir.has(id) ? [view.detail, IR_SLOT_TEXT].filter(Boolean).join(" · ") : view.detail;
      return { id, name: view.name, detail, injury: view.injury, checked, disabled: full && !checked };
    });
}

/**
 * What the Analyzer offers: the other teams, my players and the partner's (active rosters and IR, an IR player's detail
 * saying "IR slot"), each player checked as in the draft.
 */
export function analyzerChoices(snapshot: SnapshotPart, myTeamId: string | null, draft: AnalyzerDraft): AnalyzerChoices {
  return {
    partners: snapshot.teams.filter((t) => t.id !== myTeamId).map((t) => ({ id: t.id, name: t.name })),
    mine: choices(snapshot, tradableRoster(snapshot, myTeamId), draft.give, irOf(snapshot, myTeamId)),
    theirs: choices(snapshot, tradableRoster(snapshot, draft.partnerId), draft.get, irOf(snapshot, draft.partnerId)),
    limitText: `Up to ${ANALYZER_MAX_PER_SIDE} players a side, from the active rosters and IR (players on a taxi squad can't be traded here yet).`,
  };
}

/** The Analyzer's result in words: my odds before the trade, the card, or why the trade can't be made, and the notes. */
export interface AnalysisView {
  /** "Your odds before this trade: 62% to make the playoffs, 9% to win the title." and what they count (baselineLines), with a card only; null otherwise. */
  baseline: string | null;
  baselineNote: string | null;
  card: TradeCardView | null;
  illegal: string | null;
  notes: string[];
}

/**
 * The Analyzer's result in words. `analysis.baseline` (my odds before any trade, which the worker sends with the
 * evaluation: src/workers/engine.worker.ts) gives the card's odds their end points and the line above it, so a trade
 * reads the same as on the Trade Finder (review of Phase 4: the Finder's "+9.1 percentage points (63% to 72%)" read
 * "+9.1 percentage points" here). Without it, the card shows the changes alone. `from` "planB" (a trade opened from a
 * card's "If they say no, try:", evaluated without "How to offer it": the worker's `steps: false`) says so first among
 * the notes, with a card.
 */
export function buildAnalysisView(
  analysis: TradeAnalysis & { baseline?: CardContext["baseline"] },
  snapshot: SnapshotPart,
  lastNflWeek?: number,
  opts: { from?: AnalyzerFrom | null | undefined } = {},
): AnalysisView {
  const baseline = analysis.baseline ?? null;
  const card = analysis.evaluation && !analysis.illegal ? buildTradeCard(analysis.evaluation, { snapshot, baseline, lastNflWeek }) : null;
  const odds = card ? baselineLines(baseline, "analyzer") : null;
  // A note the card's reasons already say isn't said twice.
  const said = new Set(card?.reasons ?? []);
  const notes = [...new Set(analysis.notes)].filter((n) => !said.has(n));
  return { baseline: odds?.text ?? null, baselineNote: odds?.note ?? null, card, illegal: analysis.illegal, notes: card && opts.from === "planB" ? [FROM_PLAN_B_NOTE, ...notes] : notes };
}

// ---------------------------------------------------------------------------------------------
// Feedback (§11; src/lib/feedbackStore.ts)

export interface CardFeedback {
  outcome: FeedbackOutcome | null;
  report: { reason: FeedbackReason; note: string | null } | null;
  /** Which version was sent (FeedbackRecord.version), null when unknown or nothing is saved. */
  version: FeedbackVersion | null;
  /** That version's trade key (FeedbackRecord.versionKey), null when unknown (a record made before keys were saved, or none). */
  versionKey: string | null;
  /** That version's trade in words ("Kyle Monangai and Bo Nix for Carnell Tate", read from its key), null when unknown. */
  versionWords: string | null;
}

/**
 * What this browser has saved for a trade idea (all null when nothing). With the league's `snapshot`, the recorded
 * version's trade in words (versionWords, from its key: proposalFromKey).
 */
export function cardFeedback(records: readonly FeedbackRecord[] | undefined, leagueKey: string, tradeKey: string, snapshot?: SnapshotPart): CardFeedback {
  const record = records ? feedbackFor(records, leagueKey, tradeKey) : undefined;
  const version = record?.version ?? null;
  const versionKey = version !== null ? (record?.versionKey ?? null) : null;
  const proposal = versionKey !== null && snapshot ? proposalFromKey(versionKey) : null;
  return {
    outcome: record?.outcome?.kind ?? null,
    report: record?.report ? { reason: record.report.reason, note: record.report.note ?? null } : null,
    version,
    versionKey,
    versionWords: proposal && snapshot ? tradeWords(proposal, snapshot) : null,
  };
}

/**
 * The "Version:" line under a card's outcome buttons (the file header), or null: the recorded version's label when its key
 * is one the card shows (on a card with two; a plain card's one version goes without saying; a record without a key,
 * made before keys were saved, by its kind alone), else "an earlier one" with its trade in words when a version with a
 * key is recorded that the card doesn't show (review of Phase 4b: after a refresh changed a card's Plan B, the line named
 * the box shown now; the Analyzer's card for the same trade said nothing).
 */
export function versionLine(feedback: Pick<CardFeedback, "outcome" | "version" | "versionKey" | "versionWords">, versions: readonly VersionChoice[]): string | null {
  if (!feedback.outcome || feedback.version === null) return null;
  const key = feedback.versionKey;
  const shown = key !== null ? versions.find((v) => v.key === key) : versions.length > 1 ? versions.find((v) => v.version === feedback.version) : undefined;
  if (shown) return versions.length > 1 ? shown.label : null;
  if (key === null) return null;
  return feedback.versionWords ? `an earlier one (${feedback.versionWords})` : "an earlier one";
}
