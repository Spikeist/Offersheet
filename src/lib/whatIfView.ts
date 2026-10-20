/**
 * The Trade Analyzer's "What if" in words (Checkpoint 7h; planner reply to Checkpoint 7g, section 4: "Parker wants to compare
 * any players and see how his odds move. … Pick players to take off your roster and any players to put on it, from any team
 * or from free agency. There's no partner and no chance they accept. Roster rules apply as usual. … Show: Helps you; the
 * odds lines, before → after: title, playoffs, and top-N when the league pays more places; the weekly lines. Other teams stay
 * as they are. Say so in one line: “Other teams don't change. To see a real trade, use the Analyzer with a partner.”").
 * PURE functions from the engine's answer (src/engine/evaluate.ts analyzeWhatIf, through the engine worker's `whatif`) and the
 * snapshot to plain words and numbers, so the page (src/components/trades/WhatIfPanel.tsx) only lays them out. They reuse the
 * trade card's own wording (src/lib/tradeView.ts: the odds lines, the weekly line, the roster moves, injury tags), so a
 * what-if reads like a trade, minus what a trade has and a what-if doesn't: no partner, no chance they accept, no Overall, no
 * offers, no Plan B, no feedback buttons (⚠️ the lead's: feedback is about offers to a manager).
 *
 * - The mode (readAnalyzerMode): the Analyzer's address names it, `?mode=whatif`, with the players (`remove`, `add`: player
 *   ids only, never a team id, as the trade's address carries none but the partner's; whatIfHref, readWhatIfDraft).
 * - The picker (whatIfChoices): my players to take off (my active roster, then my IR, each saying "IR slot"), and the players
 *   to put on, grouped by team in the league's order and then "Free agents", narrowed by where they are ("Every team and free
 *   agents", one team, or "Free agents"), a position and a name typed (accents, case and punctuation ignored), at most
 *   WHAT_IF_RESULTS_MAX at once (⚠️ ours, a display limit) with how many matched; nothing listed until one of the three
 *   narrows it (⚠️ ours: every rostered player and every free agent is several hundred rows on a phone). Free agents in the
 *   league's own order (the import ranks them by projection) within each position. At most WHAT_IF_MAX (the Analyzer's
 *   per-side limit, config.search.analyzerMaxPerSide) taken off and put on.
 * - The result (buildWhatIfView): my odds before the change (the League page's headline, or the change's own "before" with the
 *   moves it finds worth making either way: WhatIfEvaluation.before), what Helps you sums up here, the planner's line about
 *   other teams, and the card: the players taken off and put on (each put on saying where he's from, each with his injury tag),
 *   Helps you with its scale's tooltip and "Helps you here counts your odds only." (⚠️ the lead's words: no trade-value or
 *   long-term term, since nothing is traded), the odds lines and the weekly line (tradeView.ts oddsViews, weeklyLine: the
 *   card's own rules), my lineup's change, the ROS points put on and taken off, and the roster moves the numbers assume
 *   (tradeView.ts myMovesLines, in a change's words: "this trade" reads "this change", whatIfWords).
 * No FantasyCalc value anywhere (none is read: the engine's B has no trade-value term here).
 */
import type { HelpsScale } from "@/engine/benefit";
import type { WhatIfAnalysis, WhatIfEvaluation, WhatIfProposal } from "@/engine/evaluate";
import { POSITIONS, type LeagueSnapshot, type Pos } from "@/engine/model";
import type { Reward } from "@/engine/reward";
import { fmtSigned, fmtWhole } from "./format";
import { PLATFORM_LABEL, posLabel } from "./labels";
import { printedScore } from "./printed";
import {
  ANALYZER_MAX_PER_SIDE,
  ANALYZER_PATH,
  IR_SLOT_TEXT,
  ROSTER_MOVES_HEADING,
  assetView,
  helpsScaleText,
  incomingInjuryNote,
  injuryTagText,
  listText,
  myMovesLines,
  myRosterIds,
  oddsViews,
  percentText,
  perWeek,
  rosNoteOf,
  seasonEndOf,
  titleOddsText,
  topChance,
  topPlacesOf,
  weeklyLine,
  weighedOddsWords,
  type AssetView,
  type CardContext,
  type NumberView,
  type OddsView,
  type PlayerChoice,
  type SnapshotPart,
  type WeeklyLineView,
} from "./tradeView";

// ---------------------------------------------------------------------------------------------
// The mode and the address

/** The Trade Analyzer's two modes (Checkpoint 7h): a trade with a team, or a what-if. */
export type AnalyzerMode = "trade" | "whatif";

/** The mode switch's choices, the trade first (the Analyzer's own). */
export const ANALYZER_MODES: readonly { value: AnalyzerMode; label: string }[] = [
  { value: "trade", label: "Trade with a team" },
  { value: "whatif", label: "What if" },
];

/** The mode the Analyzer's address names: `?mode=whatif`, else a trade. */
export function readAnalyzerMode(search: string | null | undefined): AnalyzerMode {
  return new URLSearchParams(search ?? "").get("mode") === "whatif" ? "whatif" : "trade";
}

/**
 * The query a mode of the Analyzer reads its draft from (WhatIfPanel.tsx useModeQuery, pure): the address's when it names
 * `mode`, else the last one that did (`last`, "" before any). Each mode's evaluation writes its own mode's address, which names
 * nothing of the other's, so the other mode keeps reading the address it last had (the review of Checkpoint 7h: a trade a card's
 * "Open in Analyzer" had prefilled emptied once a what-if was evaluated, and its result read as changed).
 */
export function modeQueryOf(last: string, query: string, mode: AnalyzerMode): string {
  return readAnalyzerMode(query) === mode ? query : last;
}

/** A what-if being built: my players to take off and the players to put on (canonical ids, in the order picked). */
export interface WhatIfDraft {
  remove: string[];
  add: string[];
}

export const EMPTY_WHAT_IF: WhatIfDraft = { remove: [], add: [] };

/** At most this many players taken off, and as many put on (the Analyzer's per-side limit, config.search.analyzerMaxPerSide). */
export const WHAT_IF_MAX: number = ANALYZER_MAX_PER_SIDE;

/** My players a what-if can take off: my active roster, then my IR, each once (taxi players can't be, as in a trade). */
function removable(snapshot: Pick<LeagueSnapshot, "teams">, myTeamId: string | null): string[] {
  const team = myTeamId ? snapshot.teams.find((t) => t.id === myTeamId) : undefined;
  return team ? [...new Set([...team.roster, ...team.ir])] : [];
}

/** Where a player a what-if can put on is: another team's active roster or IR, or the free agents (snapshot order). */
interface Source {
  teamId: string | null;
  ir: boolean;
}

/** Every player a what-if can put on (the engine's rules, evaluate.ts whatIfProblem): other teams' active rosters and IR, then the free agents. */
function puttable(snapshot: Pick<LeagueSnapshot, "teams" | "freeAgents">, myTeamId: string | null): Map<string, Source> {
  const out = new Map<string, Source>();
  const mine = new Set(myTeamId ? (snapshot.teams.find((t) => t.id === myTeamId)?.taxi ?? []) : []);
  for (const id of removable(snapshot, myTeamId)) mine.add(id);
  for (const t of snapshot.teams) {
    if (t.id === myTeamId) continue;
    for (const id of t.roster) if (!out.has(id) && !mine.has(id)) out.set(id, { teamId: t.id, ir: false });
    for (const id of t.ir) if (!out.has(id) && !mine.has(id)) out.set(id, { teamId: t.id, ir: true });
  }
  for (const id of snapshot.freeAgents ?? []) if (!out.has(id) && !mine.has(id)) out.set(id, { teamId: null, ir: false });
  return out;
}

function keepIds(ids: readonly string[], allowed: (id: string) => boolean, taken: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  for (const id of ids) if (allowed(id) && !taken.has(id) && !out.includes(id) && out.length < WHAT_IF_MAX) out.push(id);
  return out;
}

/**
 * The what-if the Analyzer's address names (`?mode=whatif&remove=…&add=…`): my players to take off from my active roster and IR,
 * and players to put on from the other teams' active rosters and IR or the free agents, each once, at most WHAT_IF_MAX of each.
 * Anything else is ignored (and an address that isn't a what-if's names none).
 */
export function readWhatIfDraft(search: string | null | undefined, snapshot: Pick<LeagueSnapshot, "teams" | "freeAgents">, myTeamId: string | null): WhatIfDraft {
  if (readAnalyzerMode(search) !== "whatif") return EMPTY_WHAT_IF;
  const q = new URLSearchParams(search ?? "");
  const mine = new Set(removable(snapshot, myTeamId));
  const others = puttable(snapshot, myTeamId);
  const remove = keepIds(q.getAll("remove"), (id) => mine.has(id));
  return { remove, add: keepIds(q.getAll("add"), (id) => others.has(id), new Set(remove)) };
}

/** The Analyzer's address for a what-if: the mode and player ids only (never prefetched: the pages' links that carry ids aren't). */
export function whatIfHref(draft: WhatIfDraft): string {
  const q = new URLSearchParams();
  q.set("mode", "whatif");
  for (const id of draft.remove) q.append("remove", id);
  for (const id of draft.add) q.append("add", id);
  return `${ANALYZER_PATH}?${q.toString()}`;
}

/** A draft's identity, whatever the order its players were picked in (to tell whether a result is for it). */
export function whatIfDraftKey(draft: WhatIfDraft): string {
  return `whatif|${[...draft.remove].sort().join(",")}|${[...draft.add].sort().join(",")}`;
}

/** The draft as the engine's what-if, once it names at least one player (the page asks for one first). */
export function whatIfProposalOf(draft: WhatIfDraft): WhatIfProposal | null {
  return draft.remove.length + draft.add.length ? { remove: [...draft.remove], add: [...draft.add] } : null;
}

/** The what-if being built in a sentence ("You take off Bo Nix; you put on Malik Willis."), null before any player is picked. */
export function whatIfSummary(draft: WhatIfDraft, snapshot: Pick<LeagueSnapshot, "players">): string | null {
  if (!draft.remove.length && !draft.add.length) return null;
  const names = (ids: readonly string[]) => listText(ids.map((id) => snapshot.players[id]?.name ?? "a player"));
  const text = `You take off ${draft.remove.length ? names(draft.remove) : "nobody"}; you put on ${draft.add.length ? names(draft.add) : "nobody"}`;
  // A name can end the sentence with its own period ("Jr.").
  return text.endsWith(".") ? text : `${text}.`;
}

// ---------------------------------------------------------------------------------------------
// The picker

/** "Every team and free agents" (whatIfChoices' `from`). */
export const ANY_SOURCE = "any";
/** "Free agents" (whatIfChoices' `from`): never a team id (teams' ids are the platform's, none is this word). */
export const FREE_AGENTS_SOURCE = "free-agents";
/** "Any position". */
export const ANY_POSITION = "any";

/** What the put-on list is narrowed by: where (ANY_SOURCE, a team id, FREE_AGENTS_SOURCE), a position (ANY_POSITION or one), a name. */
export interface WhatIfFilter {
  from: string;
  pos: string;
  query: string;
}

export const DEFAULT_WHAT_IF_FILTER: WhatIfFilter = { from: ANY_SOURCE, pos: ANY_POSITION, query: "" };

/** At most this many players the put-on list shows at once (⚠️ ours, a display limit, not a model number: a phone's list). */
export const WHAT_IF_RESULTS_MAX = 30;

/** "Free agents", the put-on list's last group. */
export const FREE_AGENTS_LABEL = "Free agents";

/** What the put-on list says before anything narrows it. */
export const WHAT_IF_PROMPT = "Type a name, or choose a team, free agents or a position, to see players.";

/** One group of the put-on list: a team's players (its name), or the free agents. */
export interface WhatIfGroup {
  id: string;
  name: string;
  players: PlayerChoice[];
}

/** A player picked to put on: his name, position and NFL team, where he's from, and his injury tag. */
export interface PutOnView {
  id: string;
  name: string;
  detail: string;
  injury: AssetView["injury"];
}

export interface WhatIfChoices {
  /** My players to take off (active roster, then IR: "IR slot"), checked as in the draft. */
  mine: PlayerChoice[];
  /** Where to look: "Every team and free agents", each other team (the league's order), "Free agents". */
  sources: { value: string; label: string }[];
  /** "Any position", then the positions players to put on hold (POSITIONS order), named as the league does ("D/ST" on ESPN). */
  positions: { value: string; label: string }[];
  /** The put-on list, narrowed by the filter, grouped by team then free agents (empty before anything narrows it). */
  groups: WhatIfGroup[];
  /** WHAT_IF_PROMPT before anything narrows the list; null otherwise. */
  prompt: string | null;
  /** "No player matches." when narrowed to none; null otherwise. */
  none: string | null;
  /** "Showing 30 of 85. …" when the list is cut at WHAT_IF_RESULTS_MAX; null otherwise. */
  more: string | null;
  /** The players picked to put on, in the order picked. */
  picked: PutOnView[];
  /** "Up to 4 players to take off and 4 to put on, …" */
  limitText: string;
}

const POS_RANK = new Map<Pos, number>(POSITIONS.map((p, i) => [p, i]));

/** A name or a typed query as matched: no accents, lower case, punctuation as spaces ("Ja'Marr Chase" → "ja marr chase"). */
export function searchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "QB · TEN", "WR · CIN · IR slot" (a player on IR: he'd come from an IR slot). */
function choiceDetail(snapshot: SnapshotPart, id: string, ir: boolean): string {
  const view = assetView({ kind: "player", id }, snapshot);
  return ir ? [view.detail, IR_SLOT_TEXT].filter(Boolean).join(" · ") : view.detail;
}

/** Where a player put on is from, in words: "from Team 4", "from Team 4's IR", "free agent". */
function fromWords(snapshot: SnapshotPart, source: Source | undefined): string {
  if (!source || source.teamId === null) return "free agent";
  const name = snapshot.teams.find((t) => t.id === source.teamId)?.name ?? "another team";
  return source.ir ? `from ${/s$/i.test(name) ? `${name}'` : `${name}'s`} IR` : `from ${name}`;
}

/**
 * What the what-if form offers (the file header): my players to take off, where to look and which positions, the put-on list
 * narrowed by `filter`, and the players picked. Unchecked players are disabled while their side is full (WHAT_IF_MAX).
 */
export function whatIfChoices(snapshot: SnapshotPart & Pick<LeagueSnapshot, "freeAgents">, myTeamId: string | null, draft: WhatIfDraft, filter: WhatIfFilter = DEFAULT_WHAT_IF_FILTER): WhatIfChoices {
  const name = (id: string) => snapshot.players[id]?.name ?? id;
  const rank = (id: string) => POS_RANK.get(snapshot.players[id]?.pos as Pos) ?? POSITIONS.length;
  const byPosThenName = (a: string, b: string) => rank(a) - rank(b) || name(a).localeCompare(name(b)) || (a < b ? -1 : a > b ? 1 : 0);
  const choice = (id: string, ir: boolean, picked: readonly string[]): PlayerChoice => {
    const view = assetView({ kind: "player", id }, snapshot);
    const checked = picked.includes(id);
    return { id, name: view.name, detail: choiceDetail(snapshot, id, ir), injury: view.injury, checked, disabled: picked.length >= WHAT_IF_MAX && !checked };
  };

  // My players: active roster, then IR.
  const myIR = new Set(myTeamId ? (snapshot.teams.find((t) => t.id === myTeamId)?.ir ?? []) : []);
  const mine = [...removable(snapshot, myTeamId)].sort(byPosThenName).map((id) => choice(id, myIR.has(id), draft.remove));

  // Players to put on, and where they are.
  const others = puttable(snapshot, myTeamId);
  const otherTeams = snapshot.teams.filter((t) => t.id !== myTeamId);
  const sources = [{ value: ANY_SOURCE, label: "Every team and free agents" }, ...otherTeams.map((t) => ({ value: t.id, label: t.name })), { value: FREE_AGENTS_SOURCE, label: FREE_AGENTS_LABEL }];
  const present = new Set<Pos>();
  for (const id of others.keys()) {
    const pos = snapshot.players[id]?.pos;
    if (pos) present.add(pos);
  }
  const positions = [{ value: ANY_POSITION, label: "Any position" }, ...POSITIONS.filter((p) => present.has(p)).map((p) => ({ value: p, label: posLabel(p, snapshot.platform) }))];

  const from = sources.some((s) => s.value === filter.from) ? filter.from : ANY_SOURCE;
  const pos = positions.some((p) => p.value === filter.pos) ? filter.pos : ANY_POSITION;
  const query = searchText(filter.query);
  const matches = (id: string): boolean => {
    if (pos !== ANY_POSITION && snapshot.players[id]?.pos !== pos) return false;
    return !query || searchText(name(id)).includes(query);
  };
  const picked = draft.add.map((id): PutOnView => {
    const view = assetView({ kind: "player", id }, snapshot);
    return { id, name: view.name, detail: [view.detail, fromWords(snapshot, others.get(id))].filter(Boolean).join(" · "), injury: view.injury };
  });
  const limitText = `Up to ${WHAT_IF_MAX} players to take off and ${WHAT_IF_MAX} to put on, from the active rosters and IR or the free agents (players on a taxi squad can't be moved here).`;
  const base = { mine, sources, positions, picked, limitText };

  if (from === ANY_SOURCE && pos === ANY_POSITION && !query) return { ...base, groups: [], prompt: WHAT_IF_PROMPT, none: null, more: null };

  // The groups: the teams in the league's order (active roster then IR, by position then name), then the free agents (the
  // league's order within each position: the import ranks them by projection).
  const lists: { id: string; name: string; ids: string[] }[] = [];
  for (const t of otherTeams) {
    if (from !== ANY_SOURCE && from !== t.id) continue;
    const ids = [...others.entries()].filter(([, s]) => s.teamId === t.id).map(([id]) => id).filter(matches).sort(byPosThenName);
    if (ids.length) lists.push({ id: t.id, name: t.name, ids });
  }
  if (from === ANY_SOURCE || from === FREE_AGENTS_SOURCE) {
    const fa = [...others.entries()].filter(([, s]) => s.teamId === null).map(([id]) => id).filter(matches);
    const order = new Map(fa.map((id, i) => [id, i]));
    fa.sort((a, b) => rank(a) - rank(b) || (order.get(a) ?? 0) - (order.get(b) ?? 0));
    if (fa.length) lists.push({ id: FREE_AGENTS_SOURCE, name: FREE_AGENTS_LABEL, ids: fa });
  }
  const total = lists.reduce((s, l) => s + l.ids.length, 0);
  let room = WHAT_IF_RESULTS_MAX;
  const groups: WhatIfGroup[] = [];
  for (const l of lists) {
    if (room <= 0) break;
    const ids = l.ids.slice(0, room);
    room -= ids.length;
    groups.push({ id: l.id, name: l.name, players: ids.map((id) => choice(id, others.get(id)?.ir === true, draft.add)) });
  }
  const shown = WHAT_IF_RESULTS_MAX - room;
  const more = total > shown ? `Showing ${shown} of ${fmtWhole(total)}. Choose a team or a position, or type more of a name, to narrow it.` : null;
  return { ...base, groups, prompt: null, none: total ? null : "No player matches.", more };
}

// ---------------------------------------------------------------------------------------------
// The result

/** The planner's line under a what-if's result (section 4: "Say so in one line"). */
export const WHAT_IF_OTHER_TEAMS = "Other teams don't change. To see a real trade, use the Analyzer with a partner.";

/** Under the "Helps you" number (⚠️ the lead's words): a what-if trades nothing, so no trade value or long-term value is weighed. */
export const WHAT_IF_ODDS_ONLY = "Helps you here counts your odds only.";

/** A what-if's card: the change and my numbers (the file header). */
export interface WhatIfCardView {
  key: string;
  /** "You take off" / "You put on": each player with position, NFL team and his injury tag; one put on says where he's from. */
  remove: AssetView[];
  add: AssetView[];
  /** Helps you as printed (0 when the change doesn't help; "—" without odds), its scale's tooltip. */
  helps: NumberView;
  /** WHAT_IF_ODDS_ONLY. */
  helpsNote: string;
  /** My title, top-N (when the league pays 2nd or 3rd place) and playoff odds before → after (tradeView.ts oddsViews). */
  odds: OddsView[];
  /** The weeks whose win chance the change moves (tradeView.ts weeklyLine), or null. */
  weekly: WeeklyLineView | null;
  /** "Your lineup", the change's lineup points a week (regular season, playoffs). */
  lineup: string;
  /** "You put on 142 ROS pts, take off 118". */
  ros: string;
  /** When my starting lineup moves the other way from those points (tradeView.ts rosNoteOf), else null. */
  rosNote: string | null;
  /** For injury-tagged players put on: what their projections assume (tradeView.ts incomingInjuryNote), else null. */
  injuryNote: string | null;
  /** The roster moves the numbers assume, in a change's words (whatIfWords on tradeView.ts myMovesLines); empty when none. */
  moves: string[];
  /** ROSTER_MOVES_HEADING. */
  movesHeading: string;
}

/** The what-if's result in words: my odds before the change, what Helps you sums up here, the card, or why it can't be made. */
export interface WhatIfView {
  /** "Your odds before this change: 62% to make the playoffs, 9.2% to win the title." and what they count, with a card only; null otherwise. */
  baseline: string | null;
  baselineNote: string | null;
  /** What Helps you sums up here, and its scale, with a card only; null otherwise. */
  helpsInfo: string | null;
  /** The planner's line about other teams (WHAT_IF_OTHER_TEAMS), with a card only; null otherwise. */
  otherTeams: string | null;
  card: WhatIfCardView | null;
  illegal: string | null;
  notes: string[];
  /** The scale Helps you was scored on (WhatIfAnalysis.helpsScale), null when unknown. */
  helpsScale: HelpsScale | null;
  /** The reward B was weighed by (WhatIfAnalysis.reward), null when none. */
  reward: Pick<Reward, "goal" | "shares"> | null;
}

/**
 * A trade's roster-move words said of a what-if: "this trade" → "this change" (myMovesLines' "Assumed with or without this
 * trade", "This trade makes a waiver move worthwhile", "whom this trade brings in", "(WR, from this trade)", …), whatever the
 * case of its first letter. ⚠️ Ours: the words are the trade card's own (one wording to keep in step), read by this rule.
 */
export function whatIfWords(line: string): string {
  return line.replace(/\b([Tt])his trade\b/g, "$1his change");
}

/**
 * My odds before the change in words, the "before" of every line on the card: the League page's headline odds (every team
 * after its likely pickups), or the change's own "before" when it finds moves worth making either way (`own`); the top-N
 * chance between them when the league pays 2nd or 3rd place (tradeView.ts baselineLines' rules).
 */
function baselineOf(baseline: CardContext["baseline"], reward: CardContext["reward"], own: boolean): { text: string; note: string } | null {
  if (!baseline || baseline.pPlayoffs === null || !Number.isFinite(baseline.pPlayoffs)) return null;
  const title = baseline.pTitle !== null && Number.isFinite(baseline.pTitle) ? `, ${titleOddsText(baseline.pTitle)} to win the title` : "";
  const places = topPlacesOf(reward);
  const topP = places ? topChance(baseline.prizes, places) : null;
  const top = places && topP !== null ? `, ${percentText(Math.min(1, Math.max(0, topP)))} to finish in the top ${places}` : "";
  return {
    text: `Your odds before this change: ${percentText(baseline.pPlayoffs)} to make the playoffs${top}${title}.`,
    note: own
      ? "They count the free-agent pickups that would help each team, as on the League page, and the moves this change finds worth making either way; its odds start from them."
      : "As on the League page, they count the free-agent pickups that would help each team, and this change's odds start from them.",
  };
}

/**
 * The what-if's answer in words (the file header). `result.baseline`, my odds before any change (the worker sends them with the
 * answer), gives the card's odds their "before" unless the change has its own (WhatIfEvaluation.before); without either, the
 * odds lines show the changes alone. `lastNflWeek`: the NFL's last week, for "Out for the season" (tradeView.ts seasonEndOf);
 * `blendOn`: whether the market blend reaches anyone (tradeView.ts marketBlendOn), for what a hurt player's projection assumes.
 */
export function buildWhatIfView(
  result: WhatIfAnalysis & { baseline?: CardContext["baseline"] },
  snapshot: SnapshotPart,
  opts: { lastNflWeek?: number | undefined; blendOn?: boolean | undefined } = {},
): WhatIfView {
  const e = result.illegal ? null : result.evaluation;
  const helpsScale = result.helpsScale ?? null;
  const reward = result.reward ?? null;
  const card = e ? whatIfCard(e, snapshot, result.baseline ?? null, reward, helpsScale, opts) : null;
  const odds = card && e ? baselineOf(e.before ?? result.baseline ?? null, reward, e.before !== undefined) : null;
  return {
    baseline: odds?.text ?? null,
    baselineNote: odds?.note ?? null,
    helpsInfo: card ? `Helps you (0–100) sums up how much ${weighedOddsWords(reward, helpsScale)} rise. ${helpsScaleText(helpsScale)}` : null,
    otherTeams: card ? WHAT_IF_OTHER_TEAMS : null,
    card,
    illegal: result.illegal,
    notes: [...new Set(result.notes)],
    helpsScale,
    reward,
  };
}

/** The card (WhatIfCardView) for an evaluation. */
function whatIfCard(
  e: WhatIfEvaluation,
  snapshot: SnapshotPart,
  baseline: CardContext["baseline"],
  reward: CardContext["reward"],
  scale: HelpsScale | null,
  opts: { lastNflWeek?: number | undefined; blendOn?: boolean | undefined },
): WhatIfCardView {
  const end = seasonEndOf(snapshot.settings, opts.lastNflWeek);
  const source = snapshot.platform === "manual" ? undefined : PLATFORM_LABEL[snapshot.platform];
  const others = snapshot.teams.filter((t) => t.id !== e.detail.myTeamId);
  const sourceOf = (id: string): Source | undefined => {
    for (const t of others) {
      if (t.roster.includes(id)) return { teamId: t.id, ir: false };
      if (t.ir.includes(id)) return { teamId: t.id, ir: true };
    }
    return { teamId: null, ir: false };
  };
  const asset = (id: string, side: "give" | "get"): AssetView => {
    const view = assetView({ kind: "player", id }, snapshot);
    const tag = e.tagged.find((t) => t.playerId === id && t.side === side);
    const detail = side === "get" ? [view.detail, fromWords(snapshot, sourceOf(id))].filter(Boolean).join(" · ") : view.detail;
    return { ...view, detail, status: tag ? { text: injuryTagText(tag, end, source), tone: view.injury?.tone ?? "muted" } : null };
  };
  const value = printedScore(e.tradeScore, e.b);
  const roster = myRosterIds(snapshot, e.detail.myTeamId, { get: e.proposal.add.map((id) => ({ kind: "player" as const, id })) });
  return {
    key: e.key,
    remove: e.proposal.remove.map((id) => asset(id, "give")),
    add: e.proposal.add.map((id) => asset(id, "get")),
    helps: { value, srText: value === "—" ? "not scored: the season couldn't be simulated" : null, title: helpsScaleText(scale) },
    helpsNote: WHAT_IF_ODDS_ONLY,
    odds: oddsViews(e, e.before ?? baseline, reward),
    weekly: weeklyLine(e.detail.winChance),
    lineup: `${perWeek(e.dPPW)} in the regular season, ${fmtSigned(e.dPPWPlayoffs, 1)} in the playoffs`,
    ros: `You put on ${fmtWhole(e.ros.added)} ROS pts, take off ${fmtWhole(e.ros.removed)}`,
    rosNote: rosNoteOf({ ros: { given: e.ros.removed, received: e.ros.added }, detail: { weekly: e.detail.weekly } }),
    injuryNote: incomingInjuryNote(e.tagged, snapshot, [], opts.blendOn ?? true),
    moves: myMovesLines(e.myMoves, snapshot, "the other team", { roster }).map(whatIfWords),
    movesHeading: ROSTER_MOVES_HEADING,
  };
}

/**
 * The status line once an answer is in (announced: the line is a live region; the trade's analysisStatus words it the same
 * way): why the change can't be made, or its Helps you as printed.
 */
export function whatIfStatus(view: Pick<WhatIfView, "illegal" | "card">): string {
  if (view.illegal) return `This change can't be made: ${view.illegal}`;
  return view.card ? `Evaluated: Helps you ${view.card.helps.srText ?? view.card.helps.value}.` : "Evaluated.";
}
