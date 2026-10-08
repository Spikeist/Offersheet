/**
 * The Settings page's view model (CLAUDE.md §14 item 6 "Settings", §12 "User settings", §7 "Streaming
 * positions"; lead decision L12): every TradeSettings field (src/engine/settings.ts) as plain-English
 * choices for the imported league, the edits the page makes (applySettingsEdit), and warnings about
 * combinations that can't work. Pure: no React, no storage.
 *
 * What the page offers, and why:
 * - Positions I stream weekly: the streamable positions (config.streaming.streamable: K, DEF, QB, TE) this
 *   league's lineup starts; K and DEF are on by default. It applies to my team only; other teams count as
 *   streaming a position after config.streaming.detectAdds adds there this season.
 * - Playoff weeks count (planner reply to Checkpoint 7a, §6.1): read-only since the League model sets the weight itself,
 *   from my odds under my goal (LeagueModel.playoffWeight and playoffWeightAuto, one decimal as the League page labels it:
 *   playoffWeightText), with what it affects; its fallback says why in plain words (FALLBACK_WORDS). The page passes what it
 *   knows (SettingsViewInput.playoffWeight: worked out from the league's saved inputs, usePlayoffWeight.ts); before that,
 *   it's set automatically when the League page loads. The manual 1×–2× control is gone.
 * - Win now ↔ Future (λ, §10): dynasty and keeper leagues only. "Automatic" (null) is the default by my
 *   playoff odds (config.benefit.lambda); the slider starts at the keeper default in a keeper league and
 *   at the bubble default (balanced) in a dynasty one. Keeper costs aren't modeled, and the page says so.
 * - What does your league reward? (Phase 4c's "What matters most", planner reply to Checkpoint 4b, change 8; framed by
 *   the league's prizes since the planner's reply to Checkpoint 7a, 5.2, with no auto-switching; TradeSettings.goal): Only
 *   the champion (the default, config.benefit.goalDefault: "title") / Several prizes ("prizes"; Checkpoint 7c, planner
 *   reply to Checkpoint 7b, §6, in place of "Top finishers too": a stored "balanced" reads as it, settings.ts) / Making the
 *   playoffs ("playoffs"), each with one line saying how it weighs the prize and playoff odds in Helps you
 *   (config.benefit.goals' weights, never fixed numbers), and the planner's helper line ("On the bubble? Keep “Only the
 *   champion.” It already counts getting into the playoffs."). Every league type: in dynasty and keeper leagues it weighs
 *   this season's part (B_win), and the help says later seasons count by Win now ↔ Future.
 * - Protect my trade value (planner addendum to Checkpoint 3, §3; lead decision N3): Low / Medium / High (κ =
 *   config.benefit.protectValue: how much Helps you counts the trade value given up or gained, so the user keeps value
 *   for later deals before the deadline), Medium (config.benefit.protectValueDefault) marked as the default, its help
 *   saying it counts in projected points a week like a lineup change (planner reply to Checkpoint 7a, §2 question 5) with
 *   ⚠️ no exchange rate (PROTECT_VALUE_HELP: review of Phase 7b, a planner question): "giving 25% more trade value than you
 *   get costs about 0.4 points a week" next to the Analyzer's "Trade value: −0.4 pts/week equivalent." turned that line
 *   back into the trade's value comparison (planner reply to Checkpoint 7a, 5.4: none in the Analyzer's Details). Redraft
 *   leagues only: dynasty and keeper leagues have no market term in Helps you (their long-term value counts instead,
 *   through Win now ↔ Future; a second term would count trade value twice), and in its place they get the planner's line
 *   after the Win now ↔ Future group (TRADE_VALUE_NOTE, SettingsView.tradeValueNote: planner reply to Checkpoint 7b, Q3:
 *   "In dynasty and keeper leagues, the Win now ↔ Future slider covers trade value."), so the setting's absence says why.
 *   The help says depth for injuries and byes is counted either way. Phase 4c (planner reply
 *   to Checkpoint 4b, change 12): while the league's values are our own estimates (FantasyCalc's curve fallback,
 *   `valuesEstimated`), Helps you leaves trade value out (evaluate.ts: κ = 0), so a note says the setting does nothing
 *   until FantasyCalc is back; Win now ↔ Future gets the same note in dynasty and keeper leagues, whose long-term value
 *   is left out then too (benefit.futureValuesLoaded).
 * - Max players per side: 1 to config.search.maxPerSideAllowed.
 * - Untouchables (my players: roster, IR and taxi) and must-include players (any team's, mine first) need
 *   my team; without it the page points to the Import Report. A player is never both: marking one moves him
 *   out of the other list. Saved players who are no longer on my team (untouchables) or on any team
 *   (must-include) are listed so they can be removed.
 * - Positions to target and to avoid: the positions this league starts, without the ones trade ideas
 *   leave out (config.market.tradeSearchExcluded: P, K, DEF, IDP) unless those are included. A position is
 *   never both; turning "include" off clears the left-out positions from both lists, so no hidden choice
 *   can empty the search.
 * - Include K, D/ST and IDP: only when the league starts one of them, named after the ones it starts.
 * - Include draft picks: dynasty and keeper leagues only. Picks aren't in the search yet (Phase 5), and the help says so.
 * Warnings: must-include players from two other teams (a trade is with one team), more must-include players
 * on a side than a trade allows, a player on both lists, saved players who left, targets the search can't use.
 */
import { config } from "@/engine/config";
import type { PlayoffWeightAuto, PlayoffWeightFallback } from "@/engine/leagueModel";
import { POSITIONS, type LeagueSnapshot, type PlayerInfo, type Pos } from "@/engine/model";
import { GOALS, PROTECT_VALUE_LEVELS, normalizeTradeSettings, type Goal, type ProtectValue, type TradeSettings } from "@/engine/settings";
import { LEAGUE_TYPE_LABEL, PLATFORM_LABEL, posLabel } from "@/lib/labels";

/** One option of a choice group: its value, its words, and whether it's chosen. */
export interface Choice<T> {
  value: T;
  label: string;
  /** Smaller words after the label ("default", "QB · BUF · IR"). */
  detail?: string;
  checked: boolean;
}

export interface PlayerPick {
  id: string;
  /** "Josh Allen" (or a stand-in when the player isn't in the league's data any more). */
  name: string;
  /** "QB · BUF" (and "IR" or "taxi" when he's there). */
  detail: string;
}

export interface MustIncludeGroup {
  teamId: string;
  /** "Your team" or the team's name. */
  label: string;
  options: { id: string; label: string }[];
}

export type PlayersView =
  | { kind: "noTeam"; text: string }
  | {
      kind: "ok";
      untouchables: { choices: Choice<string>[]; stale: PlayerPick[] };
      mustInclude: {
        /** Players that can still be added, by team (mine first). */
        groups: MustIncludeGroup[];
        /** Players already chosen, with where they are ("Your team", a team's name, or "Not on a team"). */
        chosen: (PlayerPick & { team: string })[];
        warnings: string[];
      };
    };

export interface SettingsView {
  league: { name: string; platformLabel: string; season: number; typeLabel: string; dynastyOrKeeper: boolean };
  /** The league has saved settings (false: the defaults). */
  stored: boolean;
  /**
   * The Trade Finder's "Chance they accept: at least" when the saved settings hold one other than the default (it's saved
   * with them, and Reset to defaults sets it back too; final review of Phase 4c, finding PAGES-5: a league whose only change
   * was that minimum read as customized, with nothing on this page to say how): "The Trade Finder's “Chance they accept:
   * at least” is 30%, set on the Trade Finder. Reset to defaults sets it back to 10% too."; else null.
   */
  finderMinimum: string | null;
  /** "Positions I stream weekly"; null when the league starts none of the streamable positions. */
  stream: { choices: Choice<Pos>[]; help: string } | null;
  /**
   * "Playoff weeks count", read-only (planner reply to Checkpoint 7a, §6.1; the file header): `label` "Playoff weeks count",
   * `value` its reading ("2.0×, set automatically from your odds."), `help` what it affects; `text` the whole line.
   */
  playoffWeight: { label: string; value: string; help: string; text: string };
  /** Win now ↔ Future: dynasty and keeper leagues only. */
  lambda: {
    automatic: boolean;
    /** The slider's value (the saved one, or where it starts when "Automatic" is turned off). */
    value: number;
    /** The value in words, e.g. "Mostly this season: later seasons count 35%". */
    valueText: string;
    automaticText: string;
    help: string;
    keeperNote: string | null;
    /** Why later seasons don't count for now, while the league's values are our own estimates (FantasyCalc's curve fallback); else null. */
    estimatedNote: string | null;
  } | null;
  /**
   * "What does your league reward?" (TradeSettings.goal): Only the champion / Several prizes / Making the playoffs, each
   * with its line of help; `help` what it sets and the planner's helper line (planner reply to Checkpoint 7a, 5.2); every
   * league type.
   */
  goal: { legend: string; choices: (Choice<Goal> & { help: string })[]; help: string };
  /**
   * "Protect my trade value": Low / Medium / High; redraft leagues only (null otherwise). `note`: why it does nothing for now,
   * while the league's values are our own estimates (FantasyCalc's curve fallback); else null.
   */
  protectValue: { choices: Choice<ProtectValue>[]; help: string; note: string | null } | null;
  /**
   * Where "Protect my trade value" would be, in dynasty and keeper leagues (null in redraft ones): why it isn't (planner
   * reply to Checkpoint 7b, Q3: TRADE_VALUE_NOTE, shown after the Win now ↔ Future group).
   */
  tradeValueNote: string | null;
  maxPerSide: { choices: Choice<number>[]; help: string };
  players: PlayersView;
  positions: { target: Choice<Pos>[]; avoid: Choice<Pos>[]; note: string | null };
  /** "Include kickers and D/STs in trade ideas"; null when the league starts none of them. */
  kDefIdp: { label: string; checked: boolean; help: string } | null;
  /** Dynasty and keeper leagues only. */
  picks: { checked: boolean; help: string } | null;
}

type SnapshotPart = Pick<LeagueSnapshot, "platform" | "name" | "season" | "settings" | "teams" | "players">;

export interface SettingsViewInput {
  snapshot: SnapshotPart;
  /** My team, as the pages resolve it (resolveMyTeam); null when the user hasn't picked one. */
  myTeamId: string | null;
  settings: TradeSettings;
  stored: boolean;
  /**
   * The league's latest model inputs say its trade values are our own estimates (MarketInputs.fallback kind "curve":
   * FantasyCalc didn't answer and its newest saved list is too old to read as its own); absent or false otherwise.
   */
  valuesEstimated?: boolean;
  /**
   * The automatic playoff-week weight as the page knows it (usePlayoffWeight.ts: a League model built from the league's
   * saved inputs with these settings); absent: not known ("set automatically when the League page loads").
   */
  playoffWeight?: PlayoffWeightRead;
}

/**
 * What the Settings page knows of the automatic playoff-week weight (SettingsViewInput.playoffWeight): nothing yet
 * ("unknown": no fresh saved inputs to work it out from), being worked out ("working"), or the League model's
 * (LeagueModel.playoffWeight as `omega`, playoffWeightAuto as `auto`).
 */
export type PlayoffWeightRead = { kind: "unknown" } | { kind: "working" } | { kind: "known"; omega: number; auto: PlayoffWeightAuto | null };

/**
 * A playoff-week weight as the pages print it, one decimal (planner reply to Checkpoint 7a, §6.1): "2.0", "1.3" (the
 * fallback 1.25), "0.5". The League page's "(playoffs count 2.0×)" labels print the same (src/lib/leagueView.ts).
 */
export function playoffWeightText(omega: number): string {
  return Number.isFinite(omega) ? omega.toFixed(1) : "—";
}

/** Why the automatic playoff weight fell back to the default (PlayoffWeightAuto.reason), in plain words. */
export const FALLBACK_WORDS: Readonly<Record<PlayoffWeightFallback, string>> = {
  noTeam: "pick your team on the Import Report to set it from your odds",
  noRegularWeeks: "no regular-season weeks are left, so it doesn't matter",
  noPlayoffWeeks: "no playoff weeks are left to count",
  noOdds: "your odds couldn't be worked out",
  titleUnknown: "your title odds aren't known",
  noEffect: "lineup changes don't move your odds right now",
  notFinite: "your odds couldn't be measured",
};

/** What the automatic playoff-week weight affects (the planner's words; ⚠️ ours: the pickups the odds count, so it never reads as leaving the odds alone). */
export const PLAYOFF_WEIGHT_HELP =
  "It only affects shortlists, free-agent rankings (and so the pickups your odds count), needs and trade chips. Final scores come from playing out the season, which weighs each week by its real effect on your odds.";

/** "Playoff weeks count" in words (SettingsView.playoffWeight; the file header). */
export function playoffWeightView(read: PlayoffWeightRead | undefined): SettingsView["playoffWeight"] {
  const label = "Playoff weeks count";
  let value: string;
  if (read?.kind === "known") {
    const w = `${playoffWeightText(read.omega)}×`;
    const reason = read.auto?.basis === "fallback" && read.auto.reason ? FALLBACK_WORDS[read.auto.reason] : null;
    value = reason ? `${w} (the default: ${reason}).` : `${w}, set automatically from your odds.`;
  } else if (read?.kind === "working") {
    value = "set automatically from your odds. Working it out…";
  } else {
    value = "set automatically from your odds when the League page loads.";
  }
  return { label, value, help: PLAYOFF_WEIGHT_HELP, text: `${label}: ${value} ${PLAYOFF_WEIGHT_HELP}` };
}

/** The order positions are listed in (QB, RB, WR, TE, K, P, DEF, DL, LB, DB). */
const POS_ORDER = new Map(POSITIONS.map((p, i) => [p, i]));
const EXCLUDED: ReadonlySet<Pos> = new Set(config.market.tradeSearchExcluded);
const IDP: ReadonlySet<Pos> = new Set<Pos>(["DL", "LB", "DB"]);

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** "a", "a and b", "a, b and c". */
function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Positions some starting slot of this league accepts, in POSITIONS order. */
export function startablePositions(snapshot: Pick<LeagueSnapshot, "settings">): Pos[] {
  const set = new Set<Pos>();
  for (const slot of snapshot.settings.lineup) if (slot.count > 0) for (const p of slot.eligible) set.add(p);
  return POSITIONS.filter((p) => set.has(p));
}

/** A position's name in a sentence, as this platform's users know it. */
function positionWords(pos: Pos, platform: LeagueSnapshot["platform"]): string {
  switch (pos) {
    case "QB":
      return "quarterbacks";
    case "RB":
      return "running backs";
    case "WR":
      return "wide receivers";
    case "TE":
      return "tight ends";
    case "K":
      return "kickers";
    case "P":
      return "punters";
    case "DEF":
      return platform === "espn" ? "D/STs" : "team defenses";
    default:
      return "IDP players";
  }
}

const STREAM_NAME: Partial<Record<Pos, string>> = { QB: "Quarterback", TE: "Tight end", K: "Kicker" };

function streamLabel(pos: Pos, platform: LeagueSnapshot["platform"]): string {
  if (pos === "DEF") return platform === "espn" ? "D/ST" : "Team defense (DEF)";
  return `${STREAM_NAME[pos] ?? pos} (${pos})`;
}

/** Where a player is on his team, for his detail line. */
function slotWord(team: LeagueSnapshot["teams"][number], id: string): string | null {
  if (team.ir.includes(id)) return "IR";
  if (team.taxi.includes(id)) return "taxi";
  return null;
}

function playerPick(id: string, info: PlayerInfo | undefined, platform: LeagueSnapshot["platform"], where: string | null): PlayerPick {
  if (!info) return { id, name: "A player who's no longer in this league's data", detail: "" };
  const parts = [posLabel(info.pos, platform), info.nflTeam ?? "no NFL team", ...(where ? [where] : [])];
  return { id, name: info.name, detail: parts.join(" · ") };
}

/** A team's players (roster, IR, taxi), each once, by position then name. */
function teamPlayers(snapshot: SnapshotPart, teamId: string): PlayerPick[] {
  const team = snapshot.teams.find((t) => t.id === teamId);
  if (!team) return [];
  const ids = [...new Set([...team.roster, ...team.ir, ...team.taxi])];
  const rank = (pos: Pos | undefined) => (pos === undefined ? POSITIONS.length : (POS_ORDER.get(pos) ?? POSITIONS.length));
  return ids
    .map((id) => ({ pick: playerPick(id, snapshot.players[id], snapshot.platform, slotWord(team, id)), pos: snapshot.players[id]?.pos }))
    .sort((a, b) => rank(a.pos) - rank(b.pos) || a.pick.name.localeCompare(b.pick.name) || a.pick.id.localeCompare(b.pick.id))
    .map((x) => x.pick);
}

/** Which team a player is on now (roster, IR or taxi), if any. */
function teamOf(snapshot: SnapshotPart, id: string): LeagueSnapshot["teams"][number] | undefined {
  return snapshot.teams.find((t) => t.roster.includes(id) || t.ir.includes(id) || t.taxi.includes(id));
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** λ in words: how much later seasons count. */
export function lambdaText(value: number): string {
  const lean = value <= 0.1 ? "This season" : value < 0.4 ? "Mostly this season" : value <= 0.6 ? "Balanced" : value < 0.9 ? "Mostly the future" : "The future";
  return `${lean}: later seasons count ${pct(value)}`;
}

/** "Protect my trade value" levels in words (each one's weight is config.benefit.protectValue): the level, capitalized. */
export const PROTECT_VALUE_LABEL: Record<ProtectValue, string> = { low: "Low", medium: "Medium", high: "High" };

/**
 * "What does your league reward?" in words (TradeSettings.goal; planner reply to Checkpoint 4b, change 8, reframed by the
 * planner's reply to Checkpoint 7a, 5.2; "Several prizes" since Checkpoint 7c, planner reply to Checkpoint 7b, §6, in place
 * of "Top finishers too"): the same labels as the Trade Finder's (src/lib/tradeView.ts GOAL_LABEL, kept apart so this page
 * doesn't load the trade pages' words; settingsView.test.ts checks the two agree).
 */
export const GOAL_LABEL: Record<Goal, string> = { title: "Only the champion", prizes: "Several prizes", playoffs: "Making the playoffs" };

/** The goal's question (SettingsView.goal.legend; planner reply to Checkpoint 7a, 5.2). */
export const GOAL_LEGEND = "What does your league reward?";

/** The planner's helper line under it (planner reply to Checkpoint 7a, 5.2: no auto-switching by playoff odds). */
export const GOAL_BUBBLE_HINT = "On the bubble? Keep “Only the champion.” It already counts getting into the playoffs.";

/**
 * "Protect my trade value"'s help (the file header): what it does, in projected points a week like a lineup change (planner
 * reply to Checkpoint 7a, §2 question 5), and what High and Low are for. ⚠️ No exchange rate between trade value and points
 * (review of Phase 7b, a planner question): with one ("giving 25% more trade value than you get costs about 0.4 points a
 * week"), the Analyzer's "Trade value: −0.4 pts/week equivalent." read back as the trade's own value comparison, which
 * Offer Sheet doesn't show (planner reply to Checkpoint 7a, 5.4).
 */
export const PROTECT_VALUE_HELP =
  "How much Helps you counts trade value, so you keep some for later deals before your trade deadline: giving up more value than you get lowers it, getting more raises it, in projected points a week, like a change to your lineup. " +
  "High protects your value the most; Low goes for the biggest lineup gain now. Your bench's worth as cover for injuries and byes counts either way.";

/**
 * A goal's line of help: how it weighs the prize and playoff odds in Helps you, with config.benefit.goals' weights
 * ("Weighs your title odds most (85%), playoff odds 15%."; "Several prizes": "Weighs your share of the league's prizes most
 * (85%), playoff odds 15%.", the lead's words for Checkpoint 7c). `weights.prizes` weighs the change in my share of the
 * prizes, which is my title odds' when 1st place pays everything ("Only the champion", "Making the playoffs").
 */
export function goalHelp(goal: Goal, weights: { readonly playoffs: number; readonly prizes: number } = config.benefit.goals[goal]): string {
  const prizes = pct(weights.prizes);
  const playoffs = pct(weights.playoffs);
  if (goal === "title") return `Weighs your title odds most (${prizes}), playoff odds ${playoffs}.`;
  if (goal === "playoffs") return `Weighs your playoff odds most (${playoffs}), title odds ${prizes}.`;
  return `Weighs your share of the league's prizes most (${prizes}), playoff odds ${playoffs}.`;
}

/**
 * Why dynasty and keeper leagues have no "Protect my trade value" (SettingsView.tradeValueNote): the planner's sentence
 * (planner reply to Checkpoint 7b, Q3). Their long-term value already counts trade value, through Win now ↔ Future
 * (benefit.ts: no market term there, whatever κ), so a second term would count it twice.
 */
export const TRADE_VALUE_NOTE = "In dynasty and keeper leagues, the Win now ↔ Future slider covers trade value.";

/** Why "Protect my trade value" does nothing for now (SettingsView.protectValue.note): the trade values are our own estimates. */
export const PROTECT_VALUE_ESTIMATED_NOTE =
  "For now this setting changes nothing: FantasyCalc isn't available, so this league's trade values are our own estimates, and Helps you leaves trade value out until FantasyCalc is back.";
/** Why later seasons don't count for now (SettingsView.lambda.estimatedNote), in a dynasty or keeper league. */
export const LAMBDA_ESTIMATED_NOTE =
  "For now Helps you counts this season only: FantasyCalc isn't available, so this league's values are our own estimates, which say nothing about later seasons.";

/** Where the Win now ↔ Future slider starts when "Automatic" is turned off. */
export function lambdaStart(leagueType: LeagueSnapshot["settings"]["leagueType"]): number {
  return leagueType === "keeper" ? config.benefit.lambda.keeper : config.benefit.lambda.bubble;
}

/** "30%", or "Any" for no minimum: the Trade Finder's own labels for "Chance they accept: at least". */
const minChanceWords = (m: number): string => (m > 0 ? `${Math.round(m * 100)}%` : "Any");

/** SettingsView.finderMinimum: said only for saved settings whose minimum isn't the default. */
export function finderMinimumText(minChance: number, stored: boolean): string | null {
  const def = config.ranking.minChanceDefault;
  if (!stored || !Number.isFinite(minChance) || Math.abs(minChance - def) < 1e-9) return null;
  return `The Trade Finder's “Chance they accept: at least” is ${minChanceWords(minChance)}, set on the Trade Finder. Reset to defaults sets it back to ${minChanceWords(def)} too.`;
}

export function buildSettingsView(input: SettingsViewInput): SettingsView {
  const { snapshot, myTeamId } = input;
  const s = normalizeTradeSettings(input.settings);
  const platform = snapshot.platform;
  const type = snapshot.settings.leagueType;
  const dynastyOrKeeper = type === "dynasty" || type === "keeper";
  const startable = startablePositions(snapshot);
  const lam = config.benefit.lambda;

  const streamable = config.streaming.streamable.filter((p) => startable.includes(p));
  const stream = streamable.length
    ? {
        choices: streamable.map((p) => ({ value: p, label: streamLabel(p, platform), checked: s.streamPositions.includes(p) })),
        help:
          `Each week you pick up whichever free agent has the best matchup. For a position you stream, Offer Sheet values your lineup spot at the better of your own player and the ${ordinal(config.streaming.streamRank)}-best free agent that week (other managers stream too), so a trade never pays for what the waiver wire gives you anyway. ` +
          `It's for your team; another team counts as streaming a position once it has picked up ${config.streaming.detectAdds} or more players there this season.`,
      }
    : null;

  // Read-only since the planner's reply to Checkpoint 7a, §6.1 (the file header).
  const playoffWeight = playoffWeightView(input.playoffWeight);

  const lambda = dynastyOrKeeper
    ? {
        automatic: s.lambda === null,
        value: s.lambda ?? lambdaStart(type),
        valueText: lambdaText(s.lambda ?? lambdaStart(type)),
        automaticText:
          type === "keeper"
            ? `Later seasons count ${pct(lam.keeper)} in a keeper league.`
            : `Set from your playoff odds: later seasons count ${pct(lam.contender)} when you're ${pct(lam.contenderAt)} or better to make the playoffs, ${pct(lam.bubble)} from ${pct(lam.bubbleAt)} to ${pct(lam.contenderAt)}, and ${pct(lam.rebuild)} below ${pct(lam.bubbleAt)}.`,
        help: "A trade can help you this season, in later seasons, or both. This sets how much later seasons count when Offer Sheet scores a trade for you.",
        keeperNote: type === "keeper" ? "What it costs to keep a player next season isn't part of the score yet." : null,
        estimatedNote: input.valuesEstimated ? LAMBDA_ESTIMATED_NOTE : null,
      }
    : null;

  // "What does your league reward?" (TradeSettings.goal): every league type; in dynasty and keeper leagues it weighs this
  // season's part. The planner's helper line last (planner reply to Checkpoint 7a, 5.2).
  const goal = {
    legend: GOAL_LEGEND,
    choices: GOALS.map((g) => ({
      value: g,
      label: GOAL_LABEL[g],
      ...(g === config.benefit.goalDefault ? { detail: "default" } : {}),
      help: goalHelp(g),
      checked: g === s.goal,
    })),
    help: `${
      dynastyOrKeeper
        ? "For this season, Helps you scores a trade by how much it raises your title and playoff odds (how much later seasons count is set under Win now or build for the future). Pick what your league's prizes reward."
        : "Helps you scores a trade by how much it raises your title and playoff odds. Pick what your league's prizes reward."
    } ${GOAL_BUBBLE_HINT}`,
  };

  const protectValue =
    type === "redraft"
      ? {
          choices: PROTECT_VALUE_LEVELS.map((level) => ({
            value: level,
            label: PROTECT_VALUE_LABEL[level],
            ...(level === config.benefit.protectValueDefault ? { detail: "default" } : {}),
            checked: level === s.protectValue,
          })),
          help: PROTECT_VALUE_HELP,
          note: input.valuesEstimated ? PROTECT_VALUE_ESTIMATED_NOTE : null,
        }
      : null;

  const maxPerSide = {
    choices: Array.from({ length: config.search.maxPerSideAllowed }, (_, i) => i + 1).map((n) => ({
      value: n,
      label: String(n),
      ...(n === config.search.maxPerSide ? { detail: "default" } : {}),
      checked: n === s.maxPerSide,
    })),
    help: `The most players either team gives in one trade idea. ${config.search.maxPerSideAllowed} finds bigger packages, but the search takes longer.`,
  };

  const excludedHere = startable.filter((p) => EXCLUDED.has(p));
  const excludedWords = [...new Set(excludedHere.map((p) => (IDP.has(p) ? "IDP players" : positionWords(p, platform))))];
  const kDefIdp = excludedHere.length
    ? {
        label: `Include ${listText(excludedWords)} in trade ideas`,
        checked: s.includeKDefIdp,
        help: "Off by default: managers rarely trade for them, and FantasyCalc doesn't value them, so their trade values are Offer Sheet's estimates.",
      }
    : null;

  const shown = startable.filter((p) => s.includeKDefIdp || !EXCLUDED.has(p));
  const targetHidden = s.targetPositions.filter((p) => !shown.includes(p));
  const positions = {
    target: shown.map((p) => ({ value: p, label: posLabel(p, platform), checked: s.targetPositions.includes(p) })),
    avoid: shown.map((p) => ({ value: p, label: posLabel(p, platform), checked: s.avoidPositions.includes(p) })),
    note:
      s.targetPositions.length > 0 && targetHidden.length === s.targetPositions.length
        ? `Your saved target positions (${listText(targetHidden.map((p) => posLabel(p, platform)))}) aren't in trade ideas here, so they'd find nothing. Pick positions above, or leave them all unchecked.`
        : null,
  };

  // Picks in trades are deferred to Phase 5 (CLAUDE.md §12): with the box on, the Trade Finder says "Draft picks aren't part
  // of trade ideas yet." (search.ts searchNotes), so the help says what the choice does today instead of promising picks in
  // trade ideas (review of Phase 7b: the two lines contradicted each other).
  const picks = dynastyOrKeeper
    ? { checked: s.includePicks, help: "Draft picks aren't part of trade ideas yet. Your choice is kept for when they are." }
    : null;

  return {
    league: { name: snapshot.name, platformLabel: PLATFORM_LABEL[platform], season: snapshot.season, typeLabel: LEAGUE_TYPE_LABEL[type], dynastyOrKeeper },
    stored: input.stored,
    finderMinimum: finderMinimumText(s.minChance, input.stored),
    stream,
    playoffWeight,
    goal,
    lambda,
    protectValue,
    tradeValueNote: dynastyOrKeeper ? TRADE_VALUE_NOTE : null,
    maxPerSide,
    players: playersView(snapshot, myTeamId, s),
    positions,
    kDefIdp,
    picks,
  };
}

function playersView(snapshot: SnapshotPart, myTeamId: string | null, s: TradeSettings): PlayersView {
  const mine = myTeamId ? snapshot.teams.find((t) => t.id === myTeamId) : undefined;
  if (!mine) {
    return { kind: "noTeam", text: "Pick your team on the Import Report first: untouchables and must-include players are chosen from the rosters, starting with yours." };
  }
  const myPlayers = teamPlayers(snapshot, mine.id);
  const onMyTeam = new Set(myPlayers.map((p) => p.id));
  const untouchables = {
    choices: myPlayers.map((p) => ({ value: p.id, label: p.name, detail: p.detail, checked: s.untouchables.includes(p.id) })),
    stale: s.untouchables.filter((id) => !onMyTeam.has(id)).map((id) => playerPick(id, snapshot.players[id], snapshot.platform, null)),
  };

  const chosen = new Set(s.mustInclude);
  const others = snapshot.teams.filter((t) => t.id !== mine.id);
  const groups: MustIncludeGroup[] = [mine, ...others].map((team) => ({
    teamId: team.id,
    label: team.id === mine.id ? "Your team" : team.name,
    options: teamPlayers(snapshot, team.id)
      .filter((p) => !chosen.has(p.id))
      .map((p) => ({ id: p.id, label: `${p.name} (${p.detail}${team.id === mine.id && s.untouchables.includes(p.id) ? " · untouchable" : ""})` })),
  }));

  const warnings: string[] = [];
  const chosenTeams = s.mustInclude.map((id) => teamOf(snapshot, id));
  const chosenList = s.mustInclude.map((id, i) => {
    const team = chosenTeams[i];
    const pick = playerPick(id, snapshot.players[id], snapshot.platform, team ? slotWord(team, id) : null);
    return { ...pick, team: team ? (team.id === mine.id ? "Your team" : team.name) : "Not on a team" };
  });
  chosenList.forEach((p, i) => {
    if (!chosenTeams[i]) warnings.push(`${p.name} isn't on a team in this league any more, so no trade can include him. Remove him.`);
  });
  const partners = [...new Set(chosenTeams.flatMap((t) => (t && t.id !== mine.id ? [t.id] : [])))];
  if (partners.length >= 2) {
    const names = partners.map((id) => snapshot.teams.find((t) => t.id === id)?.name ?? id);
    warnings.push(`A trade is with one team at a time, so players from ${listText(names)} can't all be in one trade, and trade ideas will find none. Keep players from one other team.`);
  }
  const mineCount = chosenTeams.filter((t) => t?.id === mine.id).length;
  const theirCount = chosenTeams.filter((t) => t && t.id !== mine.id).length;
  if (mineCount > s.maxPerSide) warnings.push(`You chose ${mineCount} of your players, but a trade idea has at most ${s.maxPerSide} per side.`);
  if (partners.length === 1 && theirCount > s.maxPerSide) warnings.push(`You chose ${theirCount} of their players, but a trade idea has at most ${s.maxPerSide} per side.`);
  const both = s.mustInclude.filter((id) => s.untouchables.includes(id));
  for (const id of both) warnings.push(`${snapshot.players[id]?.name ?? "A player"} is both untouchable and a must-include player. Remove him from one list.`);

  return { kind: "ok", untouchables, mustInclude: { groups, chosen: chosenList, warnings } };
}

// ---------------------------------------------------------------------------------------------
// Edits

export type SettingsEdit =
  | { kind: "stream"; pos: Pos; on: boolean }
  /** null = Automatic. */
  | { kind: "lambda"; value: number | null }
  | { kind: "goal"; value: Goal }
  | { kind: "protectValue"; value: ProtectValue }
  | { kind: "maxPerSide"; value: number }
  | { kind: "untouchable"; id: string; on: boolean }
  | { kind: "mustInclude"; id: string; on: boolean }
  | { kind: "target"; pos: Pos; on: boolean }
  | { kind: "avoid"; pos: Pos; on: boolean }
  | { kind: "includeKDefIdp"; on: boolean }
  | { kind: "includePicks"; on: boolean };

const withOut = <T>(xs: readonly T[], x: T): T[] => xs.filter((y) => y !== x);
const withIn = <T>(xs: readonly T[], x: T): T[] => (xs.includes(x) ? [...xs] : [...xs, x]);
const toggled = <T>(xs: readonly T[], x: T, on: boolean): T[] => (on ? withIn(xs, x) : withOut(xs, x));

/**
 * One change on the Settings page: the new settings (normalized), and a note when the change also undid
 * another choice (a player can't be both untouchable and a must-include player; a position can't be both
 * targeted and avoided; turning "include K, D/ST and IDP" off clears those positions from both lists).
 * `nameOf` names players in the note.
 */
export function applySettingsEdit(settings: TradeSettings, edit: SettingsEdit, nameOf: (id: string) => string = () => "That player", platform?: LeagueSnapshot["platform"]): { settings: TradeSettings; note: string | null } {
  const s = normalizeTradeSettings(settings);
  let note: string | null = null;
  let next: TradeSettings;
  switch (edit.kind) {
    case "stream":
      next = { ...s, streamPositions: toggled(s.streamPositions, edit.pos, edit.on) };
      break;
    case "lambda":
      next = { ...s, lambda: edit.value };
      break;
    case "goal":
      next = { ...s, goal: edit.value };
      break;
    case "protectValue":
      next = { ...s, protectValue: edit.value };
      break;
    case "maxPerSide":
      next = { ...s, maxPerSide: edit.value };
      break;
    case "untouchable":
      if (edit.on && s.mustInclude.includes(edit.id)) note = `${nameOf(edit.id)} is no longer a must-include player.`;
      next = { ...s, untouchables: toggled(s.untouchables, edit.id, edit.on), mustInclude: edit.on ? withOut(s.mustInclude, edit.id) : s.mustInclude };
      break;
    case "mustInclude":
      if (edit.on && s.untouchables.includes(edit.id)) note = `${nameOf(edit.id)} is no longer untouchable.`;
      next = { ...s, mustInclude: toggled(s.mustInclude, edit.id, edit.on), untouchables: edit.on ? withOut(s.untouchables, edit.id) : s.untouchables };
      break;
    case "target":
      if (edit.on && s.avoidPositions.includes(edit.pos)) note = `${posLabel(edit.pos, platform)} is no longer avoided.`;
      next = { ...s, targetPositions: toggled(s.targetPositions, edit.pos, edit.on), avoidPositions: edit.on ? withOut(s.avoidPositions, edit.pos) : s.avoidPositions };
      break;
    case "avoid":
      if (edit.on && s.targetPositions.includes(edit.pos)) note = `${posLabel(edit.pos, platform)} is no longer a target.`;
      next = { ...s, avoidPositions: toggled(s.avoidPositions, edit.pos, edit.on), targetPositions: edit.on ? withOut(s.targetPositions, edit.pos) : s.targetPositions };
      break;
    case "includeKDefIdp": {
      next = { ...s, includeKDefIdp: edit.on };
      if (!edit.on) {
        const cleared = [...new Set([...s.targetPositions, ...s.avoidPositions].filter((p) => EXCLUDED.has(p)))];
        if (cleared.length) {
          next = { ...next, targetPositions: s.targetPositions.filter((p) => !EXCLUDED.has(p)), avoidPositions: s.avoidPositions.filter((p) => !EXCLUDED.has(p)) };
          note = `${listText(cleared.map((p) => posLabel(p, platform)))} ${cleared.length === 1 ? "is" : "are"} no longer targeted or avoided.`;
        }
      }
      break;
    }
    case "includePicks":
      next = { ...s, includePicks: edit.on };
      break;
  }
  return { settings: normalizeTradeSettings(next), note };
}
