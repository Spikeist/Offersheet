import { describe, expect, it } from "vitest";
import type { BracketMatch, MatchupLite, RosterGroups, Standing } from "./analyze";
import { nflCalendar } from "./calendar";
import type { League2026, PicksSummary, Prev2025, TxLite } from "./crawl";
import { enough, evaluateAll, type CodeCheck, type Dataset, type Evaluation } from "./evaluate";

const LEAGUE_ID = (n: number) => `99${String(n).padStart(17, "0")}`;

function league(n: number, settings: Record<string, number>, picks?: PicksSummary, extra: Partial<League2026> = {}): League2026 {
  return {
    leagueId: LEAGUE_ID(n),
    previousLeagueId: LEAGUE_ID(1000 + n),
    previousLink: "id",
    draftId: LEAGUE_ID(2000 + n),
    hop: 1,
    status: "in_season",
    season: "2026",
    seasonType: "regular",
    totalRosters: 12,
    settings: { num_teams: 12, leg: 3, last_scored_leg: 3, waiver_day_of_week: 2, ...settings },
    rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN"],
    scoringNonzero: ["pass_td", "rec"],
    metadataKeys: [],
    nameKeywords: [],
    hasBracketIds: false,
    draft: { type: "snake", status: "complete", rounds: 15, playerType: 0, hasBudget: false },
    picks,
    ...extra,
  };
}

/** 12 teams; roster i has the i-th best record. */
function standings(gamesPerTeam: number, extra: (i: number) => Partial<Standing> = () => ({})): Standing[] {
  return Array.from({ length: 12 }, (_, i) => {
    const wins = Math.max(0, gamesPerTeam - 1 - i);
    return { rosterId: i + 1, wins, losses: gamesPerTeam - wins, ties: 0, fpts: 1500 - 10 * i, ppts: 1700 - 10 * i, reserve: 0, taxi: 0, players: 15, ...extra(i) };
  });
}

/** Six-team fixed bracket, favourites win; seeds = roster ids. */
const WINNERS: BracketMatch[] = [
  { r: 1, m: 1, t1: 3, t2: 6, w: 3, l: 6 },
  { r: 1, m: 2, t1: 4, t2: 5, w: 4, l: 5 },
  { r: 2, m: 3, t1: 1, t2: 4, w: 1, l: 4, t2_from: { w: 2 } },
  { r: 2, m: 4, t1: 2, t2: 3, w: 2, l: 3, t2_from: { w: 1 } },
  { r: 2, m: 5, t1: 6, t2: 5, w: 5, l: 6, p: 5 },
  { r: 3, m: 6, t1: 1, t2: 2, w: 1, l: 2, p: 1 },
  { r: 3, m: 7, t1: 4, t2: 3, w: 3, l: 4, p: 3 },
];
const ROUND_PAIRS: Array<Array<[number, number]>> = [
  [
    [3, 6],
    [4, 5],
  ],
  [
    [1, 4],
    [2, 3],
  ],
  [[1, 2]],
];

/** Matchups where the listed pairs meet in the given weeks; the lower roster id scores more. */
function matchups(weeksPerRound: number[][], losersPair?: { week: number; pair: [number, number] }): Record<string, MatchupLite[]> {
  const out: Record<string, MatchupLite[]> = {};
  weeksPerRound.forEach((weeks, r) => {
    for (const w of weeks) {
      const list = (out[String(w)] ??= []);
      (ROUND_PAIRS[r] ?? []).forEach(([a, b], i) => {
        list.push({ roster_id: a, matchup_id: i + 1, points: 100 }, { roster_id: b, matchup_id: i + 1, points: 90 });
      });
    }
  });
  if (losersPair) {
    const list = (out[String(losersPair.week)] ??= []);
    list.push({ roster_id: losersPair.pair[0], matchup_id: 9, points: 80 }, { roster_id: losersPair.pair[1], matchup_id: 9, points: 95 });
  }
  return out;
}

function trade(leg: number, extra: Partial<TxLite> = {}): TxLite {
  return { type: "trade", status: "complete", leg, created: 0, statusUpdated: 600_000, rosters: 2, consenters: 2, draftPicks: 0, settingsKeys: [], metadataKeys: [], ...extra };
}

function prev(n: number, settings: Record<string, number>, opts: { weeks: number[][]; losersW: number; trades: Record<string, TxLite[]>; games?: number; depth?: number; from?: number; standings?: Standing[]; rosterGroups?: RosterGroups[] }): Prev2025 {
  return {
    fromLeagueId: LEAGUE_ID(opts.from ?? n),
    leagueId: LEAGUE_ID(1000 + n),
    depth: opts.depth ?? 1,
    previousLeagueId: LEAGUE_ID(3000 + n),
    previousLink: "id",
    hasBracketOverrides: false,
    httpStatus: 200,
    found: true,
    season: String(2026 - (opts.depth ?? 1)),
    status: "complete",
    totalRosters: 12,
    settings: { playoff_teams: 6, start_week: 1, ...settings },
    rosterPositions: [],
    standings: opts.standings ?? standings(opts.games ?? (settings.playoff_week_start ?? 15) - 1),
    winners: WINNERS,
    // Toilet bowl when the recorded winner (losersW) is the lower scorer (roster 7 scores 80, roster 12 scores 95).
    losers: [{ r: 1, m: 1, t1: 7, t2: 12, w: opts.losersW, l: opts.losersW === 7 ? 12 : 7 }],
    matchups: matchups(opts.weeks, { week: opts.weeks[0]?.[0] ?? 15, pair: [7, 12] }),
    transactions: opts.trades,
    nameKeywords: [],
    rosterGroups: opts.rosterGroups,
  };
}

const BASE = { type: 0, playoff_round_type: 0, playoff_week_start: 15, league_average_match: 0, playoff_type: 0, playoff_seed_type: 0, trade_deadline: 11, best_ball: 0 };
const ONE_WEEK = [[15], [16], [17]];

function dataset(): Dataset {
  const leagues: League2026[] = [
    ...[1, 2, 3].map((n) => league(n, BASE, { picks: 180, keepers: 0, rookies: 15, withYearsExp: 180, maxKeepersPerRoster: 0 })),
    ...[4, 5, 6].map((n) => league(n, { ...BASE, type: 1, max_keepers: 2 }, { picks: 180, keepers: 12, rookies: 15, withYearsExp: 180, maxKeepersPerRoster: 1 })),
    ...[7, 8, 9].map((n) => league(n, { ...BASE, type: 2, taxi_slots: 3 }, { picks: 48, keepers: 0, rookies: 48, withYearsExp: 48, maxKeepersPerRoster: 0 })),
    ...[10, 11, 12].map((n) => league(n, { ...BASE, playoff_round_type: 1 })),
    ...[13, 14, 15].map((n) => league(n, { ...BASE, playoff_round_type: 2, playoff_week_start: 13 })),
    league(16, { ...BASE, trade_deadline: 99 }),
    league(17, BASE, undefined, { previousLeagueId: null, previousLink: "zero" }),
  ];
  const prevs: Prev2025[] = [
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => prev(n, { ...BASE, trade_deadline: 11 }, { weeks: ONE_WEEK, losersW: 7, trades: { "10": [trade(10)], "11": [trade(11)], "12": [] } })),
    ...[10, 11, 12].map((n) => prev(n, { ...BASE, playoff_round_type: 1, playoff_type: 1 }, { weeks: [[15], [16], [17, 18]], losersW: 12, trades: {} })),
    ...[13, 14, 15].map((n) => prev(n, { ...BASE, playoff_round_type: 2, playoff_week_start: 13, playoff_type: 1 }, { weeks: [[13, 14], [15, 16], [17, 18]], losersW: 12, trades: {} })),
    prev(16, { ...BASE, trade_deadline: 99 }, { weeks: ONE_WEEK, losersW: 7, trades: { "15": [], "16": [trade(16)], "17": [] } }),
  ];
  return {
    state: { week: 4, season: "2026", displayWeek: 3, weekday: "Tuesday" },
    leagues,
    prev: prevs,
    current: [],
    zeroLinkStatus: 404,
    crawl: { seedSources: ["test"], usersFetched: 1, usersWithNewLeagues: 1, usersQueued: 1, leagueUserLists: 0, draftsSeen: 0, stoppedBy: "target", picksRequested: 0, currentRequested: 0, prevRequested: 0, calls: 0, live: 0, cached: 0, statusCounts: {}, byTemplate: {} },
  };
}

const checkOf = (ev: Evaluation, key: string): CodeCheck => {
  const c = ev.checks.find((x) => x.key === key);
  if (!c) throw new Error(`missing ${key}`);
  return c;
};

describe("the evidence rule", () => {
  it("needs 3 clean leagues, or 10 with at most 10% contradicting", () => {
    expect(enough(2)).toBe(false);
    expect(enough(3)).toBe(true);
    expect(enough(5, 1)).toBe(false);
    expect(enough(10, 1)).toBe(true);
    expect(enough(10, 2)).toBe(false);
  });
});

describe("evaluateAll", () => {
  const ev = evaluateAll(dataset());
  const check = (key: string) => checkOf(ev, key);

  it("verifies league types from keeper picks and rookie-only drafts", () => {
    expect(check("CODES.type").status).toBe("ok");
    expect(check("CODES.type").summary).toContain("0 = redraft ✓, 1 = keeper ✓, 2 = dynasty ✓");
  });

  it("counts deadline-week trades by leg, and keeps the no-deadline value apart", () => {
    const c = check("CODES.tradeDeadline");
    expect(c.status).toBe("ok");
    expect(c.summary).toContain("9 trades in leg D (9 leagues), 9 in leg D−1 (9 leagues)");
    expect(c.summary).toContain("0 after leg D (0 leagues)");
    const none = check("CODES.tradeDeadlineNone");
    expect(none.status).toBe("warn"); // one league traded after the latest week value
    expect(none.summary).toContain("99 → trades completed after week 11");
    expect(ev.questions.some((q) => q.includes("no-deadline value"))).toBe(true);
  });

  it("maps playoff_round_type values to round lengths, counting leagues", () => {
    const c = check("CODES.playoffRoundType");
    expect(c.summary).toContain("0 → 1-week rounds (10/10 seasons from 10 leagues)");
    expect(c.summary).toContain("1 → 2-week final (3/3 seasons from 3 leagues)");
    expect(c.summary).toContain("2 → 2-week rounds (3/3 seasons from 3 leagues)");
    expect(c.status).toBe("ok");
  });

  it("verifies the median game, playoff start, playoff teams and seeding", () => {
    expect(check("CODES.playoffWeekStart").status).toBe("ok");
    expect(check("CODES.playoffTeams").status).toBe("ok");
    expect(check("CODES.seeding").status).toBe("ok");
    expect(check("CODES.medianGame").summary).toContain("0 → once per week in 16/16 (100%) leagues");
  });

  it("tells a toilet bowl from a consolation bracket", () => {
    const c = check("CODES.playoffType");
    expect(c.summary).toContain("0 → losers advance (toilet bowl)");
    expect(c.summary).toContain("1 → winners advance (consolation)");
    expect(c.status).toBe("ok");
  });

  it('reports previous_league_id "0" as an adapter fact', () => {
    expect(check("CODES.sample").summary).toContain('1 "0"');
    expect(ev.issues.some((i) => i.includes('previous_league_id as the string "0"') && i.includes("HTTP 404"))).toBe(true);
  });

  it("never puts a league, draft or previous-league ID in the output, nor per-league records", () => {
    const text = JSON.stringify(ev);
    const ids = [...dataset().leagues.flatMap((l) => [l.leagueId, l.previousLeagueId, l.draftId]), ...dataset().prev.flatMap((p) => [p.leagueId, p.previousLeagueId])];
    for (const id of ids) if (id) expect(text).not.toContain(id);
    expect(text).not.toContain("roundWeeksExamples");
    const v = ev.meta.verification as Record<string, unknown>;
    expect(Array.isArray(v.seedingMisfits)).toBe(false);
  });

  it("says when disabled trading, pick trading and trade review aren't proven", () => {
    expect(check("CODES.disableTrades").status).toBe("warn");
    expect(check("CODES.pickTrading").status).toBe("warn");
    const r = check("CODES.tradeReview");
    expect(r.status).toBe("warn");
    expect(r.summary).toContain("key missing →");
    expect(ev.questions.some((q) => q.includes("Reconcile with probe:sleeper A.tradeReview"))).toBe(true);
  });
});

describe("evaluateAll: small samples and confounds", () => {
  it("counts older seasons of one league as seasons, not independent leagues", () => {
    const d = dataset();
    // Code 2 only in one league, seen over three seasons (depth 1–3).
    d.leagues = d.leagues.filter((l) => l.settings.playoff_round_type !== 2 || l.leagueId === LEAGUE_ID(13));
    d.prev = [
      ...d.prev.filter((p) => p.settings.playoff_round_type !== 2),
      ...[1, 2, 3].map((depth) =>
        prev(13 + 100 * depth, { ...BASE, playoff_round_type: 2, playoff_week_start: 13, playoff_type: 1, trade_deadline: 11 }, { weeks: [[13, 14], [15, 16], [17, 18]], losersW: 12, depth, from: 13, trades: { "11": [trade(11)] } }),
      ),
    ];
    const ev = evaluateAll(d);
    const c = checkOf(ev, "CODES.playoffRoundType");
    expect(c.status).toBe("warn");
    expect(c.summary).toContain("2 → 2-week rounds (3/3 seasons from 1 league; below the 3-league minimum)");
    // The two older seasons stay out of the deadline check: 9 + 1 leagues with a leg-D trade.
    expect(checkOf(ev, "CODES.tradeDeadline").summary).toContain("10 trades in leg D (10 leagues)");
  });

  it("finds that position limits exempt IR players and asks about it", () => {
    const d = dataset();
    const pos: Record<string, string> = { q1: "QB", q2: "QB", q3: "QB", q4: "QB" };
    d.positionOf = (id) => pos[id];
    const groups = [
      { players: ["q1", "q2", "q3", "q4"], reserve: ["q4"], taxi: [] },
      { players: ["q1", "q2"], reserve: [], taxi: [] },
    ];
    d.prev.push(prev(40, { ...BASE, position_limit_qb: 3 }, { weeks: ONE_WEEK, losersW: 7, trades: {}, rosterGroups: groups }));
    d.leagues.push(league(40, { ...BASE, position_limit_qb: 3 }));
    const ev = evaluateAll(d);
    const c = checkOf(ev, "CODES.positionLimits");
    expect(c.status).toBe("warn");
    expect(c.summary).toContain("on active rosters (players[] minus reserve and taxi) 0 exceeded and 1 were reached exactly");
    expect(c.summary).toContain("over the limit only through IR (reserve) players in 1 league");
    expect(ev.issues.some((i) => i.includes("position_limit_{pos}") && i.includes("IR exempt"))).toBe(true);
    expect(ev.questions.some((q) => q.includes("appear to exempt IR"))).toBe(true);
    expect(ev.questions.some((q) => q.includes("aren't hard caps"))).toBe(false);
  });

  it("flags disabled trading as confounded when every such season is a guillotine league", () => {
    const d = dataset();
    const weeks = { "4": [], "5": [], "6": [], "7": [], "8": [], "10": [], "11": [], "12": [] };
    for (const n of [50, 51, 52]) d.prev.push(prev(n, { ...BASE, type: 3, disable_trades: 1 }, { weeks: ONE_WEEK, losersW: 7, trades: { ...weeks } }));
    for (const p of d.prev) if (p.settings.disable_trades === undefined) p.settings.disable_trades = 0;
    const c = checkOf(evaluateAll(d), "CODES.disableTrades");
    expect(c.status).toBe("warn");
    expect(c.summary).toContain("no guillotine season with trading on to compare");
    expect(c.summary).toContain("not comparable for guillotine");
    // With a guillotine season that trades, the comparison becomes possible (and here decisive).
    const d2 = dataset();
    for (const n of [50, 51, 52]) d2.prev.push(prev(n, { ...BASE, type: 3, disable_trades: 1 }, { weeks: ONE_WEEK, losersW: 7, trades: { ...weeks } }));
    const busy = Object.fromEntries(Object.keys(weeks).map((w) => [w, [trade(Number(w))]]));
    d2.prev.push(prev(53, { ...BASE, type: 3, disable_trades: 0 }, { weeks: ONE_WEEK, losersW: 7, trades: busy }));
    const c2 = checkOf(evaluateAll(d2), "CODES.disableTrades");
    expect(c2.summary).toContain("guillotine: 0 trades in 24 league-weeks off vs a trade in 8/8 league-weeks in 1 season on");
    expect(c2.status).toBe("ok");
  });

  it("keeps a missing veto key apart from 0 and reads the poll", () => {
    const d = dataset();
    const polled = (leg: number) => trade(leg, { created: 0, statusUpdated: 30 * 3_600_000, metadataKeys: ["poll_id"] });
    const quick = (leg: number) => trade(leg, { created: 0, statusUpdated: 2 * 3_600_000 });
    [1, 2, 3].forEach((n) => {
      const p = d.prev[n - 1];
      if (p) {
        p.settings.veto_auto_poll = 1;
        p.settings.trade_review_days = 1;
        p.transactions = { "10": [polled(10)], "11": [polled(11)] };
      }
    });
    [4, 5, 6].forEach((n) => {
      const p = d.prev[n - 1];
      if (p) {
        p.settings.veto_auto_poll = 0;
        p.settings.trade_review_days = 2;
        p.transactions = { "10": [quick(10)], "11": [quick(11)] };
      }
    });
    const ev = evaluateAll(d);
    const r = checkOf(ev, "CODES.tradeReview");
    expect(r.summary).toContain("veto_auto_poll = 1 → 6/6 completed trades carried a veto poll");
    expect(r.summary).toContain("with trade_review_days ≥ 1, 6/6 trades completed within 24 h, so no enforced hold was seen");
    // A missing key is its own group: 4 seasons with 7 trades, none with a poll (enough for the rule).
    expect(r.summary).toContain("key missing → 0/7 with a poll in 4 leagues");
    expect(r.status).toBe("ok");
  });

  it("raises an issue when a median-game league played once per week, and when start_week disagrees with games played", () => {
    const d = dataset();
    for (const n of [60, 61, 62]) d.prev.push(prev(n, { ...BASE, league_average_match: 1 }, { weeks: ONE_WEEK, losersW: 7, trades: {}, games: 28 }));
    d.prev.push(prev(63, { ...BASE, league_average_match: 1 }, { weeks: ONE_WEEK, losersW: 7, trades: {}, games: 14 }));
    // A league that says it starts in week 4 but already has one game per team after week 3.
    d.current.push({ leagueId: LEAGUE_ID(70), reasons: ["start_week>1"], status: "in_season", settings: { start_week: 4, last_scored_leg: 3 }, standings: standings(1) });
    const ev = evaluateAll(d);
    const m = checkOf(ev, "CODES.medianGame");
    expect(m.status).toBe("warn");
    expect(m.summary).toContain("1 → once per week in 1/4 (25%) leagues, twice in 3/4 (75%) (exceptions: 1× 12-team league: once); 1 of 4 leagues contradict");
    expect(ev.issues.some((i) => i.includes("league_average_match = 1, yet every team played only once per week in 1 of 4"))).toBe(true);
    expect(checkOf(ev, "CODES.startWeek").status).toBe("warn");
    expect(ev.issues.some((i) => i.includes("start_week doesn't match the games already played in 1 in-season 2026 league") && i.includes("expected 0 games per team"))).toBe(true);
  });

  it("leaves never-played seasons out, but keeps guillotine seasons (points, no games)", () => {
    const d = dataset();
    const empty = standings(0).map((s) => ({ ...s, wins: 0, losses: 0, fpts: 0, ppts: 0, players: 0 }));
    d.prev.push(prev(80, BASE, { weeks: ONE_WEEK, losersW: 7, trades: {}, standings: empty }));
    const chopped = standings(0).map((s) => ({ ...s, wins: 0, losses: 0 }));
    d.prev.push(prev(81, { ...BASE, type: 3, playoff_week_start: 0 }, { weeks: [], losersW: 7, trades: { "5": [trade(5, { type: "chopped" })] }, standings: chopped }));
    d.leagues.push(league(81, { ...BASE, type: 3, playoff_week_start: 0, last_chopped_leg: 3 }));
    const ev = evaluateAll(d);
    expect(checkOf(ev, "CODES.sample").summary).toContain("(1 never played: no games or points; left out)");
    expect(checkOf(ev, "CODES.type3").summary).toContain('transactions of type "chopped": 1 in 1 finished type-3 seasons');
  });

  it("dates leg-D trades with the NFL calendar and proposes the deadline rule", () => {
    const d = dataset();
    const csv = ["season,game_type,week,gameday", "2025,REG,10,2025-11-06", "2025,REG,11,2025-11-13", "2025,REG,12,2025-11-20"].join("\n");
    d.calendar = nflCalendar(csv);
    const tuesdayAfter = Date.parse("2025-11-18T15:00:00Z"); // 10:00 ET, the Tuesday after NFL week 11
    for (const p of d.prev.slice(0, 9)) p.transactions = { "10": [], "11": [trade(11, { statusUpdated: tuesdayAfter })], "12": [] };
    const ev = evaluateAll(d);
    expect(checkOf(ev, "CODES.tradeDeadline").summary).toContain('"Tuesday after week D":9');
    expect(ev.decisions.some((x) => x.includes("trades are open while the league's settings.leg ≤ trade_deadline") && x.includes("9 of 9 leg-D trades"))).toBe(true);
  });
});
