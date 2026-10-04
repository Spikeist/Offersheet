/**
 * TradeEvaluation fixtures for engine tests (rank.ts and explain.ts; other tracks may reuse them). Test-only: no
 * engine code imports this file. Defaults are consistent with the engine's own rules, so a test overrides only what
 * it is about:
 * - Trade Score, Overall and the acceptance label come from B and P_complete through benefit.ts and acceptance.ts;
 * - the flags from benefit.tradeFlags (g_mkt(me), B, the injured list);
 * - g_mkt for the two sides agree with the package values (the card's value given / received): my PV_give is the
 *   partner's PV_recv, so 1 + g_mkt(partner) = 1 / (1 + g_mkt(me));
 * - a star premium fact's e and "Harder to get" tag follow config.acceptance.starPremium (premiumFact);
 * - "Offer first / if they say no" steps follow the addendum's two cases and pass its show thresholds by default
 *   (tradeSteps, withSteps).
 * Players are public NFL names (their statuses here are made up); teams are placeholders ("Team 7"), as reports use.
 */
import { acceptanceLabel, type AcceptanceTerms, type ActivitySummary, type ContextTerm } from "./acceptance";
import { overallScore, tradeFlags, tradeScore } from "./benefit";
import { config } from "./config";
import type { ExplainContext } from "./explain";
import type { InjuryStatus, Pos, SlotDef } from "./model";
import { slotInstances } from "./needs";
import type { PlanB, PremiumFact, TradeAsset, TradeDetail, TradeEvaluation, TradeEvaluationCore, TradeProposal, TradeStep, TradeSteps } from "./tradeModel";

/** A 10-team ESPN-style lineup: QB, RB ×2, WR ×2, TE, FLEX (RB/WR/TE), K, D/ST. */
export const FIXTURE_LINEUP: SlotDef[] = [
  { slot: "QB", count: 1, eligible: ["QB"] },
  { slot: "RB", count: 2, eligible: ["RB"] },
  { slot: "WR", count: 2, eligible: ["WR"] },
  { slot: "TE", count: 1, eligible: ["TE"] },
  { slot: "RB/WR/TE", count: 1, eligible: ["RB", "WR", "TE"] },
  { slot: "K", count: 1, eligible: ["K"] },
  { slot: "D/ST", count: 1, eligible: ["DEF"] },
];

/** Its slot instances: QB1 "QB", RB1, RB2, WR1, WR2, TE1 "TE", RB/WR/TE1 "FLEX", K1 "K", D/ST1 "D/ST". */
export const FIXTURE_SLOTS = slotInstances(FIXTURE_LINEUP);

export interface FixturePlayer {
  name: string;
  pos: Pos;
  nflTeam: string | null;
  injury?: InjuryStatus;
}

/** Fixture players by id. */
export const FIXTURE_PLAYERS: Readonly<Record<string, FixturePlayer>> = {
  allen: { name: "Josh Allen", pos: "QB", nflTeam: "BUF" },
  nix: { name: "Bo Nix", pos: "QB", nflTeam: "DEN" },
  bijan: { name: "Bijan Robinson", pos: "RB", nflTeam: "ATL" },
  kyren: { name: "Kyren Williams", pos: "RB", nflTeam: "LAR" },
  cmc: { name: "Christian McCaffrey", pos: "RB", nflTeam: "SF", injury: "IR" },
  jacobs: { name: "Josh Jacobs", pos: "RB", nflTeam: "GB", injury: "OUT" },
  jefferson: { name: "Justin Jefferson", pos: "WR", nflTeam: "MIN" },
  jsn: { name: "Jaxon Smith-Njigba", pos: "WR", nflTeam: "SEA" },
  nacua: { name: "Puka Nacua", pos: "WR", nflTeam: "LAR" },
  wilson: { name: "Garrett Wilson", pos: "WR", nflTeam: "NYJ" },
  kelce: { name: "Travis Kelce", pos: "TE", nflTeam: "KC" },
  laporta: { name: "Sam LaPorta", pos: "TE", nflTeam: "DET" },
  steelers: { name: "Steelers D/ST", pos: "DEF", nflTeam: "PIT" },
};

/** My team in the fixtures, and the default partner. */
export const FIXTURE_MY_TEAM = "3";
export const FIXTURE_PARTNER = "7";

/** An ExplainContext with placeholder team names ("Team 7") and the fixture players. */
export function explainContext(over: Partial<ExplainContext> = {}): ExplainContext {
  return {
    teamName: (id) => `Team ${id}`,
    player: (id) => FIXTURE_PLAYERS[id] ?? null,
    slots: FIXTURE_SLOTS,
    leagueType: "redraft",
    tradeDeadline: { week: 13, date: "2026-12-02T17:00:00.000Z" },
    ...over,
  };
}

/** Acceptance terms, all 0 except the base (β0 = −0.6). */
export function acceptanceTerms(over: Partial<AcceptanceTerms> = {}): AcceptanceTerms {
  return { base: -0.6, value: 0, need: 0, hole: 0, complexity: 0, activity: 0, history: 0, context: 0, hot: 0, urgency: 0, ...over };
}

/** An activity summary matching no rule ("normal", a = 0). */
export function activitySummary(over: Partial<ActivitySummary> = {}): ActivitySummary {
  return { a: 0, rule: "normal", trades: 0, recentTrades: 0, transactions: 4, lastWeek: 3, ...over };
}

/** No season context. */
export function contextTerm(over: Partial<ContextTerm> = {}): ContextTerm {
  return { ctx: 0, checkedOut: false, agingPlayers: 0, contender: false, ...over };
}

/** A TradeDetail with nothing to say: no slots, holes, hot players, urgency, weeks or notes. */
export function tradeDetail(over: Partial<TradeDetail> = {}): TradeDetail {
  return {
    myTeamId: FIXTURE_MY_TEAM,
    mySlots: [],
    partnerSlots: [],
    teams: 10,
    holes: [],
    holesFilled: [],
    terms: acceptanceTerms(),
    vetoRisk: false,
    activity: activitySummary(),
    history: { trades: 0, average: null },
    context: contextTerm(),
    hotReceived: [],
    hotGiven: [],
    urgency: 0,
    weekly: [],
    riskyWeeks: [],
    notes: [],
    ...over,
  };
}

const player = (id: string): TradeAsset => ({ kind: "player", id });

/** A stable key for a fixture proposal (the engine builds its own; tests only need it unique and stable). */
export function fixtureKey(p: TradeProposal): string {
  const side = (assets: readonly TradeAsset[]) =>
    assets
      .map((a) => (a.kind === "player" ? a.id : `pick:${a.season}:${a.round}:${a.originalTeamId}`))
      .sort()
      .join(",");
  return `${p.partnerId}|${side(p.give)}|${side(p.get)}`;
}

/** What tradeEvaluation takes: any TradeEvaluation field, plus the trade as player ids and a partial detail. */
export interface EvaluationFixture extends Partial<Omit<TradeEvaluation, "proposal" | "detail">> {
  partnerId?: string;
  /** My players given / received (canonical ids); default ["nix"] for ["kelce"]. */
  give?: readonly string[];
  get?: readonly string[];
  /** Assets as given (picks included), instead of `give` / `get`. */
  proposal?: TradeProposal;
  detail?: Partial<TradeDetail>;
}

/**
 * A final-stage, legal TradeEvaluation (the file header's rules): by default B 3, P_complete 0.4, even value
 * (5,000 each way), +2 points a week for me, odds +3 / +1 percentage points, and a detail with nothing to say.
 */
export function tradeEvaluation(o: EvaluationFixture = {}): TradeEvaluation {
  const proposal: TradeProposal = o.proposal ?? {
    partnerId: o.partnerId ?? FIXTURE_PARTNER,
    give: (o.give ?? ["nix"]).map(player),
    get: (o.get ?? ["kelce"]).map(player),
  };
  const b = o.b === undefined ? 3 : o.b;
  const pComplete = o.pComplete ?? 0.4;
  const pAccept = o.pAccept ?? pComplete;
  const gMine = o.gMine ?? 0;
  const gPartner = o.gPartner ?? (gMine > -1 ? 1 / (1 + gMine) - 1 : Number.POSITIVE_INFINITY);
  const given = 5000;
  const received = Number.isFinite(gMine) ? given * (1 + gMine) : 0;
  const assets = proposal.give.length + proposal.get.length;
  const pz = Math.min(0.999, Math.max(0.001, pAccept));
  const injured = o.flags?.injured ?? [];
  return {
    key: o.key ?? fixtureKey(proposal),
    proposal,
    illegal: o.illegal ?? null,
    stage: o.stage ?? "final",
    sims: o.sims ?? 5000,
    required: o.required ?? { me: { drops: [], adds: [] }, partner: { drops: [], adds: [] } },
    b,
    tradeScore: o.tradeScore !== undefined ? o.tradeScore : tradeScore(b),
    pAccept,
    pComplete,
    acceptLabel: o.acceptLabel ?? acceptanceLabel(pAccept),
    overall: o.overall !== undefined ? o.overall : overallScore(b, pComplete),
    dPO: o.dPO !== undefined ? o.dPO : 0.03,
    dCH: o.dCH !== undefined ? o.dCH : 0.01,
    dEW: o.dEW !== undefined ? o.dEW : 0.2,
    dPPW: o.dPPW ?? 2,
    dPPWPlayoffs: o.dPPWPlayoffs ?? 2,
    bWin: o.bWin !== undefined ? o.bWin : b,
    bFuture: o.bFuture ?? null,
    lambda: o.lambda ?? null,
    dDyn: o.dDyn ?? null,
    dynMissing: o.dynMissing ?? false,
    value: o.value ?? { given, received },
    gMine,
    gPartner,
    ros: o.ros ?? { given: 100, received: 120 },
    partnerDeltaLineup: o.partnerDeltaLineup ?? 0,
    features: o.features ?? { g: Math.max(-0.5, Math.min(0.5, gPartner)), n: 0, h: 0, c: Math.max(0, assets - 2), a: 0, hist: null, ctx: 0, hot: 0, urg: 0, z: Math.log(pz / (1 - pz)) },
    flags: o.flags ?? tradeFlags({ gMine, b, injured }),
    detail: tradeDetail(o.detail),
    ...(o.steps ? { steps: o.steps } : {}),
    ...(o.planB ? { planB: o.planB } : {}),
    reasons: o.reasons ?? [],
    pitch: o.pitch ?? "",
  };
}

/**
 * A Plan B ("If they say no, try:"; planner reply to Checkpoint 4, change 6) for a fixture card: the trade as player ids
 * (default my ["nix"] for their ["jsn"], another target than tradeEvaluation's default) with tradeEvaluation's rules for
 * its numbers (B 2 by default: Helps you and Overall from B and P_complete, the label from P_accept).
 */
export function planBFixture(o: { partnerId?: string; give?: readonly string[]; get?: readonly string[]; b?: number; pComplete?: number; pAccept?: number; kind?: PlanB["kind"] } = {}): PlanB {
  const e = tradeEvaluation({ partnerId: o.partnerId, give: o.give ?? ["nix"], get: o.get ?? ["jsn"], b: o.b ?? 2, pComplete: o.pComplete ?? 0.5, ...(o.pAccept !== undefined ? { pAccept: o.pAccept } : {}) });
  return { proposal: e.proposal, key: e.key, b: e.b as number, tradeScore: e.tradeScore as number, pAccept: e.pAccept, pComplete: e.pComplete, acceptLabel: e.acceptLabel, overall: e.overall as number, kind: o.kind ?? "otherTarget" };
}

/**
 * The star premium on one player the partner gives (PremiumFact; planner addendum to Checkpoint 3, §1): by default
 * their best player (rank 1), not a top-12 one. e (= e_rank + e_elite) and the "Harder to get" tag (e ≥
 * harderToGetMin) follow config.acceptance.starPremium unless given; pass `e` for the dynasty rebuilding halving.
 */
export function premiumFact(playerId: string, over: Partial<Omit<PremiumFact, "playerId">> = {}): PremiumFact {
  const sp = config.acceptance.starPremium;
  const rank = over.rank ?? 1;
  const elite = over.elite ?? false;
  const e = over.e ?? (sp.rank[rank - 1] ?? 0) + (elite ? sp.elite : 0);
  return { playerId, e, rank, elite, harderToGet: over.harderToGet ?? e >= sp.harderToGetMin - 1e-9 };
}

/** What tradeStep takes: any TradeStep field, plus the trade as player ids and a partial detail (tradeEvaluation's conventions). */
export interface StepFixture extends Partial<Omit<TradeStep, "proposal" | "detail">> {
  partnerId?: string;
  /** My players given / received (canonical ids); default ["nix"] for ["kelce"]. */
  give?: readonly string[];
  get?: readonly string[];
  /** Assets as given, instead of `give` / `get`. */
  proposal?: TradeProposal;
  detail?: Partial<TradeDetail>;
}

/**
 * One version of a trade in "Offer first / if they say no" (TradeStep; addendum §4), with tradeEvaluation's defaults
 * and rules: B 3 (Trade Score from it), P_complete 0.4 (P_accept the same, its label), even value (g_mkt(partner) from
 * g_mkt(me)), no forced moves, a detail with nothing to say.
 */
export function tradeStep(o: StepFixture = {}): TradeStep {
  const proposal: TradeProposal = o.proposal ?? {
    partnerId: o.partnerId ?? FIXTURE_PARTNER,
    give: (o.give ?? ["nix"]).map(player),
    get: (o.get ?? ["kelce"]).map(player),
  };
  const b = o.b === undefined ? 3 : o.b;
  const pComplete = o.pComplete ?? 0.4;
  const pAccept = o.pAccept ?? pComplete;
  const gMine = o.gMine ?? 0;
  return {
    proposal,
    key: o.key ?? fixtureKey(proposal),
    b,
    tradeScore: o.tradeScore !== undefined ? o.tradeScore : tradeScore(b),
    pAccept,
    pComplete,
    acceptLabel: o.acceptLabel ?? acceptanceLabel(pAccept),
    gMine,
    gPartner: o.gPartner ?? (gMine > -1 ? 1 / (1 + gMine) - 1 : Number.POSITIVE_INFINITY),
    required: o.required ?? { me: { drops: [], adds: [] }, partner: { drops: [], adds: [] } },
    detail: tradeDetail(o.detail),
  };
}

/** A step's own numbers and facts (its proposal follows the case in tradeSteps). */
export type StepOverrides = Omit<StepFixture, "proposal" | "give" | "get" | "partnerId">;

/** What tradeSteps reads from the ranked trade (a TradeEvaluation or its core). */
export type RankedTrade = Pick<TradeEvaluationCore, "proposal" | "key" | "b" | "tradeScore" | "pAccept" | "pComplete" | "acceptLabel" | "gMine" | "gPartner" | "required" | "detail">;

/** The other version's defaults in tradeSteps: its P_complete this much away from the ranked trade's (more than the show threshold, 0.05). */
const STEP_ACCEPT_GAP = 0.15;

/**
 * "Offer first / if they say no" steps (TradeSteps; addendum §4) for the ranked trade `ranked` (e.g. from
 * tradeEvaluation) and the throw-in `throwIn` (one of my players), in the addendum's two cases:
 * - `throwIn` in the ranked trade's give (another of my players must stay without him; else it throws): ranked
 *   "full". The full step is the ranked trade (its numbers and detail); the offer first is it without the throw-in,
 *   by default P_complete STEP_ACCEPT_GAP lower (at least minOfferFirst), B 10% higher (I keep him) and g_mkt(me) 0.1
 *   higher.
 * - otherwise: ranked "offerFirst". The offer first is the ranked trade; the full step adds the throw-in to my side,
 *   by default P_complete STEP_ACCEPT_GAP higher (at most the P_accept cap, config.acceptance.pAcceptClamp's top), B 90%
 *   (above the 80% rule) and g_mkt(me) 0.1 lower.
 * The other version's detail defaults to the ranked trade's. `over` overrides either step's numbers and facts (a
 * partial detail merges onto its default); derived fields (Trade Score, label, g_mkt(partner)) follow the overrides.
 */
export function tradeSteps(ranked: RankedTrade, throwIn: string, over: { offerFirst?: StepOverrides; full?: StepOverrides } = {}): TradeSteps {
  const isThrowIn = (a: TradeAsset) => a.kind === "player" && a.id === throwIn;
  const own = (o: StepOverrides = {}): TradeStep =>
    tradeStep({
      proposal: ranked.proposal,
      key: ranked.key,
      required: ranked.required,
      b: ranked.b,
      ...(o.b === undefined ? { tradeScore: ranked.tradeScore } : {}),
      pComplete: ranked.pComplete,
      pAccept: o.pComplete !== undefined ? o.pComplete : ranked.pAccept,
      ...(o.pAccept === undefined && o.pComplete === undefined ? { acceptLabel: ranked.acceptLabel } : {}),
      gMine: ranked.gMine,
      ...(o.gMine === undefined ? { gPartner: ranked.gPartner } : {}),
      ...o,
      detail: { ...ranked.detail, ...o.detail },
    });
  const other = (proposal: TradeProposal, defaults: { b: number | null; pComplete: number; gMine: number }, o: StepOverrides = {}): TradeStep =>
    tradeStep({ proposal, ...defaults, ...o, detail: { ...ranked.detail, ...o.detail } });
  const b = ranked.b;
  if (ranked.proposal.give.some(isThrowIn)) {
    if (!ranked.proposal.give.some((a) => !isThrowIn(a))) throw new Error(`tradeSteps: ${throwIn} is my only player in the trade, so neither case applies`);
    const lean: TradeProposal = { ...ranked.proposal, give: ranked.proposal.give.filter((a) => !isThrowIn(a)) };
    const offerFirst = other(lean, { b: b === null ? null : b * 1.1, pComplete: Math.max(config.search.steps.minOfferFirst, ranked.pComplete - STEP_ACCEPT_GAP), gMine: ranked.gMine + 0.1 }, over.offerFirst);
    return { offerFirst, ifNo: { add: throwIn, full: own(over.full) }, ranked: "full" };
  }
  const full: TradeProposal = { ...ranked.proposal, give: [...ranked.proposal.give, player(throwIn)] };
  const fullStep = other(full, { b: b === null ? null : b * 0.9, pComplete: Math.min(config.acceptance.pAcceptClamp[1], ranked.pComplete + STEP_ACCEPT_GAP), gMine: ranked.gMine - 0.1 }, over.full);
  return { offerFirst: own(over.offerFirst), ifNo: { add: throwIn, full: fullStep }, ranked: "offerFirst" };
}

/** `ranked` with its steps (tradeSteps): `withSteps(tradeEvaluation({ give: ["kelce", "nix"], get: ["bijan"] }), "nix")`. */
export function withSteps<T extends RankedTrade>(ranked: T, throwIn: string, over: { offerFirst?: StepOverrides; full?: StepOverrides } = {}): T & { steps: TradeSteps } {
  return { ...ranked, steps: tradeSteps(ranked, throwIn, over) };
}
