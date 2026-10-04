/**
 * The trade report's offline logic (scripts/trade-report.ts buildTradeReport and the pieces behind it) on a small
 * synthetic league (src/engine/trade.testing.ts smallLeague: 6 teams, made-up players): no network, no .env.local.
 * The league is given real-looking team, owner and league names first, so the tests can show none reaches the report, and
 * Phase 4b's facts: two IR players (one whose team has room at his return, one whose full roster must drop someone),
 * waiver ranks (so the allocation follows the waiver order, mine last), a questionable player of mine, and the public NFL
 * names the report follows (Garrett Wilson, Zay Flowers, and three free agents for section 5).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import { proposalKey, tradeInternals } from "@/engine/evaluate";
import { irEligibleStatuses } from "@/engine/irSlots";
import type { LeagueSnapshot, Pos } from "@/engine/model";
import { seasonOdds } from "@/engine/season";
import { defaultTradeSettings } from "@/engine/settings";
import { TEST_NOW } from "@/engine/testLeague";
import { smallLeague } from "@/engine/trade.testing";
import type { TradeEvaluation } from "@/engine/tradeModel";
import { planBFixture, tradeEvaluation } from "@/engine/tradeTestFixtures";
import { buildTradeCard, injuryTagText, knownTagsOf, seasonEndOf } from "@/lib/tradeView";
import { parseLeagueReport, placeholders, resetWaiverOrder, statusShort, type LeagueReportTables } from "./league-report";
import {
  ALLOCATION_NAMED,
  ANCHORS,
  ANCHOR_TOLERANCE,
  BLEND_NAMED,
  CHECKPOINT4_REPORTED,
  CP4_SWITCHES,
  DATA_ROS_SHOWN,
  MOST_GIVEN_SHOWN,
  NOW_SWITCHES,
  PREMIUM_ANCHORS,
  PREMIUM_ANCHOR_TOLERANCE,
  SETTINGS,
  TOP_DETAIL,
  WILSON,
  YIELD_GAP_DOCUMENTED_MS,
  anchorRows,
  buildTradeReport,
  cardsReport,
  changeText,
  coveredRiskyWeeks,
  cp4Reproduction,
  dataChanges,
  fmt,
  gapStageText,
  gapTracker,
  listFacts,
  listedOf,
  listedOfCompare,
  loadOffline,
  median,
  mostGivenText,
  parseArgs,
  parseCompare,
  pctSigned,
  pickupReach,
  pitchValueGain,
  premiumAnchorRows,
  pts,
  quantile,
  readCompare,
  recordsSame,
  reportCommand,
  reportedInjuredTop,
  reportedTagsCheck,
  reproductionText,
  shownReturnWeek,
  signed,
  switchOptions,
  valueReading,
  wilsonWhy,
  withConfigPatch,
  withSwitches,
  type CompareRun,
  type ListedTrade,
} from "./trade-report";

/** Names the report must never print (stand-ins for leaguemates' team and owner names and the league's id). */
const PRIVATE = { league: "Secret League Name", leagueId: "987654321", team: (id: string) => `Zebra Squad ${id}`, owner: (id: string) => `Owner Realname ${id}` };

type PlayerInfo = LeagueSnapshot["players"][string];

/** The synthetic league with Phase 4b's facts (the file header); `ids` names the players the tests follow. */
function league(): { raw: LeagueSnapshot; snapshot: LeagueSnapshot; inputs: ReturnType<typeof smallLeague>["inputs"]; ids: Record<string, string> } {
  const { snapshot, inputs } = smallLeague(11);
  let s: LeagueSnapshot = { ...snapshot, name: PRIVATE.league, leagueId: PRIVATE.leagueId, teams: snapshot.teams.map((t) => ({ ...t, name: PRIVATE.team(t.id), ownerName: PRIVATE.owner(t.id) })) };
  const values = inputs.market?.values ?? {};
  const best = (teamId: string, pos: Pos) => {
    const t = s.teams.find((x) => x.id === teamId);
    const id = [...(t?.roster ?? [])].filter((p) => s.players[p]?.pos === pos).sort((a, b) => (values[b] ?? 0) - (values[a] ?? 0) || (a < b ? -1 : 1))[0];
    if (!id) throw new Error(`no ${pos} on team ${teamId}`);
    return id;
  };
  const edit = (id: string, over: Partial<PlayerInfo>) => {
    s = { ...s, players: { ...s.players, [id]: { ...(s.players[id] as PlayerInfo), ...over } } };
  };
  const fa = (pos: Pos) => {
    const id = s.freeAgents.find((p) => s.players[p]?.pos === pos);
    if (!id) throw new Error(`no free agent at ${pos}`);
    return id;
  };
  const ids: Record<string, string> = { wilson: best("1", "WR"), flowers: best("2", "WR"), andrews: fa("TE"), washington: fa("WR"), love: fa("QB") };
  edit(ids.wilson as string, { name: "Garrett Wilson", injury: "QUESTIONABLE" });
  edit(ids.flowers as string, { name: "Zay Flowers" });
  edit(ids.andrews as string, { name: "Mark Andrews" });
  edit(ids.washington as string, { name: "Malik Washington" });
  edit(ids.love as string, { name: "Jordan Love" });
  // IR: team 2 moves its best RB to IR (room at his return); team 3, full, gets a free-agent RB on IR (it must drop someone then).
  ids.irRoom = best("2", "RB");
  ids.irFull = fa("RB");
  edit(ids.irRoom, { injury: "IR", injuryReturnWeek: 8 });
  edit(ids.irFull, { injury: "IR", injuryReturnWeek: 8 });
  s = {
    ...s,
    freeAgents: s.freeAgents.filter((id) => id !== ids.irFull),
    teams: s.teams.map((t) => (t.id === "2" ? { ...t, roster: t.roster.filter((id) => id !== ids.irRoom), ir: [ids.irRoom as string] } : t.id === "3" ? { ...t, ir: [ids.irFull as string] } : t)),
  };
  // Waiver ranks: the allocation follows the waiver order, my team ("1") last.
  const ranks: Record<string, number> = { "4": 1, "2": 2, "5": 3, "6": 4, "3": 5, "1": 6 };
  s = { ...s, teams: s.teams.map((t) => ({ ...t, waiverRank: ranks[t.id] as number })) };
  return { raw: s, snapshot: placeholders(s), inputs, ids };
}

const { raw, snapshot, inputs, ids } = league();
const settings = defaultTradeSettings();
const clock = () => performance.now();

/** A compare file (CompareRun) for this league: two trades of mine with made-up numbers, the odds, pickups and duplicates. */
function compareFixture(): CompareRun {
  const mine = snapshot.teams.find((t) => t.id === "1")?.roster ?? [];
  const theirs = snapshot.teams.find((t) => t.id === "2")?.roster ?? [];
  return parseCompare(
    {
      label: "Checkpoint 4 model",
      code: "b27e90f",
      dump: "synthetic",
      now: TEST_NOW.toISOString(),
      odds: { asRostersStand: { pPlayoffs: 0.7, pTitle: 0.2 }, withPickups: { pPlayoffs: 0.65, pTitle: 0.18 } },
      pickups: [{ teamId: "2", moves: [{ add: ids.andrews, drop: theirs[0] }] }],
      duplicates: [{ playerId: ids.andrews, teamIds: ["2", "4"] }],
      hidden: { byBenefit: 5, byMarket: 1 },
      trades: [
        { rank: 1, partnerId: "2", give: [ids.wilson], get: [ids.flowers], helps: 50, pAccept: 0.5, pComplete: 0.5, label: "Decent", overall: 30, b: 4, gMine: -0.2, gPartner: 0.25, steps: null, tagged: [{ playerId: ids.flowers, side: "get", status: "QUESTIONABLE", returnWeek: 9 }] },
        { rank: 2, partnerId: "2", give: [mine[1] as string], get: [theirs[1] as string], helps: 20, pAccept: 0.3, pComplete: 0.3, label: "Possible", overall: 9, b: 1.5, gMine: 0.1, gPartner: -0.09, steps: null, tagged: [] },
      ],
    },
    "compare-fixture",
  );
}

const compare = compareFixture();

/**
 * A committed league report as scripts/league-report.ts renders its two tables (the team table under "Projected
 * starting-lineup points per week" and the roster tables "### Team N"), for section 4's data changes: `edit` changes a team's
 * players (name → status code and ROS, or null to leave him out) and adds others; `record` and `ppw` per team id.
 */
function leagueReportMd(o: { ros: (id: string) => number; status?: (id: string) => string; drop?: readonly string[]; extra?: Record<string, { name: string; status: string; ros: number }[]>; record?: (teamId: string) => string; ppw: (teamId: string) => number }): string {
  const rec = (r: { w: number; l: number; t: number }) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ""}`;
  const L = ["## Projected starting-lineup points per week", "", "| Team | Record | PF | Proj/wk (scenario) | Proj/wk (EV) | ROS (scenario, playoff weeks × 1.25) |", "|---|---|---|---|---|---|"];
  for (const t of snapshot.teams) L.push(`| Team ${t.id}${t.id === snapshot.myTeamId ? " (you)" : ""} | ${o.record ? o.record(t.id) : rec(t.record)} | ${t.pointsFor.toFixed(1)} | ${o.ppw(t.id).toFixed(1)} | 90.0 | 1400 |`);
  L.push("", "## Needs and trade chips, every team", "", "| Team | Needs | Trade chips |", "|---|---|---|", "| Team 1 | none | 0 |", "", "## Rest-of-season and weekly projected points, every rostered player", "");
  for (const t of snapshot.teams) {
    L.push(`### Team ${t.id}${t.id === snapshot.myTeamId ? " (you)" : ""}`, "", "| Player | Pos | NFL | St | ROS | Reg | PO |", "|---|---|---|---|---|---|---|");
    for (const id of [...t.roster, ...t.ir]) {
      if (o.drop?.includes(id)) continue;
      const p = snapshot.players[id];
      L.push(`| ${p?.name}${t.ir.includes(id) ? " (IR)" : ""} | ${p?.pos} | ${p?.nflTeam ?? "FA"} | ${o.status ? o.status(id) : statusShort(p?.injury)} | ${o.ros(id).toFixed(1)} | 1.0 | 1.0 |`);
    }
    for (const x of o.extra?.[t.id] ?? []) L.push(`| ${x.name} | WR | FA | ${x.status} | ${x.ros.toFixed(1)} | 1.0 | 1.0 |`);
    L.push("");
  }
  return L.join("\n");
}

const mineIds = snapshot.teams.find((t) => t.id === "1")?.roster ?? [];
const team2First = snapshot.teams.find((t) => t.id === "2")?.roster[0] as string;
/** Checkpoint 4's report here: the same rosters and records; Garrett Wilson (questionable now) was active then; every ROS 100. */
const cp4Md = leagueReportMd({ ros: () => 100, status: (id) => (id === ids.wilson ? "" : statusShort(snapshot.players[id]?.injury)), ppw: (teamId) => 100 + Number(teamId) / 10 });
/** Checkpoint 3's: team 2 had "Old Receiver" and not its first player now; the same records. */
const cp3Md = leagueReportMd({ ros: () => 100, drop: [team2First], extra: { "2": [{ name: "Old Receiver", status: "Q", ros: 50 }] }, ppw: () => 99 });

// One report for the suite: 4 availability scenarios (the app's 32 would only slow the suite; every rule is the same), one
// timed run after one warm-up and one run again on the same context (so the determinism check compares four searches),
// and two blend weights.
const report = buildTradeReport(snapshot, inputs, {
  now: TEST_NOW,
  clock,
  mode: "offline",
  dataNote: "Synthetic test league.",
  scenarios: 4,
  runs: 1,
  warmups: 1,
  again: 1,
  blendWeights: [0, config.marketBlend.weight],
  compare: { run: compare, file: path.join(process.cwd(), "data-local", "compare-fixture.json") },
  compare3: null,
  history: { cp3: cp3Md, cp4: cp4Md },
  command: "npm run trade:report -- --offline data-local/synthetic --team 1",
});
const doc = report.doc;
/** Section n of the report ("## n. …" up to the next "## " heading; the "### …" subsections stay inside). */
const section = (n: number): string => {
  const m = new RegExp(`\\n## ${n}\\. `).exec(doc);
  if (!m) return "";
  const start = m.index + 1;
  const next = doc.indexOf("\n## ", start + 1);
  return doc.slice(start, next < 0 ? undefined : next);
};
const playerIds = (t: TradeEvaluation, side: "give" | "get"): string[] => (side === "give" ? t.proposal.give : t.proposal.get).flatMap((a) => (a.kind === "player" ? [a.id] : []));

describe("trade report: numbers in words", () => {
  it("formats numbers with a real minus sign and signs, percents and percentage points", () => {
    expect([fmt(1.234), fmt(-1.25, 2), fmt(-0.01, 1), fmt(null), fmt(Number.NaN)]).toEqual(["1.2", "−1.25", "0.0", "–", "–"]);
    expect([signed(2.5), signed(-0.4), signed(0), signed(0.04, 1)]).toEqual(["+2.5", "−0.4", "0.0", "0.0"]);
    expect([pctSigned(0.445), pctSigned(-0.308), pts(0.081), pts(-0.004), pts(null)]).toEqual(["+44.5%", "−30.8%", "+8.1 pts", "−0.4 pts", "–"]);
  });

  it("reads trade value exactly from both sides' g_mkt: my give is their get", () => {
    expect(valueReading(1000 / 1445 - 1, 0.445)).toEqual({ you: "you give up 44.5% more trade value than you get", them: "they get 44.5% more than they give" });
    expect(valueReading(0.25, -0.2).them).toBe("they give up 25.0% more than they get");
    expect(valueReading(0, 0).you).toBe("even trade value");
    expect(valueReading(Number.NaN, 0).you).toBe("trade value unknown");
  });

  it("median and quantiles: linear between order statistics", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([Number.NaN, 1])).toBe(1);
    expect(median([])).toBeNaN();
    const s = [1, 2, 3, 4, 5];
    expect([quantile(s, 0), quantile(s, 0.1), quantile(s, 0.5), quantile(s, 1)]).toEqual([1, 1.4, 3, 5]);
    expect(quantile([], 0.5)).toBeNaN();
  });

  it("a side's forced moves in words: drops, adds, IR slots and the displacements an IR return brings", () => {
    const name = (id: string) => snapshot.players[id]?.name as string;
    const [a, b] = snapshot.teams.find((t) => t.id === "1")?.roster ?? [];
    const text = changeText(snapshot, { drops: [a as string], adds: [], toIR: [ids.irRoom as string], displaced: [{ playerId: b as string, week: 8, returner: ids.irRoom as string }, { playerId: ids.irFull as string, week: 8, returner: ids.irFull as string }] });
    expect(text).toContain(`drop ${name(a as string)} (`);
    expect(text).toContain(`${name(ids.irRoom as string)} (RB, `);
    expect(text).toContain("goes to an open IR slot");
    expect(text).toContain(`from week 8 drop ${name(b as string)} (`);
    expect(text).toContain(`when ${name(ids.irRoom as string)} comes back from IR`);
    expect(text).toContain(`release ${name(ids.irFull as string)} (`);
    expect(changeText(snapshot, { drops: [], adds: [] })).toBe("none");
  });
});

describe("trade report: the command line and the compare files", () => {
  const root = path.join(tmpdir(), "repo");

  it("--offline takes an optional folder (default data-local/parker-league), --team, --compare and --compare3 (paths from the root)", () => {
    expect(parseArgs([], root)).toEqual({ offline: null, team: undefined, compare: null, compare3: null });
    expect(parseArgs(["--offline"], root).offline).toBe(path.join(root, "data-local", "parker-league"));
    expect(parseArgs(["--offline", "--team", "3"], root)).toEqual({ offline: path.join(root, "data-local", "parker-league"), team: "3", compare: null, compare3: null });
    expect(parseArgs(["--offline", "data-local/x", "--team", "3", "--compare", "data-local/c4.json", "--compare3", "data-local/c3.json"], root)).toEqual({
      offline: path.join(root, "data-local", "x"),
      team: "3",
      compare: path.join(root, "data-local", "c4.json"),
      compare3: path.join(root, "data-local", "c3.json"),
    });
  });

  it("checks a compare file and names every bad JSON path; a Checkpoint 3 file needs only its odds", () => {
    expect(compare.trades).toHaveLength(2);
    expect(parseCompare({ label: "Checkpoint 3 model", code: "6a83beb", dump: "d", now: "2026-10-03T21:29:20.898Z", odds: { asRostersStand: { pPlayoffs: 0.6, pTitle: 0.1 } } }, "c3").odds.withPickups).toBeUndefined();
    expect(() => parseCompare({ label: "x", code: "y", dump: "d", now: "n", odds: { asRostersStand: { pPlayoffs: "high" } } }, "bad.json")).toThrow(/bad\.json isn't a compare file: odds\.asRostersStand\.pPlayoffs: .*; odds\.asRostersStand\.pTitle/);
    const dir = mkdtempSync(path.join(tmpdir(), "trade-report-compare-"));
    try {
      const file = path.join(dir, "cp4.json");
      writeFileSync(file, JSON.stringify(compare));
      expect(readCompare(file)).toEqual(compare);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a compare file's tags say a return week only where today's cards would (explain.injuryTags' rule)", () => {
    // Week 6 now: OUT from next week, IR/PUP/SUSPENDED after this week, Probable/Questionable/Doubtful 2+ weeks out, NA never.
    expect([shownReturnWeek("OUT", 6, 6), shownReturnWeek("OUT", 7, 6)]).toEqual([undefined, 7]);
    expect([shownReturnWeek("IR", 6, 6), shownReturnWeek("IR", 7, 6), shownReturnWeek("SUSPENDED", 8, 6)]).toEqual([undefined, 7, 8]);
    expect([shownReturnWeek("QUESTIONABLE", 6, 6), shownReturnWeek("QUESTIONABLE", 7, 6), shownReturnWeek("DOUBTFUL", 8, 6)]).toEqual([undefined, undefined, 8]);
    expect([shownReturnWeek("NA", 9, 6), shownReturnWeek("OUT", undefined, 6), shownReturnWeek("OUT", 7.5, 6)]).toEqual([undefined, undefined, undefined]);
  });

  it("a compare row's key is the engine's proposalKey, so it matches this run's trades", () => {
    const row = listedOfCompare((compare.trades ?? [])[0] as NonNullable<CompareRun["trades"]>[number]);
    expect(row.key).toBe(proposalKey({ partnerId: "2", give: [{ kind: "player", id: ids.wilson as string }], get: [{ kind: "player", id: ids.flowers as string }] }));
    expect(row.tagged).toEqual([{ playerId: ids.flowers, side: "get", status: "QUESTIONABLE", returnWeek: 9 }]);
  });
});

describe("trade report: the list facts (section 2's questions)", () => {
  const t = (give: string[], get: string[], gMine: number, tagged: ListedTrade["tagged"] = []): ListedTrade => ({ key: `${give}|${get}`, partnerId: "2", give, get, helps: 30, pAccept: 0.4, pComplete: 0.4, label: "Decent", overall: 15, b: 2, gMine, gPartner: -gMine, tagged });

  it("counts the trades that receive an injury-tagged player and give the named player, and the medians of g_mkt(you)", () => {
    const list = [
      t(["w"], ["a"], -0.3, [{ playerId: "a", side: "get", status: "OUT" }]),
      t(["w", "x"], ["b"], -0.1, [{ playerId: "x", side: "give", status: "QUESTIONABLE" }]),
      t(["y"], ["c"], 0.05),
      t(["w"], ["d"], 0.2, [{ playerId: "d", side: "get", status: "IR", returnWeek: 8 }]),
    ];
    const f = listFacts(list, "w", 2, 3);
    // A list from a model without Plan B (a compare file's): no box count at all.
    expect(f).toEqual({ shown: 4, topN: 2, injuredTop: 1, wilsonTop: 2, injuredAll: 2, wilsonAll: 3, wilsonBoxes: null, medianTop: -0.2, medianWide: -0.1, medianAll: (-0.1 + 0.05) / 2 });
    expect(listFacts(list, null).wilsonAll).toBe(0);
  });

  it("counts the named player in the cards' Plan B boxes too: all boxes that give him, and those on a card that doesn't (review of track R)", () => {
    const withBox = (x: ListedTrade, planBGive: string[] | null): ListedTrade => ({ ...x, planBGive });
    const list = [
      withBox(t(["w"], ["a"], 0), ["w", "z"]), // a box on a card that gives him already
      withBox(t(["y"], ["b"], 0), ["w"]), // a box that adds him
      withBox(t(["y"], ["c"], 0), ["y", "x"]),
      withBox(t(["x"], ["d"], 0), null),
    ];
    expect(listFacts(list, "w").wilsonBoxes).toEqual({ all: 2, added: 1 });
    expect(listFacts(list, "w").wilsonAll).toBe(1);
    expect(listFacts(list, null).wilsonBoxes).toEqual({ all: 0, added: 0 });
    // This run's trades carry their boxes' players.
    const e = tradeEvaluation({ give: ["y"], get: ["b"], planB: planBFixture({ give: ["w"] }) });
    expect(listedOf(e, snapshot).planBGive).toEqual(["w"]);
    expect(listedOf(tradeEvaluation({ give: ["y"] }), snapshot).planBGive).toBeNull();
    expect(listedOfCompare((compare.trades ?? [])[0] as NonNullable<CompareRun["trades"]>[number]).planBGive).toBeUndefined();
  });

  it("Checkpoint 4 as reported: 8 of its top 10 receive an injury-tagged player, from its league report's statuses, read back to check them", () => {
    expect(reportedInjuredTop()).toBe(8);
    // Every received player of (a) with his status as Checkpoint 4's league report printed it (St codes): the check passes.
    const rosters: LeagueReportTables["rosters"] = new Map([["9", new Map()]]);
    const roster = rosters.get("9") as Map<string, { status: string; ros: number | null; slot: "active" | "ir" | "taxi" }>;
    for (const r of CHECKPOINT4_REPORTED.top) for (const name of r.get) roster.set(name, { status: statusShort(r.tagged[name] ?? "ACTIVE"), ros: 100, slot: "active" });
    const tables: LeagueReportTables = { teams: new Map(), rosters };
    expect(reportedTagsCheck(tables)).toBeNull();
    roster.set("Mike Evans", { status: "", ros: 100, slot: "active" });
    expect(reportedTagsCheck(tables)).toEqual(["Mike Evans"]);
    roster.delete("Davante Adams");
    expect(reportedTagsCheck(tables)).toEqual(["Davante Adams", "Mike Evans"]);
    expect(reportedTagsCheck(null)).toBeUndefined();
  });

  it("this run's trade as a listed trade: its tags from flags.tagged, else from the snapshot", () => {
    const e = tradeEvaluation({ partnerId: "2", give: [ids.wilson as string], get: [ids.flowers as string] });
    expect(listedOf({ ...e, flags: { ...e.flags, tagged: [] } }, snapshot).tagged).toEqual([]);
    // Without flags.tagged: Garrett Wilson (mine, questionable in this league) is tagged from the snapshot.
    expect(listedOf(e, snapshot).tagged).toEqual([{ playerId: ids.wilson, side: "give", status: "QUESTIONABLE" }]);
  });

  it("Checkpoint 4 as reported: its top 10 give Garrett Wilson 9 times (the lead's count), median g_mkt(you) about −25%", () => {
    const rows = CHECKPOINT4_REPORTED.top;
    expect(rows).toHaveLength(10);
    expect(rows.filter((r) => r.give.includes(WILSON)).length).toBe(CHECKPOINT4_REPORTED.wilsonTop);
    expect(median(rows.map((r) => r.gMine))).toBeCloseTo(-0.2515, 12);
    expect(CHECKPOINT4_REPORTED.shown).toBe(22);
    for (const r of rows) expect(Math.round(100 * (1 - Math.exp(-r.b / config.benefit.bRef)))).toBe(r.helps);
  });
});

describe("trade report: the config patches and switch settings", () => {
  it("withConfigPatch sets the blend weight, streaming's detection and the given-player cap, and restores them, also after a throw", () => {
    const before = { w: config.marketBlend.weight, d: config.streaming.detectAdds, c: config.ranking.perGivenPlayerInTop20 };
    const seen = withConfigPatch({ blendWeight: 0.25, detectAdds: Number.POSITIVE_INFINITY, givenPlayerCap: 9 }, () => ({ w: config.marketBlend.weight, d: config.streaming.detectAdds, c: config.ranking.perGivenPlayerInTop20 }));
    expect(seen).toEqual({ w: 0.25, d: Number.POSITIVE_INFINITY, c: 9 });
    expect(() =>
      withConfigPatch({ blendWeight: 0 }, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect({ w: config.marketBlend.weight, d: config.streaming.detectAdds, c: config.ranking.perGivenPlayerInTop20 }).toEqual(before);
  });

  it("a switch setting's engine options and config: Checkpoint 4's rules, and streaming off", () => {
    expect(switchOptions(CP4_SWITCHES, settings)).toEqual({ settings, faAllocation: "independent", irReturners: false });
    expect(switchOptions(NOW_SWITCHES, settings)).toEqual({ settings, faAllocation: "oneTeam", irReturners: true });
    const off = withSwitches({ ...NOW_SWITCHES, blend: false, streaming: false }, settings, (o) => ({ o, w: config.marketBlend.weight, d: config.streaming.detectAdds }));
    expect(off.o.settings.streamPositions).toEqual([]);
    expect(off.w).toBe(0);
    expect(off.d).toBe(Number.POSITIVE_INFINITY);
    expect(config.marketBlend.weight).toBe(0.5);
    expect(config.streaming.detectAdds).toBe(2);
  });
});

describe("trade report: the cards (section 6)", () => {
  it("counts steps, Plan B boxes by kind and distinct trades, injury tags by side, the variety drops and the most-given players", () => {
    const box = planBFixture({ give: ["nix", "x"], kind: "samePlayers" });
    const trades = [
      tradeEvaluation({ give: ["nix"], get: ["a"], planB: box }),
      tradeEvaluation({ give: ["nix"], get: ["b"], planB: box, flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: [], tagged: [{ playerId: "b", side: "get", status: "OUT", returnWeek: 6 }] } }),
      tradeEvaluation({ give: ["y"], get: ["c"], planB: planBFixture({ give: ["y"], get: ["d"] }), flags: { marketCheck: false, hiddenByMarket: false, hiddenByBenefit: false, injured: [], tagged: [{ playerId: "y", side: "give", status: "QUESTIONABLE" }] } }),
      tradeEvaluation({ give: ["nix", "y"], get: ["e"] }),
    ];
    const r = cardsReport({ ...report.result, trades, dropped: { partnerCap: 1, core: 2, filler: 3, givenPlayer: 4 } }, 2);
    expect(r.shown).toBe(4);
    expect(r.steps).toBe(0);
    expect(r.planB).toEqual({ boxes: 3, samePlayers: 2, otherTarget: 1, distinct: 2 });
    expect(r.tagged).toEqual({ any: 2, get: 1, give: 1 });
    expect(r.dropped).toEqual({ partnerCap: 1, core: 2, filler: 3, givenPlayer: 4 });
    expect(r.mostGiven).toEqual([
      { playerId: "nix", count: 3 },
      { playerId: "y", count: 2 },
    ]);
    // My players in the boxes: the cards that give him, the boxes that give him, and the boxes that add him to their card.
    expect(r.inBoxes).toEqual([
      { playerId: "nix", cards: 3, boxes: 2, added: 0 },
      { playerId: "y", cards: 2, boxes: 1, added: 0 },
      { playerId: "x", cards: 0, boxes: 2, added: 2 },
    ]);
  });

  it("lists everyone tied with the last most-given player shown (review of track R: a cut at 5 dropped Garrett Wilson among 7 at the cap)", () => {
    // Parker's case: seven players of mine given 3 times each in the top 20 (2-for-1 cards), one given twice. The ids sort as
    // strings, so the first five are "11563" … "8121", and "8146" (Garrett Wilson there) and "9493" come after them.
    const [a, b, c, d, e, f, g] = ["11563", "11604", "12534", "7021", "8121", "8146", "9493"] as const;
    const gives = [[a, b], [c, d], [e, f], [g, a], [b, c], [d, e], [f, g], [a, b], [c, d], [e, f], [g], ["11628"], ["11628"]];
    const trades = gives.map((give, k) => tradeEvaluation({ give, get: [`got${k}`] }));
    expect(trades.length).toBeLessThanOrEqual(config.ranking.partnerCapTop);
    const r = cardsReport({ ...report.result, trades }, MOST_GIVEN_SHOWN);
    expect(r.mostGiven).toEqual([a, b, c, d, e, f, g].map((playerId) => ({ playerId, count: 3 })));
    // The cut keeps the first five and every tie with the fifth: the first ten cards give six players 3 times and one twice.
    const fewer = cardsReport({ ...report.result, trades: trades.slice(0, 10) }, MOST_GIVEN_SHOWN);
    expect(fewer.mostGiven).toEqual([a, b, c, d, e, f].map((playerId) => ({ playerId, count: 3 })));
    // In words: grouped by count, names sorted, the cap's group named, and the check.
    const named: LeagueSnapshot = { ...snapshot, players: { ...snapshot.players, a: { ...(snapshot.players[ids.wilson as string] as LeagueSnapshot["players"][string]), name: "Bo Nix" }, b: { ...(snapshot.players[ids.wilson as string] as LeagueSnapshot["players"][string]), name: "Puka Nacua" } } };
    expect(mostGivenText(named, [{ playerId: ids.wilson as string, count: 3 }, { playerId: "a", count: 3 }, { playerId: "b", count: 2 }], 3)).toBe("3 each (the cap's most): Bo Nix, Garrett Wilson (2 players); then 2: Puka Nacua; none over 3 ✅");
    expect(mostGivenText(named, [{ playerId: "a", count: 4 }], 3)).toBe("4: Bo Nix ❌ (over the cap)");
    expect(mostGivenText(named, [], 3)).toBe("none");
  });
});

describe("trade report: the acceptance anchors (the planner's reply to Checkpoint 4, change 2's tables)", () => {
  it("computes the planner's 9 §11 scenarios with acceptance() (the last in a dynasty league), every one within ±0.5 points", () => {
    const rows = anchorRows();
    expect(rows.map((r) => r.name)).toEqual(ANCHORS.map((a) => a.name));
    expect(rows.map((r) => r.planner)).toEqual([67.9, 35.4, 37.8, 8.3, 48.5, 21.4, 25.0, 85.0, 61.1]);
    expect(rows.map((r) => r.plannerOld)).toEqual([61.1, 35.4, 31.0, 8.3, 53.0, 21.4, 25.0, 81.8, 61.1]);
    expect(ANCHOR_TOLERANCE).toBe(0.5);
    for (const r of rows) {
      expect(Math.abs(r.computed - r.planner)).toBeLessThanOrEqual(ANCHOR_TOLERANCE);
      expect(r.pass).toBe(true);
      expect(r.diff).toBeCloseTo(r.computed - r.planner, 12);
      expect(r.withoutPremium).toBe(r.computed); // §11's scenarios carry no star premium
    }
  });

  it("computes the 6 star-premium scenarios through the real functions, within ±0.5 (W = 752)", () => {
    const rows = premiumAnchorRows();
    expect(rows.map((r) => r.name)).toEqual(PREMIUM_ANCHORS.map((a) => a.name));
    expect(rows.map((r) => r.planner)).toEqual([10.9, 35.4, 32.8, 55.4, 26.3, 62.0]);
    expect(rows.map((r) => r.plannerOld)).toEqual([10.9, 35.4, 23.4, 32.8, 26.3, 62.0]);
    for (const r of rows) {
      expect(Math.abs(r.computed - r.planner)).toBeLessThanOrEqual(PREMIUM_ANCHOR_TOLERANCE);
      expect(r.pass).toBe(true);
      expect(r.withoutPremium).toBeGreaterThanOrEqual(r.computed - 1e-9); // the premium only ever lowers the estimate
    }
  });

  it("prints one table of 15 rows, each ✅ with Checkpoint 4's value where it changed, and the verdict", () => {
    const s = section(9);
    const rows = s.split("\n").filter((l) => /^\| \d+ \| /.test(l));
    expect(rows).toHaveLength(ANCHORS.length + PREMIUM_ANCHORS.length);
    expect(rows.every((r) => r.includes("| ✅ |"))).toBe(true);
    expect(s).toContain("| 67.9% (61.1%) |");
    expect(s).toContain("| 32.8% (23.4%) |");
    expect(s).toContain("| Even value; nothing else | 35.4% |");
    expect(s).toContain("15 of 15 within ±0.5 (§11: 9 of 9; the star premium: 6 of 6). **Pass.** ✅");
  });
});

describe("trade report: the whole offline report on a synthetic league", () => {
  const I = tradeInternals(report.ctx);
  const trades = report.result.trades;

  it("runs the real search and renders every section in order, the header with the data, the compare file and the settings", () => {
    expect(trades.length).toBeGreaterThan(0);
    expect(trades.length).toBeLessThanOrEqual(config.search.resultsShown);
    expect(report.result.myTeamId).toBe("1");
    expect([...doc.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(doc).toContain("# Trade search: Parker's ESPN league (Checkpoint 4b)");
    expect(doc).toContain("- Synthetic test league.");
    expect(doc).toContain("- Checkpoint 4 model's results (--compare): Checkpoint 4 model (code b27e90f) on dump synthetic at 2026-");
    expect(doc).toContain("(the same moment as this report's data).");
    expect(doc).toContain("- Checkpoint 3 model's results (--compare3): not given.");
    expect(doc).toContain("**Settings used** (the app's defaults, defaultTradeSettings): max 2 players a side; streamed positions K, DEF");
    expect(doc).toContain("one free agent per team (claimed in the league's waiver order (ESPN's waiver ranks))");
    expect(doc).toContain(`**Your baseline** (every team after its free-agent pickups, 5,000 seasons): P(playoffs) `);
  });

  it("section 1: a summary row and a full card per top trade, with tags in the card's words, the forced moves and the next step", () => {
    const s = section(1);
    const top = trades.slice(0, TOP_DETAIL);
    const rows = s.split("\n").filter((l) => /^\| \d+ \| Team \d+ \|/.test(l));
    expect(rows).toHaveLength(top.length);
    top.forEach((t, i) => {
      const row = rows[i] as string;
      expect(row.startsWith(`| ${i + 1} | Team ${t.proposal.partnerId} |`)).toBe(true);
      expect(row).toContain(`| ${t.tradeScore} |`);
      expect(row).toContain(`| ${fmt(t.b, 2)} |`);
      expect(row).toContain(`${pctSigned(t.gMine)} / ${pctSigned(t.gPartner)}`);
      // Every tag is printed next to its player, in the card's words.
      for (const g of t.flags.tagged ?? []) expect(row).toContain(`${snapshot.players[g.playerId]?.name} (`);
      if ((t.flags.tagged ?? []).some((g) => g.playerId === ids.wilson)) expect(row).toContain("Garrett Wilson (WR, ");
      expect(s).toContain(`### ${i + 1}. With Team ${t.proposal.partnerId}`);
    });
    expect((s.match(/^- \*\*Helps you /gm) ?? []).length).toBe(top.length);
    expect((s.match(/^Reasons:$/gm) ?? []).length).toBe(top.length);
    expect((s.match(/^> Hey!/gm) ?? []).length).toBe(top.length);
    expect((s.match(/^- (How to offer it: |If they say no, try \(|no offer-first step and no Plan B)/gm) ?? []).length).toBe(top.length);
    for (const t of top.filter((x) => x.planB)) expect(s).toContain(`· Helps you ${t.planB?.tradeScore} · Est. `);
    expect(s).toContain("- Required moves: you ");
    // Every tag in the card's own words (tradeView.injuryTagText), in brackets after its player; a tagged player of mine
    // (Garrett Wilson, questionable here) carries his tag wherever he is given.
    const end = seasonEndOf(snapshot.settings, inputs.nfl.lastWeek);
    top.forEach((t, i) => {
      for (const g of t.flags.tagged ?? []) expect(rows[i]).toContain(`${snapshot.players[g.playerId]?.name} (${snapshot.players[g.playerId]?.pos}, ${snapshot.players[g.playerId]?.nflTeam ?? "FA"}) [${injuryTagText(g, end, "ESPN")}]`);
    });
    for (const t of trades.filter((x) => playerIds(x, "give").includes(ids.wilson as string))) expect(t.flags.tagged?.some((g) => g.playerId === ids.wilson && g.side === "give" && g.status === "QUESTIONABLE")).toBe(true);
    // Facts of the synthetic data (deterministic), so the loops above run: some top cards carry a tag, some a Plan B.
    expect(top.some((t) => (t.flags.tagged ?? []).length > 0)).toBe(true);
    expect(top.some((t) => t.planB)).toBe(true);
  });

  it("section 1: each card's flags and injury note in the app's own words (tradeView.buildTradeCard), and the card's reasons", () => {
    const s = section(1);
    const top = trades.slice(0, TOP_DETAIL);
    expect((s.match(/^- Flags on the card: /gm) ?? []).length).toBe(top.length);
    const blocks = s.split("\n### ").slice(1);
    expect(blocks).toHaveLength(top.length);
    top.forEach((t, i) => {
      const block = blocks[i] as string;
      const card = buildTradeCard(t, { snapshot, baseline: report.result.baseline, lastNflWeek: inputs.nfl.lastWeek, knownTags: knownTagsOf(trades) });
      expect(block).toContain(`- Flags on the card: ${card.flags.length ? card.flags.map((f) => `"${f.text}"`).join(" · ") : "none"}`);
      if (card.injuryNote) expect(block).toContain(`- Injury note on the card: "${card.injuryNote}"`);
      else expect(block).not.toContain("- Injury note on the card:");
      // The card's reasons: exactly the app card's, in order (its injured-player caveat left to the flag).
      const after = block.slice(block.indexOf("\nReasons:\n") + "\nReasons:\n".length);
      const printed = after
        .slice(0, after.indexOf("\nPitch:\n"))
        .split("\n")
        .filter((l) => l.startsWith("1. "))
        .map((l) => l.slice(3));
      expect(printed).toEqual(card.reasons);
    });
    // The legend says what the pitch's trade-value figure is.
    expect(s).toContain("The pitch quotes trade value in FantasyCalc's raw numbers (explain.ts: no floor at W and no roster-spot credit)");
  });

  it("the pitch's trade-value figure: FantasyCalc's raw values, no floor and no roster-spot credit (explain.ts fantasyCalcGain)", () => {
    const v: Record<string, number> = { wil: 0 /* [value] */, ada: 2000, odu: 1873, nobody: 0 };
    const value = (id: string) => v[id] ?? null;
    // Card #2's case: Garrett Wilson ([value]) for two players worth 3,873: they get 18.3% more by raw values.
    expect(pitchValueGain(tradeEvaluation({ give: ["wil"], get: ["ada", "odu"] }), value)).toBeCloseTo(4581 / 3873 - 1, 12);
    expect(pitchValueGain(tradeEvaluation({ give: ["wil"], get: ["nobody"] }), value)).toBeNull();
    expect(pitchValueGain(tradeEvaluation({ give: ["wil"], get: ["ada"] }), undefined)).toBeNull();
  });

  it("the header prints the command line the report ran with, so it can be run again on the same data", () => {
    expect(doc).toContain("Generated by `npm run trade:report -- --offline data-local/synthetic --team 1` on ");
    const root = path.join(tmpdir(), "repo");
    const args = parseArgs(["--offline", "data-local/parker-league-dev", "--team", "3", "--compare", "data-local/cp4.json", "--compare3", "data-local/cp3.json"], root);
    expect(reportCommand(args, root)).toBe("npm run trade:report -- --offline data-local/parker-league-dev --team 3 --compare data-local/cp4.json --compare3 data-local/cp3.json");
    expect(reportCommand(parseArgs([], root), root)).toBe("npm run trade:report");
    expect(reportCommand(parseArgs(["--team", "3"], root), root, ["--team", "3", "--cookies"])).toBe("npm run trade:report -- --team 3 --cookies");
    // A file outside the project: its name only (no folders of the machine in the report).
    expect(reportCommand({ offline: null, team: undefined, compare: path.join(tmpdir(), "elsewhere", "cp4.json"), compare3: null }, root)).toBe("npm run trade:report -- --compare cp4.json");
  });

  it("section 2: Checkpoint 4 as reported, the compare file's list with where each trade is now, now's list, and the facts table", () => {
    const s = section(2);
    expect(s).toContain("**(a) Checkpoint 4 as reported** (reports/trade-report.md §1 at b27e90f; the received players' injury statuses from the St column of its league report on the same live data, b27e90f:reports/league-report.md");
    // This suite's "Checkpoint 4 league report" is the synthetic league's, which doesn't have (a)'s players: the read-back says so.
    expect(s).toMatch(/read back here: ⚠️ Zay Flowers, Jacory Croskey-Merritt, .* differ\):/);
    expect(s).toContain("| 1 | Team 9 | Brock Bowers | Zay Flowers | 65 / 55% (Likely) / 42 | 6.26 | −23.2% / +30.3% | Zay Flowers: Questionable |");
    expect(s).toContain("| 7 | Team 8 | Garrett Wilson + Bo Nix | Christian Watson + Dallas Goedert | 39 / 75% (Likely) / 31 | 2.97 | −27.4% / +37.7% | Dallas Goedert: Out |");
    // (Checkpoint 4's partner Team 1 is this synthetic league's own team "1", hence "(you)" here.)
    expect(s).toMatch(/\| 6 \| Team 1( \(you\))? \| Garrett Wilson \| Davante Adams \+ Isaiah Likely \| 42 \/ 70% \(Likely\) \/ 31 \| 3\.23 \| −25\.5% \/ \+34\.2% \| – \|/);
    expect(s).toContain("| Top 10 that receive an injury-tagged player | 8 of 10 | "); // not ✅: the read-back didn't match here
    expect(s).toContain("**(b) The Checkpoint 4 model on this data** (Checkpoint 4 model, code b27e90f):");
    // The compare file's first trade: Garrett Wilson for Zay Flowers (questionable in its file), with where it is now.
    expect(s).toContain("| 1 | Team 2 | Garrett Wilson | Zay Flowers | 50 / 50% / 30 | 4.00 | −20.0% / +25.0% | Zay Flowers: Questionable — ESPN expects him back week 9 | ");
    expect(s).toMatch(/\| 1 \| Team 2 \| Garrett Wilson \| Zay Flowers \|.*\| (shown at #\d+|not shown[^|]*|can't be made now: [^|]*) \|/);
    expect(s).toContain("**(c) Now:**");
    expect(report.facts.cp4).toEqual(listFacts(compare.trades?.map(listedOfCompare) ?? [], ids.wilson as string));
    expect(report.facts.now).toEqual(listFacts(trades.map((t) => listedOf(t, snapshot)), ids.wilson as string));
    expect(s).toContain(`| Cards shown | 22 | 2 | ${trades.length} | `);
    expect(s).toContain("| Hidden by default: B ≤ 0 / the market guard | 17 / 3 | 5 / 1 | ");
    expect(s).toContain(`| Garrett Wilson given: top 10 / all shown | 9 of 10 / 15 of 22 | 1 of 2 / 1 of 2 | ${report.facts.now.wilsonTop} of ${report.facts.now.topN} / ${report.facts.now.wilsonAll} of ${report.facts.now.shown} | `);
    expect(s).toContain("| Median g_mkt(you): top 10 / all shown | −25.15% (from the table's rounded values) / −20.1% | −5.0% / −5.0% | ");
    expect(s).toContain("(c) Now without the given-player cap");
    // The named player in the Plan B boxes too (review of track R): Checkpoint 4 had none; now's count from the cards' boxes.
    const n = report.facts.now;
    expect(n.wilsonBoxes).not.toBeNull();
    const boxes = n.wilsonBoxes as NonNullable<typeof n.wilsonBoxes>;
    const boxGive = (t: TradeEvaluation) => (t.planB?.proposal.give ?? []).flatMap((a) => (a.kind === "player" ? [a.id] : []));
    expect(boxes.all).toBe(trades.filter((t) => boxGive(t).includes(ids.wilson as string)).length);
    expect(boxes.added).toBe(trades.filter((t) => boxGive(t).includes(ids.wilson as string) && !playerIds(t, "give").includes(ids.wilson as string)).length);
    expect(s).toContain(`| Plan B boxes on the shown cards that give Garrett Wilson (of them, on a card that doesn't give him) | – (no Plan B then) | – (no Plan B then) | ${boxes.all} (${boxes.added}) | `);
    expect(s).toContain(`| Suggestions on the page that sell Garrett Wilson: cards + Plan B boxes | 15 (no Plan B then) | 1 (no Plan B then) | ${n.wilsonAll} + ${boxes.all} = ${n.wilsonAll + boxes.all} | `);
    // Why the uncapped list sells him: its numbers are wilsonWhy's over the uncapped search at the app's weight.
    const main = report.blend.find((b) => b.weight === config.marketBlend.weight);
    expect(report.wilsonWhy).toEqual(wilsonWhy(main?.uncapped.result.trades ?? [], ids.wilson as string));
    if ((report.wilsonWhy?.gives ?? 0) > 0) expect(s).toContain("**What the blend changed, and what it didn't** (without the cap, so the cap hides nothing:");
  });

  it("section 2: why the model sells Garrett Wilson, from the cards' own reasons (wilsonWhy, coveredRiskyWeeks)", () => {
    expect(coveredRiskyWeeks(["Raises your playoff odds by 3.9.", "Covers your risky week 13: +7.4 projected points that week."])).toEqual([13]);
    expect(coveredRiskyWeeks(["Covers your risky weeks 12 and 13: +3.1 and +4.0 projected points those weeks."])).toEqual([12, 13]);
    expect(coveredRiskyWeeks(["Weakens your risky week 13: −3.0 projected points that week."])).toEqual([]);
    const w = "wil";
    const list = [
      tradeEvaluation({ give: [w], get: ["a", "b"], ros: { given: 152, received: 250 }, reasons: ["Covers your risky week 13: +7.4 projected points that week."] }),
      tradeEvaluation({ give: [w], get: ["c", "d"], ros: { given: 152, received: 280 }, reasons: ["Covers your risky weeks 12 and 13: +3 and +4 projected points those weeks."] }),
      tradeEvaluation({ give: [w, "x"], get: ["e"], ros: { given: 200, received: 150 }, reasons: [] }),
      tradeEvaluation({ give: ["y"], get: ["f", "g"], reasons: ["Covers your risky week 13: +2 projected points that week."] }),
    ];
    expect(wilsonWhy(list, w)).toEqual({
      top: 4,
      gives: 3,
      riskyCovered: [
        { week: 13, trades: 2 },
        { week: 12, trades: 1 },
      ],
      aloneForTwo: { trades: 2, rosIn: [250, 280], rosOut: 152 },
    });
    expect(wilsonWhy(list, w, 1).gives).toBe(1);
    expect(wilsonWhy(list, null)).toEqual({ top: 4, gives: 0, riskyCovered: [], aloneForTwo: { trades: 0, rosIn: null, rosOut: null } });
  });

  it("section 3: the search at each blend weight, the app's own the main search, each also without the given-player cap; config restored", () => {
    const runs = report.blend;
    expect(runs.map((r) => r.weight)).toEqual([0, config.marketBlend.weight]);
    const main = runs[1] as (typeof runs)[number];
    expect(main.result).toBe(report.result);
    expect(main.ctx).toBe(report.ctx);
    expect(main.facts).toEqual(report.facts.now);
    for (const r of runs) {
      expect(r.facts).toEqual(listFacts(r.result.trades.map((t) => listedOf(t, snapshot)), ids.wilson as string));
      expect(r.uncapped.facts).toEqual(listFacts(r.uncapped.result.trades.map((t) => listedOf(t, snapshot)), ids.wilson as string));
      // The capped list never gives one player of mine more than the cap allows in the top 20; the uncapped one may.
      const window = r.result.trades.slice(0, config.ranking.partnerCapTop);
      for (const id of new Set(window.flatMap((t) => playerIds(t, "give")))) expect(window.filter((t) => playerIds(t, "give").includes(id)).length).toBeLessThanOrEqual(config.ranking.perGivenPlayerInTop20);
    }
    // The weight-0 context has no blend; the main one does.
    expect(tradeInternals((runs[0] as (typeof runs)[number]).ctx).league.lp.blend.weight).toBe(0);
    expect(I.league.lp.blend.weight).toBe(config.marketBlend.weight);
    expect(config.marketBlend.weight).toBe(0.5);
    expect(config.ranking.perGivenPlayerInTop20).toBe(3);
    const s = section(3);
    expect(s).toContain("| | w 0.00 | w 0.50 (the app's) |");
    expect(s).toContain(`| **Median g_mkt(you), top 10** | **${pctSigned(runs[0]?.facts.medianTop)}** | **${pctSigned(main.facts.medianTop)}** |`);
    expect(s).toContain("| *Without the given-player cap:* cards shown | ");
  });

  it("section 3: the blend's facts from the context's League build: per position, f's distribution, the extremes, the named players", () => {
    const bf = report.blendFacts;
    const blend = I.league.lp.blend;
    expect(bf.positions).toEqual(blend.positions);
    const scaled = [...blend.factors.values()].filter((f) => f.ours > 0);
    expect(bf.count).toBe(scaled.length);
    expect(bf.count).toBeGreaterThan(0); // RBs and WRs are blended in this league
    const q = bf.quantiles as NonNullable<typeof bf.quantiles>;
    expect(q.min).toBeLessThanOrEqual(q.p10);
    expect(q.p10).toBeLessThanOrEqual(q.median);
    expect(q.median).toBeLessThanOrEqual(q.p90);
    expect(q.p90).toBeLessThanOrEqual(q.max);
    expect(bf.largest[0]?.f).toBe(q.max);
    expect(bf.smallest[0]?.f).toBe(q.min);
    for (const r of bf.largest) expect(r.f).toBeCloseTo(r.used / r.ours, 12);
    expect(bf.named.map((n) => n.name)).toEqual([...BLEND_NAMED]);
    const wilson = bf.named[0]?.row;
    expect(wilson?.id).toBe(ids.wilson);
    expect(wilson?.ros).toEqual(I.model.players[ids.wilson as string]?.blend ?? null);
    expect(section(3)).toContain(`f over the ${bf.count} players the blend reaches with a base rate above 0: min ${fmt(q.min, 3)}`);
    // Injured against healthy players' f (the double-counted discount, a planner question), and "off the curve" defined.
    const taggedF = [...blend.factors].filter(([id, x]) => x.ours > 0 && (snapshot.players[id]?.injury ?? "ACTIVE") !== "ACTIVE").map(([, x]) => x.f);
    const h = bf.byHealth;
    expect(h.tagged.count).toBe(taggedF.length);
    expect(h.tagged.count + h.healthy.count).toBe(bf.count);
    expect(h.tagged.count).toBeGreaterThan(0); // Garrett Wilson is questionable in this league
    expect(h.tagged.median).toBe(median(taggedF));
    expect(h.offCurve).toBe(scaled.filter((f) => !f.fit).length);
    expect(h.offCurveTagged).toBeLessThanOrEqual(h.offCurve);
    expect(bf.extremesTagged.smallest).toBe(bf.smallest.filter((r) => r.status !== "ACTIVE").length);
    expect(section(3)).toContain(`the ${h.tagged.count} injury-tagged players (any status but active): median f ${fmt(h.tagged.median, 3)}`);
    expect(section(3)).toContain(`"(off the curve)": not one of his position's curve points (an injury tag, or no game left on his NFL team's schedule)`);
  });

  it("section 4: every switch setting, built with its switches; free agents don't move the odds as rosters stand; config restored", () => {
    const st = report.settings;
    expect([...st.keys()]).toEqual(SETTINGS.map((s) => s.key));
    const now = st.get("now");
    expect(now?.model).toBe(report.model);
    expect(now?.ctx).toBe(report.ctx);
    expect(now?.pickups?.pPlayoffs).toBe(report.result.baseline.pPlayoffs);
    for (const r of st.values()) {
      expect(r.stand).not.toBeNull();
      expect(r.pickups).not.toBeNull();
      const L = tradeInternals(r.ctx).league;
      expect(L.allocation === null).toBe(!r.switches.oneTeam);
      expect(L.irReturners).toBe(r.switches.irReturners);
      expect(L.lp.blend.weight).toBe(r.switches.blend ? config.marketBlend.weight : 0);
      expect(r.model.faAllocation === undefined).toBe(!r.switches.oneTeam);
    }
    // One free agent per team changes only the pickups: as rosters stand, the odds are the same bit for bit.
    expect(st.get("cp4+oneTeam")?.stand).toEqual(st.get("cp4")?.stand);
    expect(st.get("now-oneTeam")?.stand).toEqual(now?.stand);
    expect(config.streaming.detectAdds).toBe(2);
    const s = section(4);
    expect(s).toContain("| Checkpoint 3, as reported | 6a83beb | live data of 2026-09-30 | 78.6% / 19.7% | – | – |");
    expect(s).toContain("| Checkpoint 4, as reported | b27e90f | live data of 2026-10-03 09:28Z | 67.8% / 13.3% | 62.9% / 11.6% | −4.9 pts / −1.7 pts (unpaired) |");
    expect(s).toContain("| The Checkpoint 4 model | b27e90f | this report's data | 70.0% / 20.0% | 65.0% / 18.0% | −5.0 pts / −2.0 pts (unpaired) |");
    expect(s).toContain("| The Checkpoint 3 model | – | not given (--compare3) | – | – | – |");
    expect(s).toContain("| The market blend | ");
    // Each data row of the change table has a cell for every column.
    const head = s.split("\n").find((l) => l.startsWith("| Change |")) as string;
    const cells = (l: string) => l.split("|").length;
    for (const l of s.split("\n").filter((x) => /^\| (The market blend|One free agent, one team|IR returners|Streaming|All three)/.test(x))) expect(cells(l)).toBe(cells(head));
  });

  it("section 4: now's pickup effect on the same seasons (paired: the League model's teams on the search's final block)", () => {
    const I = tradeInternals(report.ctx);
    const sim = I.sim as NonNullable<typeof I.sim>;
    const odds = seasonOdds(snapshot, report.model, { sims: config.simulation.finalSims, seed: config.simulation.seed, normals: sim.blocks.final });
    const mine = odds?.teams.find((t) => t.teamId === "1");
    expect(report.standOnSearch).toEqual({ pPlayoffs: mine?.pPlayoffs, pTitle: mine?.pTitle });
    // The final block isn't the League model's own seasons (1 … finalSims): another number in general, the same rule.
    const now = report.settings.get("now");
    const effect = `${pts((now?.pickups?.pPlayoffs ?? 0) - (report.standOnSearch?.pPlayoffs ?? 0))} / `;
    expect(section(4)).toContain(`| **Now** | this code | this report's data | **`);
    expect(section(4)).toContain(`${effect}`);
    expect(section(4)).toMatch(/\| \*\*Now\*\* \|.*\(paired\) \|/);
    expect(section(4)).toContain("**Now's is paired**: your odds as rosters stand priced on the search's own seasons (seasons 1,001–6,000) are ");
  });

  it("section 4: what changed in the data, from the committed league reports read back (records, roster moves and injury news, Checkpoint 4's rules on both data)", () => {
    const d = report.dataChanges;
    const c4 = d.cp4 as NonNullable<typeof d.cp4>;
    const c3 = d.cp3 as NonNullable<typeof d.cp3>;
    expect(c4.get("1")).toEqual({ joined: [], left: [], status: [{ name: "Garrett Wilson", from: "", to: "Q" }], record: { then: c4.get("1")?.record.now, now: c4.get("1")?.record.now } });
    expect(c3.get("2")?.joined).toEqual([snapshot.players[team2First]?.name]);
    expect(c3.get("2")?.left).toEqual(["Old Receiver"]);
    expect(recordsSame(c4)).toBe(true);
    expect(recordsSame(c3)).toBe(true);
    // Points per week under Checkpoint 4's rules: the report's then, the "cp4" setting's League model now.
    const cp4Model = report.settings.get("cp4")?.model;
    for (const t of snapshot.teams) {
      const m = cp4Model?.teams.find((x) => x.id === t.id);
      expect(d.ppwCp4.get(t.id)).toEqual({ then: Number((100 + Number(t.id) / 10).toFixed(1)), now: m ? (m.scen ?? m.ev).ppw : null });
    }
    // My players with no status change (Garrett Wilson's changed): ROS 100 then, the cp4 model's now, the largest moves first.
    const expected = mineIds
      .filter((id) => id !== ids.wilson && Number.isFinite(cp4Model?.players[id]?.ros.total))
      .map((id) => ({ name: snapshot.players[id]?.name as string, then: 100, now: cp4Model?.players[id]?.ros.total as number }))
      .filter((r) => Math.abs(r.now - r.then) >= 0.05)
      .sort((a, b) => Math.abs(b.now - b.then) - Math.abs(a.now - a.then) || (a.name < b.name ? -1 : 1))
      .slice(0, DATA_ROS_SHOWN);
    expect(d.myRos).toEqual(expected);
    expect(d.myRos.some((r) => r.name === "Garrett Wilson")).toBe(false);
    const s = section(4);
    expect(s).toContain("no fantasy game was decided in between: every team's record is the same as in Checkpoint 3's and Checkpoint 4's league reports ✅");
    expect(s).toContain("| Team | Since Checkpoint 3's data (live data of 2026-09-30) | Since Checkpoint 4's data (live data of 2026-10-03 09:28Z) | Points per week under Checkpoint 4's rules: its data → this data |");
    expect(s).toMatch(/\| Team 1 \(you\) \| no change \| Garrett Wilson active → Q \| 100\.1 → \d+\.\d \([+−]?\d+\.\d\) \|/);
    expect(s).toContain(`+${snapshot.players[team2First]?.name}, −Old Receiver`);
    // A record that changed: recordsSame says so (the report then says ⚠️ instead of claiming no game was decided).
    const changed = dataChanges(snapshot, { cp3: null, cp4: parseLeagueReport(leagueReportMd({ ros: () => 100, ppw: () => 100, record: (id) => (id === "2" ? "9-9" : `${snapshot.teams.find((t) => t.id === id)?.record.w}-${snapshot.teams.find((t) => t.id === id)?.record.l}`) })) }, cp4Model ?? null);
    expect(recordsSame(changed.cp4)).toBe(false);
    expect(changed.cp4?.get("2")?.record.then).toBe("9-9");
    expect(recordsSame(changed.cp3)).toBeNull();
    // Without the reports: nothing to compare.
    const none = dataChanges(snapshot, { cp3: null, cp4: null }, cp4Model ?? null);
    expect([none.cp3, none.cp4, none.myRos]).toEqual([null, null, []]);
  });

  it("section 4: Checkpoint 4's rules against the Checkpoint 4 model's own odds, ✅ only when they agree to the printed decimal", () => {
    const run = { stand: { pPlayoffs: 0.7, pTitle: 0.2 }, pickups: { pPlayoffs: 0.65, pTitle: 0.18 } };
    const same = cp4Reproduction(compare, run);
    expect(same).toEqual({ same: true, stand: "0.0 pts / 0.0 pts", pickups: "0.0 pts / 0.0 pts" });
    expect(reproductionText(same as NonNullable<typeof same>)).toContain("the switches reproduce the Checkpoint 4 model to the printed decimal ✅");
    const off = cp4Reproduction(compare, { ...run, pickups: { pPlayoffs: 0.66, pTitle: 0.18 } });
    expect(off?.same).toBe(false);
    expect(off?.pickups).toBe("+1.0 pts / 0.0 pts");
    expect(reproductionText(off as NonNullable<typeof off>)).toContain("⚠️ not the same");
    expect(cp4Reproduction(null, run)).toBeNull();
    // This suite's compare odds are made up (0.70 / 0.20), so the real run takes the ⚠️ branch.
    expect(section(4)).toContain("⚠️ not the same: some of Phase 4b's other changes move the odds too.");
  });

  it("section 5: the allocation, each team's pickups both ways, no free agent twice one per team, the named players, the top trades' adds", () => {
    const a = report.allocation;
    expect(a.allocation).toEqual({ basis: "waiver", order: ["4", "2", "5", "6", "3", "1"] });
    expect(a.dups.oneTeam).toEqual([]);
    expect(a.dups.cp4).toEqual([{ playerId: ids.andrews, teamIds: ["2", "4"] }]);
    expect(a.oneTeam.map((t) => t.teamId)).toEqual(snapshot.teams.map((t) => t.id));
    expect(a.named.map((n) => n.name)).toEqual([...ALLOCATION_NAMED]);
    for (const n of a.named) expect(n.oneTeam.length).toBeLessThanOrEqual(1);
    expect(a.named[0]?.cp4).toEqual(["2"]);
    expect(a.trades).toHaveLength(Math.min(TOP_DETAIL, trades.length));
    for (const r of a.trades) {
      expect(r.fromThird).toEqual([]);
      expect(r.theirFromThird).toEqual([]);
      // My team claims last in this league: the partner always goes first, and I take a pickup of its only when no team
      // sits between us (the one it gives up after the trade: evaluate.ts tradeSides).
      if (!r.illegal) expect(r.first).toBe("partner");
      if (r.fromPartner.length) expect(r.between).toBe(false);
    }
    const s = section(5);
    expect(s).toContain("**The order**, from the league's waiver order (ESPN's waiver ranks): Team 4 > Team 2 > Team 5 > Team 6 > Team 3 > Team 1 (you).");
    expect(s).toContain("One per team: **0** ✅.");
    expect(s).toContain("A third team's pickup: 0 of ");
    // CLAUDE.md §2.2's ⚠️ on the live order (review of track R), and the rule for reaching a partner's pickup worded both ways.
    expect(s).toContain("⚠️ ESPN gives the waiver order as it stands when the league is imported. Parker's league resets it every week to reverse standings");
    expect(s).toContain("or when you're right behind the partner, no team between, and the partner lets him go after the trade; yours is in the partner's reach the same way round");
    expect(s).not.toContain("only when I'm earlier in the order");
  });

  it("section 5: the same search on the weekly reset waiver order (reverse standings), a fresh context", () => {
    const reset = resetWaiverOrder(report.model) as string[];
    const live = report.allocation.allocation?.order ?? [];
    expect(reset).toHaveLength(snapshot.teams.length);
    // Reverse standings: the last-placed team claims first.
    const ranks = new Map((report.model.odds?.teams ?? []).map((t) => [t.teamId, t.rank]));
    for (let i = 1; i < reset.length; i++) expect(ranks.get(reset[i - 1] as string) as number).toBeGreaterThan(ranks.get(reset[i] as string) as number);
    const rr = report.resetOrder;
    if (reset.every((id, i) => id === live[i])) {
      expect(rr).toBeNull();
      return;
    }
    const r = rr as NonNullable<typeof rr>;
    expect(r.order).toEqual(reset);
    expect(r.live).toEqual(live);
    expect(r.facts).toEqual(listFacts(r.result.trades.map((t) => listedOf(t, snapshot)), ids.wilson as string));
    expect(r.odds?.pPlayoffs).toBe(r.result.baseline.pPlayoffs);
    const s = section(5);
    expect(s).toContain("**The same search on the weekly reset order**");
    expect(s).toContain(`| The weekly reset order | ${reset.indexOf("1") + 1}`);
    expect(s).toContain(`of the reset order's top ${Math.min(TOP_DETAIL, r.result.trades.length)} are in this report's top`);
  });

  it("section 5: who can reach a partner's baseline pickup after a trade, both ways round (evaluate.ts tradeSides)", () => {
    // I take theirs: I'm first, or right behind them with no team between (they let him go).
    expect(pickupReach("me", true, "partner's")).toBe("you're earlier in the order, so you'd claim him first");
    expect(pickupReach("partner", false, "partner's")).toBe("you're right behind them in the order and they let him go after the trade");
    expect(pickupReach("partner", true, "partner's")).toMatch(/^❌/);
    // They take mine: the same the other way round.
    expect(pickupReach("partner", true, "mine")).toBe("they're earlier in the order, so they'd claim him first");
    expect(pickupReach("me", false, "mine")).toBe("they're right behind you in the order and you let him go after the trade");
    expect(pickupReach("me", true, "mine")).toMatch(/^❌/);
    expect(pickupReach(null, false, "mine")).toMatch(/^❌/);
  });

  it("section 6: the cards' counts are the search's, and the planner's literal Plan B rules", () => {
    expect(report.cards).toEqual(cardsReport(report.result));
    const lp = report.literalPlanB;
    expect(lp.lessLikely).toBeLessThanOrEqual(lp.boxes);
    expect(lp.worseOnBoth).toBeLessThanOrEqual(lp.lessLikely);
    const s = section(6);
    expect(s).toContain(`| Shown | ${trades.length} |`);
    expect(s).toContain(`| With a Plan B | ${report.cards.planB.boxes} (`);
    expect(s).toContain(`**Plan B under the planner's literal rules** (the same search with the "likelier" rule and the box cap off: TradeSearchOptions.planB): ${lp.boxes} boxes;`);
    expect(s.split("\n").filter((l) => /^\| \d+ \| Team \d+ \| /.test(l))).toHaveLength(trades.length);
    expect(s).toContain(`**Your players given most in the top ${config.ranking.partnerCapTop}** (the first ${MOST_GIVEN_SHOWN}, and everyone tied with the last of them): ${mostGivenText(snapshot, report.cards.mostGiven, config.ranking.perGivenPlayerInTop20)}.`);
    if (report.cards.inBoxes.length) expect(s).toContain("**The cap and the Plan B boxes.** The given-player cap counts the cards, and a box only when it adds a player of yours to its card");
  });

  it("section 7: every IR player with his return week R and the displacement as the team stands and at V*(T); PPW without and with returners", () => {
    const ir = report.ir;
    const room = ir.rows.find((r) => r.playerId === ids.irRoom);
    const full = ir.rows.find((r) => r.playerId === ids.irFull);
    expect(ir.rows).toHaveLength(2);
    expect(room).toMatchObject({ teamId: "2", status: "IR", espnWeek: 8, R: 8, returner: true, drop: null });
    expect(full).toMatchObject({ teamId: "3", status: "IR", espnWeek: 8, R: 8, returner: true });
    expect(full?.drop).not.toBeNull(); // team 3's roster is full at his return
    expect(full?.drop?.week).toBe(8);
    // V*(T)'s displacement comes from the trade baseline (TeamState.base.displaced).
    const t3 = I.byId.get("3");
    expect(full?.vstarDrop?.playerId).toBe(t3?.base.displaced.find((d) => d.returner === ids.irFull)?.id);
    expect(ir.ppw.map((p) => p.teamId)).toEqual(snapshot.teams.map((t) => t.id));
    expect(ir.odds.on).toEqual(report.settings.get("now")?.stand);
    expect(ir.odds.off).toEqual(report.settings.get("cp4+blend+oneTeam")?.stand);
    // The trades with an IR player (in an IR slot, or with a status the league's IR slot takes: the engine's own rule, which
    // for ESPN takes OUT players too), and the forced moves IR players bring.
    const eligible = irEligibleStatuses(snapshot.settings);
    expect(ir.eligible).toEqual([...eligible]);
    const slot = new Set(snapshot.teams.flatMap((t) => t.ir));
    const isIr = (id: string) => {
      const status = snapshot.players[id]?.injury;
      return slot.has(id) || (status !== undefined && eligible.has(status));
    };
    expect(ir.trades.map((t) => t.rank)).toEqual(trades.flatMap((t, i) => ([...playerIds(t, "give"), ...playerIds(t, "get")].some(isIr) ? [i + 1] : [])));
    for (const t of ir.trades) for (const p of t.ir) expect(p.slot).toBe(slot.has(p.playerId));
    expect(ir.inSlot).toBe(ir.trades.filter((t) => t.ir.some((p) => p.slot)).length);
    const has = (t: TradeEvaluation, side: "me" | "partner", k: "toIR" | "displaced") => (t.required[side][k] ?? []).length > 0;
    expect(ir.toIR).toBe(trades.filter((t) => has(t, "me", "toIR") || has(t, "partner", "toIR")).length);
    expect(ir.displaced).toEqual({ mine: trades.filter((t) => has(t, "me", "displaced")).length, theirs: trades.filter((t) => has(t, "partner", "displaced")).length });
    const s = section(7);
    expect(s).toContain("| Team 2 | ");
    expect(s).toContain("| On IR | 8 | 8 | yes | nobody (room) | ");
    expect(s).toContain(`**Shown trades with an IR player** (in an IR slot, or on an active roster with a status this league's IR slot takes, irSlots.irEligibleStatuses: ${[...eligible].join(" and ")}): ${ir.trades.length} of ${trades.length}`);
  });

  it("section 8: every shown trade and Plan B re-evaluated by the Analyzer bit for bit; the no-op moves nothing; the measured bound", () => {
    const c = report.consistency;
    expect(c.rows).toHaveLength(trades.length);
    for (const r of c.rows) {
      expect(r.differ).toEqual([]);
      expect(Object.is(r.bSearch, r.bAnalyzer)).toBe(true);
      expect(r.myAfter).not.toBeNull();
    }
    expect(c.planB).toHaveLength(trades.filter((t) => t.planB).length);
    for (const r of c.planB) expect(r.differ).toEqual([]);
    expect(report.noOp).toHaveLength(trades.length);
    for (const r of report.noOp) for (const d of [r.screen, r.final]) expect(d).toEqual({ dPO: 0, dCH: 0, dEW: 0 });
    const g = report.giveAway;
    expect(g.length).toBeGreaterThan(0);
    for (const r of g) if (!r.illegal && r.value < I.credit) for (const level of ["low", "medium", "high"] as const) expect(r.b[level]).toBe(r.bWin);
    const s = section(8);
    expect(s).toContain(`ΔPO, ΔCH and ΔEW are exactly 0 in **${trades.length} of ${trades.length}** ✅.`);
    expect(s).toContain(`**${trades.length} of ${trades.length} match exactly** ✅`);
  });

  it("section 10: the League model and the search, cold and warm per stage, again on the same context, deterministic", () => {
    const r = report.runtime;
    expect(r.runs).toHaveLength(1);
    expect(r.warmups).toBe(1);
    expect(r.again.runs).toBe(1);
    expect(r.sameEveryRun).toBe(true);
    for (const k of ["setup", "screening", "exact", "simScreen", "simFinal", "rank", "steps", "total"]) {
      expect(Number.isFinite(r.search[k])).toBe(true);
      expect(Number.isFinite(r.cold.search[k])).toBe(true);
      expect(Number.isFinite(r.again.search[k])).toBe(true);
    }
    for (const k of ["league model", "baseline lineups", "simulation", "profiles", "total"]) expect(Number.isFinite(r.context[k])).toBe(true);
    const lr = report.leagueRuntime;
    expect(lr.runs).toBe(1);
    expect(Number.isFinite(lr.warm.total)).toBe(true);
    expect(Number.isFinite(lr.cold.total)).toBe(true);
    expect(lr.teams).toBe(snapshot.teams.length);
    for (const k of ["league", "searches", "blend", "settings", "sections", "resetOrder", "literalPlanB", "consistency", "total"]) expect(Number.isFinite(report.timing[k])).toBe(true);
    const s = section(10);
    expect(s).toContain("| Stage | Cold | Warm | Again (same context) |");
    expect(s).toContain("| total | ");
    expect(s).toContain(`Counts: ${report.result.counts.screened.toLocaleString("en-US")} candidates screened`);
    // The longest stretch between yields with the stage it fell in, flagged against CLAUDE.md §12's bound; the browser's
    // worker timing is the check:browser run's.
    for (const run of [r.cold, ...r.runs]) expect(run.maxGap).toBeGreaterThanOrEqual(0);
    expect(s).toContain("**The longest stretch of work between two progress yields** (the worker can stop or hand the thread back only between them): ");
    expect(s).toContain(r.maxGap > YIELD_GAP_DOCUMENTED_MS ? `⚠️ Above CLAUDE.md §12's "typically under ${YIELD_GAP_DOCUMENTED_MS} ms of work between yields"` : `Within CLAUDE.md §12's "typically under ${YIELD_GAP_DOCUMENTED_MS} ms" ✅.`);
    expect(s).toContain("`npm run check:browser` times a full Trade Finder search there on the production build");
  });

  it("the longest stretch between progress yields and where it ended (gapTracker, gapStageText)", () => {
    let now = 0;
    const g = gapTracker(() => now);
    const step = (dt: number, p: Parameters<typeof g.onProgress>[0]) => {
      now += dt;
      g.onProgress(p);
    };
    step(5, { stage: "setup", done: 0, total: 1 });
    step(30, { stage: "screening", done: 1, total: 9 });
    step(10, { stage: "rank", done: 0, total: 1 }); // the yield before the ranking
    step(70, { stage: "rank", done: 0, total: 17 }); // inside card 1's Plan B choice (the ranking and its steps before it)
    step(20, { stage: "rank", done: 1, total: 17 }); // card 1 done
    step(25, { stage: "rank", done: 1, total: 17 }); // inside card 2's
    now += 3;
    const f = g.finish();
    expect(f).toEqual({ maxGap: 70, maxGapAt: { stage: "rank", done: 0, total: 17, card: 1 } });
    expect(gapStageText(f.maxGapAt)).toBe("the shown trades' offer-first steps, Plan B and words (card 1 of 17)");
    expect(gapStageText({ stage: "rank", done: 0, total: 1, card: null })).toBe("the ranking");
    expect(gapStageText({ stage: "exact", done: 79, total: 200, card: null })).toBe("exact evaluation (79 of 200)");
    expect(gapStageText(null)).toBe("the search's last stretch, after its last progress report");
    // A last stretch longer than any between yields ends with the search.
    let t2 = 0;
    const g2 = gapTracker(() => t2);
    t2 += 5;
    g2.onProgress({ stage: "setup", done: 0, total: 1 });
    t2 += 50;
    expect(g2.finish()).toEqual({ maxGap: 50, maxGapAt: null });
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
    for (const m of doc.matchAll(/Team (\d+)/g)) {
      // Checkpoint 4's reported rows name its own league's partners (Teams 1–10); this league has 6.
      if (!teamIds.has(m[1] as string)) expect(Number(m[1])).toBeLessThanOrEqual(10);
    }
    expect(doc).toContain("Team 1 (you)");
    expect(doc).not.toMatch(/Team [2-6] \(you/);
  });
});

describe("trade report: the offline dump loader", () => {
  it("reads snapshot, inputs and meta, puts placeholders on the names again, honors --team, and fills in waiver ranks from waiver-ranks.json", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "trade-report-"));
    try {
      const noRanks = {
        ...raw,
        teams: raw.teams.map((t) => {
          const { waiverRank: _rank, ...rest } = t;
          void _rank;
          return rest;
        }),
      };
      writeFileSync(path.join(dir, "snapshot.json"), JSON.stringify(noRanks));
      writeFileSync(path.join(dir, "inputs.json"), JSON.stringify(inputs));
      writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ now: TEST_NOW.toISOString() }));
      const o = loadOffline(dir, undefined);
      expect(o.now.toISOString()).toBe(TEST_NOW.toISOString());
      expect(o.snapshot.name).toBe("League 1");
      expect(o.snapshot.teams.map((t) => t.name)).toEqual(raw.teams.map((t) => `Team ${t.id}`));
      expect(o.snapshot.teams.every((t) => t.ownerName === `Owner ${t.id}`)).toBe(true);
      expect(o.snapshot.myTeamId).toBe(raw.myTeamId);
      expect(o.waiverRanks).toBeNull();
      expect(loadOffline(dir, "3").snapshot.myTeamId).toBe("3");
      writeFileSync(path.join(dir, "waiver-ranks.json"), JSON.stringify({ readAt: "2026-10-03T18:04:58.416Z", ranks: { "1": 6, "2": 2, "3": 5, "4": 1, "5": 3, "6": 4.5 } }));
      const ranked = loadOffline(dir, undefined);
      expect(ranked.snapshot.teams.map((t) => t.waiverRank)).toEqual([6, 2, 5, 1, 3, undefined]);
      expect(ranked.waiverRanks).toEqual({ readAt: "2026-10-03T18:04:58.416Z", teams: 5 });
      writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ now: "not a date" }));
      expect(() => loadOffline(dir, undefined)).toThrow(/valid `now`/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("trade report: facts of the synthetic league the conditional branches need (so their tests run)", () => {
  it("has a reset order other than the live one, an uncapped list that sells Garrett Wilson for a risky week, my players in Plan B boxes and ROS moves", () => {
    expect(report.resetOrder).not.toBeNull();
    expect(report.wilsonWhy?.gives ?? 0).toBeGreaterThan(0);
    expect(report.wilsonWhy?.riskyCovered.length ?? 0).toBeGreaterThan(0);
    expect(report.cards.inBoxes.length).toBeGreaterThan(0);
    expect(report.dataChanges.myRos.length).toBeGreaterThan(0);
  });
});
