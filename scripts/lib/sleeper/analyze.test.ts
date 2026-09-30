import { describe, expect, it } from "vitest";
import {
  auditMyTeamLookup,
  bracketShape,
  classifyCoverage,
  findMyRoster,
  hasProjection,
  impliedByes,
  lastPlayoffWeek,
  matchupPairs,
  pairsKey,
  pickOwnership,
  recordsFromMatchups,
  repeatedPairWeeks,
  rosterPoints,
  slotCounts,
  summarizeTransactions,
  tradeReviewFromSettings,
  unknownSlots,
} from "./analyze";
import type { SleeperBracketMatch, SleeperMatchup, SleeperRoster, SleeperTransaction } from "./types";

const m = (roster_id: number, matchup_id: number | null, points: number) => ({ roster_id, matchup_id, points }) as SleeperMatchup;

describe("lineup slots", () => {
  it("counts slots and spots unknown slot names", () => {
    const rp = ["QB", "RB", "RB", "FLEX", "SUPER_FLEX", "BN", "BN", "WEIRD_SLOT"];
    expect(slotCounts(rp)).toEqual({ QB: 1, RB: 2, FLEX: 1, SUPER_FLEX: 1, BN: 2, WEIRD_SLOT: 1 });
    expect(unknownSlots(rp)).toEqual(["WEIRD_SLOT"]);
  });
});

describe("matchups", () => {
  it("pairs rosters by matchup_id and reports odd groups", () => {
    const w = matchupPairs(1, [m(1, 1, 100), m(2, 1, 90), m(3, 2, 80), m(4, null, 0), m(5, 3, 70)]);
    expect(w.pairs).toEqual([[1, 2]]);
    expect(w.nullIds).toBe(1);
    expect(w.problems).toEqual(["matchup_id 2 has 1 roster(s)", "matchup_id 3 has 1 roster(s)"]);
  });

  it("rebuilds records, with and without a median game", () => {
    const weeks = [{ week: 1, rows: [m(1, 1, 100), m(2, 1, 90), m(3, 2, 80), m(4, 2, 120)] }];
    const h2h = recordsFromMatchups(weeks, false);
    expect(h2h.get(1)).toEqual({ w: 1, l: 0, t: 0, pf: 100, pa: 90 });
    expect(h2h.get(3)).toEqual({ w: 0, l: 1, t: 0, pf: 80, pa: 120 });
    const med = recordsFromMatchups(weeks, true); // median = 95
    expect(med.get(1)).toMatchObject({ w: 2, l: 0 });
    expect(med.get(2)).toMatchObject({ w: 0, l: 2 });
  });

  it("joins Sleeper's split points fields", () => {
    expect(rosterPoints({ fpts: 412, fpts_decimal: 7, fpts_against: 380, fpts_against_decimal: 55 })).toEqual({ pf: 412.07, pa: 380.55 });
  });
});

describe("brackets", () => {
  it("reads rounds, byes and placement games from the documented 6-team example", () => {
    // Example bracket from docs.sleeper.com (Getting the playoff bracket).
    const rows = [
      { r: 1, m: 1, t1: 3, t2: 6, w: null, l: null },
      { r: 1, m: 2, t1: 4, t2: 5, w: null, l: null },
      { r: 2, m: 3, t1: 1, t2: null, t2_from: { w: 1 }, w: null, l: null },
      { r: 2, m: 4, t1: 2, t2: null, t2_from: { w: 2 }, w: null, l: null },
      { r: 2, m: 5, t1: null, t2: null, t1_from: { l: 1 }, t2_from: { l: 2 }, w: null, l: null, p: 5 },
      { r: 3, m: 6, t1: null, t2: null, t1_from: { w: 3 }, t2_from: { w: 4 }, w: null, l: null, p: 1 },
      { r: 3, m: 7, t1: null, t2: null, t1_from: { l: 3 }, t2_from: { l: 4 }, w: null, l: null, p: 3 },
    ] as SleeperBracketMatch[];
    expect(bracketShape(rows)).toEqual({ matches: 7, rounds: 3, seededTeams: 6, firstRoundTeams: 4, byes: 2, placementGames: 3, decided: 0 });
    expect(impliedByes(6)).toBe(2);
    expect(impliedByes(8)).toBe(0);
    expect(impliedByes(7)).toBe(1);
  });
});

describe("transactions and picks", () => {
  it("summarizes types, statuses and per-roster moves (completed only)", () => {
    const txs = [
      { transaction_id: "1", type: "trade", status: "complete", leg: 1, created: 10, roster_ids: [1, 2], adds: { a: 1, b: 2 }, drops: { a: 2, b: 1 } },
      { transaction_id: "2", type: "waiver", status: "failed", leg: 2, created: 20, roster_ids: [3], adds: { c: 3 }, drops: null },
      { transaction_id: "3", type: "free_agent", status: "complete", leg: 2, created: 30, roster_ids: [3], adds: { d: 3 }, drops: { e: 3 } },
    ] as unknown as SleeperTransaction[];
    const s = summarizeTransactions(txs);
    expect(s.byType).toEqual({ trade: 1, waiver: 1, free_agent: 1 });
    expect(s.byTypeStatus["waiver/failed"]).toBe(1);
    expect(s.trades).toHaveLength(1);
    expect(s.perRoster.get(3)).toEqual({ adds: 1, drops: 1, trades: 0, waivers: 0, freeAgents: 1 });
    expect(s.perRoster.get(1)).toEqual({ adds: 1, drops: 1, trades: 1, waivers: 0, freeAgents: 0 });
    expect([s.firstCreated, s.lastCreated]).toEqual([10, 30]);
  });

  it("applies traded picks to default ownership", () => {
    const own = pickOwnership([1, 2, 3], ["2027"], 2, [
      { season: "2027", round: 1, roster_id: 1, previous_owner_id: 1, owner_id: 3 },
      { season: "2029", round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1 },
    ]);
    expect(own.total).toBe(6);
    expect(own.moved).toBe(1);
    expect(own.outside).toBe(1);
    expect(own.perRoster.get(3)).toBe(3);
    expect(own.perRoster.get(1)).toBe(1);
  });
});

describe("projection rows", () => {
  it("tells real projections from ADP-only stub rows", () => {
    expect(hasProjection({ adp_dd_ppr: 1000 })).toBe(false);
    expect(hasProjection({ adp_dd_ppr: 999, pos_adp_dd_ppr: 120, gp: 1 })).toBe(false);
    expect(hasProjection(null)).toBe(false);
    expect(hasProjection({ adp_dd_ppr: 50, pts_ppr: 12.3, rec: 4 })).toBe(true);
    expect(hasProjection({ adp_dd_ppr: 1000, gp: 1, def_kr_yd: 21.5 })).toBe(true); // a returner-only projection
    expect(hasProjection({ pts_ppr: 0 })).toBe(true); // projected to score nothing is still a projection
  });

  it("classifies coverage: no team → bye → projected → injured vs healthy gaps", () => {
    const cov = classifyCoverage(
      [
        { id: "a", team: "AAA", injury: null, projected: true, hasRow: true },
        { id: "b", team: "AAA", injury: "Out", projected: false, hasRow: true },
        { id: "c", team: "AAA", injury: "Questionable", projected: false, hasRow: true },
        { id: "d", team: "BYE", injury: null, projected: false, hasRow: true },
        { id: "e", team: null, injury: null, projected: false, hasRow: true },
        { id: "f", team: "AAA", injury: "IR", projected: true, hasRow: true },
        { id: "g", team: "AAA", injury: "", projected: false, hasRow: false },
        { id: "h", team: "AAA", injury: null, projected: false, hasRow: true, depth: 3 }, // a backup QB
        { id: "i", team: "AAA", injury: null, projected: false, hasRow: true, depth: 1 },
      ],
      new Set(["AAA"]),
    );
    expect(cov.noTeam).toEqual(["e"]);
    expect(cov.bye).toEqual(["d"]);
    expect(cov.healthyProjected).toEqual(["a"]);
    expect(cov.healthyMissing).toEqual(["c", "g", "i"]);
    expect(cov.backupMissing).toEqual(["h"]);
    expect(cov.injuredMissing).toEqual(["b"]);
    expect(cov.injuredProjected).toEqual(["f"]);
    expect(cov.stubRows).toBe(6); // b, c, d, e, h, i have a row without a projection
    expect(cov.expected).toBe(4); // backups without a projection are left out
    expect(cov.rate).toBeCloseTo(1 / 4, 9);
  });
});

describe("playoff weeks and repeated pairs", () => {
  it("derives the last playoff week from playoff_round_type", () => {
    expect(lastPlayoffWeek(15, 3, 0)).toBe(17);
    expect(lastPlayoffWeek(15, 3, undefined)).toBe(17);
    expect(lastPlayoffWeek(15, 3, 1)).toBe(18); // two-week final
    expect(lastPlayoffWeek(14, 2, 2)).toBe(17); // two weeks per round
    expect(lastPlayoffWeek(15, 3, 2)).toBe(18); // capped at week 18
  });

  it("finds the earlier week with the same pairs, in any order", () => {
    expect(pairsKey([[2, 1], [4, 3]])).toBe(pairsKey([[3, 4], [1, 2]]));
    const byWeek = new Map<number, Array<[number, number]>>([
      [1, [[1, 2], [3, 4]]],
      [2, [[1, 3], [2, 4]]],
      [3, [[1, 4], [2, 3]]],
      [4, [[2, 1], [4, 3]]],
      [5, [[1, 3], [4, 2]]],
      [6, [[1, 2], [3, 4]]],
    ]);
    const r = repeatedPairWeeks(byWeek, [4, 5, 6]);
    expect([...r]).toEqual([
      [4, 1],
      [5, 2],
      [6, 4],
    ]);
    expect(repeatedPairWeeks(new Map([[1, [[1, 2]]], [2, [[1, 3]]]]) as Map<number, Array<[number, number]>>, [2]).get(2)).toBeNull();
  });
});

describe("trade review", () => {
  it("maps veto_auto_poll to league_vote, everything else to none", () => {
    expect(tradeReviewFromSettings({ veto_auto_poll: 1, trade_review_days: 2 })).toBe("league_vote");
    expect(tradeReviewFromSettings({ veto_auto_poll: 0, trade_review_days: 2, veto_votes_needed: 6 })).toBe("none");
    expect(tradeReviewFromSettings({ trade_review_days: 3 })).toBe("none");
  });
});

describe("my team", () => {
  const rosters = [
    { roster_id: 1, owner_id: "u1", co_owners: null, settings: {} },
    { roster_id: 2, owner_id: "u2", co_owners: ["u5", "u6"], settings: {} },
    { roster_id: 3, owner_id: "u3", co_owners: ["u7"], settings: {} },
    { roster_id: 4, owner_id: null, co_owners: null, settings: {} },
  ] as unknown as SleeperRoster[];

  it("finds a roster by owner_id first, then co_owners", () => {
    expect(findMyRoster(rosters, "u2")).toEqual({ rosterId: 2, via: "owner_id" });
    expect(findMyRoster(rosters, "u6")).toEqual({ rosterId: 2, via: "co_owners" });
    expect(findMyRoster(rosters, "u7")).toEqual({ rosterId: 3, via: "co_owners" });
    expect(findMyRoster(rosters, "nobody")).toBeNull();
  });

  it("audits the rule for every owner and co-owner and flags users on two rosters", () => {
    expect(auditMyTeamLookup(rosters)).toEqual({ owners: { total: 3, resolved: 3 }, coOwners: { total: 3, resolved: 3 }, onSeveralRosters: 0 });
    const shared = [...rosters, { roster_id: 5, owner_id: "u9", co_owners: ["u1"], settings: {} }] as unknown as SleeperRoster[];
    const a = auditMyTeamLookup(shared);
    expect(a.onSeveralRosters).toBe(1);
    expect(a.coOwners).toEqual({ total: 4, resolved: 3 }); // u1 resolves to roster 1 via owner_id, not roster 5
  });
});
