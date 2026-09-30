import { describe, expect, it } from "vitest";
import { LeagueImportError } from "@/adapters/types";
import type { SleeperPlayerLite } from "@/data/types";
import { POSITIONS, type LeagueSnapshot } from "@/engine/model";
import { expectedPoints } from "@/engine/scoring";
import { findMyRosterId, hasProjection, lineupFromRosterPositions, lookupPlayer, mapInjury, normalizeSleeperLeague, playoffLayout, sleeperPos, FREE_AGENTS_PER_POSITION, type SleeperNormalizeContext } from "./normalize";
import { mapSleeperScoring, normalizeProjectionStats } from "./scoringMap";
import { ALL_SLEEPER_LISTS, crosswalkResolver, fakeResolver, loadTestLeague, projectionRowOf, rawOf, type TestLeague } from "./test-helpers";

const NOW = new Date("2026-09-29T18:00:00Z");
const ctx = (t: TestLeague, extra: Partial<SleeperNormalizeContext> = {}): SleeperNormalizeContext => ({ now: NOW, resolver: fakeResolver(t.players), ...extra });
const run = (t: TestLeague, extra: Partial<SleeperNormalizeContext> = {}) => normalizeSleeperLeague(rawOf(t), ctx(t, extra));
const codes = (r: ReturnType<typeof run>) => r.snapshot.warnings.map((w) => w.code);
const warning = (r: ReturnType<typeof run>, code: string) => r.snapshot.warnings.find((w) => w.code === code);
const rosteredIds = (t: TestLeague): string[] => t.rosters.flatMap((r) => r.players as string[]);

function expectImportError(fn: () => unknown, code: string, path?: string): LeagueImportError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(LeagueImportError);
    const e = err as LeagueImportError;
    expect(e.code).toBe(code);
    if (path) expect(e.detail.path).toBe(path);
    return e;
  }
  throw new Error(`expected LeagueImportError ${code}`);
}

describe("normalizeSleeperLeague: the public test league (minimized fixtures)", () => {
  const t = loadTestLeague();
  const { snapshot, notes } = run(t, { userId: t.meta.me.userId });
  const s = snapshot.settings;

  it("reads the league basics, and the league week (settings.leg) next to the NFL week", () => {
    expect(snapshot).toMatchObject({ platform: "sleeper", leagueId: t.league.league_id, season: 2026, name: t.league.name, fetchedAt: NOW.toISOString(), currentWeek: 4 });
    // Tuesday of NFL week 4: the league's waivers haven't run, so it's still league week 3.
    expect(snapshot.leagueWeek).toBe(3);
    expect(s.numTeams).toBe(12);
    expect(s.leagueType).toBe("dynasty"); // settings.type 2
  });

  it("builds the lineup from roster_positions, with bench, IR, taxi and max roster size", () => {
    expect(s.lineup).toEqual([
      { slot: "QB", count: 1, eligible: ["QB"] },
      { slot: "RB", count: 2, eligible: ["RB"] },
      { slot: "WR", count: 2, eligible: ["WR"] },
      { slot: "TE", count: 1, eligible: ["TE"] },
      { slot: "FLEX", count: 1, eligible: ["RB", "WR", "TE"] },
      { slot: "SUPER_FLEX", count: 1, eligible: ["QB", "RB", "WR", "TE"] },
      { slot: "K", count: 1, eligible: ["K"] },
      { slot: "DEF", count: 1, eligible: ["DEF"] },
    ]);
    expect(s).toMatchObject({ benchSlots: 10, irSlots: 2, taxiSlots: 3, maxRosterSize: 20 });
    expect(s.positionLimits).toBeUndefined();
    expect(s.bestBall).toBeUndefined();
  });

  it("reads the season shape, playoffs, deadline and review with the verified codes", () => {
    expect(s.regularSeasonWeeks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(s.playoffWeeks).toEqual([15, 16, 17]); // 6 teams → 3 one-week rounds (round type 0)
    expect(s).toMatchObject({ playoffTeams: 6, playoffByes: 2, medianGame: false, pointsOnly: false, tradeDeadline: { week: 11 }, tradeReview: "league_vote" });
    expect(s.playoffRoundWeeks).toBeUndefined();
    expect(s.playoffSeeding).toEqual({ reseed: true, divisionWinnersFirst: false });
    expect(s.divisions).toBeUndefined();
    expect(s.faabBudget).toBeUndefined(); // waiver_type 0 is not FAAB
    expect(s.unknownSettings).toBeUndefined();
  });

  it("maps the scoring, including D/ST brackets as DEF-only ranges", () => {
    expect(s.scoring.perStat).toMatchObject({ pass_yd: 0.04, pass_td: 4, rec: 0.5, rush_yd: 0.1, fum_lost: -2 });
    expect(s.scoring.perStat).not.toHaveProperty("pts_allow_14_20");
    expect(s.scoring.rules.filter((r) => r.kind === "range")).toHaveLength(14); // 6 pts_allow + 8 yds_allow brackets scored
    expect(s.scoring.rules.every((r) => r.kind === "range" && r.positions?.[0] === "DEF")).toBe(true);
    expect(s.scoring.unmapped).toEqual([]);
  });

  it("builds teams: names, owners, active roster without IR/taxi, record and points", () => {
    expect(snapshot.teams.map((x) => x.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
    for (const team of snapshot.teams) {
      const r = t.rosters.find((x) => String(x.roster_id) === team.id);
      const u = t.users.find((x) => x.user_id === r.owner_id);
      expect(team.name).toBe(u.metadata?.team_name ?? u.display_name);
      expect(team.ownerName).toBe(u.display_name);
      expect(team.ir).toEqual(r.reserve ?? []);
      expect(team.taxi).toEqual(r.taxi ?? []);
      expect(new Set([...team.roster, ...team.ir, ...team.taxi])).toEqual(new Set(r.players));
      expect(team.roster.some((p) => team.ir.includes(p) || team.taxi.includes(p))).toBe(false);
      expect(team.record).toEqual({ w: r.settings.wins, l: r.settings.losses, t: r.settings.ties });
      expect(team.pointsFor).toBeCloseTo(r.settings.fpts + r.settings.fpts_decimal / 100, 6);
      expect(team.pointsAgainst).toBeCloseTo(r.settings.fpts_against + r.settings.fpts_against_decimal / 100, 6);
    }
    // fpts + fpts_decimal / 100, rounded to cents (the fixture's points are synthetic).
    const r1 = t.rosters.find((x) => x.roster_id === 1).settings;
    expect(snapshot.teams[0]?.pointsFor).toBe(Math.round((r1.fpts + r1.fpts_decimal / 100) * 100) / 100);
    expect(snapshot.teams.some((x) => x.ir.length) && snapshot.teams.some((x) => x.taxi.length)).toBe(true);
  });

  it("finds my team from the user id (owner_id)", () => {
    expect(snapshot.myTeamId).toBe(String(t.meta.me.rosterId));
  });

  it("has every regular-season matchup pair and ignores the playoff-week placeholders", () => {
    expect(snapshot.schedule).toHaveLength(14 * 6);
    expect(snapshot.schedule.every((m) => m.week <= 14 && !m.isPlayoff && m.teamB !== null)).toBe(true);
    for (let w = 1; w <= 14; w++) {
      const teams = snapshot.schedule.filter((m) => m.week === w).flatMap((m) => [m.teamA, m.teamB]);
      expect(new Set(teams).size).toBe(12);
    }
    const w1 = t.matchups[1] as Array<{ roster_id: number; matchup_id: number }>;
    const a = w1.find((m) => m.roster_id === 1) as { matchup_id: number };
    const opp = w1.find((m) => m.matchup_id === a.matchup_id && m.roster_id !== 1) as { roster_id: number };
    expect(snapshot.schedule).toContainEqual({ week: 1, teamA: String(Math.min(1, opp.roster_id)), teamB: String(Math.max(1, opp.roster_id)), isPlayoff: false });
  });

  it("keeps completed transactions only, with week = leg, ISO timestamps, moves and picks", () => {
    const raw = Object.values(t.transactions).flat();
    const complete = raw.filter((x) => x.status === "complete");
    expect(snapshot.transactions).toHaveLength(complete.length);
    expect(complete.length).toBeLessThan(raw.length); // a failed waiver claim is in the fixture
    const times = snapshot.transactions.map((x) => Date.parse(x.timestamp));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const tx of snapshot.transactions) {
      const src = complete.find((x) => x.transaction_id === tx.id);
      expect(tx.week).toBe(src.leg);
      expect(tx.timestamp).toBe(new Date(src.created).toISOString());
      expect(tx.teams).toEqual(src.roster_ids.map(String));
    }
    const trade = snapshot.transactions.find((x) => x.type === "trade" && x.picks?.length);
    expect(trade).toBeDefined();
    const srcTrade = complete.find((x) => x.transaction_id === trade?.id);
    for (const m of trade?.moves ?? []) {
      expect(m.to).toBe(String(srcTrade.adds[m.playerId]));
      expect(m.from).toBe(String(srcTrade.drops[m.playerId]));
    }
    expect(trade?.picks?.[0]).toEqual({ season: Number(srcTrade.draft_picks[0].season), round: srcTrade.draft_picks[0].round, originalTeamId: String(srcTrade.draft_picks[0].roster_id), ownerTeamId: String(srcTrade.draft_picks[0].owner_id) });
    expect(snapshot.transactions.map((x) => x.type).sort()).toEqual(expect.arrayContaining(["add", "drop", "trade", "waiver"]));
    const dropOnly = snapshot.transactions.find((x) => x.type === "drop");
    expect(dropOnly?.moves.every((m) => m.to === null && m.from !== null)).toBe(true);
  });

  it("lists future pick ownership: own picks of the open seasons, moved by traded_picks", () => {
    const picks = snapshot.draftPicks ?? [];
    // The 2026 draft is complete, so 2027–2029 × 3 rounds × 12 teams.
    expect(picks).toHaveLength(3 * 3 * 12);
    expect(new Set(picks.map((p) => p.season))).toEqual(new Set([2027, 2028, 2029]));
    for (const row of t.tradedPicks) {
      const p = picks.find((x) => x.season === Number(row.season) && x.round === row.round && x.originalTeamId === String(row.roster_id));
      if (Number(row.season) === 2026) expect(p).toBeUndefined(); // this year's draft is over
      else expect(p?.ownerTeamId).toBe(String(row.owner_id));
    }
    expect(picks.filter((p) => p.originalTeamId !== p.ownerTeamId).length).toBe(t.tradedPicks.filter((r) => Number(r.season) > 2026).length);
    expect(notes.some((n) => n.startsWith("Draft picks: 2027–2029"))).toBe(true);
  });

  it("before this season's draft, opens the current season plus 3 future years (Sleeper's documented window)", () => {
    const raw = rawOf(t);
    // No traded pick beyond 2028, so 2029 can only come from the documented window, not from traded_picks.
    const tradedPicks = t.tradedPicks.filter((p) => Number(p.season) <= 2028);
    const preDraft = { ...raw, league: { ...(raw.league as object), status: "pre_draft" }, drafts: [], tradedPicks };
    const { snapshot: pre, notes: preNotes } = normalizeSleeperLeague(preDraft, ctx(t, { userId: t.meta.me.userId }));
    expect(new Set((pre.draftPicks ?? []).map((p) => p.season))).toEqual(new Set([2026, 2027, 2028, 2029]));
    expect(preNotes.some((n) => n.startsWith("Draft picks: 2026–2029"))).toBe(true);
  });

  it("knows every rostered player, mapping positions, DEF ids and injuries", () => {
    const rostered = snapshot.teams.flatMap((x) => [...x.roster, ...x.ir, ...x.taxi]);
    for (const id of rostered) expect(snapshot.players[id]?.id).toBe(id);
    expect(codes({ snapshot, notes })).not.toContain("PLAYER_UNKNOWN");
    const defs = rostered.filter((id) => /^[A-Z]{2,3}$/.test(id));
    expect(defs.length).toBeGreaterThan(0);
    for (const id of defs) expect(snapshot.players[id]).toMatchObject({ pos: "DEF", eligible: ["DEF"], nflTeam: id });
    // Injury status: the projection row's when it carries one (fresher), else the players DB's.
    const rowInjury = new Map(t.projections.filter((r) => r.player && r.player.injury_status !== undefined).map((r) => [r.player_id, r.player.injury_status as string | null]));
    const injured = t.players.filter((x) => rostered.includes(x.id) && x.injuryStatus);
    expect(injured.length).toBeGreaterThan(5);
    for (const p of injured) expect(snapshot.players[p.id]?.injury).toBe(mapInjury(rowInjury.has(p.id) ? rowInjury.get(p.id) : p.injuryStatus).injury);
    expect(Object.values(snapshot.players).every((p) => p.ids.sleeper === p.id && p.eligible.includes(p.pos))).toBe(true);
  });

  it("ranks free agents by league-scored projections, startable positions only", () => {
    const fa = snapshot.freeAgents;
    const rostered = new Set(snapshot.teams.flatMap((x) => [...x.roster, ...x.ir, ...x.taxi]));
    expect(fa.length).toBeGreaterThan(10);
    expect(fa.some((id) => rostered.has(id))).toBe(false);
    expect(new Set(fa.map((id) => snapshot.players[id]?.pos))).toEqual(new Set(["QB", "RB", "WR", "TE", "K", "DEF"]));
    for (const pos of POSITIONS) expect(fa.filter((id) => snapshot.players[id]?.pos === pos).length).toBeLessThanOrEqual(FREE_AGENTS_PER_POSITION);
    const stubs = t.projections.filter((r) => !hasProjection(r.stats)).map((r) => r.player_id);
    expect(stubs.length).toBeGreaterThan(0);
    expect(fa.some((id) => stubs.includes(id))).toBe(false); // no real projection in any fetched week
    // Players unknown to the resolver fall back to the projection row's embedded player object.
    const embedded = t.projections.filter((r) => r.player && hasProjection(r.stats)).map((r) => r.player_id);
    expect(embedded.length).toBeGreaterThan(0);
    for (const id of embedded) expect(snapshot.players[id]?.name).not.toBe(id);
    expect(notes).toContain(`Free agents: the top ${FREE_AGENTS_PER_POSITION} per position by Sleeper's projections for week 4 under this league's scoring, averaged over the weeks each player is projected to play (so a bye or a missed week doesn't hide him).`);
  });

  it("adds no unexpected warnings", () => {
    expect(codes({ snapshot, notes })).toEqual([]);
  });
});

describe("normalizeSleeperLeague: codes and variants", () => {
  it("rejects guillotine leagues (settings.type 3) with a friendly UNSUPPORTED_LEAGUE", () => {
    const t = loadTestLeague();
    t.league.settings.type = 3;
    const e = expectImportError(() => run(t), "UNSUPPORTED_LEAGUE", "settings.type");
    expect(e.message).toMatch(/guillotine/i);
  });

  it("rejects leagues of another sport", () => {
    const t = loadTestLeague();
    t.league.sport = "nba";
    expectImportError(() => run(t), "UNSUPPORTED_LEAGUE", "sport");
  });

  it("accepts best-ball leagues with an Import Report note", () => {
    const t = loadTestLeague();
    t.league.settings.best_ball = 1;
    const r = run(t);
    expect(r.snapshot.settings.bestBall).toBe(true);
    expect(r.notes.some((n) => /lineups are set automatically/.test(n))).toBe(true);
  });

  it("maps league types 0/1/2 and warns on unknown codes", () => {
    const types = [0, 1, 2].map((type) => {
      const t = loadTestLeague();
      t.league.settings.type = type;
      return run(t).snapshot.settings.leagueType;
    });
    expect(types).toEqual(["redraft", "keeper", "dynasty"]);
    const t = loadTestLeague();
    t.league.settings.type = 7;
    const r = run(t);
    expect(r.snapshot.settings.leagueType).toBe("redraft");
    expect(codes(r)).toContain("LEAGUE_TYPE_UNKNOWN");
    expect(r.snapshot.draftPicks).toBeUndefined(); // redraft: no pick table
  });

  it("maps trade review: veto_auto_poll 1 → league_vote, else none (missing → warning)", () => {
    const review = (v: number | undefined) => {
      const t = loadTestLeague();
      if (v === undefined) delete t.league.settings.veto_auto_poll;
      else t.league.settings.veto_auto_poll = v;
      return run(t);
    };
    expect(review(1).snapshot.settings.tradeReview).toBe("league_vote");
    expect(review(0).snapshot.settings.tradeReview).toBe("none");
    const missing = review(undefined);
    expect(missing.snapshot.settings.tradeReview).toBe("none");
    expect(codes(missing)).toContain("TRADE_REVIEW_UNVERIFIED");
  });

  it("reads position limits (active roster, IR exempt) and ignores 0 / unknown positions", () => {
    const t = loadTestLeague();
    Object.assign(t.league.settings, { position_limit_qb: 3, position_limit_def: 2, position_limit_k: 0, position_limit_hc: 1 });
    const r = run(t);
    expect(r.snapshot.settings.positionLimits).toEqual({ QB: 3, DEF: 2 });
    expect(r.snapshot.warnings).toContainEqual(expect.objectContaining({ code: "POSITION_LIMIT_UNKNOWN", platformPath: "settings.position_limit_hc" }));
  });

  it("maps the trade deadline: 1–17 → that week, 99 → none (inferred, with a warning), any other code → unknown", () => {
    const deadline = (v: number | undefined) => {
      const t = loadTestLeague();
      if (v === undefined) delete t.league.settings.trade_deadline;
      else t.league.settings.trade_deadline = v;
      return run(t);
    };
    expect(deadline(1).snapshot.settings.tradeDeadline).toEqual({ week: 1 });
    expect(deadline(17).snapshot.settings.tradeDeadline).toEqual({ week: 17 });
    const none = deadline(99);
    expect(none.snapshot.settings.tradeDeadline).toBeNull();
    expect(none.snapshot.settings.unknownSettings).toBeUndefined();
    expect(codes(none)).not.toContain("TRADE_DEADLINE_UNKNOWN");
    // 99 = no deadline was confirmed in only 1 of 5 leagues in Phase 0: shown with a ⚠️ warning, not as fact.
    expect(none.snapshot.warnings).toContainEqual({ code: "SETTING_INFERRED", message: expect.stringContaining("99"), platformPath: "settings.trade_deadline" });
    for (const v of [0, 18, undefined]) {
      const r = deadline(v);
      expect(r.snapshot.settings.tradeDeadline).toBeNull();
      // UNKNOWN-1: the Import Report shows it as unknown, not as "No trade deadline".
      expect(r.snapshot.settings.unknownSettings).toEqual(["tradeDeadline"]);
      expect(warning(r, "TRADE_DEADLINE_UNKNOWN")).toMatchObject({ message: expect.stringContaining("unknown"), platformPath: "settings.trade_deadline" });
    }
  });

  it("carries the league week so a deadline week D stays open through leg D (SLP-6)", () => {
    const t = loadTestLeague();
    t.league.settings.trade_deadline = 3;
    const r = run(t).snapshot;
    // NFL week 4 has begun (Tuesday), but the league is still in leg 3: trades still complete.
    expect(r.currentWeek).toBe(4);
    expect(r.leagueWeek).toBe(3);
    expect((r.leagueWeek as number) <= (r.settings.tradeDeadline?.week as number)).toBe(true);
    const noLeg = loadTestLeague();
    delete noLeg.league.settings.leg;
    expect(run(noLeg).snapshot.leagueWeek).toBeUndefined();
  });

  it("warns when trading is turned off", () => {
    const t = loadTestLeague();
    t.league.settings.disable_trades = 1;
    expect(codes(run(t))).toContain("TRADES_DISABLED");
  });

  it("lays out playoff rounds by playoff_round_type and caps them at week 18", () => {
    expect(playoffLayout(15, 6, 0)).toEqual({ weeks: [15, 16, 17], roundWeeks: [1, 1, 1], capped: false });
    expect(playoffLayout(15, 6, 1)).toEqual({ weeks: [15, 16, 17, 18], roundWeeks: [1, 1, 2], capped: false });
    expect(playoffLayout(14, 4, 2)).toEqual({ weeks: [14, 15, 16, 17], roundWeeks: [2, 2], capped: false });
    expect(playoffLayout(15, 8, 2)).toEqual({ weeks: [15, 16, 17, 18], roundWeeks: [2, 2, 2], capped: true });
    expect(playoffLayout(16, 7, 0).weeks).toEqual([16, 17, 18]);

    const t = loadTestLeague();
    t.league.settings.playoff_round_type = 1;
    const r1 = run(t);
    expect(r1.snapshot.settings.playoffWeeks).toEqual([15, 16, 17, 18]);
    expect(r1.snapshot.settings.playoffRoundWeeks).toEqual([1, 1, 2]);
    expect(codes(r1)).toEqual([]); // round type 1 was verified (5/5 leagues)
    const t2 = loadTestLeague();
    Object.assign(t2.league.settings, { playoff_round_type: 2, playoff_teams: 8 });
    const r2 = run(t2);
    expect(r2.snapshot.settings).toMatchObject({ playoffTeams: 8, playoffByes: 0, playoffWeeks: [15, 16, 17, 18] });
    expect(codes(r2)).toContain("PLAYOFF_WEEKS_CAPPED");
    // Round type 2 was seen in only 2 leagues: an inferred reading.
    expect(r2.snapshot.warnings).toContainEqual(expect.objectContaining({ code: "SETTING_INFERRED", platformPath: "settings.playoff_round_type" }));
  });

  it("says so when it assumes one-week rounds because the league leaves the round type out", () => {
    const t = loadTestLeague();
    delete t.league.settings.playoff_round_type;
    const r = run(t);
    expect(r.snapshot.settings.playoffWeeks).toEqual([15, 16, 17]);
    expect(r.snapshot.settings.playoffRoundWeeks).toBeUndefined();
    expect(r.snapshot.warnings).toContainEqual(expect.objectContaining({ code: "SETTING_DEFAULTED", platformPath: "settings.playoff_round_type" }));
  });

  it("derives byes as the next power of two minus playoff teams", () => {
    const byes = [4, 5, 6, 7, 8].map((n) => {
      const t = loadTestLeague();
      t.league.settings.playoff_teams = n;
      return run(t).snapshot.settings.playoffByes;
    });
    expect(byes).toEqual([0, 3, 2, 1, 0]);
  });

  it("assumes week 15 when playoff_week_start is 0 or missing, with a warning", () => {
    const t = loadTestLeague();
    t.league.settings.playoff_week_start = 0;
    const r = run(t);
    expect(r.snapshot.settings.playoffWeeks[0]).toBe(15);
    expect(codes(r)).toContain("PLAYOFF_START_MISSING");
  });

  it("reads the median game, FAAB budget and divisions; division winners first is flagged as inferred", () => {
    const t = loadTestLeague();
    Object.assign(t.league.settings, { league_average_match: 1, waiver_type: 2, waiver_budget: 100, divisions: 2 });
    t.rosters.forEach((r) => (r.settings.division = r.roster_id <= 6 ? 1 : 2));
    const r = run(t);
    const { snapshot } = r;
    expect(snapshot.settings.medianGame).toBe(true);
    expect(snapshot.settings.faabBudget).toBe(100);
    expect(snapshot.settings.divisions).toEqual([
      { id: "1", teamIds: ["1", "2", "3", "4", "5", "6"] },
      { id: "2", teamIds: ["7", "8", "9", "10", "11", "12"] },
    ]);
    expect(snapshot.settings.playoffSeeding).toEqual({ reseed: true, divisionWinnersFirst: true });
    expect(snapshot.teams.find((x) => x.id === "7")?.divisionId).toBe("2");
    // 2/2 informative leagues in Phase 0: below the 3-league minimum, so ⚠️.
    expect(snapshot.warnings).toEqual([expect.objectContaining({ code: "SETTING_INFERRED", platformPath: "settings.divisions" })]);
  });

  it("says so when the median-game setting is missing (read as no median game)", () => {
    const t = loadTestLeague();
    delete t.league.settings.league_average_match;
    const r = run(t);
    expect(r.snapshot.settings.medianGame).toBe(false);
    expect(r.snapshot.warnings).toEqual([expect.objectContaining({ code: "SETTING_DEFAULTED", platformPath: "settings.league_average_match" })]);
  });

  it("leaves playoff seeding out, with a warning, when the league doesn't report it (§8 default seeding)", () => {
    const t = loadTestLeague();
    delete t.league.settings.playoff_seed_type;
    const r = run(t);
    expect(r.snapshot.settings.playoffSeeding).toBeUndefined();
    expect(r.snapshot.warnings).toEqual([expect.objectContaining({ code: "SETTING_DEFAULTED", platformPath: "settings.playoff_seed_type" })]);
    const odd = loadTestLeague();
    odd.league.settings.playoff_seed_type = 4;
    const r2 = run(odd);
    expect(r2.snapshot.settings.playoffSeeding).toEqual({ reseed: false, divisionWinnersFirst: false });
    expect(codes(r2)).toContain("PLAYOFF_SEED_TYPE_UNKNOWN");
  });

  it("gathers teams without a division into ONE warning, and seeds division winners first only with real divisions (SLP-8)", () => {
    const none = loadTestLeague();
    none.league.settings.divisions = 2;
    none.rosters.forEach((x) => delete x.settings.division);
    const r = run(none);
    expect(r.snapshot.warnings.filter((w) => w.code === "DIVISION_MISSING")).toHaveLength(1);
    expect(r.snapshot.settings.divisions).toBeUndefined();
    expect(r.snapshot.settings.playoffSeeding).toEqual({ reseed: true, divisionWinnersFirst: false });
    expect(codes(r)).not.toContain("SETTING_INFERRED");

    const some = loadTestLeague();
    some.league.settings.divisions = 2;
    some.rosters.forEach((x) => (x.settings.division = x.roster_id === 12 ? null : x.roster_id <= 6 ? 1 : 2));
    const r2 = run(some);
    expect(r2.snapshot.warnings.filter((w) => w.code === "DIVISION_MISSING")).toEqual([expect.objectContaining({ message: expect.stringContaining("1 of 12 teams") })]);
    expect(r2.snapshot.settings.divisions?.map((d) => d.teamIds.length)).toEqual([6, 5]);
    expect(r2.snapshot.settings.playoffSeeding?.divisionWinnersFirst).toBe(true);
  });

  it("ignores stale roster division numbers when the league has no divisions", () => {
    const t = loadTestLeague();
    t.rosters.forEach((r) => (r.settings.division = 1 + (r.roster_id % 2)));
    const { snapshot } = run(t);
    expect(snapshot.settings.divisions).toBeUndefined();
    expect(snapshot.teams.every((x) => x.divisionId === undefined)).toBe(true);
  });

  it("warns that playoff matchups aren't imported yet once the playoffs have started (SLP-9)", () => {
    const t = loadTestLeague();
    t.state = { ...t.state, week: 15 };
    const r = run(t);
    expect(r.snapshot.currentWeek).toBe(15);
    expect(codes(r)).toContain("PLAYOFFS_NOT_IMPORTED");
    expect(r.snapshot.schedule.every((m) => !m.isPlayoff)).toBe(true);
    const over = loadTestLeague();
    over.league.season = "2025";
    expect(codes(run(over))).not.toContain("PLAYOFFS_NOT_IMPORTED"); // the season is over: nothing left to simulate
  });

  it("finds my team through co_owners, and warns when the user isn't in the league", () => {
    const t = loadTestLeague();
    const roster = t.rosters.find((r) => r.roster_id === 5);
    roster.co_owners = ["3000000000000000099"];
    t.users.push({ user_id: "3000000000000000099", display_name: "Zorblax Quintavious" });
    const r = run(t, { userId: "3000000000000000099" });
    expect(r.snapshot.myTeamId).toBe("5");
    expect(r.snapshot.teams.find((x) => x.id === "5")?.ownerName).toMatch(/ & Zorblax Quintavious$/);
    expect(findMyRosterId(t.rosters, "3000000000000000099")).toEqual({ rosterId: 5, via: "co_owners" });

    const stranger = run(loadTestLeague(), { userId: "3000000000000000098" });
    expect(stranger.snapshot.myTeamId).toBeNull();
    expect(codes(stranger)).toContain("USER_NOT_IN_LEAGUE");
    expect(run(loadTestLeague()).snapshot.myTeamId).toBeNull(); // league-ID path: the user picks
  });

  it("names orphan rosters and falls back to the display name without a team name", () => {
    const t = loadTestLeague();
    const r1 = t.rosters.find((r) => r.roster_id === 1);
    r1.owner_id = null;
    const { snapshot } = run(t);
    expect(snapshot.teams[0]).toMatchObject({ name: "Team 1", ownerName: "No manager" });
  });

  it("uses a placeholder player for an unknown team defense and warns about other unknown players", () => {
    const t = loadTestLeague();
    const def = t.rosters.flatMap((r) => r.players as string[]).find((p) => /^[A-Z]{2,3}$/.test(p)) as string;
    const other = t.rosters[0].players.find((p: string) => !/^[A-Z]/.test(p)) as string;
    t.players = t.players.filter((p) => p.id !== def && p.id !== other);
    t.projections = t.projections.filter((r) => r.player_id !== other);
    const { snapshot } = run(t);
    expect(snapshot.players[def]).toMatchObject({ pos: "DEF", name: `${def} D/ST`, nflTeam: def });
    expect(snapshot.players[other]).toBeUndefined();
    expect(snapshot.warnings).toContainEqual(expect.objectContaining({ code: "PLAYER_UNKNOWN" }));
  });

  it("marks a rostered player KNOWN not to be active (retired or unsigned) as NA, with a warning that says so", () => {
    const t = loadTestLeague();
    const id = t.rosters[0].players.find((p: string) => !/^[A-Z]/.test(p)) as string;
    t.players = t.players.map((p) => (p.id === id ? { ...p, name: "Orvald Tensk", active: false, injuryStatus: null } : p));
    const { snapshot } = run(t);
    expect(snapshot.players[id]).toMatchObject({ name: "Orvald Tensk", injury: "NA" });
    const w = snapshot.warnings.find((x) => x.code === "PLAYER_INACTIVE");
    expect(w?.message).toContain("Orvald Tensk");
    expect(w?.message).toContain("marked NA: not an active NFL player");
    expect(snapshot.freeAgents).not.toContain(id);
  });

  it("treats an unknown Sleeper injury status as healthy, with a warning (SLP-4)", () => {
    const t = loadTestLeague();
    const id = rosteredIds(t).find((p) => !/^[A-Z]/.test(p) && !t.projections.some((r) => r.player_id === p)) as string;
    t.players = t.players.map((p) => (p.id === id ? { ...p, injuryStatus: "Mystery" } : p));
    const r = run(t);
    expect(r.snapshot.players[id]?.injury).toBe("ACTIVE");
    expect(warning(r, "INJURY_STATUS_UNKNOWN")?.message).toBe("Sleeper sent injury status(es) we don't recognize (Mystery); those players are treated as healthy.");
  });

  it("names a missing required field by its JSON path (BAD_RESPONSE)", () => {
    const t = loadTestLeague();
    delete t.rosters[3].roster_id;
    expectImportError(() => run(t), "BAD_RESPONSE", "rosters[3].roster_id");
    const t2 = loadTestLeague();
    delete t2.league.roster_positions;
    expectImportError(() => run(t2), "BAD_RESPONSE", "league.roster_positions");
    const t3 = loadTestLeague();
    t3.state = { season: "2026" };
    expectImportError(() => run(t3), "BAD_RESPONSE", "state.week");
  });

  it("skips malformed optional rows with a warning instead of failing", () => {
    const t = loadTestLeague();
    const leg = t.meta.txLegs[0] as number;
    (t.transactions[leg] as unknown[]).push({ type: "trade" });
    t.projections.push({ stats: { rec: 1 } });
    const r = run(t);
    expect(r.snapshot.warnings).toContainEqual(expect.objectContaining({ code: "TRANSACTIONS_UNREADABLE" }));
    expect(r.snapshot.warnings).toContainEqual(expect.objectContaining({ code: "PROJECTION_ROWS_UNREADABLE", platformPath: `projections/4[${t.projections.length - 1}].player_id` }));
  });

  it("warns about the season: another season than asked, not drafted, or already over", () => {
    const t = loadTestLeague();
    t.league.status = "pre_draft";
    const r = run(t, { requestedSeason: 2025 });
    expect(codes(r)).toEqual(expect.arrayContaining(["SEASON_MISMATCH", "NOT_DRAFTED"]));
    const past = loadTestLeague();
    past.league.season = "2025";
    const over = run(past);
    expect(over.snapshot.currentWeek).toBe(18);
    expect(codes(over)).toContain("SEASON_OVER");
  });

  it("warns when projections are missing or empty and lists no free agents", () => {
    const t = loadTestLeague();
    const raw = rawOf(t);
    delete raw.projections;
    const r = normalizeSleeperLeague(raw, ctx(t));
    expect(r.snapshot.freeAgents).toEqual([]);
    expect(r.snapshot.warnings).toContainEqual(expect.objectContaining({ code: "PROJECTIONS_MISSING" }));
    const stubsOnly = normalizeSleeperLeague({ ...rawOf(t), projections: { 4: [{ player_id: "4984", stats: { adp_dd_ppr: 1000 } }], 5: [] } }, ctx(t));
    expect(stubsOnly.snapshot.freeAgents).toEqual([]);
    expect(stubsOnly.snapshot.warnings).toContainEqual(expect.objectContaining({ code: "PROJECTIONS_EMPTY", message: expect.stringContaining("weeks 4–5") }));
    expect(stubsOnly.notes.some((n) => n.startsWith("Free agents"))).toBe(false);
    const offseason = rawOf(t);
    delete offseason.projections;
    delete offseason.projectionWeek; // the fetch half requests projections only in the regular season
    expect(normalizeSleeperLeague(offseason, ctx(t)).snapshot.warnings).toContainEqual(expect.objectContaining({ code: "PROJECTIONS_OFFSEASON" }));
  });

  it("treats this season's picks as used once the league is in season, even without the drafts list", () => {
    const t = loadTestLeague();
    const raw = rawOf(t);
    delete raw.drafts;
    const picks = normalizeSleeperLeague(raw, ctx(t)).snapshot.draftPicks ?? [];
    expect(new Set(picks.map((p) => p.season))).toEqual(new Set([2027, 2028, 2029]));
    const pre = loadTestLeague();
    pre.league.status = "pre_draft";
    pre.drafts = [];
    const prePicks = run(pre).snapshot.draftPicks ?? [];
    expect(prePicks.some((p) => p.season === 2026)).toBe(true); // this year's draft is still ahead
    const traded2026 = pre.tradedPicks.find((p) => Number(p.season) === 2026 && p.roster_id !== p.owner_id);
    expect(traded2026).toBeDefined();
    expect(prePicks.find((p) => p.season === 2026 && p.round === traded2026.round && p.originalTeamId === String(traded2026.roster_id))?.ownerTeamId).toBe(String(traded2026.owner_id));
  });

  it("dedupes traded picks listed twice, warning when owners differ", () => {
    const t = loadTestLeague();
    const future = t.tradedPicks.find((p) => Number(p.season) > 2026);
    const other = future.owner_id === 12 ? 11 : 12;
    t.tradedPicks.push({ ...future, owner_id: other });
    const r = run(t);
    const p = r.snapshot.draftPicks?.find((x) => x.season === Number(future.season) && x.round === future.round && x.originalTeamId === String(future.roster_id));
    expect(p?.ownerTeamId).toBe(String(other));
    expect(codes(r)).toContain("TRADED_PICK_DUPLICATE");
    expect(r.snapshot.draftPicks).toHaveLength(108);
  });
});

describe("free agents over the next weeks (SLP-2)", () => {
  const scoringOf = (t: TestLeague) => mapSleeperScoring(t.league.scoring_settings).scoring;
  const wrs = (s: LeagueSnapshot) => s.freeAgents.filter((id) => s.players[id]?.pos === "WR");
  const points = (t: TestLeague, stats: Record<string, number>) => expectedPoints(normalizeProjectionStats(stats, "WR"), "WR", scoringOf(t));
  const scaled = (stats: Record<string, number>, k: number) => Object.fromEntries(Object.entries(stats).map(([key, v]) => [key, /^(adp_|pos_adp_|gp$)/.test(key) ? v : v * k]));

  it("keeps a free agent whose current week is a bye-week stub, ranked by the weeks he's projected", () => {
    const t = loadTestLeague();
    const before = wrs(run(t).snapshot);
    expect(before.length).toBeGreaterThanOrEqual(3);
    const top = before[0] as string;
    const row = t.projections.find((r) => r.player_id === top);
    // Week 4: an ADP-only stub (his bye); weeks 5 and 6: projected as in week 4.
    const w4 = t.projections.map((r) => (r.player_id === top ? { player_id: top, week: 4, stats: { adp_dd_ppr: 120, pos_adp_dd_ppr: 12 } } : r));
    const onlyThisWeek = normalizeSleeperLeague({ ...rawOf(t), projections: { 4: w4 } }, ctx(t));
    expect(onlyThisWeek.snapshot.freeAgents).not.toContain(top); // the old one-week ranking lost him
    const r = normalizeSleeperLeague({ ...rawOf(t), projections: { 4: w4, 5: [{ ...row, week: 5 }], 6: [{ ...row, week: 6 }] } }, ctx(t));
    expect(wrs(r.snapshot)).toEqual(before); // mean of weeks 5–6 = his week-4 points: still the top WR
    expect(r.notes.some((n) => n.includes("projections for weeks 4–6"))).toBe(true);
  });

  it("ranks by the MEAN of the real weekly projections", () => {
    const t = loadTestLeague();
    const listed = wrs(run(t).snapshot);
    const faRows = t.projections.filter((r) => listed.includes(r.player_id));
    expect(faRows.length).toBeGreaterThanOrEqual(3);
    // Week 5 re-projects every free-agent WR differently (×0.5 … ×2.5); week 6 has only stubs (skipped).
    const w5 = faRows.map((r, i) => ({ ...r, week: 5, stats: scaled(r.stats, 0.5 + 0.5 * ((i * 7) % 5)) }));
    const w6 = faRows.map((r) => ({ player_id: r.player_id, week: 6, stats: { adp_dd_ppr: 150 } }));
    const r = normalizeSleeperLeague({ ...rawOf(t), projections: { 4: t.projections, 5: w5, 6: w6 } }, ctx(t));
    const mean = (id: string) => (points(t, faRows.find((x) => x.player_id === id).stats) + points(t, w5.find((x) => x.player_id === id)?.stats ?? {})) / 2;
    const expected = [...listed].sort((a, b) => mean(b) - mean(a) || a.localeCompare(b));
    expect(expected).not.toEqual(listed); // the week-5 numbers really reorder them
    expect(wrs(r.snapshot)).toEqual(expected);
  });
});

describe("player facts: players DB, projection rows and DynastyProcess (SLP-1, DATA-1, DATA-4)", () => {
  /** Production-shaped projections: every rostered and projected player has a row that embeds his player object. */
  function productionRows(t: TestLeague): Array<Record<string, unknown>> {
    const byId = new Map(t.players.map((p) => [p.id, p]));
    const rows: Array<Record<string, unknown>> = t.projections.map((r) => {
      const p = byId.get(r.player_id);
      return r.player || !p ? r : { ...projectionRowOf(p, {}, 4), stats: r.stats };
    });
    const have = new Set(rows.map((r) => r.player_id));
    for (const id of rosteredIds(t)) {
      const p = byId.get(id);
      if (p && !have.has(id)) rows.push(projectionRowOf(p, { rec: 3, rec_yd: 31 }, 4));
    }
    return rows;
  }
  /** Rostered players marked NA (a free agent can carry Sleeper's own NA status). */
  const naPlayers = (s: LeagueSnapshot) => s.teams.flatMap((x) => [...x.roster, ...x.ir, ...x.taxi]).filter((id) => s.players[id]?.injury === "NA");
  const wrFreeAgents = (s: LeagueSnapshot) => s.freeAgents.filter((id) => s.players[id]?.pos === "WR");

  const allButWr = ALL_SLEEPER_LISTS.filter((p) => p !== "WR");

  it.each([
    ["failed (HTTP 500)", { sleeper: "the WR list could not be loaded (HTTP 500)" }],
    ["came back empty", undefined],
  ])("a WR list that %s marks no WR inactive, and projected WRs stay free agents", (_label, notes) => {
    const t = loadTestLeague();
    t.projections = productionRows(t);
    const healthy = normalizeSleeperLeague(rawOf(t), { now: NOW, resolver: crosswalkResolver({ sleeper: t.players, complete: ALL_SLEEPER_LISTS, dynasty: t.players }) });
    const degraded = normalizeSleeperLeague(rawOf(t), { now: NOW, resolver: crosswalkResolver({ sleeper: t.players.filter((p) => p.position !== "WR"), complete: allButWr, dynasty: t.players, ...(notes ? { notes } : {}) }) });
    expect(codes(degraded)).not.toContain("PLAYER_INACTIVE");
    expect(naPlayers(degraded.snapshot)).toEqual(naPlayers(healthy.snapshot));
    const rosteredWrs = rosteredIds(t).filter((id) => t.players.find((p) => p.id === id)?.position === "WR");
    expect(rosteredWrs.length).toBeGreaterThan(20);
    for (const id of rosteredWrs) expect(degraded.snapshot.players[id]).toMatchObject({ pos: "WR", injury: healthy.snapshot.players[id]?.injury, nflTeam: healthy.snapshot.players[id]?.nflTeam });
    expect(wrFreeAgents(healthy.snapshot).length).toBeGreaterThan(0);
    expect(wrFreeAgents(degraded.snapshot)).toEqual(wrFreeAgents(healthy.snapshot));
  });

  it("a partial WR list with the committed rows (most rostered players have none): WRs are 'unknown', not retired", () => {
    const t = loadTestLeague();
    const r = normalizeSleeperLeague(rawOf(t), { now: NOW, resolver: crosswalkResolver({ sleeper: t.players.filter((p) => p.position !== "WR"), complete: allButWr, dynasty: t.players }) });
    expect(codes(r)).not.toContain("PLAYER_INACTIVE");
    expect(naPlayers(r.snapshot)).toEqual([]);
    const rosteredWrs = rosteredIds(t).filter((id) => t.players.find((p) => p.id === id)?.position === "WR");
    for (const id of rosteredWrs) expect(r.snapshot.players[id]).toMatchObject({ pos: "WR", name: t.players.find((p) => p.id === id)?.name });
  });

  it("with the Sleeper DB unavailable, DynastyProcess facts mean 'unknown', not 'retired': no NA, no PLAYER_INACTIVE", () => {
    const t = loadTestLeague();
    const r = normalizeSleeperLeague(rawOf(t), { now: NOW, resolver: crosswalkResolver({ sleeper: null, dynasty: t.players }) });
    expect(codes(r)).not.toContain("PLAYER_INACTIVE");
    expect(naPlayers(r.snapshot)).toEqual([]);
    const people = rosteredIds(t).filter((id) => !/^[A-Z]{2,3}$/.test(id));
    for (const id of people) expect(r.snapshot.players[id]?.name).toBe(t.players.find((p) => p.id === id)?.name);
  });

  it("with every list loaded, a rostered player missing from them is KNOWN inactive: NA and PLAYER_INACTIVE", () => {
    const t = loadTestLeague();
    const id = rosteredIds(t).find((p) => t.players.find((x) => x.id === p)?.position === "TE" && !t.projections.some((r) => r.player_id === p)) as string;
    const name = t.players.find((x) => x.id === id)?.name as string;
    const r = normalizeSleeperLeague(rawOf(t), { now: NOW, resolver: crosswalkResolver({ sleeper: t.players.filter((p) => p.id !== id), complete: ALL_SLEEPER_LISTS, dynasty: t.players }) });
    expect(r.snapshot.players[id]).toMatchObject({ name, pos: "TE", injury: "NA" });
    expect(naPlayers(r.snapshot)).toEqual([id]);
    expect(warning(r, "PLAYER_INACTIVE")?.message).toBe(`1 rostered player(s) aren't on Sleeper's list of active NFL players (retired or unsigned), so they're marked NA: not an active NFL player. ${name}.`);
  });

  it("takes injury status and NFL team from the projection row over the day-old players DB", () => {
    const t = loadTestLeague();
    const p = t.players.find((x) => rosteredIds(t).includes(x.id) && x.position === "RB" && !x.injuryStatus && x.team && !t.projections.some((r) => r.player_id === x.id)) as SleeperPlayerLite;
    const newTeam = p.team === "NYJ" ? "MIA" : "NYJ";
    // Sleeper's DB (up to a day old) says healthy on his old team; this week's row says Out, traded.
    t.projections.push(projectionRowOf({ ...p, injuryStatus: "Out", team: newTeam }, { rush_att: 0.1 }, 4));
    const s = run(t).snapshot;
    expect(s.players[p.id]).toMatchObject({ name: p.name, injury: "OUT", nflTeam: newTeam, ...(typeof p.age === "number" ? { age: p.age } : {}) });

    // A row whose player object doesn't carry those fields keeps the DB's.
    const t2 = loadTestLeague();
    t2.projections.push({ player_id: p.id, week: 4, stats: { rush_att: 0.1 }, player: { position: "RB" } });
    expect(run(t2).snapshot.players[p.id]).toMatchObject({ injury: "ACTIVE", nflTeam: p.team });
  });

  it("lookupPlayer: a KNOWN inactive verdict yields only to a row that shows a current player", () => {
    const retired: SleeperPlayerLite = { id: "9901", name: "Orvald Tensk", position: "WR", fantasyPositions: ["WR"], team: null, injuryStatus: null, status: null, age: 34, active: false, yearsExp: 11 };
    const resolver = fakeResolver([retired]);
    const stub = { player_id: "9901", week: 4, stats: { adp_dd_ppr: 300 }, player: { position: "WR", fantasy_positions: ["WR"], team: null, first_name: "Orvald", last_name: "Tensk", injury_status: null } };
    expect(lookupPlayer(resolver, "9901", stub)).toMatchObject({ active: false }); // a teamless stub row: still retired
    const signed = { ...stub, stats: { rec: 2.1 }, player: { ...stub.player, team: "KC" } };
    expect(lookupPlayer(resolver, "9901", signed)).toMatchObject({ active: true, team: "KC", age: 34 }); // signed since: current
    const unknown = { ...retired, active: null };
    expect(lookupPlayer(fakeResolver([unknown]), "9901", stub)).toMatchObject({ active: null, team: null }); // unknown: the row's facts
    expect(lookupPlayer(fakeResolver([unknown]), "9901", undefined)).toMatchObject({ active: null });
    expect(lookupPlayer(fakeResolver([]), "9901", undefined)).toBeUndefined();
  });
});

describe("helpers", () => {
  it("maps Sleeper positions to ours", () => {
    expect(sleeperPos("TE", ["TE"])).toBe("TE");
    expect(sleeperPos("DE", ["DL"])).toBe("DL");
    expect(sleeperPos("CB")).toBe("DB");
    expect(sleeperPos("FB", ["RB"])).toBe("RB");
    expect(sleeperPos("OL", [])).toBeNull();
    expect(sleeperPos("DEF", ["DEF"])).toBe("DEF");
  });

  it("maps injury statuses (DNR and COV count as OUT)", () => {
    expect(["Questionable", "Doubtful", "Out", "IR", "PUP", "Sus", "NA", "DNR", "COV"].map((s) => mapInjury(s).injury)).toEqual(["QUESTIONABLE", "DOUBTFUL", "OUT", "IR", "PUP", "SUSPENDED", "NA", "OUT", "OUT"]);
    expect(mapInjury(null)).toEqual({ injury: "ACTIVE", known: true });
    expect(mapInjury("")).toEqual({ injury: "ACTIVE", known: true });
    expect(mapInjury("Mystery")).toEqual({ injury: "ACTIVE", known: false });
  });

  it("reports unknown slots and counts the bench", () => {
    expect(lineupFromRosterPositions(["QB", "WRRB_FLEX", "REC_FLEX", "IDP_FLEX", "OP", "BN", "BN"])).toEqual({
      lineup: [
        { slot: "QB", count: 1, eligible: ["QB"] },
        { slot: "WRRB_FLEX", count: 1, eligible: ["RB", "WR"] },
        { slot: "REC_FLEX", count: 1, eligible: ["WR", "TE"] },
        { slot: "IDP_FLEX", count: 1, eligible: ["DL", "LB", "DB"] },
      ],
      bench: 2,
      unknown: ["OP"],
    });
  });

  it("tells real projections from ADP-only stubs", () => {
    expect(hasProjection({ adp_dd_ppr: 1000 })).toBe(false);
    expect(hasProjection({ adp_dd_ppr: 180, gp: 1, pos_adp_dd_ppr: 31 })).toBe(false);
    expect(hasProjection({ gp: 1, rec: 3.2 })).toBe(true);
    expect(hasProjection(null)).toBe(false);
  });
});
