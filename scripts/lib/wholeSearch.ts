/**
 * Section 12 of `npm run trade:report` (Checkpoint 7h; planner reply to Checkpoint 7g, sections 2 and 3): the app's search
 * against a brute force and against the Thorough search, under one setting.
 *
 * The brute force (search.ts TradeSearchOptions.mode "bruteForce", a report switch the app never sets: the file header of
 * search.ts, "Whole rosters") screens every 1-for-1, 1-for-2, 2-for-1 and 2-for-2 with every partner from whole rosters with
 * the screening objective the app's search uses, then evaluates the best of them exactly and plays them out (its funnel:
 * config.search.bruteForce). The planner's words: "screen every 1-for-1, 1-for-2, 2-for-1 and 2-for-2 trade with every
 * partner. Use whole rosters, not just the pools, and the same screening objective. Then run exact evaluation and the
 * simulation on the best of them." and "Report how many of its top 10 and top 25 by Overall the normal search also found, the
 * best trade the normal search missed with its numbers".
 *
 * Two readings of "its top 10 and top 25 by Overall": `raw`, the brute force's finalists by EG (B × P_complete, Overall's
 * order) on the ranking block, past the §10 guards and the minimum chance as printed, before the list's variety rules (so
 * near-duplicates count one each); and `capped`, the brute force's own card list (rank.ts: the variety rules, the merge), its
 * top 10 and every card. For each, how many the app's search evaluated exactly, made a finalist the ranking picked, and
 * showed: as a card, or among a card's offers (merged into it, or promoted from it), or dropped for a better version it shows.
 * Each trade the app's search missed says where it fell out, read off the app's own rules: its candidates screened again on
 * the same context (search.buildPools, search.partnerCandidates, search.screeningRules and search.shortlistOf, its own calls,
 * as trade-report's searchGap does).
 *
 * The Thorough search (mode "thorough": the Trade Finder's switch, config.search.thorough): its time and the cards it shows
 * that the app's search doesn't. Each search (the brute force and the Thorough one) runs cold on a trade context of its own,
 * and is compared with the app's search under the same setting (deterministic: the same seasons on every context built from
 * the same data, settings and moment).
 */
import { acceptanceLabel } from "@/engine/acceptance";
import { config } from "@/engine/config";
import { buildTradeContext, tradeInternals, type Screened, type TradeContext } from "@/engine/evaluate";
import { atMostWaiverCredit, buildPools, partnerCandidates, runTradeSearch, screeningRules, searchStateOf, shortlistOf, type SearchMode, type SearchState } from "@/engine/search";
import type { LeagueSnapshot } from "@/engine/model";
import type { ModelInputs } from "@/engine/inputs";
import type { TradeSettings } from "@/engine/settings";
import type { TradeEvaluationCore, TradeProposal, TradeSearchResult } from "@/engine/tradeModel";
import { acceptText } from "@/lib/printed";

const EPS = 1e-9;

/** How many of a list of the brute force's trades the app's search found, at each stage. */
export interface WholeFound {
  n: number;
  /** Evaluated exactly (SearchState.exactByKey, or a version of a card's offers it evaluated: SearchState.versions). */
  exact: number;
  /** A finalist the ranking picked (SearchState.finals less the "Helps both" extras). */
  finalist: number;
  /** A card of its Overall list. */
  card: number;
  /** A card, or among a card's offers (merged into it: MergedCards.overall, promoted cards' originals among them), or dropped for a better version it shows (MergedCards.dominated). */
  shown: number;
}

/** Where a trade fell out of the app's search, earliest stage first (causeOf). */
export type WholeStage = "size" | "notInGive" | "notInGet" | "unreached" | "rules" | "keep" | "shortlist" | "exact" | "extra" | "finalist" | "merged" | "dropped" | "card";

export interface WholeRow {
  place: number;
  key: string;
  proposal: TradeProposal;
  /** As printed: Helps you, the chance they accept (P_complete, the nearest 5%) with its label, Overall. */
  helps: number | null;
  chance: string;
  label: string;
  overall: number | null;
  b: number | null;
  /** "1-for-2" and the like. */
  shape: string;
  stage: WholeStage;
  /** The stage in words, read off the app's own rules (causeOf). */
  why: string;
}

export interface WholeRun {
  /** Context and search, cold (one fresh trade context), ms. */
  coldMs: number;
  counts: TradeSearchResult["counts"];
  timings: Record<string, number>;
  cards: number;
}

export interface WholeSearchSetting {
  label: string;
  minChance: number;
  normal: { cards: number; counts: TradeSearchResult["counts"]; promoted: number };
  brute: WholeRun & { finalists: number; raw: number };
  raw: { top10: WholeFound; top25: WholeFound; rows: WholeRow[] };
  capped: { top10: WholeFound; all: WholeFound };
  /** The best trade by EG the app's search didn't evaluate exactly (not even as a version of a card's offers), and the best it doesn't show (raw), or null. */
  missed: WholeRow | null;
  missedShown: WholeRow | null;
  /** The Thorough search: its run, and its cards the app's search doesn't show (as WholeRow, numbers as its cards print them). */
  thorough: WholeRun & { newCards: WholeRow[]; threeASide: number };
}

const playerIds = (side: TradeProposal["give"]): string[] => side.flatMap((a) => (a.kind === "player" ? [a.id] : []));
const egOf = (c: Pick<TradeEvaluationCore, "b" | "pComplete">): number => (c.b === null ? Number.NEGATIVE_INFINITY : c.b * c.pComplete);
const byEg = (a: TradeEvaluationCore, b: TradeEvaluationCore): number => egOf(b) - egOf(a) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const byObjective = (a: Screened, b: Screened): number => (Math.abs(b.objective - a.objective) > EPS ? b.objective - a.objective : a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const shapeOf = (p: TradeProposal): string => `${playerIds(p.give).length}-for-${playerIds(p.get).length}`;

function drain<T>(it: Generator<void, T, void>): T {
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** The printed chance's own step (acceptance's display step), as the minimum-chance filter judges it. */
const printedChance = (p: number): number => Math.round(p / config.acceptance.displayStep) * config.acceptance.displayStep;

/**
 * The brute force's raw ranking (the file header): its finalists the ranking picked by EG, past the §10 guards (B > 0, not
 * hidden by the market guard) and the minimum chance as printed.
 */
export function rawRanking(state: Pick<SearchState, "finals" | "helpsBothExtras">, minChance: number): TradeEvaluationCore[] {
  const extras = new Set(state.helpsBothExtras);
  return state.finals.filter((c) => !extras.has(c.key) && c.b !== null && c.b > 0 && !c.flags.hiddenByMarket && printedChance(c.pComplete) >= minChance - EPS).sort(byEg);
}

/** What the app's search did with each trade: its keys at each stage, and where a trade fell out (causeOf). */
interface NormalReading {
  state: SearchState;
  cards: Map<string, number>;
  merged: Map<string, string>;
  dropped: Map<string, string>;
  finalists: Set<string>;
  extras: Set<string>;
  causeOf: (key: string, proposal: TradeProposal) => { stage: WholeStage; why: string };
}

function readNormal(ctx: TradeContext, result: TradeSearchResult, name: (id: string) => string): NormalReading | null {
  const state = searchStateOf(result);
  const I = tradeInternals(ctx);
  if (!state || I.blocked || !I.me) return null;
  const cards = new Map(result.trades.map((t, i) => [t.key, i + 1]));
  const merged = new Map((result.merged?.overall ?? []).map((m) => [m.key, m.into]));
  const dropped = new Map((result.merged?.dominated ?? []).filter((d) => d.list === "overall").map((d) => [d.key, d.by]));
  const extras = new Set(state.helpsBothExtras);
  const finalists = new Set(state.finals.filter((c) => !extras.has(c.key)).map((c) => c.key));
  // The app's candidates screened again on its own context (searchGap's reading), with its keep and its shortlist.
  const pools = buildPools(I, state.settings, null);
  const cheap = atMostWaiverCredit(I);
  const screened = new Map<string, Screened>();
  const ruledRank = new Map<string, number>();
  const lists: Screened[][] = [];
  for (const partner of pools.partners) {
    const H = pools.get.get(partner.id) as { pool: string[]; forced: string[] };
    const list = drain(partnerCandidates(I, partner, { give: pools.give, forcedGive: pools.forcedGive, get: H.pool, forcedGet: H.forced }, state.settings.maxPerSide, { screened: 0 }));
    lists.push(list);
    for (const s of list) screened.set(s.key, s);
    screeningRules(list, cheap)
      .sort(byObjective)
      .forEach((s, i) => ruledRank.set(s.key, i + 1));
  }
  const shortlist = shortlistOf(lists, cheap);
  const kept = new Map<string, number>();
  for (const list of lists)
    screeningRules(list, cheap)
      .sort(byObjective)
      .slice(0, Math.max(0, Math.floor(config.search.keptPerPartner)))
      .forEach((s) => kept.set(s.key, 0));
  [...kept.keys()]
    .map((k) => screened.get(k) as Screened)
    .sort(byObjective)
    .forEach((s, i) => kept.set(s.key, i + 1));
  const inShortlist = new Set(shortlist.map((s) => s.key));
  const place = (key: string) => (cards.has(key) ? `idea ${cards.get(key)}` : "an idea");
  const causeOf = (key: string, proposal: TradeProposal): { stage: WholeStage; why: string } => {
    const team = `Team ${proposal.partnerId}`;
    if (cards.has(key)) return { stage: "card", why: `trade idea ${cards.get(key)}` };
    if (merged.has(key)) return { stage: "merged", why: `among ${place(merged.get(key) as string)}'s offers (merged into it)` };
    if (dropped.has(key)) return { stage: "dropped", why: `dropped for a better version of the same trade (${place(dropped.get(key) as string)})` };
    if (finalists.has(key)) return { stage: "finalist", why: "a finalist; the list's variety rules leave it out" };
    if (extras.has(key)) return { stage: "extra", why: `played out as a "Helps both" extra; only that list ranks it` };
    if (state.exactByKey.has(key)) return { stage: "exact", why: "evaluated exactly, not among the finalists" };
    if (state.versions.has(key)) return { stage: "exact", why: "evaluated exactly as a version of an idea's offers (“How to offer it”), not among the finalists" };
    const give = playerIds(proposal.give);
    const get = playerIds(proposal.get);
    const most = Math.max(give.length, get.length);
    if (most > state.settings.maxPerSide) return { stage: "size", why: `${most} players on a side, past the search's ${state.settings.maxPerSide} a side (Settings: max players per side)` };
    const H = pools.get.get(proposal.partnerId);
    const outG = give.filter((id) => !pools.give.includes(id));
    const outH = get.filter((id) => !(H?.pool.includes(id) || H?.forced.includes(id)));
    if (outG.length) return { stage: "notInGive", why: `${outG.map(name).join(" and ")} ${outG.length === 1 ? "isn't" : "aren't"} in your give pool G (your top ${config.search.givePool} by surplus score with your trade chips)` };
    if (outH.length) return { stage: "notInGet", why: `${outH.map(name).join(" and ")} ${outH.length === 1 ? "isn't" : "aren't"} in ${team}'s get pool H` };
    const s = screened.get(key);
    if (!s) return { stage: "unreached", why: `in the pools, but no candidate rule reaches it (2-for-2s past the first ${config.search.exhaustive.twoForTwoTop} of each pool, outside the beams)` };
    const r = ruledRank.get(key);
    if (r === undefined) return { stage: "rules", why: "screened; the value window or a cheaper version of it leaves it out" };
    if (r > config.search.keptPerPartner) return { stage: "keep", why: `screened #${r} of ${team}'s by the screening objective; the search keeps ${config.search.keptPerPartner} a partner` };
    if (!inShortlist.has(key)) return { stage: "shortlist", why: `kept, #${kept.get(key) ?? "?"} of every partner's by the screening objective; exact evaluation takes the best ${config.search.exactEvaluationMax}` };
    return { stage: "shortlist", why: "shortlisted, not evaluated exactly (illegal on exact evaluation)" };
  };
  return { state, cards, merged, dropped, finalists, extras, causeOf };
}

function foundOf(keys: readonly string[], n: NormalReading): WholeFound {
  return {
    n: keys.length,
    exact: keys.filter((k) => n.state.exactByKey.has(k) || n.state.versions.has(k)).length,
    finalist: keys.filter((k) => n.finalists.has(k)).length,
    card: keys.filter((k) => n.cards.has(k)).length,
    shown: keys.filter((k) => n.cards.has(k) || n.merged.has(k) || n.dropped.has(k)).length,
  };
}

function rowOf(c: TradeEvaluationCore, place: number, n: NormalReading): WholeRow {
  const { stage, why } = n.causeOf(c.key, c.proposal);
  return { place, key: c.key, proposal: c.proposal, helps: c.tradeScore, chance: acceptText(c.pComplete), label: acceptanceLabel(c.pComplete), overall: c.overall, b: c.b, shape: shapeOf(c.proposal), stage, why };
}

function timedRun(snapshot: LeagueSnapshot, inputs: ModelInputs, opts: { now: Date; clock: () => number; settings: TradeSettings; scenarios?: number }, mode: SearchMode): { result: TradeSearchResult; run: WholeRun } {
  const t0 = opts.clock();
  const ctx = buildTradeContext(snapshot, inputs, { now: opts.now, settings: opts.settings, ...(opts.scenarios !== undefined ? { scenarios: opts.scenarios } : {}) });
  const result = runTradeSearch(ctx, { settings: opts.settings, clock: opts.clock, mode });
  const coldMs = opts.clock() - t0;
  const timings = Object.fromEntries(Object.entries(result.timings).filter(([, v]) => Number.isFinite(v)).map(([k, v]) => [k, v as number]));
  return { result, run: { coldMs, counts: result.counts, timings, cards: result.trades.length } };
}

/**
 * Section 12 under one setting (the file header): the brute force and the Thorough search, each cold on a trade context of its
 * own, against the app's search under that setting (`normal`: its context and result). Null when the app's search stopped
 * before ranking.
 */
export function wholeSearchSetting(
  snapshot: LeagueSnapshot,
  inputs: ModelInputs,
  opts: { now: Date; clock: () => number; settings: TradeSettings; scenarios?: number; label: string },
  normal: { ctx: TradeContext; result: TradeSearchResult },
): WholeSearchSetting | null {
  const name = (id: string): string => snapshot.players[id]?.name ?? id;
  const n = readNormal(normal.ctx, normal.result, name);
  if (!n) return null;
  const brute = timedRun(snapshot, inputs, opts, "bruteForce");
  const bs = searchStateOf(brute.result);
  if (!bs) return null;
  const minChance = n.state.settings.minChance;
  const raw = rawRanking(bs, minChance);
  const rawKeys = raw.map((c) => c.key);
  const bruteCards = brute.result.trades.map((t) => t.key);
  const missedAt = raw.findIndex((c) => !n.state.exactByKey.has(c.key) && !n.state.versions.has(c.key));
  const missedShownAt = raw.findIndex((c) => !n.cards.has(c.key) && !n.merged.has(c.key) && !n.dropped.has(c.key));
  const thorough = timedRun(snapshot, inputs, opts, "thorough");
  const newCards = thorough.result.trades.flatMap((t, i) => (n.cards.has(t.key) || n.merged.has(t.key) || n.dropped.has(t.key) ? [] : [rowOf(t, i + 1, n)]));
  return {
    label: opts.label,
    minChance,
    normal: { cards: normal.result.trades.length, counts: normal.result.counts, promoted: (normal.result.merged?.promoted ?? []).filter((p) => p.list === "overall").length },
    brute: { ...brute.run, finalists: bs.finals.length - bs.helpsBothExtras.length, raw: raw.length },
    raw: { top10: foundOf(rawKeys.slice(0, 10), n), top25: foundOf(rawKeys.slice(0, 25), n), rows: raw.slice(0, 10).map((c, i) => rowOf(c, i + 1, n)) },
    capped: { top10: foundOf(bruteCards.slice(0, 10), n), all: foundOf(bruteCards, n) },
    missed: missedAt >= 0 ? rowOf(raw[missedAt] as TradeEvaluationCore, missedAt + 1, n) : null,
    missedShown: missedShownAt >= 0 ? rowOf(raw[missedShownAt] as TradeEvaluationCore, missedShownAt + 1, n) : null,
    thorough: { ...thorough.run, newCards, threeASide: thorough.result.trades.filter((t) => playerIds(t.proposal.give).length === 3 || playerIds(t.proposal.get).length === 3).length },
  };
}

const ms = (x: number): string => (x >= 10_000 ? `${(x / 1000).toFixed(1)} s` : `${Math.round(x).toLocaleString("en-US")} ms`);
const thousands = (x: number): string => Math.round(x).toLocaleString("en-US");
const foundText = (f: WholeFound): string => `${f.exact} / ${f.finalist} / ${f.card} (${f.shown})`;

/** The browser's factor on Node's times (Checkpoint 7d's check:browser), as section 4 says it. */
const BROWSER_FACTOR = 1.24;

/** Section 12 rendered under one setting (trade-report's renderWholeSearch calls it per setting). */
export function wholeSearchLines(s: WholeSearchSetting, snapshot: LeagueSnapshot, teamName: (id: string) => string): string[] {
  const name = (id: string): string => snapshot.players[id]?.name ?? id;
  const trade = (p: TradeProposal): string => `${teamName(p.partnerId)}: ${playerIds(p.give).map(name).join(" + ") || "nothing"} → ${playerIds(p.get).map(name).join(" + ") || "nothing"}`;
  const numbers = (r: WholeRow): string => `${r.helps ?? "–"} / ${r.chance} (${r.label}) / ${r.overall ?? "–"}`;
  const L: string[] = [];
  const t = s.thorough;
  L.push(`**${s.label}**:`, "");
  L.push(
    `- Times (Node, context and search, cold, a context each): the brute force ${ms(s.brute.coldMs)} (${thousands(s.brute.counts.screened)} trades screened, ${thousands(s.brute.counts.exact)} exact, ${s.brute.counts.simFinal} final runs, ${s.brute.cards} cards); the Thorough search ${ms(t.coldMs)}, ⚠️ about ${ms(t.coldMs * BROWSER_FACTOR)} in the browser (×${BROWSER_FACTOR}) (${thousands(t.counts.screened)} screened, ${thousands(t.counts.exact)} exact, ${t.counts.simFinal} final runs, ${t.cards} cards, ${t.threeASide} with 3 players a side); the app's search: section 4 (${thousands(s.normal.counts.screened)} screened, ${thousands(s.normal.counts.exact)} exact, ${s.normal.cards} cards).`,
    `- Raw (the brute force's ${s.brute.raw} finalists that pass the guards and the minimum chance, of ${s.brute.finalists}, by Overall): of its top 10, the app's search evaluated exactly / made a finalist / showed as a card (or among a card's offers, or dropped for a better version it shows) ${foundText(s.raw.top10)}; of its top ${s.raw.top25.n}, ${foundText(s.raw.top25)}.`,
    s.capped.all.n > s.capped.top10.n
      ? `- Capped (the brute force's own list, ${s.brute.cards} cards): of its top 10, ${foundText(s.capped.top10)}; of all ${s.capped.all.n}, ${foundText(s.capped.all)}.`
      : `- Capped (the brute force's own list, ${s.brute.cards} card${s.brute.cards === 1 ? "" : "s"}): ${foundText(s.capped.all)}.`,
  );
  L.push(
    s.missed
      ? `- The best trade the app's search missed (its raw #${s.missed.place}, the ranking block's numbers): ${trade(s.missed.proposal)}, ${numbers(s.missed)} (${s.missed.shape}): ${s.missed.why}.`
      : `- The app's search evaluated every one of the brute force's ${s.brute.raw} raw finalists exactly.`,
  );
  if (s.missedShown && s.missedShown.key !== s.missed?.key) L.push(`- The best one it doesn't show (its raw #${s.missedShown.place}): ${trade(s.missedShown.proposal)}, ${numbers(s.missedShown)} (${s.missedShown.shape}): ${s.missedShown.why}.`);
  L.push(`- Promotions (answer 3, section 11): ${s.normal.promoted} on the Overall list.`, "");
  L.push(`The brute force's top 10 (raw; Helps you / chance / Overall on the ranking block) and what the app's search did with each:`, "");
  s.raw.rows.forEach((r) => L.push(`${r.place}. ${trade(r.proposal)} (${numbers(r)}; ${r.shape}): ${r.why}`));
  L.push("");
  if (t.newCards.length) {
    L.push(`The Thorough search's cards the app's search doesn't show (${t.newCards.length} of ${t.cards}; as its cards print them):`, "");
    t.newCards.forEach((r) => L.push(`${r.place}. ${trade(r.proposal)} (${numbers(r)}; ${r.shape}): the app's search: ${r.why}`));
  } else L.push(`The Thorough search shows no card the app's search doesn't show (${t.cards} cards).`);
  L.push("");
  return L;
}

/** Section 12 on trade-report's console line: the brute force's raw top 10 the app's search found, and the Thorough search. */
export function wholeSummary(s: WholeSearchSetting | null, label: string): string {
  if (!s) return `${label}: no brute force (the search stopped before ranking)`;
  const n = s.thorough.newCards.length;
  return `${label}: of the brute force's raw top ${s.raw.top10.n}, ${s.raw.top10.exact} evaluated and ${s.raw.top10.shown} shown; Thorough ${ms(s.thorough.coldMs)} cold, ${n} card${n === 1 ? "" : "s"} the app's search doesn't show`;
}
