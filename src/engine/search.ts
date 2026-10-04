/**
 * The trade search (CLAUDE.md §12; Phase 4 wave 2 lead decisions M6–M8, M11, M14): pools, screening with beams,
 * exact evaluation, the screening and final simulations, then ranking and explanations. Pure and deterministic: the
 * same context and options give the same result; the only clock is the optional one for timings. Every number comes
 * from config.search, config.simulation and config.ranking (src/engine/evaluate.ts does the evaluating).
 *
 * Pools (§12 step 2; M6). Candidates are players with a model on the active rosters and, with IR returners (planner reply
 * to Checkpoint 4, change 5; league.ts step 5b, evaluate.ts rule 5), on the IRs: IR players appear in both pools.
 * - G (mine): my top givePool by surplus score (TeamModel.players surplusScore: z(value) − z(MV_lose); an IR returner's
 *   lineup cost is what losing him costs V*(me)'s lineups, no active spot opening; an IR player who isn't back this
 *   season has no surplus score and ranks last) ∪ every trade chip of mine (active players) ∪ my must-include players,
 *   minus untouchables, minus P, K, D/ST and IDP unless includeKDefIdp; ⚠️ the filters come before the top givePool is
 *   taken (the pool is my top tradable players), and must-include players always stay (even untouchable ones).
 * - H (per partner P): P's players by MV_add(me, j) in EV lineups (league.ts's rule: V*(me) plus him minus the drop that
 *   makes room, the optimizer re-run from there, against V*(me)); an IR player of P whom an open IR slot of mine would
 *   take (⚠️ judged on my IR before the trade; the slot takes his status) as a returner instead: what he adds to V*(me)'s
 *   lineups, no drop. Keeping those above 0, after the position filters
 *   (targetPositions non-empty: only those; never avoidPositions; the K/D/ST/IDP rule): the top getPool players not
 *   tagged "Harder to get" for P (evaluate.harderToGetFor: e ≥ harderToGetMin, a top-12 player who is P's #1 or #2;
 *   planner addendum to Checkpoint 3, §2, lead decision N2) plus the top getPoolTagged tagged ones (star trades are still
 *   evaluated, and rank on their honest acceptance), in MV_add order ∪ P's must-include players.
 * - Must-include ids on no team's active roster (or IR) are ignored (a note); must-include players on two or more other teams:
 *   no trade can hold them all (no trades, a note); one partner's: only that partner is searched; mine: every
 *   candidate contains them. opts.partnerId searches that partner only.
 *
 * Beams (M7, §12 as we read it). Seeds: every 1-for-1 in G × H; with must-include players, the forced core completed to
 * at least one player a side (the core alone when both sides have forced players, else the core plus each single from
 * the other pool). An extension adds one player from G, one from H, or one from each: every single addition is
 * screened, and the one-on-each additions pair the pairExtensionTop best single additions on each side; never past
 * maxPerSide on a side; deduplicated by key. maxPerSide ≥ 2: the best beamSecond seeds are extended once (2-for-1,
 * 1-for-2 and 2-for-2); maxPerSide 3: the best beamThird of those extensions once more. Then trades whose g_mkt(P)
 * falls outside screeningGWindow are dropped, then the dominated ones (lead decision N11, ⚠️ ours, in the spirit of §13's
 * filler rule; review of the addendum: variants with a player of mine worth less than the waiver credit took 85 of the
 * 200 exact slots on Parker's league, 3 after the pruning): a trade that gives one of my players worth less than W
 * (perception value; W = the waiver credit) is dropped when the same trade without him (same partner and players of
 * theirs, my side keeping at least one player) was screened and kept with an objective at least as high
 * (dominancePruned). Each partner then keeps its best keptPerPartner, and the best exactEvaluationMax over all partners go
 * to exact evaluation. Order everywhere: the screening objective (my ΔROS × quick P_accept), then the key. Since the
 * value floor (planner reply to Checkpoint 4, change 4) such a player adds 0 value to the partner's package (W on both
 * sides when my side already gives at least as many players; nothing when he fills a spot the partner was owed) while
 * costing the complexity term, so a variant with him screens better through the lineups or ⚠️ through the partner's g,
 * which edges toward 0 and so rises when the partner loses value (market.ts's header).
 *
 * Final stages (M8). Every exact trade gets the screening simulation (the first block of seasons, screeningSims) → B
 * (λ and κ from the call's settings: lambda and "Protect my trade value", protectValue; evaluate.simulateTrade).
 * Finalists: ⚠️ the first config.search.finalists trades rankTrades keeps from those numbers with its caps relaxed by
 * one (perCore + 1 trades a core, perPartnerInTop20 + 1 a partner, perGivenPlayerInTop20 + 1 trades giving a player of
 * mine; review of track E, item 3: at 1,000 seasons the order is noisy, and the strict caps dropped trades that rank near
 * the top at 5,000), `finalists` in place of resultsShown, and ⚠️ the partner and given-player caps' window covering
 * every finalist rather than the first 20 (rankCaps; final review of Phase 4b: the strict ranking applies those caps to
 * its whole list until it keeps 20, which on Parker's league, Oct 3, it never did, so finalists 21–40, picked with no
 * such cap, were mostly the players and partners already at it: 16 cards shown of 25); then, if the caps left room, the
 * best others by EG = B × P_complete (ties: the key), never one hidden by default (B ≤ 0 or the market guard): so the
 * final ranking has diverse trades to choose from rather than 40 variants of a few cores. They get the final simulation
 * (the second block, finalSims seasons the screening never saw: evaluate.ts); rankTrades on their numbers, with §13's
 * strict caps, gives TradeSearchResult.trades: on Parker's league (the 2026-10-03 21:29Z dump, default settings) 17
 * cards, as many as ranking all 200 exact trades at final numbers keeps (16 before the window covered every finalist;
 * the given-player cap keeps the list under 20 there). Then each shown trade
 * gets its "Offer first / if they say no" steps (planner addendum to Checkpoint 3, §4; lead decision N4: evaluate.ts
 * tradeSteps, the versions on the screening block, reusing the exact stage's evaluations); one without steps gets a Plan B
 * ("If they say no, try:", planner reply to Checkpoint 4, change 6; planB.ts: the best other exact trade with that partner
 * by its rules, ⚠️ at least the steps' minAcceptGain likelier to go through than the card and never one the list shows as a
 * card, from a pool fixed before any card picks, of every exact trade with its best numbers, a finalist's final ones; a
 * chosen trade that wasn't a finalist is simulated on the final block first, once per key, ⚠️ not counted in
 * counts.simFinal, which stays the finalists').
 * ⚠️ The Plan Bs of the cards in the top-20 window keep to the given-player cap among themselves (planB.ts: in the cards'
 * order, each box counts the players of mine its card doesn't give, and a candidate that would add one already added by
 * that many boxes is skipped). Then its words and its injury tags (evaluate.ts withWords, as the Analyzer's: explain.ts
 * with the app's names, the pitch naming the offer-first version; flags.tagged, explain.injuryTags from the snapshot with
 * explain.tagContextOf: the week now and the League model's word on which conflicted Probable, Questionable or Doubtful
 * players follow their ESPN return date). The ranking stays on the ranked trades' numbers. Hidden counts: the finalists'
 * (rankTrades) plus the other exact trades the guards hide at screening numbers; TradeSearchResult.dropped counts the
 * finalists the final ranking's variety rules left out (rankTrades' dropped, its given-player cap's `givenPlayer` too, on
 * every path).
 *
 * One partner (⚠️ ours, end-of-Phase-4 review, finding 5): a search of a single partner (opts.partnerId, must-include
 * players of theirs, or a league with one other team: Pools.partners holds one team) ranks without the per-partner cap,
 * in both rankings (rankCaps). §13's "at most 3 trades per partner in the top 20" keeps the all-teams list varied across
 * partners; with one partner searched there is no other partner to make room for, and the cap would cut the list to 3
 * whatever else qualified (every one-partner search on Parker's league showed 3, of up to 30 finalists). The per-core and
 * filler rules still apply. A search of all teams ranks exactly as before.
 *
 * Notes: the context's (no team, no weeks, season over, deadline passed, no odds: then no trades), B's own
 * (benefit.benefitNotes, once), positions left out by settings, must-include problems, emptied pools, and draft
 * picks (M11: ⚠️ deferred to Phase 5; with includePicks on in a dynasty or keeper league, a note says so).
 *
 * Progress (M8, M14): the generator yields between units of work (a batch of screens, each exact trade, each final
 * simulation, each shown trade's steps and Plan B: reported under the "rank" stage, one unit per shown trade, with a
 * yield before each of Plan B's simulations too), so a worker can slice it and stop it. Timings: one key per
 * TradeSearchStage, "steps" (the shown trades' steps, Plan B and words) and "total".
 */
import { benefit, benefitNotes } from "./benefit";
import { config } from "./config";
import {
  assetValue,
  evaluateExact,
  harderToGetFor,
  proposalKey,
  screenTrade,
  simulateTrade,
  tradeInternals,
  tradeSteps,
  withWords,
  type ExactTrade,
  type Screened,
  type TeamState,
  type TradeContext,
  type TradeInternals,
  type TradeVersion,
} from "./evaluate";
import { addValueOf, baseFor, startablePositions } from "./league";
import type { Pos } from "./model";
import { addGainExact } from "./teamValue";
import { addedGiven, choosePlanB, givenCapSkip, planBCandidates, planBConfig, type PlanBConfig } from "./planB";
import { rankTrades, type RankConfig } from "./rank";
import { defaultTradeSettings, normalizeTradeSettings, type TradeSettings } from "./settings";
import type { PlanB, TradeAsset, TradeEvaluation, TradeEvaluationCore, TradeSearchProgress, TradeSearchResult, TradeSearchStage } from "./tradeModel";

export interface TradeSearchOptions {
  /** The user's settings (maxPerSide, untouchables, mustInclude, target/avoid positions, includeKDefIdp, includePicks, lambda, protectValue). Default: defaultTradeSettings(). */
  settings?: TradeSettings;
  /** Only trades with this partner (null or absent = every other team). */
  partnerId?: string | null;
  /** Milliseconds (performance.now in the browser) for TradeSearchResult.timings; without it the timings are empty. */
  clock?: () => number;
  /**
   * Report switch (the app never sets it): Plan B's rules in place of config's (planB.ts planBConfig), for instance
   * `{ minAcceptGain: null }` (no "likelier to go through" rule: the planner's rules as first read) or
   * `{ givenPlayerCap: null }` (Plan B's offers not capped), so a report can measure what each rule does.
   */
  planB?: Partial<PlanBConfig>;
}

/** Gains closer than this are ties (float noise, not a tunable). */
const EPS = 1e-9;

/** Screens, and screening simulations, between two progress yields (config.search: responsiveness, M8). */
const SCREEN_BATCH = Math.max(1, Math.floor(config.search.yieldEveryScreens));
const SIM_BATCH = Math.max(1, Math.floor(config.search.yieldEverySims));

const byKey = (a: { key: string }, b: { key: string }): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const byObjective = (a: Screened, b: Screened): number => (Math.abs(b.objective - a.objective) > EPS ? b.objective - a.objective : byKey(a, b));

const players = (ids: readonly string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));

/** A core as rankTrades reads it: the numbers, without words (they never change the order). */
const bare = (core: TradeEvaluationCore): TradeEvaluation => ({ ...core, reasons: [], pitch: "" });

/** Words for the positions left out of the search by default (config.market.tradeSearchExcluded). */
const EXCLUDED_WORDS: Readonly<Partial<Record<Pos, string>>> = { P: "punters", K: "kickers", DEF: "D/STs", DL: "IDP players", LB: "IDP players", DB: "IDP players" };

function listText(xs: readonly string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The pools and the partners to search (M6), or the notes that stop the search. */
export interface Pools {
  partners: TeamState[];
  give: string[];
  forcedGive: string[];
  get: Map<string, { pool: string[]; forced: string[] }>;
  notes: string[];
  stop: boolean;
}

export function buildPools(I: TradeInternals, settings: TradeSettings, partnerId: string | null): Pools {
  const me = I.me as TeamState;
  const notes: string[] = [];
  const out: Pools = { partners: [], give: [], forcedGive: [], get: new Map(), notes, stop: false };
  const stop = (note: string): Pools => {
    notes.push(note);
    out.stop = true;
    return out;
  };
  const maxPerSide = settings.maxPerSide;
  const hasRow = (id: string) => I.league.table.rows.has(id);
  const posOf = (id: string) => I.league.posOf(id);
  const excluded = new Set<Pos>(settings.includeKDefIdp ? [] : config.market.tradeSearchExcluded);
  const untouchable = new Set(settings.untouchables);

  // Must-include players: mine, one partner's, or nobody's (ignored). Tradable: active-roster players and, with IR
  // returners (evaluate.ts rule 5), IR players.
  const tradableOf = (t: TeamState): readonly string[] => (I.irOn ? [...t.roster, ...t.ir] : t.roster);
  const forcedGive: string[] = [];
  const forcedBy = new Map<string, string[]>();
  let ignored = 0;
  for (const id of settings.mustInclude) {
    if (tradableOf(me).includes(id)) {
      forcedGive.push(id);
      continue;
    }
    const owner = I.teams.find((t) => t !== me && tradableOf(t).includes(id));
    if (!owner) {
      ignored++;
      continue;
    }
    forcedBy.set(owner.id, [...(forcedBy.get(owner.id) ?? []), id]);
  }
  if (ignored > 0) notes.push(`${ignored === 1 ? "1 must-include player isn't" : `${ignored} must-include players aren't`} on any team's active roster${I.irOn ? " or IR" : ""}, so ${ignored === 1 ? "it's" : "they're"} ignored.`);
  if (forcedBy.size >= 2) return stop("Your must-include players are on different teams, and a trade is with one team, so no trade can include them all.");
  if (forcedGive.length > maxPerSide) return stop(`You must include ${forcedGive.length} of your players, more than the ${maxPerSide} a side your settings allow.`);
  const [forcedTeam, forcedGet] = [...forcedBy.entries()][0] ?? [null, []];
  if (forcedGet.length > maxPerSide) return stop(`You must include ${forcedGet.length} of their players, more than the ${maxPerSide} a side your settings allow.`);
  let partners = I.teams.filter((t) => t !== me);
  if (partnerId !== null) partners = partners.filter((t) => t.id === partnerId);
  if (forcedTeam !== null) {
    if (partnerId !== null && partnerId !== forcedTeam) return stop("Your must-include players are on another team than the one you picked, so no trade with this team can include them.");
    partners = partners.filter((t) => t.id === forcedTeam);
  }
  if (!partners.length) return stop("Pick a team to trade with.");

  // G: my top tradable players by surplus score (my IR returners included: TeamModel.players ranks them by their lineup
  // cost from V*(me)'s lineups), my trade chips, my must-include players.
  const myModel = I.model.teams[me.index];
  const tradable = (id: string) => hasRow(id) && !untouchable.has(id) && !excluded.has(posOf(id) as Pos);
  const surplus = (id: string) => myModel?.players[id]?.surplusScore ?? Number.NEGATIVE_INFINITY;
  const top = [...new Set(tradableOf(me))]
    .filter(tradable)
    .sort((a, b) => surplus(b) - surplus(a) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, Math.max(0, Math.floor(config.search.givePool)));
  const chips = (myModel?.chips ?? []).map((c) => c.playerId).filter((id) => me.roster.includes(id) && tradable(id));
  const give = [...new Set([...top, ...chips, ...forcedGive])];
  if (!give.length) return stop("None of your players can be offered with your settings (untouchable, or at positions left out of the search).");

  // H per partner: its top players by what they'd add to my lineup (MV_add(me, j), EV), the "Harder to get" ones apart,
  // and its must-include players.
  const target = new Set<Pos>(settings.targetPositions);
  const avoid = new Set<Pos>(settings.avoidPositions);
  const addValue = addValueOf(I.league);
  const wanted = (pos: Pos | undefined) => pos !== undefined && !excluded.has(pos) && !avoid.has(pos) && (target.size === 0 || target.has(pos));
  const getPool = Math.max(0, Math.floor(config.search.getPool));
  const getPoolTagged = Math.max(0, Math.floor(config.search.getPoolTagged));
  // A partner's IR player comes to me as a returner when I'd have an open IR slot (⚠️ judged before any trade: my IR as it
  // stands) and the slot takes his status (evaluate.ts rule 5): MV_add is then what he adds to V*(me)'s lineups, no drop.
  const myIrOpen = I.irOn && me.ir.length < Math.max(0, Math.floor(I.snapshot.settings.irSlots));
  for (const p of partners) {
    const forced = p.id === forcedTeam ? forcedGet : [];
    const scored: { id: string; mv: number }[] = [];
    for (const id of new Set(tradableOf(p))) {
      const row = I.league.table.rows.get(id);
      if (!row || forced.includes(id) || !wanted(row.pos)) continue;
      const mask = I.league.maskOf(row);
      let mv: number;
      if (myIrOpen && p.ir.includes(id) && I.irEligible.has(I.snapshot.players[id]?.injury ?? "ACTIVE")) {
        mv = addGainExact(me.vstar.solved, row, mask, I.weights).gain;
      } else {
        const base = baseFor(I.league, I.bases, me.index, row.pos);
        if (!base) continue;
        mv = addValue(me.index, base, row, mask, false);
      }
      if (mv > EPS) scored.push({ id, mv });
    }
    scored.sort((a, b) => (Math.abs(b.mv - a.mv) > EPS ? b.mv - a.mv : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // The top getPool untagged and the top getPoolTagged tagged, kept in MV_add order.
    let untagged = 0;
    let tagged = 0;
    const top: string[] = [];
    for (const x of scored) {
      if (harderToGetFor(I, p.id, x.id) ? tagged++ < getPoolTagged : untagged++ < getPool) top.push(x.id);
    }
    const pool = [...top, ...forced];
    out.get.set(p.id, { pool, forced });
  }
  if (partners.every((p) => (out.get.get(p.id)?.pool.length ?? 0) === 0)) {
    return stop(target.size > 0 || avoid.size > 0 ? "No player at the positions your settings allow would improve your lineup." : "No player on the other teams would improve your lineup right now.");
  }
  out.partners = partners;
  out.give = give;
  out.forcedGive = forcedGive;
  return out;
}

/** Notes that hold for the whole search: positions left out, picks deferred, B's own (benefit.benefitNotes). */
function searchNotes(I: TradeInternals, settings: TradeSettings): string[] {
  const notes: string[] = [];
  if (!settings.includeKDefIdp) {
    const started = startablePositions(I.snapshot.settings);
    const words = [...new Set(config.market.tradeSearchExcluded.filter((p) => started.has(p)).flatMap((p) => EXCLUDED_WORDS[p] ?? []))];
    if (words.length) notes.push(`${capitalize(listText(words))} are left out; turn them on in Settings.`);
  }
  if (settings.includePicks && I.snapshot.settings.leagueType !== "redraft") notes.push("Draft picks aren't part of trade ideas yet.");
  if (I.sim && I.me) {
    // The same rules benefit() applies to every trade: title odds unknown, long-term values missing.
    const b = benefit({
      leagueType: I.snapshot.settings.leagueType,
      dPO: 0,
      dCH: I.sim.base.final.pTitle === null ? null : 0,
      gMine: 0,
      dynasty: I.future && I.future.myTotal > 0 ? { delta: 0, total: I.future.myTotal } : null,
      myPPlayoffs: I.sim.base.final.pPlayoffs,
      lambda: settings.lambda,
    });
    notes.push(...benefitNotes(b));
  }
  return notes;
}

/** One partner's pools (M6): my give pool G and its forced players, the partner's get pool H and its forced players. */
export interface PartnerPool {
  give: readonly string[];
  forcedGive: readonly string[];
  get: readonly string[];
  forcedGet: readonly string[];
}

/**
 * One partner's screened candidates (M7; the file header's beams), legal ones only, each trade once, before the g
 * window: the seeds (every 1-for-1 of G × H, or the forced core completed to a player a side), then with maxPerSide ≥ 2
 * the best beamSecond seeds extended once (each single addition from G and from H screened, and the pairExtensionTop
 * best of each side paired), and with maxPerSide ≥ 3 the best beamThird of those extensions extended once more. Every
 * candidate holds the forced players. `tally.screened` counts the screens (a trade reached twice is screened once). It
 * yields after every SCREEN_BATCH screens (the search's progress).
 */
export function* partnerCandidates(I: TradeInternals, partner: TeamState, pool: PartnerPool, maxPerSide: number, tally: { screened: number }): Generator<void, Screened[], void> {
  const seen = new Map<string, Screened | null>();
  let sinceYield = 0;
  const screen = (give: readonly string[], get: readonly string[]): Screened | null => {
    const key = proposalKey({ partnerId: partner.id, give: players(give), get: players(get) });
    if (seen.has(key)) return seen.get(key) ?? null;
    tally.screened++;
    sinceYield++;
    const s = screenTrade(I, partner, give, get, key);
    seen.set(key, s);
    return s;
  };

  // Seeds.
  const seeds: Screened[] = [];
  const { forcedGive, forcedGet } = pool;
  const giveOthers = pool.give.filter((id) => !forcedGive.includes(id));
  const getOthers = pool.get.filter((id) => !forcedGet.includes(id));
  const seedSides: [readonly string[], readonly string[]][] = [];
  if (forcedGive.length && forcedGet.length) seedSides.push([forcedGive, forcedGet]);
  else if (forcedGive.length) for (const h of getOthers) seedSides.push([forcedGive, [h]]);
  else if (forcedGet.length) for (const g of giveOthers) seedSides.push([[g], forcedGet]);
  else for (const g of giveOthers) for (const h of getOthers) seedSides.push([[g], [h]]);
  for (const [give, get] of seedSides) {
    if (give.length > maxPerSide || get.length > maxPerSide) continue;
    const s = screen(give, get);
    if (s) seeds.push(s);
    if (sinceYield >= SCREEN_BATCH) {
      sinceYield = 0;
      yield;
    }
  }

  // Extensions: one player from G, one from H, or one from each (the best single additions paired).
  const top = Math.max(0, Math.floor(config.search.pairExtensionTop));
  function* extend(from: readonly Screened[]): Generator<void, Screened[], void> {
    const made = new Map<string, Screened>();
    for (const s of from) {
      const singlesGive: Screened[] = [];
      const singlesGet: Screened[] = [];
      if (s.give.length < maxPerSide) {
        for (const g of pool.give) {
          if (s.give.includes(g)) continue;
          const x = screen([...s.give, g], s.get);
          if (x) singlesGive.push(x);
        }
      }
      if (s.get.length < maxPerSide) {
        for (const h of pool.get) {
          if (s.get.includes(h)) continue;
          const x = screen(s.give, [...s.get, h]);
          if (x) singlesGet.push(x);
        }
      }
      for (const x of [...singlesGive, ...singlesGet]) made.set(x.key, x);
      const bestGive = [...singlesGive].sort(byObjective).slice(0, top);
      const bestGet = [...singlesGet].sort(byObjective).slice(0, top);
      for (const g of bestGive) {
        const addG = g.give.find((id) => !s.give.includes(id)) as string;
        for (const h of bestGet) {
          const addH = h.get.find((id) => !s.get.includes(id)) as string;
          const x = screen([...s.give, addG], [...s.get, addH]);
          if (x) made.set(x.key, x);
        }
      }
      if (sinceYield >= SCREEN_BATCH) {
        sinceYield = 0;
        yield;
      }
    }
    return [...made.values()];
  }
  const all = new Map<string, Screened>(seeds.map((s) => [s.key, s]));
  if (maxPerSide >= 2) {
    const second = yield* extend([...seeds].sort(byObjective).slice(0, Math.max(0, Math.floor(config.search.beamSecond))));
    for (const x of second) all.set(x.key, x);
    if (maxPerSide >= 3) {
      const third = yield* extend([...second].sort(byObjective).slice(0, Math.max(0, Math.floor(config.search.beamThird))));
      for (const x of third) all.set(x.key, x);
    }
  }
  return [...all.values()];
}

/**
 * Whether a player is worth less than the waiver credit W (raw perception values; a player without one counts 0; every
 * package counts such a player at W): "a player of mine worth less than W" in the dominance pruning (lead decision N11;
 * dominancePruned). With no market values W is 0 and nobody is.
 */
export function belowWaiverCredit(I: Pick<TradeInternals, "values" | "credit">): (id: string) => boolean {
  const W = I.credit;
  return (id) => (I.values[id] ?? 0) < W;
}

/**
 * The dominance pruning of one partner's screened trades (lead decision N11; the file header): a trade that gives a player
 * of mine worth less than W (`cheap`) is dropped when the same trade without him (same partner, same players of
 * theirs, my side keeping at least one player) is in `list` with an objective at least as high (ties within float noise
 * count as equal). The trades it compares with are the ones passed in (screened and kept by the g window), dropped or
 * not, so a chain of variants keeps its leanest best one: every trade dropped leaves one at least as good with fewer of my
 * players. A must-include player of mine is in every candidate, so no trade without him exists to drop one with him.
 */
export function dominancePruned(list: readonly Screened[], cheap: (id: string) => boolean): Screened[] {
  const byKeyOf = new Map(list.map((s) => [s.key, s]));
  return list.filter((s) => {
    if (s.give.length < 2) return true;
    for (const id of s.give) {
      if (!cheap(id)) continue;
      const lean = byKeyOf.get(proposalKey({ partnerId: s.partnerId, give: players(s.give.filter((x) => x !== id)), get: players(s.get) }));
      if (lean && lean.objective >= s.objective - EPS) return false;
    }
    return true;
  });
}

/**
 * The trades exact evaluation takes from the screening (M7): each partner's candidates inside the screeningGWindow on
 * g_mkt(P) (a non-finite g is outside), without the dominated ones when `cheap` is given (N11: dominancePruned with my
 * players worth less than W, as the search passes it; null: no pruning, for reports that measure it), that partner's
 * best keptPerPartner, then the best exactEvaluationMax over all partners. Order: the objective, then the key.
 */
export function shortlistOf(perPartner: readonly (readonly Screened[])[], cheap: ((id: string) => boolean) | null = null): Screened[] {
  const [gLo, gHi] = config.search.screeningGWindow;
  const shortlist: Screened[] = [];
  for (const list of perPartner) {
    const inWindow = list.filter((x) => Number.isFinite(x.gPartner) && x.gPartner >= gLo - EPS && x.gPartner <= gHi + EPS);
    const kept = (cheap ? dominancePruned(inWindow, cheap) : inWindow).sort(byObjective).slice(0, Math.max(0, Math.floor(config.search.keptPerPartner)));
    shortlist.push(...kept);
  }
  return shortlist.sort(byObjective).slice(0, Math.max(0, Math.floor(config.search.exactEvaluationMax)));
}

/**
 * The caps a ranking in the search reads (rank.ts; §13): config's (the final ranking, resultsShown trades), or `relaxed`
 * (the finalists): one looser per core, per partner and per player of mine given, over every finalist (the partner and
 * given-player caps' window covers all config.search.finalists of them: the file header, "Final stages"), and
 * config.search.finalists trades. `onePartner` (the file header, "One partner"): no per-partner cap at all; the per-core,
 * given-player and filler rules stay.
 */
export function rankCaps(opts: { relaxed: boolean; onePartner: boolean }): RankConfig {
  const loosen = opts.relaxed ? 1 : 0;
  const finalists = Math.max(0, Math.floor(config.search.finalists));
  return {
    perPartnerInTop20: opts.onePartner ? Number.POSITIVE_INFINITY : config.ranking.perPartnerInTop20 + loosen,
    partnerCapTop: opts.relaxed ? Math.max(config.ranking.partnerCapTop, finalists) : config.ranking.partnerCapTop,
    // ⚠️ Ours: one partner keeps it (a one-team list that sells the same player of mine again and again needs it too).
    perGivenPlayerInTop20: config.ranking.perGivenPlayerInTop20 + loosen,
    perCore: config.ranking.perCore + loosen,
    fillerCutoffFraction: config.ranking.fillerCutoffFraction,
    resultsShown: opts.relaxed ? finalists : config.search.resultsShown,
    marketHideBelow: config.benefit.marketHideBelow,
  };
}

/** EG = B × P_complete (−∞ without B): the order the finalists' last places are filled in. */
const egOf = (c: TradeEvaluationCore): number => (c.b === null ? Number.NEGATIVE_INFINITY : c.b * c.pComplete);

/** Hidden by default at these numbers (§10 guards): B ≤ 0 or unknown, or the market guard. */
const hiddenAt = (c: TradeEvaluationCore): boolean => c.b === null || !(c.b > 0) || c.flags.hiddenByMarket;

/** EG, highest first, then the key. */
const byEgThenKey = (a: TradeEvaluationCore, b: TradeEvaluationCore): number => (Math.abs(egOf(b) - egOf(a)) > EPS ? egOf(b) - egOf(a) : byKey(a, b));

/**
 * The finalists (the file header, "Final stages") among the trades with screening numbers: the first
 * config.search.finalists that rankTrades keeps with its per-core, per-partner and given-player caps relaxed by one, the
 * caps' window covering every finalist (rankCaps; no per-partner cap when `onePartner`: the file header's "One
 * partner"), then, while room is left, the best others by EG = B × P_complete (ties: the key) that aren't hidden by
 * default. Also the counts of the others the guards hide (B ≤ 0 or unknown: by benefit; else the market guard).
 */
export function finalistsOf(cores: readonly TradeEvaluationCore[], value: (asset: TradeAsset) => number, onePartner = false): { keys: Set<string>; hidden: { byBenefit: number; byMarket: number } } {
  const maxFinalists = Math.max(0, Math.floor(config.search.finalists));
  // Relaxed by one (review of track E, item 3): at 1,000 seasons the order is noisy, and the strict caps dropped trades the
  // 5,000-season numbers rank near the top. The strict rules apply in the final ranking.
  const pre = rankTrades(cores.map(bare), value, rankCaps({ relaxed: true, onePartner }));
  const keys = new Set(pre.trades.map((t) => t.key));
  const rest = cores.filter((c) => !keys.has(c.key) && !hiddenAt(c)).sort(byEgThenKey);
  for (const c of rest) {
    if (keys.size >= maxFinalists) break;
    keys.add(c.key);
  }
  const hidden = { byBenefit: 0, byMarket: 0 };
  for (const c of cores) {
    if (keys.has(c.key)) continue;
    if (c.b === null || !(c.b > 0)) hidden.byBenefit++;
    else if (c.flags.hiddenByMarket) hidden.byMarket++;
  }
  return { keys, hidden };
}

/**
 * The search as a generator: it yields progress between units of work (so a worker can slice it and stop it) and
 * returns the result. Deterministic: the same context and options give the same result.
 */
export function* tradeSearch(ctx: TradeContext, opts: TradeSearchOptions = {}): Generator<TradeSearchProgress, TradeSearchResult, void> {
  const I = tradeInternals(ctx);
  const clock = opts.clock;
  const timings: Record<string, number> = {};
  const start = clock ? clock() : 0;
  let last = start;
  /** A stage's milliseconds (TradeSearchStage keys, plus "steps": the shown trades' "Offer first" steps and words). */
  const mark = (stage: TradeSearchStage | "steps") => {
    if (!clock) return;
    const t = clock();
    timings[stage] = (timings[stage] ?? 0) + (t - last);
    last = t;
  };
  const settings = normalizeTradeSettings(opts.settings ?? defaultTradeSettings());
  const counts = { screened: 0, exact: 0, simScreen: 0, simFinal: 0 };
  // The same keys rankTrades counts (its `givenPlayer` too), whichever path returns.
  const noDrops = { partnerCap: 0, core: 0, filler: 0, givenPlayer: 0 };
  const result = (trades: TradeEvaluation[], hidden: TradeSearchResult["hidden"], notes: string[], dropped: NonNullable<TradeSearchResult["dropped"]> = noDrops): TradeSearchResult => {
    if (clock) timings.total = last - start;
    const base = I.sim && I.me ? I.sim.base.final : null;
    return {
      trades,
      myTeamId: I.me?.id ?? null,
      baseline: { pPlayoffs: base?.pPlayoffs ?? null, pTitle: base?.pTitle ?? null, expWins: base?.expWins ?? null },
      hidden,
      dropped: { ...dropped },
      counts,
      timings,
      notes: [...new Set(notes)],
      warnings: [...I.warnings],
    };
  };
  const none = { byBenefit: 0, byMarket: 0 };

  yield { stage: "setup", done: 0, total: 1 };
  if (I.blocked || !I.me) {
    mark("setup");
    return result([], none, [...I.notes]);
  }
  const notes = searchNotes(I, settings);
  const pools = buildPools(I, settings, opts.partnerId ?? null);
  notes.push(...pools.notes);
  mark("setup");
  if (pools.stop) return result([], none, notes);
  yield { stage: "setup", done: 1, total: 1 };

  // Screening (§12 step 2): beams per partner.
  const maxPerSide = settings.maxPerSide;
  const perPartner: Screened[][] = [];
  for (let pi = 0; pi < pools.partners.length; pi++) {
    const partner = pools.partners[pi] as TeamState;
    const H = pools.get.get(partner.id) as { pool: string[]; forced: string[] };
    const it = partnerCandidates(I, partner, { give: pools.give, forcedGive: pools.forcedGive, get: H.pool, forcedGet: H.forced }, maxPerSide, counts);
    let r = it.next();
    while (!r.done) {
      yield { stage: "screening", done: pi, total: pools.partners.length };
      r = it.next();
    }
    perPartner.push(r.value);
    yield { stage: "screening", done: pi + 1, total: pools.partners.length };
  }
  // The dominance pruning (N11).
  const chosen = shortlistOf(perPartner, belowWaiverCredit(I));
  mark("screening");

  // Exact evaluation (§12 step 3).
  const exact: ExactTrade[] = [];
  for (let i = 0; i < chosen.length; i++) {
    const s = chosen[i] as Screened;
    const x = evaluateExact(I, { partnerId: s.partnerId, give: players(s.give), get: players(s.get) }, maxPerSide);
    if (!("illegal" in x)) exact.push(x);
    yield { stage: "exact", done: i + 1, total: chosen.length };
  }
  counts.exact = exact.length;
  mark("exact");

  // The screening simulation (§12 step 4): B for every exact trade.
  const screened: { x: ExactTrade; core: TradeEvaluationCore }[] = [];
  for (let i = 0; i < exact.length; i++) {
    const x = exact[i] as ExactTrade;
    screened.push({ x, core: simulateTrade(I, x, "screen", settings.lambda, settings.protectValue) });
    if ((i + 1) % SIM_BATCH === 0 || i + 1 === exact.length) yield { stage: "simScreen", done: i + 1, total: exact.length };
  }
  counts.simScreen = screened.length;
  mark("simScreen");

  // Finalists (the file header): relaxed-cap ranking at screening numbers, then the best others by EG. One partner
  // searched: no per-partner cap in either ranking (the file header, "One partner").
  const value = assetValue(I);
  const onePartner = pools.partners.length === 1;
  const { keys: finalKeys, hidden: hiddenElsewhere } = finalistsOf(
    screened.map((s) => s.core),
    value,
    onePartner,
  );
  const finalists = screened.filter((s) => finalKeys.has(s.core.key));

  // The final simulation (§12 step 5).
  const finals: TradeEvaluationCore[] = [];
  for (let i = 0; i < finalists.length; i++) {
    const s = finalists[i] as { x: ExactTrade; core: TradeEvaluationCore };
    finals.push(simulateTrade(I, s.x, "final", settings.lambda, settings.protectValue));
    yield { stage: "simFinal", done: i + 1, total: finalists.length };
  }
  counts.simFinal = finals.length;
  mark("simFinal");

  // Rank and diversify (§13), on the numbers (the words never change the order).
  yield { stage: "rank", done: 0, total: 1 };
  const ranked = rankTrades(finals.map(bare), value, rankCaps({ relaxed: false, onePartner }));
  mark("rank");

  // The shown trades' steps ("Offer first / if they say no", N4), a Plan B for each one without steps (planB.ts), their
  // words (the pitch names the offer-first version) and their injury tags.
  const versions = new Map<string, TradeVersion>(screened.map((s) => [s.core.key, { x: s.x, screen: s.core }]));
  // Plan B's pool, fixed before any card picks: every exact trade with its best numbers (a finalist's final ones). A
  // candidate that isn't a finalist is simulated on the final block once, whichever card asks first.
  const finalByKey = new Map<string, TradeEvaluationCore>(finals.map((c) => [c.key, c]));
  const exactByKey = new Map<string, ExactTrade>(screened.map((s) => [s.core.key, s.x]));
  const planBPool = screened.map((s) => finalByKey.get(s.core.key) ?? s.core);
  const finalOf = (core: TradeEvaluationCore): TradeEvaluationCore => {
    const known = finalByKey.get(core.key);
    if (known) return known;
    const x = exactByKey.get(core.key);
    if (!x) return core;
    const sim = simulateTrade(I, x, "final", settings.lambda, settings.protectValue);
    finalByKey.set(core.key, sim);
    return sim;
  };
  const planBCfg: PlanBConfig = { ...planBConfig(), ...opts.planB };
  // The given-player cap on the Plan B boxes (planB.ts): the boxes of the cards in the cap's top-20 window, each counting
  // the players of mine its card doesn't give, in the cards' order.
  const capWindow = Math.max(0, Math.floor(config.ranking.partnerCapTop));
  const inBoxes = new Map<string, number>();
  const count = (ids: readonly string[]) => {
    for (const id of ids) inBoxes.set(id, (inBoxes.get(id) ?? 0) + 1);
  };
  const shown: TradeEvaluation[] = [];
  // A box never names a trade the list shows as a card (planB.ts: the card above or below already offers it).
  const shownKeys = new Set(ranked.trades.map((t) => t.key));
  const total = Math.max(1, ranked.trades.length);
  for (let i = 0; i < ranked.trades.length; i++) {
    const { reasons: _reasons, pitch: _pitch, ...core } = ranked.trades[i] as TradeEvaluation;
    void _reasons;
    void _pitch;
    const version = versions.get(core.key);
    const steps = version ? tradeSteps(I, version, { settings, maxPerSide, versions }) : null;
    let planB: PlanB | null = null;
    if (!steps) {
      const inWindow = i < capWindow;
      const skip = inWindow ? givenCapSkip(core.proposal, inBoxes, planBCfg.givenPlayerCap) : undefined;
      const it = choosePlanB(core, planBCandidates(core, planBPool, planBCfg, shownKeys), finalOf, planBCfg, skip);
      let r = it.next();
      while (!r.done) {
        yield { stage: "rank", done: i, total };
        r = it.next();
      }
      planB = r.value;
      if (planB && inWindow) count(addedGiven(core.proposal, planB.proposal));
    }
    shown.push(withWords(I, { ...core, ...(steps ? { steps } : {}), ...(planB ? { planB } : {}) }));
    yield { stage: "rank", done: i + 1, total };
  }
  if (!ranked.trades.length) yield { stage: "rank", done: 1, total: 1 };
  mark("steps");
  return result(shown, { byBenefit: ranked.hidden.byBenefit + hiddenElsewhere.byBenefit, byMarket: ranked.hidden.byMarket + hiddenElsewhere.byMarket }, notes, ranked.dropped);
}

/** Runs tradeSearch to the end on the calling thread, reporting each progress step. */
export function runTradeSearch(ctx: TradeContext, opts: TradeSearchOptions = {}, onProgress?: (p: TradeSearchProgress) => void): TradeSearchResult {
  const it = tradeSearch(ctx, opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    onProgress?.(r.value);
  }
}
