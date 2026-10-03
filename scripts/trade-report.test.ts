/**
 * The trade report's offline logic (scripts/trade-report.ts buildTradeReport and the checks behind it) on a small
 * synthetic league (src/engine/trade.testing.ts smallLeague: 6 teams, made-up players): no network, no .env.local.
 * The league is given real-looking team, owner and league names first, so the tests can show none reaches the report.
 * Three players get public NFL names the report follows by name: Bo Nix and Christian McCaffrey (the optimizer section)
 * and, for the Smith-Njigba example, the most valuable player of teams 2, 5 and 6 renamed Jaxon Smith-Njigba. The lead's
 * named star trades (Brock Bowers and others) aren't in a synthetic league: the report says so.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { displayAcceptance } from "@/engine/acceptance";
import { config } from "@/engine/config";
import { assetValue, buildTradeContext, perceivedG, throwIns, tradeInternals, tradeVersion, type Screened, type TeamState, type TradeVersion } from "@/engine/evaluate";
import { buildLeagueModel } from "@/engine/league";
import type { LeagueSnapshot, Pos } from "@/engine/model";
import { rankTrades, type RankConfig } from "@/engine/rank";
import { belowWaiverCredit, runTradeSearch, shortlistOf } from "@/engine/search";
import { PROTECT_VALUE_LEVELS, defaultTradeSettings } from "@/engine/settings";
import { TEST_NOW } from "@/engine/testLeague";
import { smallLeague } from "@/engine/trade.testing";
import type { TradeAsset, TradeEvaluation, TradeProposal } from "@/engine/tradeModel";
import { premiumFact, tradeEvaluation } from "@/engine/tradeTestFixtures";
import { buildLeagueView } from "@/lib/leagueView";
import { placeholders } from "./league-report";
import {
  ANCHORS,
  ANCHOR_TOLERANCE,
  CHECKPOINT3_OPTIMIZER,
  DEEP_OVERPAY_BELOW,
  PREMIUM_ANCHORS,
  PREMIUM_ANCHOR_TOLERANCE,
  PRE_EXACT,
  REALISM_BUCKETS,
  STAR_NAME,
  STAR_PACKAGE,
  STAR_TRADES,
  TOP_DETAIL,
  anchorRows,
  breakEvenKappa,
  buildTradeReport,
  dropStage,
  fmt,
  gMineStats,
  ifEvaluated,
  ifWords,
  loadOffline,
  neverEvaluatedText,
  partnerSide,
  pctSigned,
  premiumAnchorRows,
  pts,
  rankFate,
  realismCheck,
  realismVerdict,
  referenceCheck,
  signatureOf,
  signed,
  stageTag,
  stageWords,
  termRows,
  valueReading,
  valueTermWords,
  type CompareRow,
  type DropStage,
  type ModelSide,
  type Realism,
  type SearchReference,
} from "./trade-report";

/** Names the report must never print (stand-ins for leaguemates' team and owner names and the league's id). */
const PRIVATE = { league: "Secret League Name", leagueId: "987654321", team: (id: string) => `Zebra Squad ${id}`, owner: (id: string) => `Owner Realname ${id}` };

/** A player of `teamId` at `pos`, renamed (public NFL names the optimizer section follows). */
function rename(s: LeagueSnapshot, teamId: string, pos: Pos, name: string): LeagueSnapshot {
  const team = s.teams.find((t) => t.id === teamId);
  const id = team?.roster.find((p) => s.players[p]?.pos === pos);
  if (!id) throw new Error(`no ${pos} on team ${teamId}`);
  return renameId(s, id, name);
}

function renameId(s: LeagueSnapshot, id: string, name: string): LeagueSnapshot {
  return { ...s, players: { ...s.players, [id]: { ...(s.players[id] as LeagueSnapshot["players"][string]), name } } };
}

/** The star of the Smith-Njigba example: the most valuable active player of teams 2, 5 and 6 (not mine, not the optimizer examples'). */
const STAR_TEAMS = ["2", "5", "6"];

function league(): { raw: LeagueSnapshot; snapshot: LeagueSnapshot; inputs: ReturnType<typeof smallLeague>["inputs"]; starId: string; starTeam: string } {
  const { snapshot, inputs } = smallLeague(11);
  let raw: LeagueSnapshot = { ...snapshot, name: PRIVATE.league, leagueId: PRIVATE.leagueId, teams: snapshot.teams.map((t) => ({ ...t, name: PRIVATE.team(t.id), ownerName: PRIVATE.owner(t.id) })) };
  raw = rename(raw, "3", "QB", "Bo Nix");
  raw = rename(raw, "4", "RB", "Christian McCaffrey");
  const values = inputs.market?.values ?? {};
  const candidates = raw.teams.filter((t) => STAR_TEAMS.includes(t.id)).flatMap((t) => t.roster.map((id) => ({ id, teamId: t.id, v: values[id] ?? 0 })));
  const star = candidates.sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1))[0];
  if (!star || !(star.v > 0)) throw new Error("no valued player for the star");
  raw = renameId(raw, star.id, STAR_NAME);
  return { raw, snapshot: placeholders(raw), inputs, starId: star.id, starTeam: star.teamId };
}

const { raw, snapshot, inputs, starId, starTeam } = league();
const clock = () => performance.now();
// One report for the suite: 4 availability scenarios (the app's 32 would only slow the suite; every rule is the same),
// one timed run after one warm-up (so the determinism check compares two searches).
const SCENARIOS = 4;
const report = buildTradeReport(snapshot, inputs, { now: TEST_NOW, clock, mode: "offline", dataNote: "Synthetic test league.", scenarios: SCENARIOS, runs: 1, warmups: 1 });
const doc = report.doc;
const settings = defaultTradeSettings();
/** Section n of the report ("## n. …" up to the next "## " heading; the "### …" subsections stay inside). */
const section = (n: number): string => {
  const m = new RegExp(`\\n## ${n}\\. `).exec(doc);
  if (!m) return "";
  const start = m.index + 1;
  const next = doc.indexOf("\n## ", start + 1);
  return doc.slice(start, next < 0 ? undefined : next);
};
const ids = (xs: readonly TradeAsset[]): string[] => xs.flatMap((a) => (a.kind === "player" ? [a.id] : []));
/** The card's three numbers as the report prints them in one cell. */
const three = (t: TradeEvaluation): string => `${t.tradeScore ?? "–"} / ${Math.round(100 * displayAcceptance(t.pAccept))}% / ${t.overall ?? "–"}`;
const binomial = (n: number, k: number): number => (k < 0 || k > n ? 0 : k === 0 ? 1 : (binomial(n - 1, k - 1) * n) / k);

describe("trade report: numbers in words", () => {
  it("formats numbers with a real minus sign and signs, percents and percentage points", () => {
    expect([fmt(1.234), fmt(-1.25, 2), fmt(-0.01, 1), fmt(null), fmt(Number.NaN)]).toEqual(["1.2", "−1.25", "0.0", "–", "–"]);
    expect([signed(2.5), signed(-0.4), signed(0), signed(0.04, 1)]).toEqual(["+2.5", "−0.4", "0.0", "0.0"]);
    expect([pctSigned(0.445), pctSigned(-0.308), pts(0.081), pts(-0.004), pts(null)]).toEqual(["+44.5%", "−30.8%", "+8.1 pts", "−0.4 pts", "–"]);
  });

  it("reads trade value exactly from both sides' g_mkt: my give is their get", () => {
    // I give 1,445 and get 1,000: g_mkt(me) = −0.308, g_mkt(them) = +0.445; "you give up 44.5% more than you get".
    expect(valueReading(1000 / 1445 - 1, 0.445)).toEqual({ you: "you give up 44.5% more trade value than you get", them: "they get 44.5% more than they give" });
    expect(valueReading(0.25, -0.2)).toEqual({ you: "you get 25.0% more trade value than you give", them: "they give up 25.0% more than they get" });
    expect(valueReading(0, 0).you).toBe("even trade value");
    expect(valueReading(Number.NaN, 0).you).toBe("trade value unknown");
  });
});

describe("trade report: the acceptance value term in words (review finding: the market percent next to the perceived g)", () => {
  /** A trade whose value term reads g (AcceptanceFeatures.g), the partner giving "kelce" with a star premium e (none when 0). */
  const trade = (gMine: number, g: number, e: number): TradeEvaluation => {
    const base = tradeEvaluation({ gMine, detail: e > 0 ? { premium: [premiumFact("kelce", { e })] } : {} });
    return { ...base, features: { ...base.features, g } };
  };

  it("the partner's side from its own g: they give up −g / (1 + g) more than they get", () => {
    expect(partnerSide(-0.452)).toEqual({ dir: "give", pct: 0.452 / 0.548 });
    expect(partnerSide(0.25)).toEqual({ dir: "get", pct: 0.25 });
    expect(partnerSide(0)).toEqual({ dir: "even", pct: 0 });
  });

  it("with a star premium: both readings, at market and as they see it, then the term's own g and β", () => {
    // Section 4's case: at market they give up 55% more (g_mkt(me) +0.55); with the premium their g is −0.452 (82.5% more).
    expect(valueTermWords(trade(0.55, -0.452, 0.2), snapshot)).toBe("they give up 55.0% more than they get at market, 82.5% more as they see it with the star premium on kelce at e 0.20 (their g −0.452 × β_loss 9: losses weigh more than gains)");
    // The perceived g past the model's clamp: its own reading, and the clamped g the term reads.
    expect(valueTermWords(trade(0.55, -0.5, 0.2), snapshot, -0.6)).toBe("they give up 55.0% more than they get at market, 150.0% more as they see it with the star premium on kelce at e 0.20 (their g −0.600, which the model clamps to −0.500 × β_loss 9: losses weigh more than gains)");
    // Ahead at market, behind as they see it: the loss wording and β follow the g the term reads.
    expect(valueTermWords(trade(-0.05, -0.08, 0.1), snapshot)).toBe("they get 5.3% more than they give at market, but as they see it with the star premium on kelce at e 0.10 they give up 8.7% more than they get (their g −0.080 × β_loss 9: losses weigh more than gains)");
    expect(valueTermWords(trade(-0.2, 0.1, 0.1), snapshot)).toBe("they get 25.0% more than they give at market, 10.0% more as they see it with the star premium on kelce at e 0.10 (their g +0.100 × β_gain 6)");
  });

  it("without a star premium: the market reading and its g (the term's, clamped when it must be)", () => {
    expect(valueTermWords(trade(0.3, 1 / 1.3 - 1, 0), snapshot)).toBe("they give up 30.0% more than they get (their g −0.231 × β_loss 9: losses weigh more than gains)");
    expect(valueTermWords(trade(-0.2, 0.25, 0), snapshot)).toBe("they get 25.0% more than they give (their g +0.250 × β_gain 6)");
    expect(valueTermWords(trade(2, -0.5, 0), snapshot)).toBe("they give up 200.0% more than they get (their g −0.667, which the model clamps to −0.500 × β_loss 9: losses weigh more than gains)");
    expect(valueTermWords(trade(0, 0, 0), snapshot)).toBe("even trade value (their g 0.000: no value term)");
  });

  it("the report's term tables read the partner's perceived g from the trade's context (unclamped), and say both readings under a premium", () => {
    const I = tradeInternals(report.ctx);
    const words = (t: TradeEvaluation) => termRows(t, snapshot, I).find((r) => r.term === "value")?.words;
    const pick = report.example.pick;
    if (pick) {
      const perceived = perceivedG(I, pick.proposal.partnerId, ids(pick.proposal.give), ids(pick.proposal.get), pick.gPartner) ?? null;
      expect(words(pick)).toBe(valueTermWords(pick, snapshot, perceived));
      expect(section(10)).toContain(`| value | ${signed(pick.detail.terms.value, 2)} | ${words(pick)} |`);
    }
    const star = report.star.pick?.after;
    expect(star?.detail.premium?.some((p) => p.e > 0)).toBe(true); // the star's own premium (the synthetic data's top player)
    if (star) {
      expect(words(star)).toContain(" at market, ");
      expect(words(star)).toContain(" as they see it with the star premium on ");
      expect(section(4)).toContain(`| value | ${signed(report.star.pick?.before?.detail.terms.value, 2)} | ${signed(star.detail.terms.value, 2)} | ${words(star)} |`);
    }
  });
});

describe("trade report: the acceptance anchors (§11 and the addendum)", () => {
  it("computes the planner's 8 scenarios with acceptance() and every one is within ±1 point", () => {
    const rows = anchorRows();
    expect(rows.map((r) => r.name)).toEqual(ANCHORS.map((a) => a.name));
    expect(rows.map((r) => r.planner)).toEqual([61.1, 35.4, 31.0, 8.3, 53.0, 21.4, 25.0, 81.8]);
    for (const r of rows) {
      expect(Math.abs(r.computed - r.planner)).toBeLessThanOrEqual(ANCHOR_TOLERANCE);
      expect(r.pass).toBe(true);
      expect(r.diff).toBeCloseTo(r.computed - r.planner, 12);
      expect(r.tolerance).toBe(ANCHOR_TOLERANCE);
      expect(r.withoutPremium).toBe(r.computed); // §11's scenarios carry no star premium
    }
  });

  it("computes the addendum's 6 star-premium scenarios through the real functions, within ±0.5 (W = 752), and the 51.3% before", () => {
    const rows = premiumAnchorRows();
    expect(rows.map((r) => r.name)).toEqual(PREMIUM_ANCHORS.map((a) => a.name));
    expect(rows.map((r) => r.planner)).toEqual([10.9, 35.4, 23.4, 32.8, 26.3, 62.0]);
    for (const r of rows) {
      expect(Math.abs(r.computed - r.planner)).toBeLessThanOrEqual(PREMIUM_ANCHOR_TOLERANCE);
      expect(r.pass).toBe(true);
      expect(r.tolerance).toBe(PREMIUM_ANCHOR_TOLERANCE);
      // The premium only ever lowers the estimate.
      expect(r.withoutPremium).toBeGreaterThanOrEqual(r.computed - 1e-9);
    }
    // The planner's "before" values: 51.3% for the 3-for-1 star trade, unchanged for the #6.
    expect(rows[2]?.plannerBefore).toBe(51.3);
    expect(Math.abs((rows[2]?.withoutPremium ?? 0) - 51.3)).toBeLessThanOrEqual(PREMIUM_ANCHOR_TOLERANCE);
    expect(rows[1]?.withoutPremium).toBeCloseTo(rows[1]?.computed ?? 0, 12);
  });

  it("prints one table of 14 rows (the 8 and the 6), each with its tolerance and the estimate without the premium, and the verdict", () => {
    const s = section(8);
    const rows = s.split("\n").filter((l) => /^\| \d+ \| /.test(l));
    expect(rows).toHaveLength(ANCHORS.length + PREMIUM_ANCHORS.length);
    for (const a of ANCHORS) expect(s).toContain(`| ${a.name} | ${fmt(a.percent)}% |`);
    for (const a of PREMIUM_ANCHORS) expect(s).toContain(`| ${a.name} | ${fmt(a.percent)}%`);
    expect(s).toContain("| 23.4% (51.3% before) |");
    expect(rows.filter((r) => r.includes("| ±1 |"))).toHaveLength(ANCHORS.length);
    expect(rows.filter((r) => r.includes("| ±0.5 |"))).toHaveLength(PREMIUM_ANCHORS.length);
    expect(s).toContain("14 of 14 within their tolerance (§11: 8 of 8 within ±1; the addendum: 6 of 6 within ±0.5");
    expect(s).toContain("**Pass.**");
  });
});

describe("trade report: the realism check", () => {
  const base: Realism = { trades: 4, partnerBuckets: [], mineBuckets: [], partner: { min: 0, median: 0.2, max: 0.4 }, mine: { min: -0.3, median: -0.1, max: 0 }, partnerOverpays: 0, marketCheck: 0, valueTerm: 0, pAccept: 0.5, pAcceptEven: 0.4, b: 3, marketTerm: -0.1 };

  it("says plainly which way the offers lean", () => {
    expect(realismVerdict({ ...base, partnerOverpays: 3 })).toContain("the search favors offers lopsided against the partner.");
    expect(realismVerdict({ ...base, marketCheck: 3 })).toContain("so most suggestions ask you to give up more than 15% in value");
    expect(realismVerdict({ ...base, marketCheck: 1 })).toContain("It leans the other way: 1 of 4 (25%)");
    expect(realismVerdict({ ...base })).toContain("Nor does it lean the other way: 0 of 4");
    expect(realismVerdict({ ...base, trades: 0 })).toBe("No trades to check.");
  });

  it("counts the shown trades into the buckets, by g_mkt(partner) < −0.15 and by the Market check flag", () => {
    const trades = report.result.trades;
    const r = realismCheck(trades);
    expect(r.trades).toBe(trades.length);
    expect(r.partnerBuckets.reduce((s, x) => s + x, 0)).toBe(trades.length);
    expect(r.mineBuckets.reduce((s, x) => s + x, 0)).toBe(trades.length);
    expect(r.partnerBuckets).toHaveLength(REALISM_BUCKETS.length);
    expect(r.partnerOverpays).toBe(trades.filter((t) => t.gPartner < -0.15).length);
    expect(r.marketCheck).toBe(trades.filter((t) => t.gMine < config.benefit.marketCheckBelow).length);
    const s = section(3);
    expect(s).toContain(`| g_mkt bucket | Trades by g_mkt(partner) | Trades by g_mkt(you) |`);
    expect(s).toContain(`**${r.partnerOverpays} of ${r.trades}**`);
    expect(s).toContain(realismVerdict(r));
    expect(s).toContain(`B's market term (§10 with the addendum: κ ${config.benefit.protectValue.medium} × clamp(g, ±0.5)`);
  });
});

describe("trade report: before and after the addendum", () => {
  const v = report.variants;

  it("the before column is the beforeAddendum variant's own search; the after column is the app's (the report's main search)", () => {
    expect(tradeInternals(v.before.ctx).beforeAddendum).toBe(true);
    expect(tradeInternals(v.medium.ctx).beforeAddendum).toBe(false);
    expect(v.medium.result).toBe(report.result);
    expect(v.before.kappa).toBe(config.benefit.marketSanityWeight);
    // An independent before-addendum search gives the same trades with the same numbers.
    const fresh = runTradeSearch(buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: SCENARIOS, beforeAddendum: true }), { settings });
    expect(signatureOf(v.before.result)).toBe(signatureOf(fresh));
    // The model before the addendum: no star premium facts and no steps.
    for (const t of v.before.result.trades) {
      expect(t.detail.premium).toBeUndefined();
      expect(t.steps).toBeUndefined();
    }
    for (const t of report.result.trades) expect(t.detail.premium).toBeDefined();
  });

  it("checks the before variant against a saved reference place by place (keys and numbers only); without one it says so", () => {
    const toRef = (r: typeof v.before.result): SearchReference => ({
      counts: { ...r.counts },
      hidden: { ...r.hidden },
      trades: r.trades.map((t) => ({ key: t.key, b: t.b, tradeScore: t.tradeScore, pAccept: t.pAccept, pComplete: t.pComplete, overall: t.overall, dPO: t.dPO, dCH: t.dCH, dPPW: t.dPPW, gMine: t.gMine, gPartner: t.gPartner, flags: { ...t.flags, injured: [...t.flags.injured] } })),
    });
    // A JSON round trip keeps every number exactly, as the saved file does.
    const ref = JSON.parse(JSON.stringify(toRef(v.before.result))) as SearchReference;
    expect(referenceCheck(v.before.result, ref, "ref.json")).toEqual({ label: "ref.json", trades: v.before.result.trades.length, same: v.before.result.trades.length, counts: true, hidden: true, first: null });
    const off = JSON.parse(JSON.stringify(ref)) as SearchReference;
    (off.trades[1] as SearchReference["trades"][number]).pAccept += 1e-12;
    off.counts.screened += 1;
    const bad = referenceCheck(v.before.result, off, "ref.json");
    expect(bad.same).toBe(v.before.result.trades.length - 1);
    expect(bad.first).toBe("#2: pAccept");
    expect(bad.counts).toBe(false);
    expect(bad.hidden).toBe(true);
    // The after model's search is not the reference: it differs (the star premium, κ).
    expect(referenceCheck(report.result, ref, "ref.json").same).toBeLessThan(ref.trades.length);
    expect(report.reference).toBeNull();
    expect(section(2)).toContain("Not re-checked here against the pre-addendum reference (no reference saved for this data)");
  });

  it("prints the two top 10s side by side with the three numbers, rank by rank", () => {
    const s = section(2);
    const rows = s.split("\n").filter((l) => /^\| \d+ \| (Team \d+|–): /.test(l) || /^\| \d+ \| – \|/.test(l));
    const bTop = v.before.result.trades.slice(0, TOP_DETAIL);
    const aTop = report.result.trades.slice(0, TOP_DETAIL);
    expect(rows).toHaveLength(Math.max(bTop.length, aTop.length));
    rows.forEach((row, i) => {
      const b = bTop[i];
      const a = aTop[i];
      if (b) expect(row).toContain(`| Team ${b.proposal.partnerId}: `);
      if (b) expect(row).toContain(`| ${three(b)} |`);
      if (a) expect(row).toContain(`| ${three(a)} |`);
    });
  });

  it("what changed: every trade of either top 10 in both models, B_win identical in both, a shown trade's numbers the list's own", () => {
    const keys = new Set(report.compare.map((r) => r.key));
    for (const t of [...v.before.result.trades.slice(0, TOP_DETAIL), ...report.result.trades.slice(0, TOP_DETAIL)]) expect(keys.has(t.key)).toBe(true);
    expect(keys.size).toBe(report.compare.length);
    for (const r of report.compare) {
      const b = r.before.t as TradeEvaluation;
      const a = r.after.t as TradeEvaluation;
      expect(b).not.toBeNull();
      expect(a).not.toBeNull();
      if (r.before.rank !== null) expect(b).toBe(v.before.result.trades[r.before.rank - 1]);
      if (r.after.rank !== null) expect(a).toBe(report.result.trades[r.after.rank - 1]);
      // The same lineups, seeds and seasons: only the market term and the premium can differ.
      expect(a.bWin).toBe(b.bWin);
      expect(a.gMine).toBe(b.gMine);
      expect(a.gPartner).toBe(b.gPartner);
    }
    const s = section(2);
    expect(s).toContain("**What changed, trade by trade**");
    expect(s).toMatch(/- \*\*\d+ of the before top \d+ are still in the after top \d+\*\*/);
  });
});

describe("trade report: where a trade left each model's search (section 2; review finding: the stages behind \"not shown\")", () => {
  const v = report.variants;
  const runs = [
    { tr: report.traces.before, run: v.before },
    { tr: report.traces.after, run: v.medium },
  ];
  const player = (id: string): TradeAsset => ({ kind: "player", id });
  const asProposal = (x: Pick<Screened, "partnerId" | "give" | "get">): TradeProposal => ({ partnerId: x.partnerId, give: x.give.map(player), get: x.get.map(player) });
  const teamName = (id: string) => `Team ${id}${id === report.result.myTeamId ? " (you)" : ""}`;

  it("each model's search re-run stage by stage reproduces it exactly: counts, the shortlist, the shown trades in order", () => {
    for (const { tr, run } of runs) {
      expect(tr.matches).toBe(true);
      expect(tr.stopped).toBe(false);
      expect(tr.shown).toEqual(run.result.trades.map((t) => t.key));
      expect(tr.screens).toBe(run.result.counts.screened);
      expect(tr.exact.size).toBe(run.result.counts.exact);
      expect(tr.screen.size).toBe(run.result.counts.simScreen);
      expect(tr.finals.size).toBe(run.result.counts.simFinal);
      const I = tradeInternals(run.ctx);
      expect(tr.shortlist).toEqual(shortlistOf(tr.perPartner, I.beforeAddendum ? null : belowWaiverCredit(I)).map((x) => x.key));
    }
    // N11's pruning only in the addendum's model; section 3's measure reads the after trace.
    expect(report.traces.before.pruned.size).toBe(0);
    expect(report.pruning?.dropped).toBe(report.traces.after.pruned.size);
    expect(report.pruning?.screened).toBe(report.result.counts.screened);
  });

  it("dropStage agrees with the trace's own stages for every screened trade, and the finalists' fates add up to rankTrades' own counts", () => {
    const keep = config.search.keptPerPartner;
    const [lo, hi] = config.search.screeningGWindow;
    for (const { tr } of runs) {
      const fates = { shown: 0, byBenefit: 0, byMarket: 0, filler: 0, core: 0, partnerCap: 0 };
      for (const sc of tr.screened.values()) {
        const st = dropStage(tr, asProposal(sc));
        expect(st.kind).not.toBe("notScreened");
        expect(st.kind === "window").toBe(!(sc.gPartner >= lo - 1e-9 && sc.gPartner <= hi + 1e-9));
        if (st.kind === "pruned") expect(tr.pruned.has(sc.key)).toBe(true);
        if (st.kind === "partnerCut") expect(st.place.rank).toBeGreaterThan(keep);
        if (st.kind === "overallCut") expect(st.place.rank).toBeGreaterThan(config.search.exactEvaluationMax);
        // Exactly evaluated exactly when it isn't one of the stages before it.
        expect(tr.shortlist.includes(sc.key)).toBe(!PRE_EXACT.has(st.kind));
        if (st.kind === "illegal") expect(tr.illegal.get(sc.key)).toBe(st.reason);
        if (st.kind === "notFinalist") expect(tr.exact.has(sc.key) && !tr.finalists.has(sc.key)).toBe(true);
        if (st.kind === "shown" || st.kind === "hidden" || st.kind === "diversity" || st.kind === "lowerOverall") expect(tr.finalists.has(sc.key)).toBe(true);
        if (st.kind === "shown") {
          expect(tr.shown[st.place - 1]).toBe(sc.key);
          fates.shown++;
        }
        if (st.kind === "hidden") fates[st.why === "benefit" ? "byBenefit" : "byMarket"]++;
        if (st.kind === "diversity") fates[st.rule]++;
      }
      // A trade below the shown ones is never judged by a diversity rule, so the counts are rankTrades' own.
      const ranked = rankTrades([...tr.finals.values()].map((c) => ({ ...c, reasons: [], pitch: "" })), assetValue(tr.I));
      expect(fates.shown).toBe(ranked.trades.length);
      expect({ byBenefit: fates.byBenefit, byMarket: fates.byMarket }).toEqual(ranked.hidden);
      expect({ filler: fates.filler, core: fates.core, partnerCap: fates.partnerCap }).toEqual(ranked.dropped);
    }
  });

  it("the counterfactual reproduces the search's own fate for a trade it did evaluate (ifEvaluated adds nothing of its own)", () => {
    for (const { tr } of runs) {
      tr.shown.forEach((key, i) => expect(ifEvaluated(tr, asProposal(tr.screened.get(key) as Screened))).toEqual({ kind: "shown", place: i + 1 }));
      const out = tr.shortlist.find((k) => tr.exact.has(k) && !tr.finalists.has(k));
      expect(out).toBeDefined(); // a fact of the synthetic data, deterministic
      const p = asProposal(tr.screened.get(out as string) as Screened);
      expect(ifEvaluated(tr, p)).toEqual(dropStage(tr, p));
      expect(dropStage(tr, p).kind).toBe("notFinalist");
    }
  });

  it("names a trade the search never screened: a player outside the pools, or more than maxPerSide a side", () => {
    const tr = report.traces.after;
    const me = tr.I.me as TeamState;
    const outside = me.roster.find((id) => !tr.give.includes(id)) as string;
    const partner = [...tr.get.keys()][0] as string;
    const theirs = [...(tr.get.get(partner) ?? [])][0] as string;
    const st = dropStage(tr, { partnerId: partner, give: [player(outside)], get: [player(theirs)] });
    expect(st).toEqual({ kind: "notScreened", why: "pools", missingGive: [outside], missingGet: [] });
    expect(stageTag(st)).toBe("not screened");
    expect(stageWords(st, snapshot, `Team ${partner}`, settings.maxPerSide)).toBe(`never screened: ${snapshot.players[outside]?.name} isn't in your give pool`);
    expect(dropStage(tr, { partnerId: partner, give: tr.give.slice(0, settings.maxPerSide + 1).map(player), get: [player(theirs)] })).toMatchObject({ kind: "notScreened", why: "size" });
  });

  it("rankFate on fixtures: shown, hidden (B ≤ 0, the market guard), each diversity rule (the core named), and below the shown ones", () => {
    const values: Record<string, number> = { a1: 9000, a2: 100, a3: 200, b1: 8000, b2: 300, b3: 400, c1: 5000, c2: 4000, c3: 3000, c4: 2000, d1: 6000, d2: 5500, d3: 5400, d4: 5300 };
    const value = (a: TradeAsset) => (a.kind === "player" ? (values[a.id] ?? 0) : 0);
    const t = (partnerId: string, give: string[], get: string[], b: number, pComplete: number, gMine = 0) => tradeEvaluation({ partnerId, give, get, b, pComplete, gMine });
    const top = t("7", ["a1"], ["b1"], 8, 0.5); // EG 4.0
    const filler = t("7", ["a1", "a2"], ["b1"], 8.5, 0.45); // EG 3.83: top's players and a2, B within 20% of top's
    const second = t("7", ["a1"], ["b1", "b2"], 5, 0.7); // EG 3.5: core a1|b1 a second time, B 3 from top's: kept
    const third = t("7", ["a1", "a3"], ["b1", "b3"], 4, 0.8); // EG 3.2: core a1|b1 a third time
    const p8 = ["c1", "c2", "c3", "c4"].map((id, i) => t("8", [id], [`d${i + 1}`], 6, 0.5 - 0.01 * i)); // the 4th meets the partner cap
    const noHelp = t("9", ["a2"], ["b2"], -1, 0.9);
    const lopsided = t("9", ["a3"], ["b3"], 5, 0.9, -0.5);
    const all = [lopsided, third, ...p8, filler, noHelp, second, top]; // the order given never matters
    expect(rankFate(all, top.key, value)).toEqual({ kind: "shown", place: 1 });
    expect(rankFate(all, filler.key, value)).toEqual({ kind: "diversity", rule: "filler", core: null });
    expect(rankFate(all, second.key, value)).toEqual({ kind: "shown", place: 2 });
    expect(rankFate(all, third.key, value)).toEqual({ kind: "diversity", rule: "core", core: { give: "a1", get: "b1" } });
    expect(rankFate(all, (p8[3] as TradeEvaluation).key, value)).toEqual({ kind: "diversity", rule: "partnerCap", core: null });
    expect(rankFate(all, noHelp.key, value)).toEqual({ kind: "hidden", why: "benefit" });
    expect(rankFate(all, lopsided.key, value)).toEqual({ kind: "hidden", why: "market" });
    expect(rankTrades(all, value).dropped).toEqual({ filler: 1, core: 1, partnerCap: 1 });
    // Room for 3 only: the 4th kept trade is below them, and with room for every trade it would be #4.
    const cfg: RankConfig = { perPartnerInTop20: config.ranking.perPartnerInTop20, partnerCapTop: config.ranking.partnerCapTop, perCore: config.ranking.perCore, fillerCutoffFraction: config.ranking.fillerCutoffFraction, resultsShown: 3, marketHideBelow: config.benefit.marketHideBelow };
    expect(rankFate(all, (p8[1] as TradeEvaluation).key, value, cfg)).toEqual({ kind: "lowerOverall", place: 4 });
    const core: DropStage = { kind: "diversity", rule: "core", core: { give: "a1", get: "b1" } };
    expect(stageWords(core, snapshot, "Team 7", 2)).toBe("a finalist, dropped by §13's core rule: 2 trades above it share its core, a1 for b1 (the most valuable player on each side)");
    expect(ifWords({ kind: "shown", place: 5 })).toBe("it would have been shown at #5");
  });

  it("prints each trade a model didn't show with the stage that dropped it, and says why in a list (the old caption put them all down to a lower Overall or the diversity rules)", () => {
    const s = section(2);
    expect(s).not.toContain("(a lower Overall, or §13's diversity rules");
    expect(s).toContain(`**Why the trades marked "not shown" weren't shown.**`);
    expect(s).toContain("The re-runs reproduce the searches exactly (counts, hidden counts and the shown trades in order): before yes, after yes.");
    let notShown = 0;
    for (const r of report.compare) {
      for (const [label, m, tr] of [
        ["Before", r.before, report.traces.before],
        ["After", r.after, report.traces.after],
      ] as const) {
        if (m.rank !== null) {
          expect(m.stage).toEqual({ kind: "shown", place: m.rank });
          expect(m.ifEvaluated).toBeNull();
          continue;
        }
        notShown++;
        expect(m.stage).toEqual(dropStage(tr, r.proposal));
        expect(s).toContain(`not shown (${stageTag(m.stage)}) · ${three(m.t as TradeEvaluation)}`);
        expect(s).toContain(`- ${label}: Team ${r.proposal.partnerId}: `);
        expect(s).toContain(`: ${stageWords(m.stage, snapshot, teamName(r.proposal.partnerId), settings.maxPerSide)}.`);
        expect(m.ifEvaluated !== null).toBe(PRE_EXACT.has(m.stage.kind));
        if (m.ifEvaluated) expect(s).toContain(`Had it been exactly evaluated too, ${ifWords(m.ifEvaluated)}.`);
      }
    }
    expect(notShown).toBeGreaterThan(0); // a fact of the synthetic data, deterministic
    // The bullets on trades a search never exactly evaluated, in both directions, are the report's own.
    const top = (ts: readonly TradeEvaluation[]) => new Set(ts.slice(0, TOP_DETAIL).map((t) => t.key));
    const bTop = top(v.before.result.trades);
    const aTop = top(report.result.trades);
    const left = report.compare.filter((r) => bTop.has(r.key) && !aTop.has(r.key));
    const came = report.compare.filter((r) => aTop.has(r.key) && !bTop.has(r.key));
    const ctx = { snapshot, teamName, after: report.traces.after };
    const texts = [neverEvaluatedText(left, "after", `that left the top ${TOP_DETAIL}`, ctx), neverEvaluatedText(came, "before", `new in the top ${TOP_DETAIL}`, ctx)];
    for (const text of texts) if (text) expect(s).toContain(text);
    expect(texts.some((x) => x !== null)).toBe(true); // a fact of the synthetic data: the after search never screened a trade of the before top 10
  });

  it("the bullet on trades a search never exactly evaluated: where each was, the Analyzer's numbers, where it would have ranked, whether N11's pruning made the room", () => {
    const [t1, t2, t3] = report.result.trades as [TradeEvaluation, TradeEvaluation, TradeEvaluation];
    const side = (rank: number | null, stage: DropStage, cf: DropStage | null): ModelSide => ({ rank, t: null, stage, ifEvaluated: cf });
    const shown1 = side(1, { kind: "shown", place: 1 }, null);
    const rows: CompareRow[] = [
      { key: t1.key, proposal: t1.proposal, before: side(null, { kind: "partnerCut", place: { rank: 48, of: 347 }, unpruned: null }, { kind: "shown", place: 5 }), after: shown1 },
      { key: t2.key, proposal: t2.proposal, before: side(null, { kind: "partnerCut", place: { rank: 43, of: 273 }, unpruned: null }, { kind: "shown", place: 4 }), after: shown1 },
      { key: t3.key, proposal: t3.proposal, before: side(3, { kind: "shown", place: 3 }, null), after: shown1 },
    ];
    // The after search keeps t1 within its partner's best 30 only with the pruning; t2 even without it.
    const after = {
      partnerPlace: new Map([
        [t1.key, { rank: 27, of: 247 }],
        [t2.key, { rank: 12, of: 206 }],
      ]),
      partnerPlaceUnpruned: new Map([
        [t1.key, { rank: 41, of: 386 }],
        [t2.key, { rank: 20, of: 322 }],
      ]),
    };
    const name = (id: string) => `Team ${id}`;
    const text = neverEvaluatedText(rows, "before", "new in the top 10", { snapshot, teamName: name, after }) as string;
    expect(text.startsWith("- **2 of the 3 new in the top 10 were never exactly evaluated by the before search**: Team ")).toBe(true);
    expect(text).toContain(`(#48 of 347 in Team ${t1.proposal.partnerId}'s screening list)`);
    expect(text).toContain(`(#43 of 273 in Team ${t2.proposal.partnerId}'s screening list)`);
    expect(text).toContain("Their before numbers above come from the Trade Analyzer, not from the before search's ranking.");
    expect(text).toContain("For 1 of them, N11's pruning made the room in the after search: there it is within its partner's best 30 only once the pruning drops dominated variants (#27 of 247 with it, #41 of 386 without).");
    expect(text).toContain("Had the before search exactly evaluated them too, they would have been shown at #5 and #4 respectively.");
    // Within the best 30 even without the pruning: N11 isn't what let it in. Nothing measured: nothing said about N11.
    const pair = [rows[1] as CompareRow, rows[2] as CompareRow];
    const anyway = neverEvaluatedText(pair, "before", "new in the top 10", { snapshot, teamName: name, after }) as string;
    expect(anyway).toContain("- **1 of the 2 new in the top 10 was never exactly evaluated by the before search**");
    expect(anyway).toContain("N11's pruning isn't what let it in: the after search's own screening ranks it within a partner's best 30 even without it.");
    expect(anyway).toContain("Had the before search exactly evaluated it too, it would have been shown at #4.");
    expect(neverEvaluatedText(pair, "before", "new in the top 10", { snapshot, teamName: name, after: { partnerPlace: new Map(), partnerPlaceUnpruned: new Map() } })).not.toContain("N11");
    // The after search's misses say nothing about N11; a row shown in that model never counts.
    const flipped = rows.map((r) => ({ ...r, before: r.after, after: r.before }));
    const afterMiss = neverEvaluatedText(flipped, "after", "that left the top 10", { snapshot, teamName: name, after }) as string;
    expect(afterMiss).toContain("- **2 of the 3 that left the top 10 were never exactly evaluated by the after search**");
    expect(afterMiss).not.toContain("N11");
    expect(neverEvaluatedText([rows[2] as CompareRow], "before", "new in the top 10", { snapshot, teamName: name, after })).toBeNull();
  });
});

describe("trade report: g_mkt(you) and the κ question", () => {
  const v = report.variants;

  it("the levels are the app's model at κ 2 / 4 / 8 on the main context (a context built at that level gives the same)", () => {
    expect([v.before.kappa, v.low.kappa, v.medium.kappa, v.high.kappa]).toEqual([config.benefit.marketSanityWeight, config.benefit.protectValue.low, config.benefit.protectValue.medium, config.benefit.protectValue.high]);
    for (const level of PROTECT_VALUE_LEVELS) expect(v[level].settings.protectValue).toBe(level);
    const high = { ...settings, protectValue: "high" as const };
    const fresh = runTradeSearch(buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: SCENARIOS, settings: high }), { settings: high });
    expect(signatureOf(v.high.result)).toBe(signatureOf(fresh));
  });

  it("g_mkt(you) statistics per search: buckets, Market checks, below −25%, the top 10", () => {
    for (const run of [v.before, v.low, v.medium, v.high]) {
      const st = gMineStats(run.result);
      const trades = run.result.trades;
      expect(st.trades).toBe(trades.length);
      expect(st.buckets.reduce((a, b) => a + b, 0)).toBe(trades.length);
      expect(st.marketCheck).toBe(trades.filter((t) => t.flags.marketCheck).length);
      expect(st.deep).toBe(trades.filter((t) => t.gMine < DEEP_OVERPAY_BELOW).length);
      expect(st.top.trades).toBe(Math.min(TOP_DETAIL, trades.length));
      expect(st.eg).toBeCloseTo(trades.reduce((s, t) => s + (t.b ?? 0) * t.pComplete, 0), 9);
    }
    const s = section(3);
    expect(s).toContain("| g_mkt(you) | Before the addendum (κ 1, no star premium) | Low (κ 2) | Medium (κ 4, the default) | High (κ 8) |");
    expect(s).toContain(`**The κ question: your top ${TOP_DETAIL} at each level.**`);
    expect(s).toContain("**Break-even κ**");
    expect(s).toContain("**N11, the dominance pruning in screening**");
  });

  it("Σ EG holds κ × g, so the κ table adds the κ-free Σ B_win × P_complete: the same trades at two κ give the same κ-free sum (review finding)", () => {
    // Redraft: B − the market term is B_win, so the κ-free sum is Σ B_win × P_complete in every model.
    for (const run of [v.before, v.low, v.medium, v.high]) {
      const st = gMineStats(run.result);
      expect(st.egKappaFree).toBeCloseTo(run.result.trades.reduce((s, t) => s + (t.bWin as number) * t.pComplete, 0), 9);
    }
    // The very same two trades at κ 2 and κ 8 (B = B_win + κ × g): Σ EG moves, the κ-free sum doesn't.
    const at = (kappa: number) => ({
      ...report.result,
      trades: [tradeEvaluation({ b: 5 + kappa * -0.2, bWin: 5, gMine: -0.2, pComplete: 0.5 }), tradeEvaluation({ b: 3 + kappa * 0.1, bWin: 3, gMine: 0.1, pComplete: 0.4, give: ["a"], get: ["b"] })],
    });
    const lo = gMineStats(at(2));
    const hi = gMineStats(at(8));
    expect(lo.eg).toBeCloseTo((5 - 0.4) * 0.5 + (3 + 0.2) * 0.4, 12);
    expect(hi.eg).toBeCloseTo((5 - 1.6) * 0.5 + (3 + 0.8) * 0.4, 12);
    expect(lo.egKappaFree).toBeCloseTo(5 * 0.5 + 3 * 0.4, 12);
    expect(hi.egKappaFree).toBeCloseTo(lo.egKappaFree, 12);
    // Dynasty and keeper B has no market term: its κ-free sum is Σ EG.
    const dyn = gMineStats({ ...report.result, trades: [tradeEvaluation({ b: 4, bWin: 6, lambda: 0.35, pComplete: 0.5 })] });
    expect(dyn.egKappaFree).toBeCloseTo(dyn.eg, 12);
    const s = section(3);
    expect(s).toContain("**Σ EG isn't comparable across levels**");
    expect(s).toContain("| Σ EG (within a level only) | Σ B_win × P_complete (κ-free) |");
    for (const run of [v.before, v.low, v.medium, v.high]) expect(s).toContain(`| ${fmt(gMineStats(run.result).eg, 2)} | ${fmt(gMineStats(run.result).egKappaFree, 2)} |`);
  });

  it("break-even κ: where two trades' EG = (B_win + κ × g) × P_complete cross", () => {
    // Today's #1 gives 30% more (its market g −0.3 at κ 4: B 5 − 1.2 = 3.8, P_complete 0.7); the even trade (g −0.04: B 6 −
    // 0.16, P_complete 0.33). P_accept differs (a veto halves P_complete): EG reads P_complete.
    const first = tradeEvaluation({ b: 3.8, bWin: 5, gMine: -0.3, pAccept: 0.8, pComplete: 0.7, give: ["a"], get: ["b"] });
    const even = tradeEvaluation({ b: 5.84, bWin: 6, gMine: -0.04, pAccept: 0.66, pComplete: 0.33, give: ["c"], get: ["d"] });
    const be = breakEvenKappa([first, tradeEvaluation({ b: 1, bWin: 2, gMine: -0.25, pComplete: 0.9, give: ["e"], get: ["f"] }), even], 4);
    expect(be?.even).toBe(even);
    expect(be?.evenRank).toBe(3);
    const k = (6 * 0.33 - 5 * 0.7) / (-0.3 * 0.7 - -0.04 * 0.33);
    expect(be?.kappa).toBeCloseTo(k, 9);
    // At that κ the two EG are equal.
    const eg = (bWin: number, g: number, p: number, kappa: number) => (bWin + kappa * g) * p;
    expect(eg(5, -0.3, 0.7, k)).toBeCloseTo(eg(6, -0.04, 0.33, k), 9);
    // Nothing to compare: #1 already even, no even trade, a dynasty league (no market term).
    expect(breakEvenKappa([even, first], 4)).toBeNull();
    expect(breakEvenKappa([first], 4)).toBeNull();
    expect(breakEvenKappa([tradeEvaluation({ b: 3, bWin: 3, lambda: 0.5, gMine: -0.3 }), even], 4)).toBeNull();
  });

  it("N11's pruning measured: the screening again counts the search's screens; the shortlist with the pruning is the search's", () => {
    const pr = report.pruning;
    expect(pr).not.toBeNull();
    if (!pr) return;
    expect(pr.screened).toBe(report.result.counts.screened);
    expect(pr.dropped).toBeGreaterThanOrEqual(0);
    expect(pr.dropped).toBeLessThanOrEqual(pr.inWindow);
    expect(pr.exact.with).toBeLessThanOrEqual(config.search.exactEvaluationMax);
    // The pruning drops only trades that give a player worth less than W, so it never adds one to the shortlist; in this
    // league it drops some (a fact of the synthetic data, deterministic).
    expect(pr.cheap.with).toBeLessThanOrEqual(pr.cheap.without);
    expect(pr.cheap.with).toBeLessThan(pr.cheap.without);
    expect(pr.cheap.with).toBeLessThanOrEqual(pr.exact.with);
    // Its shortlist is the search's own: every shown trade came from it.
    const shortlist = new Set(pr.shortlist);
    for (const t of report.result.trades) expect(shortlist.has(t.key)).toBe(true);
    expect(pr.belowW.every((id) => (tradeInternals(report.ctx).values[id] ?? 0) < pr.W)).toBe(true);
    expect(section(3)).toContain(`Screens: ${pr.screened.toLocaleString("en-US")} (the search's own count: ${report.result.counts.screened.toLocaleString("en-US")})`);
  });
});

describe("trade report: the Smith-Njigba example", () => {
  const st = report.star;
  const I = tradeInternals(report.ctx);

  it("finds the star on his team with his premium, and tries every package of three of my RBs in both models", () => {
    expect(st.playerId).toBe(starId);
    expect(st.teamId).toBe(starTeam);
    expect(st.premium).toEqual(I.premiums.get(starTeam)?.[starId]);
    expect(st.premium?.rank).toBe(1);
    const mine = (I.me?.roster ?? []).filter((id) => I.league.table.rows.has(id) && I.league.posOf(id) === STAR_PACKAGE.pos);
    expect(st.mine).toEqual(mine);
    expect(st.packages).toHaveLength(binomial(mine.length, STAR_PACKAGE.size));
    for (const p of st.packages) {
      expect(p.get).toEqual([starId]);
      expect(p.give).toHaveLength(STAR_PACKAGE.size);
      if (!p.before || !p.after) continue;
      // Before: no premium facts; after: one fact, his own premium.
      expect(p.before.detail.premium).toBeUndefined();
      expect(p.after.detail.premium).toEqual([{ playerId: starId, e: st.premium?.e, rank: st.premium?.rank, elite: st.premium?.elite, harderToGet: st.premium?.harderToGet }]);
      expect(p.after.bWin).toBe(p.before.bWin);
    }
  });

  it("the pick is the package the old model rated most likely (P_accept, then z)", () => {
    const legal = st.packages.filter((p) => p.before && p.after);
    expect(legal.length).toBeGreaterThan(0);
    const best = [...legal].sort((a, b) => (b.before as TradeEvaluation).pAccept - (a.before as TradeEvaluation).pAccept || (b.before as TradeEvaluation).features.z - (a.before as TradeEvaluation).features.z)[0];
    expect(st.pick).toBe(best);
    const s = section(4);
    expect(s).toContain(`**${STAR_NAME} (`);
    expect(s).toContain("(the old model's most likely)");
    expect(s).toContain("**The package the old model rated most likely**");
    expect(s).toContain("| **z** |");
  });

  it("the lead's named star trades: names not on these rosters are reported, not guessed", () => {
    expect(st.named).toHaveLength(STAR_TRADES.length);
    // Brock Bowers and the others aren't in a synthetic league.
    for (const r of st.named) {
      expect(r.missing.length).toBeGreaterThan(0);
      expect(r.before).toBeNull();
    }
    expect(section(4)).toContain("not on these rosters now: Brock Bowers");
    // Every star trade the before model showed is listed with its places.
    for (const ss of st.shownStars) {
      expect(ss.tagged.length).toBeGreaterThan(0);
      expect(report.variants.before.result.trades[ss.beforeRank - 1]?.key).toBe(ss.row.before?.key);
    }
  });
});

describe("trade report: the steps diagnosis", () => {
  const d = report.steps;
  const I = tradeInternals(report.ctx);
  const cfg = config.search.steps;

  it("every shown trade gets a row; the case follows the throw-ins and the per-side maximum", () => {
    expect(d.rows).toHaveLength(report.result.trades.length);
    expect(d.withSteps).toBe(report.result.trades.filter((t) => t.steps).length);
    const thr = throwIns(I, settings);
    expect(d.throwIns.map((t) => t.id)).toEqual(thr);
    expect(d.W).toBe(I.credit);
    for (const r of d.rows) {
      const give = ids(r.trade.proposal.give);
      const inTrade = thr.filter((id) => give.includes(id));
      if (inTrade.length && give.length >= 2) {
        expect(r.stepCase).toBe("holdBack");
        expect(r.rule?.throwIn).toBe(inTrade[0]);
      } else if (!thr.some((id) => !give.includes(id))) expect(r.stepCase).toBe("noThrowIn");
      else if (give.length + 1 > settings.maxPerSide) expect(r.stepCase).toBe("noRoom");
      else expect(["add", "noHelp"]).toContain(r.stepCase);
      for (const c of r.candidates) {
        expect(c.gain).toBeCloseTo(c.full.pComplete - c.offer.pComplete, 12);
        expect(c.dz.value + c.dz.extra + c.dz.lineup + c.dz.rest).toBeCloseTo(c.dz.total, 9);
        // One more player on my side: the complexity term (−β_cx).
        expect(c.dz.extra).toBeCloseTo(-config.acceptance.beta.complexity, 12);
      }
    }
  });

  it("case 2's B filter and choice: B > 0 and at least minBShare of the offer's; the rule is the best of those by P_complete, then B, then id", () => {
    let filtered = 0;
    for (const r of d.rows) {
      if (r.stepCase !== "add") {
        for (const c of r.candidates) expect(c.bOk).toBe(true);
        continue;
      }
      for (const c of r.candidates) {
        const b = c.full.b;
        const ok = b !== null && b > 0 && b >= cfg.minBShare * (c.offer.b as number) - 1e-9;
        expect(c.bOk).toBe(ok);
        if (!ok) filtered++;
      }
      const best = [...r.candidates].filter((c) => c.bOk).sort((a, b) => b.full.pComplete - a.full.pComplete || (b.full.b as number) - (a.full.b as number) || (a.throwIn < b.throwIn ? -1 : 1))[0] ?? null;
      expect(r.rule).toBe(best);
    }
    // The filter matters in this league (a fact of the synthetic data, deterministic).
    expect(filtered).toBeGreaterThan(0);
  });

  it("agrees with the engine's own steps: a shown step is one the rule qualifies, and a qualifying rule step the pre-screen keeps is shown", () => {
    for (const r of d.rows) {
      if (r.shown) expect(r.rule?.fails).toEqual([]);
      if (r.rule && !r.rule.fails.length && r.preScreenKeeps !== false) expect(r.shown).toBe(true);
      if (r.rule && !r.rule.fails.length) {
        expect(r.rule.gain).toBeGreaterThanOrEqual(cfg.minAcceptGain - 1e-9);
        expect(r.rule.offer.pComplete).toBeGreaterThanOrEqual(cfg.minOfferFirst - 1e-9);
      }
    }
  });

  it("a candidate's numbers are the versions' as tradeVersion evaluates them (exact evaluation + the screening simulation)", () => {
    const any = d.rows.flatMap((r) => r.candidates.map((c) => ({ r, c })))[0];
    if (!any) return;
    const give = ids(any.r.trade.proposal.give);
    const get = ids(any.r.trade.proposal.get);
    const full = any.r.stepCase === "holdBack" ? give : [...give, any.c.throwIn];
    const v = tradeVersion(I, { partnerId: any.r.trade.proposal.partnerId, give: full.map((id) => ({ kind: "player", id })), get: get.map((id) => ({ kind: "player", id })) }, { settings, maxPerSide: settings.maxPerSide, versions: new Map<string, TradeVersion>() });
    expect(v?.screen.pComplete).toBe(any.c.full.pComplete);
    expect(v?.screen.b).toBe(any.c.full.b);
  });

  it("prints the count, the throw-ins against W, every row and the reasons", () => {
    const s = section(5);
    expect(s).toContain(`**Cards with an "If they say no" step: ${d.withSteps} of ${report.result.trades.length}.**`);
    expect(s).toContain("| Throw-in | Trade value | Value − W | Lineup cost (exact mode) | In shown trades |");
    const rows = s.split("\n").filter((l) => /^\| \d+ \| Team \d+: /.test(l));
    expect(rows).toHaveLength(report.result.trades.length);
    if (d.candidates) expect(s).toContain(`over all ${d.candidates} candidate versions`);
  });
});

describe("trade report: \"Harder to get\" and the League page's partner rows", () => {
  const tg = report.tags;
  const I = tradeInternals(report.ctx);

  it("lists every team's premium players as the trade context has them, and the top 12", () => {
    expect(tg.teams.map((t) => t.teamId)).toEqual(snapshot.teams.map((t) => t.id));
    for (const t of tg.teams) {
      const premiums = I.premiums.get(t.teamId) ?? {};
      expect(t.players.map((p) => p.id).sort()).toEqual(
        Object.entries(premiums)
          .filter(([, p]) => p.e > 0)
          .map(([id]) => id)
          .sort(),
      );
      for (const p of t.players) expect(premiums[p.id]).toEqual({ e: p.e, rank: p.rank, elite: p.elite, harderToGet: p.harderToGet });
    }
    expect(tg.elite.length).toBeLessThanOrEqual(config.acceptance.starPremium.eliteTop);
    const s = section(6);
    for (const t of tg.teams) for (const p of t.players.filter((x) => x.harderToGet)) expect(s).toContain(`**${snapshot.players[p.id]?.name}** #${p.rank}`);
  });

  it("the partner rows are the League page's own (buildLeagueView on the League model the page builds)", () => {
    const model = buildLeagueModel(snapshot, inputs, { now: TEST_NOW, settings, scenarios: SCENARIOS });
    const view = buildLeagueView({ snapshot, model, inputs, myTeamSource: "you", timeZone: "UTC", now: TEST_NOW.toISOString() });
    expect(tg.cards).toEqual(view.partners.cards);
    const s = section(6);
    for (const c of tg.cards) {
      expect(s).toContain(`- **${c.name}** (${c.fitText}): `);
      for (const t of c.targets) expect(s).toContain(`${t.label}: ${t.text}`);
    }
  });
});

describe("trade report: the whole offline report on a synthetic league", () => {
  it("runs the real search and shows its trades", () => {
    const trades = report.result.trades;
    expect(trades.length).toBeGreaterThan(0);
    expect(trades.length).toBeLessThanOrEqual(config.search.resultsShown);
    expect(report.result.myTeamId).toBe("1");
  });

  it("renders every section in order, the header with the settings and the data", () => {
    const headings = [...doc.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]));
    expect(headings).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(doc).toContain("# Trade search: Parker's ESPN league");
    expect(doc).toContain("- Synthetic test league.");
    expect(doc).toContain("**Settings used** (the app's defaults, defaultTradeSettings): max 2 players a side; streamed positions K, DEF; playoff weeks count 1.25×");
    expect(doc).toContain("Protect my trade value Medium (κ 4)");
    expect(doc).toContain("**Your baseline** (every team after its free-agent pickups, 5,000 seasons): P(playoffs) ");
    expect(doc).toContain("Note: Kickers and D/STs are left out; turn them on in Settings.");
  });

  it("the top trades: a summary row each and a full card with the three numbers, the readings, the star premium, the steps, reasons and pitch", () => {
    const s = section(1);
    const top = report.result.trades.slice(0, TOP_DETAIL);
    const rows = s.split("\n").filter((l) => /^\| \d+ \| Team \d+ \|/.test(l));
    expect(rows).toHaveLength(top.length);
    top.forEach((t, i) => {
      const row = rows[i] as string;
      expect(row.startsWith(`| ${i + 1} | Team ${t.proposal.partnerId} |`)).toBe(true);
      expect(row).toContain(`| ${t.tradeScore} |`);
      expect(row).toContain(`| ${t.overall} |`);
      expect(row).toContain(`| ${fmt(t.b, 2)} |`);
      expect(row).toContain(`${pctSigned(t.gMine)} / ${pctSigned(t.gPartner)}`);
      for (const p of t.detail.premium ?? []) if (p.harderToGet) expect(row).toContain(`[Harder to get]`);
      expect(s).toContain(`### ${i + 1}. With Team ${t.proposal.partnerId}`);
    });
    expect((s.match(/^- \*\*Helps you /gm) ?? []).length).toBe(top.length);
    expect((s.match(/^Reasons:$/gm) ?? []).length).toBe(top.length);
    expect((s.match(/^> Hey!/gm) ?? []).length).toBe(top.length);
    expect((s.match(/^- Star premium on what Team \d+ gives/gm) ?? []).length).toBe(top.length);
    expect((s.match(/^- How to offer it: /gm) ?? []).length).toBe(top.length);
    expect(s).toContain("- Trade value (FantasyCalc, the waiver credit included): you give ");
    expect(s).toContain("- Required moves: you ");
    expect(s).toContain("- Risk flags: ");
    expect(s).toContain(`the market term κ × clamp(g, ±0.5): κ = ${config.benefit.protectValue.medium}`);
  });

  it("the consistency check: every shown trade re-evaluated by analyzeTrade in a fresh context matches the search bit for bit, with V* moves before and after", () => {
    const c = report.consistency;
    expect(c.rows).toHaveLength(report.result.trades.length);
    for (const r of c.rows) {
      expect(r.differ).toEqual([]);
      expect(r.illegal).toBeNull();
      expect(Object.is(r.bSearch, r.bAnalyzer)).toBe(true);
      expect(r.myAfter).not.toBeNull();
      expect(r.theirAfter).not.toBeNull();
    }
    const s = section(7);
    expect(s).toContain("Checkpoint 4: a trade whose whole effect a free-agent pickup reproduces gets no B from it (ΔPO = ΔCH = 0 exactly)");
    expect(s).toContain("`src/engine/evaluate.consistency.test.ts`, \"Checkpoint 4 consistency in scenario lineups\"");
    expect(s).toContain("a player V* drops anyway, worth less than W, given for nothing: B = 0 at Low, Medium and High");
    expect(s).toContain(`**${c.rows.length} of ${c.rows.length} match exactly.**`);
    expect(s).toContain("| Team | Before the trade (baseline) | After the trade |");
    expect(s).toContain("| Team 1 (you) |");
  });

  it("the measured bound: each throw-in and player worth less than W given alone for nothing; N10 leaves no market term for those worth less than W", () => {
    const I = tradeInternals(report.ctx);
    const thr = new Set(throwIns(I, settings));
    const g = report.giveAway;
    expect(g.length).toBeGreaterThan(0);
    // Every throw-in and every tradable player of mine worth less than W, each once.
    const excluded = new Set<Pos>(config.market.tradeSearchExcluded);
    const expected = (I.me?.roster ?? []).filter((id) => I.league.table.rows.has(id) && !excluded.has(I.league.posOf(id) as Pos) && (thr.has(id) || (I.values[id] ?? 0) < I.credit));
    expect(g.map((r) => r.playerId).sort()).toEqual([...expected].sort());
    for (const r of g) {
      expect(thr.has(r.playerId) || r.value < I.credit).toBe(true);
      expect(r.inShown).toBe(report.result.trades.filter((t) => ids(t.proposal.give).includes(r.playerId)).length);
      if (r.illegal) continue;
      // The partner's row is left at its baseline: B_win is my side's alone; worth less than W, the market term is 0 at every level.
      if (r.value < I.credit) for (const level of PROTECT_VALUE_LEVELS) expect(r.b[level]).toBe(r.bWin);
      expect(r.ins).not.toContain(r.playerId);
      expect(r.outs).not.toContain(r.playerId);
      // A player my optimized roster drops anyway: the roster after is V*(me)'s, so nothing moves (my side alone).
      if (r.ros === 0 && !r.ins.length && !r.outs.length) expect(r.bWin).toBe(0);
    }
    expect(g.some((r) => r.ros === 0 && !r.ins.length && !r.outs.length)).toBe(true);
    const s = section(7);
    expect(s).toContain("**The measured bound.**");
    expect(s).toContain("| Player | Value (W ");
  });

  it("runtime: per stage medians (the steps included), counts, the longest gap between yields, deterministic runs, the report's own stages", () => {
    const r = report.runtime;
    expect(r.runs).toHaveLength(1);
    expect(r.warmups).toBe(1);
    expect(r.sameEveryRun).toBe(true);
    for (const k of ["setup", "screening", "exact", "simScreen", "simFinal", "rank", "steps", "total"]) expect(Number.isFinite(r.search[k])).toBe(true);
    for (const k of ["league model", "baseline lineups", "simulation", "profiles", "total"]) expect(Number.isFinite(r.context[k])).toBe(true);
    expect(r.maxGap).toBeGreaterThan(0);
    expect(r.maxGap).toBeLessThanOrEqual(r.search.total as number);
    for (const k of ["searches", "variants", "traces", "compare", "star", "steps", "tags", "consistency", "giveAway", "example", "optimizer", "total"]) expect(Number.isFinite(report.timing[k])).toBe(true);
    const s = section(9);
    expect(s).toContain("not the browser's Web Worker");
    expect(s).toContain("they come from the production worker check");
    expect(s).toContain("| screening (every candidate, fast lineups; the dominance pruning) |");
    expect(s).toContain("| final simulation (5,000 seasons) |");
    expect(s).toContain("| the shown trades' \"Offer first\" steps and words |");
    expect(s).toContain(`Counts: ${report.result.counts.screened.toLocaleString("en-US")} candidates screened`);
    expect(s).toContain("Longest stretch of work between two progress yields: ");
    expect(s).toContain("The Trade Analyzer: analyzeTrade took ");
    expect(s).toContain("This report's own run (buildTradeReport, wall clock):");
    expect(s).toContain("| the whole report, before writing it |");
  });

  it("the Analyzer example: a trade that helps, under the acceptance bar, inside the search's value window, with its terms in words", () => {
    const e = report.example;
    expect(e.candidates).toBeGreaterThan(0);
    expect(e.positive).toBeLessThanOrEqual(e.lowAccept);
    expect(e.inWindow).toBeLessThanOrEqual(e.positive);
    const s = section(10);
    const t = e.pick;
    if (!t) {
      expect(s).toContain("No trade inside the window qualifies");
      return;
    }
    expect(t.pAccept).toBeLessThan(0.2);
    expect(t.b).toBeGreaterThan(0);
    const [lo, hi] = config.search.screeningGWindow;
    expect(t.gPartner).toBeGreaterThanOrEqual(lo);
    expect(t.gPartner).toBeLessThanOrEqual(hi);
    const terms = termRows(t, snapshot);
    expect(terms.map((r) => r.term)).toEqual(["base", "value", "need", "hole", "complexity", "activity", "history", "context", "hot", "urgency"]);
    expect(terms.reduce((sum, r) => sum + r.logit, 0)).toBeCloseTo(t.features.z, 9);
    expect(s).toContain(`### The example: with Team ${t.proposal.partnerId}`);
    expect(s).toContain("| Term | Logit units | In words |");
    expect(s).toContain(`| **z** | **${signed(t.features.z, 2)}** |`);
    expect(s).toContain("what pulled the estimate down, most first:");
  });

  it("the free-agent optimizer: the move count distribution and the named examples (public names)", () => {
    const o = report.optimizer;
    expect(o.distribution.reduce((s, x) => s + x, 0)).toBe(snapshot.teams.length);
    const s = section(11);
    expect(s).toContain("**How many moves teams make:** 0 moves: ");
    expect(s).toMatch(/- \*\*Bo Nix \(QB, [^)]+\)\*\*: on Team 3, lineup cost \(MV_lose\) /);
    expect(s).toMatch(/- \*\*Christian McCaffrey \(RB, [^)]+\)\*\*: on Team 4, lineup cost \(MV_lose\) /);
    expect(s).toMatch(/(a trade chip: gap|not a trade chip: gap)/);
  });

  it("the optimizer examples next to Checkpoint 3's numbers, with what this run's pickups say about the change (review finding)", () => {
    const s = section(11);
    const tn = (id: string) => `Team ${id}${id === report.result.myTeamId ? " (you)" : ""}`;
    const nix = CHECKPOINT3_OPTIMIZER.nix;
    const ex = report.optimizer.examples.find((e) => e.name === nix.name);
    const focus = ex?.adds.find((a) => a.teamId === nix.teamId);
    expect(focus).toBeDefined();
    const now = focus ? (focus.scen ?? focus.ev) : Number.NaN;
    // +83 / +45 were a synthetic-input fixture's, not this league's: the sentence says so and quotes Checkpoint 3's real-data numbers.
    // Checkpoint 3's real-data team (Team 10) is named only when the league has it: this synthetic league has 6 teams.
    const where = snapshot.teams.some((t) => t.id === nix.realMaxTeamId) ? ` (${tn(nix.realMaxTeamId)})` : "";
    expect(where).toBe("");
    expect(s).toContain(`At Checkpoint 3 the +${nix.repicked} (${tn(nix.teamId)}'s one move re-picked) and +${nix.pinned} (pinned) came from a test fixture with synthetic inputs, not this league; on this league's data he added at most +${fmt(nix.realMax)} anywhere${where} against his lineup cost of ${fmt(nix.realCost)}, a gap of ${fmt(nix.realGap)}. Now ${signed(now)} to ${tn(nix.teamId)}`);
    // The reason: the focus team's own pickups at his position, which V* makes before he arrives.
    const qbs = (report.optimizer.moves.find((m) => m.teamId === nix.teamId)?.moves ?? []).filter((m) => snapshot.players[m.add]?.pos === "QB");
    if (qbs.length) expect(s).toContain(`, because ${tn(nix.teamId)}'s own pickups include ${snapshot.players[(qbs[0] as (typeof qbs)[number]).add]?.name}`);
    else expect(s).toContain(`; ${tn(nix.teamId)} makes no QB pickup of its own`);
    const mc = CHECKPOINT3_OPTIMIZER.mccaffrey;
    expect(s).toContain(`At Checkpoint 3 (the one-move baseline) his chip gap was ${fmt(mc.gap)} (maxOther ${fmt(mc.maxOther)} to ${tn(mc.teamId)} − cost ${fmt(mc.cost)}); now `);
    const mex = report.optimizer.examples.find((e) => e.name === mc.name);
    if (mex?.chip) expect(s).toContain(`now ${fmt(mex.chip.gap)} (maxOther ${fmt(mex.chip.maxOther)} to ${tn(mex.chip.bestTeamId)} − cost ${fmt(mex.chip.cost)})`);
    // What V* judges its moves by: scenario lineups here (4 scenarios, no starter limits), and every move it made clears faMinGain there.
    expect(s).toContain("Moves are judged by their gain in scenario lineups (S = 4)");
    expect(s).toContain("the scenario gain decides");
    const moves = report.optimizer.moves.flatMap((m) => m.moves);
    for (const m of moves) expect(m.gainScen as number).toBeGreaterThanOrEqual(config.freeAgentOptimizer.faMinGain - 1e-9);
    expect(moves.some((m) => m.gainEv < config.freeAgentOptimizer.faMinGain)).toBe(true); // a fact of the synthetic data: an EV-judged rule would be wrong
  });

  it("prints placeholders only: no team, owner or league name or league id from the league", () => {
    for (const t of raw.teams) {
      expect(doc).not.toContain(t.name);
      expect(doc).not.toContain(t.ownerName);
    }
    expect(doc).not.toContain(PRIVATE.league);
    expect(doc).not.toContain(PRIVATE.leagueId);
    expect(doc).not.toContain("Owner ");
    const teamIds = new Set(snapshot.teams.map((t) => t.id));
    for (const m of doc.matchAll(/Team (\d+)/g)) expect(teamIds.has(m[1] as string)).toBe(true);
    expect(doc).toContain("Team 1 (you)");
    expect(doc).not.toMatch(/Team [2-6] \(you/);
  });
});

describe("trade report: the offline dump loader", () => {
  it("reads snapshot, inputs and meta, puts placeholders on the names again, and honors --team", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "trade-report-"));
    try {
      writeFileSync(path.join(dir, "snapshot.json"), JSON.stringify(raw));
      writeFileSync(path.join(dir, "inputs.json"), JSON.stringify(inputs));
      writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ now: TEST_NOW.toISOString() }));
      const o = loadOffline(dir, undefined);
      expect(o.now.toISOString()).toBe(TEST_NOW.toISOString());
      expect(o.snapshot.name).toBe("League 1");
      expect(o.snapshot.teams.map((t) => t.name)).toEqual(raw.teams.map((t) => `Team ${t.id}`));
      expect(o.snapshot.teams.every((t) => t.ownerName === `Owner ${t.id}`)).toBe(true);
      expect(o.snapshot.myTeamId).toBe(raw.myTeamId);
      expect(loadOffline(dir, "3").snapshot.myTeamId).toBe("3");
      writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ now: "not a date" }));
      expect(() => loadOffline(dir, undefined)).toThrow(/valid `now`/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
