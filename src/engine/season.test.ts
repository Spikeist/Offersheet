import { describe, expect, it } from "vitest";
import { normalizeEspnLeague } from "@/adapters/espn/normalize";
import { LABELS, NOW, PARKER, fakeResolver, parkerBundle, readEspn } from "@/adapters/espn/test-helpers";
import { normalizeSleeperLeague } from "@/adapters/sleeper/normalize";
import { fakeResolver as sleeperResolver, loadTestLeague, rawOf } from "@/adapters/sleeper/test-helpers";
import { config } from "./config";
import { buildLeagueModel, leagueWeeks } from "./league";
import type { TeamOdds } from "./leagueModel";
import type { LeagueSettings, LeagueSnapshot, Matchup } from "./model";
import { TITLE_ONLY, prizeStillMovable } from "./reward";
import { mulberry32 } from "./rng";
import { DIVISION_RULE_ASSUMED, RESEED_RULE_ASSUMED, buildSimSetup, oddsSkippedWarning, pickupSeasonModel, playoffRounds, reseedRuleAssumed, seasonOdds, weekList, weekUnderWayNote, type SeasonModel } from "./season";
import { simNormals, simulateSeason, standingsOrder } from "./sim";
import { buildTestLeague, syntheticInputs } from "./testLeague";

const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);

/** A decided game (teamA wins unless `winner` says otherwise; "tie" = a tie; "none" = decided without a readable result). */
function done(week: number, a: number, b: number, winner: "a" | "b" | "tie" | "none" = "a", extra: Partial<Matchup> = {}): Matchup {
  const A = String(a);
  const B = String(b);
  const result = winner === "none" ? undefined : { pointsA: 100, pointsB: winner === "tie" ? 100 : 90, winnerId: winner === "a" ? A : winner === "b" ? B : null };
  return { week, teamA: A, teamB: B, isPlayoff: false, decided: true, ...(result ? { result } : {}), ...extra };
}
/** A game still to play (b null = a bye). */
const open = (week: number, a: number, b: number | null, extra: Partial<Matchup> = {}): Matchup => ({ week, teamA: String(a), teamB: b === null ? null : String(b), isPlayoff: false, ...extra });

/** A round robin of teams 1..T (circle method) over the given weeks; `decidedBefore` weeks are decided, team A winning. */
function roundRobin(T: number, weeks: number[], decidedBefore: number): Matchup[] {
  const others = range(2, T);
  return weeks.flatMap((week, r) => {
    const k = r % (T - 1);
    const row = [1, ...others.slice(k), ...others.slice(0, k)];
    return range(0, T / 2 - 1).map((i) => (week < decidedBefore ? done(week, row[i] as number, row[T - 1 - i] as number) : open(week, row[i] as number, row[T - 1 - i] as number)));
  });
}

interface Spec {
  T: number;
  currentWeek: number;
  schedule: Matchup[];
  regular?: number[];
  playoffs?: number[];
  playoffTeams?: number;
  /** W-L-T per team (team i + 1); default: wins and losses from the decided games in the schedule. */
  records?: [number, number, number][];
  pointsFor?: number[];
  settings?: Partial<LeagueSettings>;
  inProgressWeek?: number | null;
  mean?: (team: number, week: number) => number;
  sd?: (team: number, week: number) => number;
}

/** A snapshot of teams "1".."T" (empty rosters) with the given schedule, and a League-model stand-in with weekly scores. */
function league(spec: Spec): { snapshot: LeagueSnapshot; model: SeasonModel } {
  const regular = spec.regular ?? range(1, 14);
  const playoffs = spec.playoffs ?? range(15, 17);
  const { snapshot } = buildTestLeague({ teams: range(1, spec.T).map((i) => ({ id: String(i), roster: [] })), currentWeek: spec.currentWeek, regularSeasonWeeks: regular, playoffWeeks: playoffs });
  snapshot.settings = { ...snapshot.settings, playoffTeams: spec.playoffTeams ?? 4, seedingTiebreaker: "pointsFor", playoffSeeding: { reseed: false, divisionWinnersFirst: false }, ...spec.settings };
  snapshot.schedule = spec.schedule;
  const median = snapshot.settings.medianGame;
  snapshot.teams.forEach((t, i) => {
    let w = 0;
    let l = 0;
    let ties = 0;
    for (const m of spec.schedule) {
      if (!m.decided || m.isPlayoff || m.teamB === null || (m.teamA !== t.id && m.teamB !== t.id)) continue;
      const winner = m.result?.winnerId;
      if (winner === null) ties++;
      else if (winner === t.id || (winner === undefined && m.teamA === t.id)) w++;
      else l++;
      if (median) w++;
    }
    const rec = spec.records?.[i];
    t.record = rec ? { w: rec[0], l: rec[1], t: rec[2] } : { w, l, t: ties };
    t.pointsFor = spec.pointsFor?.[i] ?? 1000 - 10 * i;
  });
  const weeks = leagueWeeks(snapshot.settings, spec.currentWeek);
  const mean = spec.mean ?? ((t: number) => 100 + 2 * t);
  const sd = spec.sd ?? (() => 15);
  return {
    snapshot,
    model: {
      weeks: weeks.weeks,
      regularWeeks: weeks.regularWeeks,
      playoffWeeks: weeks.playoffWeeks,
      inProgressWeek: spec.inProgressWeek ?? null,
      teams: snapshot.teams.map((t, i) => ({ id: t.id, score: { mean: weeks.weeks.map((w) => mean(i, w)), sd: weeks.weeks.map((w) => sd(i, w)) } })),
    },
  };
}

/** A League-model stand-in for a snapshot an adapter built: its remaining weeks, every team scoring 100 ± 15 a week. */
function standIn(snapshot: LeagueSnapshot): { snapshot: LeagueSnapshot; model: SeasonModel } {
  const weeks = leagueWeeks(snapshot.settings, snapshot.currentWeek);
  const flat = (x: number) => weeks.weeks.map(() => x);
  return {
    snapshot,
    model: { weeks: weeks.weeks, regularWeeks: weeks.regularWeeks, playoffWeeks: weeks.playoffWeeks, inProgressWeek: null, teams: snapshot.teams.map((t) => ({ id: t.id, score: { mean: flat(100), sd: flat(15) } })) },
  };
}

const setupOf = (x: { snapshot: LeagueSnapshot; model: SeasonModel }) => {
  const built = buildSimSetup(x.snapshot, x.model);
  expect(built).not.toBeNull();
  return built as NonNullable<typeof built>;
};
const oddsOf = (x: { snapshot: LeagueSnapshot; model: SeasonModel }, sims = 400) => {
  const odds = seasonOdds(x.snapshot, x.model, { sims, seed: 7 });
  expect(odds).not.toBeNull();
  return odds as NonNullable<typeof odds>;
};

// ---------------------------------------------------------------------------------------------

describe("buildSimSetup: the schedule (§4 Matchup.decided; lead decision D5)", () => {
  it("a decided game with a result is played (a tie has no winner); one without a result counts only in the records; the rest are still to play", () => {
    const schedule = [
      done(1, 1, 2),
      done(1, 3, 4, "b"),
      done(2, 1, 3, "tie"),
      done(2, 2, 4),
      done(3, 1, 4, "none"), // decided, unreadable: in the records, not head-to-head
      done(3, 2, 3),
      open(4, 1, 2),
      open(4, 3, 4),
      open(5, 1, 3),
      open(5, 2, 4),
    ];
    const x = league({ T: 4, currentWeek: 4, schedule, regular: range(1, 5), playoffs: [6, 7] });
    const built = setupOf(x);
    const { setup } = built;
    expect(setup.played).toEqual([
      { a: 0, b: 1, winner: 0 },
      { a: 2, b: 3, winner: 3 },
      { a: 0, b: 2, winner: null },
      { a: 1, b: 3, winner: 1 },
      { a: 1, b: 2, winner: 1 },
    ]);
    expect(setup.games).toEqual([
      { weeks: [4], a: 0, b: 1 },
      { weeks: [4], a: 2, b: 3 },
      { weeks: [5], a: 0, b: 2 },
      { weeks: [5], a: 1, b: 3 },
    ]);
    // Drawn weeks: the remaining games' and the playoff rounds', each team's score from its model week.
    expect(setup.weeks).toEqual([4, 5, 6, 7]);
    expect(built.simWeekToModelWeek).toEqual([0, 1, 2, 3]);
    expect([...(setup.mean[2] as Float64Array)]).toEqual([104, 104, 104, 104]);
    expect([...(setup.sd[0] as Float64Array)]).toEqual([15, 15, 15, 15]);
    expect(setup.rounds).toEqual([{ weeks: [6] }, { weeks: [7] }]);
    expect(setup.teams.map((t) => [t.id, t.w, t.l, t.t])).toEqual([
      ["1", 2, 0, 1],
      ["2", 2, 1, 0],
      ["3", 0, 2, 1],
      ["4", 1, 2, 0],
    ]);
    expect(built.warnings).toEqual([]);
    expect(built.regularSeasonOver).toBe(false);
    expect(built.teamIds).toEqual(["1", "2", "3", "4"]);
  });

  it("a finished week not scored yet (before the first model week, not decided) is left out with one warning, records and odds alike (D5)", () => {
    const schedule = roundRobin(4, range(1, 6), 3); // weeks 1–2 decided, 3 finished but not scored, 4–6 to play
    const x = league({ T: 4, currentWeek: 4, schedule, regular: range(1, 6), playoffs: [7, 8] });
    const built = setupOf(x);
    expect(built.warnings).toEqual(["Week 3's final scores aren't in yet, so its games are left out of the odds until they are; refresh later."]);
    expect(built.setup.games.every((g) => g.weeks[0] !== 3)).toBe(true);
    expect(built.setup.games).toHaveLength(6);
    expect(built.setup.played).toHaveLength(4);
    // Two such weeks.
    const two = league({ T: 4, currentWeek: 4, schedule: roundRobin(4, range(1, 6), 2), regular: range(1, 6), playoffs: [7, 8] });
    expect(setupOf(two).warnings).toEqual(["Weeks 2 and 3's final scores aren't in yet, so their games are left out of the odds until they are; refresh later."]);
    // The simulation runs on what's left.
    expect(oddsOf(x).notes).toContain("Week 3's final scores aren't in yet, so its games are left out of the odds until they are; refresh later.");
    // One matchup period of two weeks (ESPN), finished but not scored: the warning names both its weeks.
    const period = [done(1, 1, 2), done(1, 3, 4), open(2, 1, 3, { weeks: [2, 3] }), open(2, 2, 4, { weeks: [2, 3] }), ...roundRobin(4, range(4, 6), 4)];
    const p = setupOf(league({ T: 4, currentWeek: 4, schedule: period, regular: range(1, 6), playoffs: [7, 8] }));
    expect(p.warnings).toEqual(["Weeks 2 and 3's final scores aren't in yet, so their games are left out of the odds until they are; refresh later."]);
    expect(p.setup.games.map((g) => g.weeks[0])).toEqual([4, 4, 5, 5, 6, 6]);
  });

  it("cross-checks records against the decided games (median leagues count one median game a matchup): one warning, the records used as reported", () => {
    const schedule = roundRobin(4, range(1, 6), 4);
    const ok = league({ T: 4, currentWeek: 4, schedule, regular: range(1, 6), playoffs: [7, 8] });
    expect(setupOf(ok).warnings).toEqual([]);
    const oneOff = league({ T: 4, currentWeek: 4, schedule, regular: range(1, 6), playoffs: [7, 8], records: [[3, 0, 0], [2, 1, 0], [1, 2, 0], [0, 2, 0]] });
    expect(setupOf(oneOff).warnings).toEqual(["1 team's record doesn't match its finished games in the schedule; the odds use the records as the platform reports them."]);
    const twoOff = league({ T: 4, currentWeek: 4, schedule, regular: range(1, 6), playoffs: [7, 8], records: [[4, 0, 0], [2, 1, 0], [1, 2, 0], [0, 2, 0]] });
    expect(setupOf(twoOff).warnings).toEqual(["2 teams' records don't match their finished games in the schedule; the odds use the records as the platform reports them."]);
    expect(setupOf(twoOff).setup.teams[0]).toMatchObject({ w: 4, l: 0, t: 0 });
    // Median league: 3 games and 3 median games each (the helper adds a median win to every decided game).
    const median = league({ T: 4, currentWeek: 4, schedule, regular: range(1, 6), playoffs: [7, 8], settings: { medianGame: true } });
    expect(setupOf(median).warnings).toEqual([]);
    expect(setupOf(median).setup.medianWeeks).toEqual([4, 5, 6]);
    // Points-only leagues have no W/L to check.
    const pointsOnly = league({ T: 4, currentWeek: 4, schedule, regular: range(1, 6), playoffs: [7, 8], settings: { pointsOnly: true }, records: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]] });
    expect(setupOf(pointsOnly).warnings).toEqual([]);
  });

  it("warns about remaining weeks without matchups and about matchups it can't read (a team not in the league, a team against itself, no week)", () => {
    const schedule = roundRobin(4, [1, 2, 3, 4, 6], 4).concat([open(5, 1, 9)]);
    const x = league({ T: 4, currentWeek: 4, schedule, regular: range(1, 8), playoffs: [9, 10] });
    expect(setupOf(x).warnings).toEqual(["The schedule has no matchups in weeks 5, 7 and 8, so they are left out of the odds.", "1 matchup names a team that isn't in the league, so it is left out of the odds."]);
    expect(oddsSkippedWarning(x.snapshot, x.model)).toBeNull();
    const odd = league({ T: 4, currentWeek: 4, schedule: roundRobin(4, range(1, 14), 4).concat([open(5, 1, 9), open(6, 2, 7), open(5, 3, 3), open(Number.NaN, 1, 2), open(7, 4, 4)]) });
    expect(setupOf(odd).warnings).toEqual([
      "2 matchups name a team that isn't in the league, so they are left out of the odds.",
      "2 matchups pit a team against itself, so they are left out of the odds.",
      "1 matchup has no NFL week we can read, so it is left out of the odds.",
    ]);
  });

  it("no odds when the rest of the regular season has no schedule (it didn't load): the records alone would print today's standings as final", () => {
    const message = "The schedule has no matchups for the rest of the regular season (weeks 4–14), so the playoff odds are left out; refresh to try again.";
    const empty = league({ T: 4, currentWeek: 4, schedule: [], records: [[3, 0, 0], [2, 1, 0], [1, 2, 0], [0, 3, 0]] });
    expect(oddsSkippedWarning(empty.snapshot, empty.model)).toBe(message);
    expect(buildSimSetup(empty.snapshot, empty.model)).toBeNull();
    expect(seasonOdds(empty.snapshot, empty.model)).toBeNull();
    // Only the weeks already played loaded: the same (they'd otherwise be 0% and 100% from three games).
    const past = league({ T: 6, currentWeek: 4, schedule: range(1, 3).flatMap((w) => [done(w, 1, 2), done(w, 3, 4), done(w, 5, 6)]) });
    expect(oddsSkippedWarning(past.snapshot, past.model)).toBe(message);
    expect(seasonOdds(past.snapshot, past.model)).toBeNull();
    // One remaining week with matchups is enough to simulate (the gaps get their own warning, above).
    const oneWeek = league({ T: 4, currentWeek: 4, schedule: roundRobin(4, range(1, 4), 4) });
    expect(oddsSkippedWarning(oneWeek.snapshot, oneWeek.model)).toBeNull();
    expect(setupOf(oneWeek).warnings).toEqual(["The schedule has no matchups in weeks 5–14, so they are left out of the odds."]);
    // A points-only league needs no schedule (points for accrue weekly), and once the regular season is
    // over the playoffs need none either: the records are final.
    const pointsOnly = league({ T: 4, currentWeek: 4, schedule: [], settings: { pointsOnly: true }, records: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]] });
    expect(oddsSkippedWarning(pointsOnly.snapshot, pointsOnly.model)).toBeNull();
    expect(oddsOf(pointsOnly).teams).toHaveLength(4);
    const playoffs = league({ T: 4, currentWeek: 15, schedule: [], records: [[11, 3, 0], [9, 5, 0], [5, 9, 0], [3, 11, 0]] });
    expect(oddsSkippedWarning(playoffs.snapshot, playoffs.model)).toBeNull();
    expect(oddsOf(playoffs).teams.map((t) => t.pPlayoffs)).toEqual([1, 1, 1, 1]);
  });

  it("no odds either when the weeks that loaded are all decided and the later ones are missing (the current week scored before the rollover; review SEASON-2)", () => {
    // 4 teams, week 4 the current week and already scored (weeks 1–4 decided: 4–0, 2–2, 1–3, 1–3), weeks 5–14 missing.
    const decided = [done(1, 1, 2), done(1, 3, 4), done(2, 1, 3), done(2, 2, 4), done(3, 1, 4), done(3, 2, 3), done(4, 1, 2), done(4, 3, 4, "b")];
    const scored = league({ T: 4, currentWeek: 4, schedule: decided });
    expect(scored.snapshot.teams.map((t) => [t.record.w, t.record.l])).toEqual([
      [4, 0],
      [2, 2],
      [1, 3],
      [1, 3],
    ]);
    const message = "The schedule has no matchups for the rest of the regular season (weeks 5–14), so the playoff odds are left out; refresh to try again.";
    expect(oddsSkippedWarning(scored.snapshot, scored.model)).toBe(message);
    expect(buildSimSetup(scored.snapshot, scored.model)).toBeNull();
    expect(seasonOdds(scored.snapshot, scored.model)).toBeNull();
    // Through buildLeagueModel: no odds, and the warning says why.
    const { snapshot, inputs } = buildTestLeague({ teams: range(1, 4).map((i) => ({ id: String(i), roster: [] })) });
    snapshot.schedule = decided;
    snapshot.teams.forEach((t, i) => (t.record = scored.snapshot.teams[i]?.record ?? t.record));
    const model = buildLeagueModel(snapshot, inputs, { now: NOW, scenarios: 0, sims: 200 });
    expect(model.odds).toBeNull();
    expect(model.warnings).toContain(message);
    // Controls: the later weeks there (a game still to play), or a week-4 game not decided yet, and the season is simulated.
    const later = league({ T: 4, currentWeek: 4, schedule: [...decided, ...roundRobin(4, range(5, 14), 15).map((m) => open(m.week, Number(m.teamA), Number(m.teamB)))] });
    expect(oddsSkippedWarning(later.snapshot, later.model)).toBeNull();
    expect(oddsOf(later).teams).toHaveLength(4);
    const live = league({ T: 4, currentWeek: 4, schedule: [...decided.slice(0, 6), open(4, 1, 2), open(4, 3, 4)] });
    expect(oddsSkippedWarning(live.snapshot, live.model)).toBeNull();
    expect(setupOf(live).warnings).toEqual(["The schedule has no matchups in weeks 5–14, so they are left out of the odds."]);
    // A week whose only undecided entries are byes has no game to play either.
    const byes = league({ T: 4, currentWeek: 4, schedule: [...decided, open(5, 1, null), open(5, 2, null)] });
    expect(oddsSkippedWarning(byes.snapshot, byes.model)).toBe("The schedule has no matchups for the rest of the regular season (weeks 6–14), so the playoff odds are left out; refresh to try again.");
    // Every remaining week scored (the regular season really over, the current week its last): simulated.
    const over = league({ T: 4, currentWeek: 4, schedule: decided, regular: range(1, 4), playoffs: [5, 6] });
    expect(oddsSkippedWarning(over.snapshot, over.model)).toBeNull();
    expect(setupOf(over).regularSeasonOver).toBe(true);
  });

  it("a multi-week matchup (ESPN) sums its weeks; once under way, only its weeks still to play are drawn, with a note", () => {
    const pair = (week: number, weeks: number[], decided: boolean): Matchup[] =>
      decided ? [done(week, 1, 2, "a", { weeks }), done(week, 3, 4, "a", { weeks })] : [open(week, 1, 2, { weeks }), open(week, 3, 4, { weeks })];
    const schedule = [...pair(1, [1], true), ...pair(2, [2, 3], false)];
    const before = setupOf(league({ T: 4, currentWeek: 2, schedule, regular: range(1, 3), playoffs: [4, 5] }));
    expect(before.setup.games).toEqual([
      { weeks: [2, 3], a: 0, b: 1 },
      { weeks: [2, 3], a: 2, b: 3 },
    ]);
    expect(before.setup.weeks).toEqual([2, 3, 4, 5]);
    expect(before.notes.some((n) => n.includes("under way"))).toBe(false);
    const during = league({ T: 4, currentWeek: 3, schedule, regular: range(1, 3), playoffs: [4, 5] });
    const built = setupOf(during);
    expect(built.setup.games[0]).toEqual({ weeks: [2, 3], a: 0, b: 1 });
    expect(built.setup.weeks).toEqual([3, 4, 5]);
    expect(built.notes).toContain("The matchups of weeks 2–3 are under way: only their weeks still to play are simulated (the points already scored aren't read).");
    expect(built.warnings).toEqual([]);
    const odds = oddsOf(during);
    // The game shows in its first simulated week.
    expect(odds.weekly.map((w) => w.week)).toEqual([3]);
    expect(odds.weekly[0]?.games.map((g) => [g.teamId, g.opponentId])).toEqual([
      ["1", "2"],
      ["2", "1"],
      ["3", "4"],
      ["4", "3"],
    ]);
  });

  it("points-only leagues draw every remaining regular week (points for accrue weekly), games or not", () => {
    const x = league({ T: 4, currentWeek: 5, schedule: [], regular: range(1, 8), playoffs: [9, 10], settings: { pointsOnly: true }, records: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]] });
    const built = setupOf(x);
    expect(built.setup.weeks).toEqual([5, 6, 7, 8, 9, 10]);
    expect(built.setup.pointsOnly).toBe(true);
    expect(built.notes[0]).toBe("Standings go by points for (a points-only league).");
    const odds = oddsOf(x);
    expect(sum(odds.teams.map((t) => t.pPlayoffs))).toBeCloseTo(4, 12);
    expect(odds.teams.every((t) => t.expWins === 0 && t.expLosses === 0)).toBe(true);
  });

  it("the regular season is over once all its games are decided, even while the current week is still the last regular week (before the platform's rollover)", () => {
    // Week 14's games are all decided on the Tuesday after it, with week 14 still the current (and in-progress) week.
    const records: [number, number, number][] = [
      [12, 2, 0],
      [9, 5, 0],
      [5, 9, 0],
      [2, 12, 0],
    ];
    const x = league({ T: 4, currentWeek: 14, schedule: roundRobin(4, range(1, 14), 15), playoffTeams: 2, records, inProgressWeek: 14 });
    expect(x.model.regularWeeks).toEqual([14]);
    const built = setupOf(x);
    expect(built.regularSeasonOver).toBe(true);
    expect(built.setup.games).toEqual([]);
    expect(built.setup.weeks).toEqual([15, 16, 17]);
    expect(built.notes).toContain("The regular season is over: the standings are final, and only the playoffs are simulated.");
    expect(built.notes.some((n) => n.startsWith("Week 14 is under way"))).toBe(false);
    const odds = oddsOf(x);
    expect(odds.teams.map((t) => t.pPlayoffs)).toEqual([1, 1, 0, 0]);
    expect(odds.teams.map((t) => t.eliminated)).toEqual([false, false, true, true]);
    // One of week 14's games not decided yet: not over. Teams 3 and 4 are out all the same: at best 6–8 and 3–11,
    // behind teams 1 and 2's final 12–2 and 9–5 with 2 playoff spots (the records alone rule them out, SPEC-3).
    const late = league({ T: 4, currentWeek: 14, schedule: roundRobin(4, range(1, 14), 15).map((m, i, all) => (i === all.length - 1 ? open(14, Number(m.teamA), Number(m.teamB)) : m)), playoffTeams: 2, records: [[12, 2, 0], [9, 5, 0], [5, 8, 0], [2, 11, 0]] });
    expect(setupOf(late).regularSeasonOver).toBe(false);
    expect(oddsOf(late).teams.map((t) => t.eliminated)).toEqual([false, false, true, true]);
    // Points-only: a remaining week whose matchups are all decided is in points for already, so it isn't
    // drawn again; a week still to score is.
    const pointsOnly = { settings: { pointsOnly: true }, records: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]] as [number, number, number][] };
    const over = setupOf(league({ T: 4, currentWeek: 14, schedule: roundRobin(4, range(1, 14), 15), ...pointsOnly }));
    expect(over.setup.weeks).toEqual([15, 16, 17]);
    expect(over.regularSeasonOver).toBe(true);
    const toScore = setupOf(league({ T: 4, currentWeek: 14, schedule: roundRobin(4, range(1, 14), 14), ...pointsOnly }));
    expect(toScore.setup.weeks).toEqual([14, 15, 16, 17]);
    expect(toScore.regularSeasonOver).toBe(false);
  });

  it("returns null when nothing is left to simulate", () => {
    // The season is over (no model weeks).
    const over = league({ T: 4, currentWeek: 18, schedule: roundRobin(4, range(1, 14), 15) });
    expect(over.model.weeks).toEqual([]);
    expect(buildSimSetup(over.snapshot, over.model)).toBeNull();
    // The last regular week decided, no playoffs.
    const x = league({ T: 4, currentWeek: 14, schedule: roundRobin(4, range(1, 14), 15), playoffs: [] });
    expect(x.model.weeks).toEqual([14]);
    expect(buildSimSetup(x.snapshot, x.model)).toBeNull();
    expect(seasonOdds(x.snapshot, x.model)).toBeNull();
    // sims below 1.
    const y = league({ T: 4, currentWeek: 4, schedule: roundRobin(4, range(1, 14), 4) });
    expect(seasonOdds(y.snapshot, y.model, { sims: 0 })).toBeNull();
  });
});

describe("buildSimSetup: playoffs and seeding rules (§8)", () => {
  it("groups playoff weeks into rounds by playoffRoundWeeks (one week each when absent)", () => {
    expect(playoffRounds({ playoffWeeks: [15, 16, 17] })).toEqual([{ weeks: [15] }, { weeks: [16] }, { weeks: [17] }]);
    expect(playoffRounds({ playoffWeeks: [15, 16, 17], playoffRoundWeeks: [1, 2] })).toEqual([{ weeks: [15] }, { weeks: [16, 17] }]);
    expect(playoffRounds({ playoffWeeks: [15, 16, 17, 18], playoffRoundWeeks: [2, 2] })).toEqual([{ weeks: [15, 16] }, { weeks: [17, 18] }]);
    // Weeks past the listed rounds are one round each; a last round the weeks run out on keeps what there is (capped at week 18).
    expect(playoffRounds({ playoffWeeks: [15, 16, 17], playoffRoundWeeks: [1] })).toEqual([{ weeks: [15] }, { weeks: [16] }, { weeks: [17] }]);
    expect(playoffRounds({ playoffWeeks: [17, 18], playoffRoundWeeks: [1, 2] })).toEqual([{ weeks: [17] }, { weeks: [18] }]);
    expect(playoffRounds({ playoffWeeks: [] })).toEqual([]);
  });

  it("byes are the bracket's own (next power of two − playoff teams): 6 → 2, 5 → 3, 7 → 1; a different listed number is noted", () => {
    const schedule = roundRobin(8, range(1, 14), 4);
    for (const [teams, byes] of [
      [6, 2],
      [5, 3],
      [7, 1],
      [8, 0],
    ] as const) {
      const x = league({ T: 8, currentWeek: 4, schedule, playoffTeams: teams });
      const odds = oddsOf(x);
      expect(odds.byes, `${teams} teams`).toBe(byes);
      expect(odds.playoffTeams).toBe(teams);
      if (byes > 0) expect(sum(odds.teams.map((t) => t.pBye as number)), `${teams} teams`).toBeCloseTo(byes, 12);
      else expect(odds.teams.every((t) => t.pBye === null)).toBe(true);
      expect(sum(odds.teams.map((t) => t.pPlayoffs))).toBeCloseTo(teams, 12);
      expect(sum(odds.teams.map((t) => t.pTitle as number))).toBeCloseTo(1, 12);
    }
    const listed = league({ T: 8, currentWeek: 4, schedule, playoffTeams: 6, settings: { playoffByes: 1 } });
    expect(setupOf(listed).notes).toContain("The league lists 1 bye, but a bracket of 6 teams has 2; the odds use 2.");
    expect(oddsOf(listed).byes).toBe(2);
  });

  it("fewer playoff rounds than the bracket needs: playoff and bye odds, title odds unknown (null), with a note", () => {
    const x = league({ T: 8, currentWeek: 4, schedule: roundRobin(8, range(1, 14), 4), playoffTeams: 8, playoffs: [15, 16] });
    const odds = oddsOf(x);
    expect(odds.notes).toContain("The playoff schedule has fewer rounds than a bracket of 8 teams needs, so title odds are unknown.");
    expect(odds.teams.every((t) => t.pTitle === null)).toBe(true);
    expect(odds.playoffsKnown).toBe(true);
    expect(sum(odds.teams.map((t) => t.pPlayoffs))).toBeCloseTo(8, 12);
  });

  it("the tiebreaker is the league's (a note says so), else points for, said to be assumed; the bracket, byes and division rules likewise", () => {
    const schedule = roundRobin(8, range(1, 14), 4);
    const known = oddsOf(league({ T: 8, currentWeek: 4, schedule, playoffTeams: 6, settings: { seedingTiebreaker: "headToHead" } }));
    expect(known.tiebreaker).toEqual({ rule: "headToHead", assumed: false });
    expect(known.reseed).toEqual({ value: false, assumed: false });
    expect(known.notes).toEqual([
      "Odds from 400 simulated seasons.",
      "Ties in the standings go to head-to-head record, the league's rule.",
      "The playoff bracket is fixed: no re-seeding after each round.",
      "The top 2 seeds get a first-round bye.",
    ]);
    const unknown = league({ T: 8, currentWeek: 4, schedule, playoffTeams: 6 });
    delete unknown.snapshot.settings.seedingTiebreaker;
    delete unknown.snapshot.settings.playoffSeeding;
    unknown.snapshot.settings.divisions = [
      { id: "a", teamIds: ["1", "2", "3", "4"] },
      { id: "b", teamIds: ["5", "6", "7", "8"] },
    ];
    const built = setupOf(unknown);
    expect(built).toMatchObject({ tiebreakerAssumed: true, reseedAssumed: true });
    expect(built.setup).toMatchObject({ tiebreaker: "pointsFor", reseed: false, divisionWinnersFirst: false });
    expect(built.setup.teams.map((t) => t.division)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(built.notes).toEqual([
      "Ties in the standings go to points for (assumed: the league doesn't say).",
      "Division winners aren't seeded first (assumed: the league doesn't say).",
      "The playoff bracket is fixed: no re-seeding after each round (assumed: the league doesn't say).",
      "The top 2 seeds get a first-round bye.",
    ]);
    const odds = oddsOf(unknown);
    expect(odds.tiebreaker).toEqual({ rule: "pointsFor", assumed: true });
    expect(odds.reseed).toEqual({ value: false, assumed: true });
    // Re-seeding and division winners first, as reported (Sleeper).
    const sleeper = league({ T: 8, currentWeek: 4, schedule, playoffTeams: 6, settings: { playoffSeeding: { reseed: true, divisionWinnersFirst: true }, divisions: unknown.snapshot.settings.divisions } });
    expect(setupOf(sleeper).notes).toContain("Division winners get the top seeds.");
    expect(setupOf(sleeper).notes).toContain("The playoffs re-seed after each round: the best seed left plays the worst.");
    expect(setupOf(sleeper).setup).toMatchObject({ reseed: true, divisionWinnersFirst: true });
  });

  it("the division rule is said to be assumed only when the adapter assumes it (Sleeper documents only some layouts; ESPN's help center documents its rule), with re-seeding as reported", () => {
    // ESPN (Parker's league with two divisions): ESPN reports re-seeding, and its help center says division winners
    // always take the top seeds (the adapter's DIVISION_SEEDING_SOURCE): no assumption.
    const bundle = parkerBundle();
    const raw = bundle.league as { settings: { scheduleSettings: { divisions?: { id: number; size: number }[] } }; teams: { divisionId?: number }[] };
    raw.settings.scheduleSettings.divisions = [
      { id: 0, size: 5 },
      { id: 1, size: 5 },
    ];
    raw.teams.forEach((t, i) => (t.divisionId = i % 2));
    const espn = normalizeEspnLeague(bundle, { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW, swid: PARKER.swid }).snapshot;
    expect(espn.settings.divisions).toHaveLength(2);
    expect(espn.settings.playoffSeeding).toEqual({ reseed: false, divisionWinnersFirst: true });
    const e = setupOf(standIn(espn));
    expect(e).toMatchObject({ divisionRuleAssumed: false, reseedAssumed: false });
    expect(e.setup.divisionWinnersFirst).toBe(true);
    expect(e.notes).toContain("Division winners get the top seeds.");
    expect(e.notes).toContain("The playoff bracket is fixed: no re-seeding after each round.");
    // A snapshot an older ESPN adapter normalized carries its "division rule assumed" warning: still read as assumed.
    const older = setupOf(standIn({ ...espn, settings: { ...espn.settings, playoffSeeding: { reseed: false, divisionWinnersFirst: false } }, warnings: [...espn.warnings, { code: "ESPN_SEEDING_DIVISIONS_UNKNOWN", message: "…" }] }));
    expect(older.divisionRuleAssumed).toBe(true);
    expect(older.notes).toContain("Division winners aren't seeded first (assumed: the league doesn't say).");
    // Sleeper: division winners first is documented for 2 divisions in a 6-team playoff, inferred in a 4-team one.
    const sleeper = (playoffTeams: number) => {
      const t = loadTestLeague();
      Object.assign(t.league.settings, { divisions: 2, playoff_teams: playoffTeams });
      t.rosters.forEach((r: { roster_id: number; settings: { division?: number } }) => (r.settings.division = ((r.roster_id - 1) % 2) + 1));
      return setupOf(standIn(normalizeSleeperLeague(rawOf(t), { now: NOW, resolver: sleeperResolver(t.players) }).snapshot));
    };
    const inferred = sleeper(4);
    expect(inferred).toMatchObject({ divisionRuleAssumed: true, reseedAssumed: false });
    expect(inferred.notes).toContain("Division winners get the top seeds (assumed: the league doesn't say).");
    const documented = sleeper(6);
    expect(documented.divisionRuleAssumed).toBe(false);
    expect(documented.notes).toContain("Division winners get the top seeds.");
    // Another adapter's inferred reading of a different setting isn't read as the division rule.
    const other = standIn({ ...espn, warnings: espn.warnings.filter((w) => !DIVISION_RULE_ASSUMED.some((d) => d.code === w.code)).concat({ code: "SETTING_INFERRED", message: "…", platformPath: "settings.trade_deadline" }) });
    expect(setupOf(other).divisionRuleAssumed).toBe(false);
    expect(setupOf(other).notes).toContain("Division winners get the top seeds.");
  });

  it("the fixed bracket is said to be assumed when the league doesn't give its re-seeding, even when the division rule sets playoffSeeding (final gate: reviews ADAPT-1, ADAPT-3)", () => {
    const BRACKET = "The playoff bracket is fixed: no re-seeding after each round";
    // Sleeper without playoff_seed_type, 2 divisions in a 6-team playoff (the documented division rule).
    const sleeper = (seedType: number | undefined, divisions = 2) => {
      const t = loadTestLeague();
      if (seedType === undefined) delete t.league.settings.playoff_seed_type;
      else t.league.settings.playoff_seed_type = seedType;
      Object.assign(t.league.settings, { divisions, playoff_teams: 6 });
      if (divisions > 0) t.rosters.forEach((r: { roster_id: number; settings: { division?: number } }) => (r.settings.division = ((r.roster_id - 1) % divisions) + 1));
      return normalizeSleeperLeague(rawOf(t), { now: NOW, resolver: sleeperResolver(t.players) }).snapshot;
    };
    const missing = sleeper(undefined);
    expect(missing.settings.playoffSeeding).toEqual({ reseed: false, divisionWinnersFirst: true });
    expect(missing.warnings.some((w) => RESEED_RULE_ASSUMED.some((d) => d.code === w.code && d.platformPath === w.platformPath))).toBe(true);
    expect(reseedRuleAssumed(missing)).toBe(true);
    const m = setupOf(standIn(missing));
    expect(m).toMatchObject({ reseedAssumed: true, divisionRuleAssumed: false });
    expect(m.notes).toContain("Division winners get the top seeds.");
    expect(m.notes).toContain(`${BRACKET} (assumed: the league doesn't say).`);
    expect(oddsOf(standIn(missing), 50).reseed).toEqual({ value: false, assumed: true });
    // A seed type Sleeper documents isn't assumed; one we don't know is.
    expect(setupOf(standIn(sleeper(0))).reseedAssumed).toBe(false);
    expect(setupOf(standIn(sleeper(1))).reseedAssumed).toBe(false);
    const unknownCode = sleeper(4, 0);
    expect(unknownCode.settings.playoffSeeding).toEqual({ reseed: false, divisionWinnersFirst: false });
    expect(setupOf(standIn(unknownCode)).notes).toContain(`${BRACKET} (assumed: the league doesn't say).`);
    // ESPN without playoffReseed, 2 divisions: division winners first is ESPN's documented rule; the re-seeding is unknown.
    const bundle = parkerBundle();
    const raw = bundle.league as { settings: { scheduleSettings: { divisions?: { id: number; size: number }[]; playoffReseed?: boolean } }; teams: { divisionId?: number }[] };
    raw.settings.scheduleSettings.divisions = [
      { id: 0, size: 5 },
      { id: 1, size: 5 },
    ];
    raw.teams.forEach((t, i) => (t.divisionId = i % 2));
    delete raw.settings.scheduleSettings.playoffReseed;
    const espn = normalizeEspnLeague(bundle, { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW, swid: PARKER.swid }).snapshot;
    expect(espn.settings.playoffSeeding).toEqual({ reseed: false, divisionWinnersFirst: true });
    expect(espn.settings.unknownSettings).toContain("playoffSeeding");
    const e = setupOf(standIn(espn));
    expect(e).toMatchObject({ reseedAssumed: true, divisionRuleAssumed: false });
    expect(e.notes).toContain("Division winners get the top seeds.");
    expect(e.notes).toContain(`${BRACKET} (assumed: the league doesn't say).`);
    // The ESPN warning alone (a snapshot without unknownSettings) still reads as assumed.
    expect(reseedRuleAssumed({ ...espn, settings: { ...espn.settings, unknownSettings: [] } })).toBe(true);
  });

  it("median leagues: each remaining week is a median week; a note says so", () => {
    const x = league({ T: 4, currentWeek: 4, schedule: roundRobin(4, range(1, 6), 4), regular: range(1, 6), playoffs: [7, 8], settings: { medianGame: true } });
    const built = setupOf(x);
    expect(built.setup.medianWeeks).toEqual([4, 5, 6]);
    expect(built.notes).toContain("Every week each team also plays the league median: the top half of the week's scores win.");
    const odds = oddsOf(x);
    for (const wk of odds.weekly) {
      expect(wk.games).toHaveLength(4);
      expect(sum(wk.games.map((g) => g.pMedianWin as number))).toBeCloseTo(2, 12); // the top half of 4 win
      expect(sum(wk.games.map((g) => g.pWin as number))).toBeCloseTo(2, 12);
    }
    // Final records: 3 decided games and 3 median games, plus 3 games and 3 median games to play.
    for (const t of odds.teams) expect(t.expWins + t.expLosses + t.expTies).toBeCloseTo(12, 12);
  });

  it("a week in progress is played in full from projections, with a note that says today's rosters and injury news are in it (D6; review SEASON-1)", () => {
    const x = league({ T: 4, currentWeek: 4, schedule: roundRobin(4, range(1, 6), 4), regular: range(1, 6), playoffs: [7, 8], inProgressWeek: 4 });
    const note = "Week 4 is under way: live scores aren't read yet, so all its games are simulated from projections as if none had started, with today's rosters and injury news.";
    expect(weekUnderWayNote(4)).toBe(note);
    expect(setupOf(x).notes).toContain(note);
    // It no longer claims the week is simulated "from pre-game projections": the tags and rosters aren't the ones at kickoff.
    expect(setupOf(x).notes.some((n) => n.includes("pre-game"))).toBe(false);
    expect(setupOf(x).setup.weeks[0]).toBe(4);
  });
});

describe("the playoffs under way (§8: regular season over, only the playoffs simulated)", () => {
  // 8 teams, regular season 1–14 over: team i + 1 finished 14 − i … (team 1 best), 6 make it, 2 byes.
  const records: [number, number, number][] = range(0, 7).map((i) => [13 - i, 1 + i, 0]);

  it("Sleeper-style (playoff matchups not imported): a round already played makes bye and title odds unknown (null), with a note", () => {
    const x = league({ T: 8, currentWeek: 16, schedule: roundRobin(8, range(1, 14), 15), playoffTeams: 6, records });
    const built = setupOf(x);
    expect(built.regularSeasonOver).toBe(true);
    expect(built.notes).toContain("The regular season is over: the standings are final, and only the playoffs are simulated.");
    expect(built.setup.games).toEqual([]);
    expect(built.setup.weeks).toEqual([16, 17]);
    const odds = oddsOf(x);
    expect(odds.playoffsKnown).toBe(false);
    expect(odds.teams.every((t) => t.pBye === null && t.pTitle === null)).toBe(true);
    expect(odds.teams.map((t) => t.pPlayoffs)).toEqual([1, 1, 1, 1, 1, 1, 0, 0]);
    expect(odds.notes).toContain("Some playoff games already played have no result we can match to the bracket, so bye and title odds are unknown.");
    expect(odds.weekly).toEqual([]);
    // The two teams out of the playoffs are certainly out; nobody else is known to be.
    expect(odds.teams.map((t) => t.eliminated)).toEqual([false, false, false, false, false, false, true, true]);
  });

  it("ESPN-style: finished playoff games are replayed and their losers are out; a finished one without a readable winner makes the playoffs unknown", () => {
    const playoff = (a: number, b: number, winner: number | null): Matchup => ({
      week: 15,
      teamA: String(a),
      teamB: String(b),
      isPlayoff: true,
      decided: true,
      ...(winner === null ? {} : { result: { pointsA: 1, pointsB: 0, winnerId: String(winner) } }),
    });
    // Round 1 (week 15): 3 vs 6 and 4 vs 5 (seeds = team numbers); 6 and 4 won.
    const schedule = [...roundRobin(8, range(1, 14), 15), playoff(3, 6, 6), playoff(4, 5, 4)];
    const x = league({ T: 8, currentWeek: 16, schedule, playoffTeams: 6, records });
    const built = setupOf(x);
    expect(built.setup.playoffResults).toEqual([
      { a: 2, b: 5, winner: 5 },
      { a: 3, b: 4, winner: 3 },
    ]);
    const odds = oddsOf(x, 2000);
    expect(odds.playoffsKnown).toBe(true);
    expect(sum(odds.teams.map((t) => t.pTitle as number))).toBeCloseTo(1, 12);
    expect(odds.teams.map((t) => t.pTitle === 0)).toEqual([false, false, true, false, true, false, true, true]);
    expect(odds.teams.map((t) => t.eliminated)).toEqual([false, false, true, false, true, false, true, true]);
    expect(odds.teams.map((t) => t.pBye)).toEqual([1, 1, 0, 0, 0, 0, 0, 0]);
    // One finished game without a winner we can read.
    const unread = league({ T: 8, currentWeek: 16, schedule: [...roundRobin(8, range(1, 14), 15), playoff(3, 6, 6), playoff(4, 5, null)], playoffTeams: 6, records });
    const u = setupOf(unread);
    expect(u.playoffsKnown).toBe(false);
    expect(u.warnings).toEqual(["1 finished playoff game has no winner we can read, so bye and title odds are unknown."]);
    const uo = oddsOf(unread);
    expect(uo.playoffsKnown).toBe(false);
    expect(uo.teams.every((t) => t.pTitle === null && t.pBye === null)).toBe(true);
  });

  it("checks the league's scheduled playoff games against our bracket: a pairing ours doesn't play makes bye and title odds unknown, with a warning (review SPEC-4)", () => {
    const scheduled = (week: number, a: number, b: number | null): Matchup => ({ week, teamA: String(a), teamB: b === null ? null : String(b), isPlayoff: true });
    const played = (week: number, a: number, b: number, winner: number): Matchup => ({ ...scheduled(week, a, b), decided: true, result: { pointsA: 1, pointsB: 0, winnerId: String(winner) } });
    const warning = "The league's playoff schedule pairs teams differently from the bracket built from its final standings (its seeding may differ from ours), so bye and title odds are unknown.";
    const at = (currentWeek: number, playoffs: Matchup[], settings: Partial<LeagueSettings> = {}) => league({ T: 8, currentWeek, schedule: [...roundRobin(8, range(1, 14), 15), ...playoffs], playoffTeams: 6, records, settings });
    // Our bracket (seeds = team numbers, fixed, 2 byes): 4 v 5 and 3 v 6 in week 15. The league scheduled 3 v 5 and 4 v 6.
    const other = at(15, [scheduled(15, 3, 5), scheduled(15, 4, 6), scheduled(15, 1, null), scheduled(15, 2, null)]);
    const built = setupOf(other);
    expect(built.warnings).toEqual([warning]);
    expect(built.playoffsKnown).toBe(false);
    const odds = oddsOf(other);
    expect(odds.playoffsKnown).toBe(false);
    expect(odds.teams.every((t) => t.pBye === null && t.pTitle === null)).toBe(true);
    expect(odds.notes).toContain(warning);
    // The same pairings as ours (home and away either way): nothing to say, the odds stand.
    const same = at(15, [scheduled(15, 6, 3), scheduled(15, 4, 5), scheduled(15, 1, null)]);
    expect(setupOf(same).warnings).toEqual([]);
    expect(oddsOf(same).playoffsKnown).toBe(true);
    expect(sum(oddsOf(same).teams.map((t) => t.pTitle as number))).toBeCloseTo(1, 12);
    // Round 2 (week 16) after round 1's results (6 beat 3, 4 beat 5): a fixed bracket plays 1 v 4 and 2 v 6; a league that
    // re-seeds plays 1 v 6 and 2 v 4, which our fixed bracket doesn't.
    const round1 = [played(15, 3, 6, 6), played(15, 4, 5, 4)];
    expect(setupOf(at(16, [...round1, scheduled(16, 1, 4), scheduled(16, 2, 6)])).playoffsKnown).toBe(true);
    const reseeded = setupOf(at(16, [...round1, scheduled(16, 1, 6), scheduled(16, 2, 4)]));
    expect(reseeded.playoffsKnown).toBe(false);
    expect(reseeded.warnings).toEqual([warning]);
    // …and with re-seeding reported, that is our bracket too.
    expect(setupOf(at(16, [...round1, scheduled(16, 1, 6), scheduled(16, 2, 4)], { playoffSeeding: { reseed: true, divisionWinnersFirst: false } })).playoffsKnown).toBe(true);
    // A seed we give a bye scheduled in round 1 is a different bracket too (the league has seed 2 play seed 7)…
    expect(setupOf(at(15, [scheduled(15, 4, 5), scheduled(15, 3, 6), scheduled(15, 2, 7)])).playoffsKnown).toBe(false);
    // …but a game between two teams outside our games of that round says nothing about them: the final (week 17) with a
    // third-place game between the semifinal losers listed next to it (after 1 beat 4 and 2 beat 6 in week 16).
    const round2 = [...round1, played(16, 1, 4, 1), played(16, 2, 6, 2)];
    const final = setupOf(at(17, [...round2, scheduled(17, 1, 2), scheduled(17, 4, 6)]));
    expect(final.warnings).toEqual([]);
    expect(final.playoffsKnown).toBe(true);
    expect(setupOf(at(17, [...round2, scheduled(17, 1, 6)])).playoffsKnown).toBe(false);
    // Before the standings are final our seeds aren't the league's yet: nothing to compare (week 14 still to play).
    const early = league({ T: 8, currentWeek: 14, schedule: [...roundRobin(8, range(1, 14), 14), scheduled(15, 3, 5), scheduled(15, 4, 6)], playoffTeams: 6, records: range(0, 7).map((i): [number, number, number] => [12 - i, 1 + i, 0]) });
    expect(setupOf(early).warnings).toEqual([]);
    expect(setupOf(early).playoffsKnown).toBe(true);
  });
});

describe("TeamOdds.eliminated: certainly out, never read off simulation counts", () => {
  const schedule = roundRobin(8, range(1, 14), 15);

  it("before the regular season ends, when the records alone rule a team out: six teams certain to finish with a better win percentage (review SPEC-3)", () => {
    // 8 teams, 6 spots, week 14 (the last regular week) still to play: team i + 1 is (13 − i)–i.
    const records = range(0, 7).map((i): [number, number, number] => [13 - i, i, 0]);
    const x = league({ T: 8, currentWeek: 14, schedule: roundRobin(8, range(1, 14), 14), playoffTeams: 6, records });
    const built = setupOf(x);
    expect(built.regularSeasonOver).toBe(false);
    expect(built.resultsLeft).toEqual(new Array(8).fill(1));
    const odds = oddsOf(x);
    // Team 8 (6–7) is 7–7 at best, while teams 1–6 finish 8–6 or better whatever happens: out, with the week still to
    // play (a deadline in week 13 comes before any regular season ends). Team 7 (7–6) can still tie team 6 at 8–6 on
    // win percentage: a tie at the cut is left to the tiebreakers, so it isn't out.
    expect(odds.teams.map((t) => t.eliminated)).toEqual([false, false, false, false, false, false, false, true]);
    expect(odds.teams[7]?.pPlayoffs).toBe(0);
    expect(odds.teams[6]?.pPlayoffs).toBeGreaterThan(0);
    // Checkpoint 7c (the review of the reward engine): the same bound as a place, TeamOdds.bestFinish, 1 + the teams certain
    // to finish ahead (two more wins than its best): eliminated is a best finish past the 6 spots.
    expect(odds.teams.map((t) => t.bestFinish)).toEqual([1, 1, 2, 3, 4, 5, 6, 7]);
    expect(odds.teams.map((t) => t.eliminated)).toEqual(odds.teams.map((t) => t.bestFinish > 6));
  });

  it("before the regular season ends: only on records certain to hold, never on an incomplete schedule, and a division title can still lift a team", () => {
    const records = range(0, 7).map((i): [number, number, number] => [13 - i, i, 0]);
    const at = (spec: Partial<Spec>) => oddsOf(league({ T: 8, currentWeek: 14, schedule: roundRobin(8, range(1, 14), 14), playoffTeams: 6, records, ...spec })).teams.map((t) => t.eliminated);
    // Two divisions, team 8 alone in its own: it could win it (division winners first), so it isn't certainly out.
    expect(at({ settings: { divisions: [{ id: "a", teamIds: ["1", "2", "3", "4", "5", "6", "7"] }, { id: "b", teamIds: ["8"] }] } })).toEqual(new Array(8).fill(false));
    // …and its best finish isn't bounded (Checkpoint 7c: TeamOdds.bestFinish 1, a division winner may be seeded first).
    const alone = oddsOf(league({ T: 8, currentWeek: 14, schedule: roundRobin(8, range(1, 14), 14), playoffTeams: 6, records, settings: { divisions: [{ id: "a", teamIds: ["1", "2", "3", "4", "5", "6", "7"] }, { id: "b", teamIds: ["8"] }] } }));
    expect(alone.teams[7]?.bestFinish).toBe(1);
    // …but with a division rival certain to finish ahead of it, it is.
    expect(at({ settings: { divisions: [{ id: "a", teamIds: ["1", "2", "3", "4"] }, { id: "b", teamIds: ["5", "6", "7", "8"] }] } })).toEqual([false, false, false, false, false, false, false, true]);
    // Two weeks left (13 and 14): team 8 (5–7 after 12) can reach 7–7, team 6 (7–5) can fall to 7–7: not certain.
    const twoLeft = league({ T: 8, currentWeek: 13, schedule: roundRobin(8, range(1, 14), 13), playoffTeams: 6, records: range(0, 7).map((i): [number, number, number] => [12 - i, i, 0]) });
    expect(setupOf(twoLeft).resultsLeft).toEqual(new Array(8).fill(2));
    expect(oddsOf(twoLeft).teams.every((t) => !t.eliminated)).toBe(true);
    // Median games are results still to come as well: two each (the game and the median game). Team 8 (12–14) is 14–14
    // at best, behind teams 1–6's worst (16–12 and up): out. Team 7 (14–12) can still tie team 6 at 16–12; counting
    // the game alone, team 7's best 15–12 would trail team 6's worst 16–11 and it would wrongly be out.
    const median = league({ T: 8, currentWeek: 14, schedule: roundRobin(8, range(1, 14), 14), playoffTeams: 6, settings: { medianGame: true }, records: range(0, 7).map((i): [number, number, number] => [26 - 2 * i, 2 * i, 0]) });
    expect(setupOf(median).resultsLeft).toEqual(new Array(8).fill(2));
    expect(oddsOf(median).teams.map((t) => t.eliminated)).toEqual([false, false, false, false, false, false, false, true]);
    // A finished week not scored yet (week 13) is still to come too: two results each, so nobody is certainly out.
    const unscored = league({ T: 8, currentWeek: 14, schedule: roundRobin(8, range(1, 14), 13), playoffTeams: 6, records: range(0, 7).map((i): [number, number, number] => [12 - i, i, 0]) });
    expect(setupOf(unscored).resultsLeft).toEqual(new Array(8).fill(2));
    expect(oddsOf(unscored).teams.every((t) => !t.eliminated)).toBe(true);
    // Not sure what's left, not sure who's out: a remaining week without matchups, a matchup we can't read, or
    // records that don't match the finished games.
    const noWeek14 = league({ T: 8, currentWeek: 13, regular: range(1, 14), schedule: roundRobin(8, range(1, 13), 13), playoffTeams: 6, records: range(0, 7).map((i): [number, number, number] => [12 - i, i, 0]) });
    expect(setupOf(noWeek14).resultsLeft).toBeNull();
    const unreadable = league({ T: 8, currentWeek: 14, schedule: [...roundRobin(8, range(1, 14), 14), open(14, 1, 9)], playoffTeams: 6, records });
    expect(setupOf(unreadable).resultsLeft).toBeNull();
    expect(oddsOf(unreadable).teams.every((t) => !t.eliminated)).toBe(true);
    const off = league({ T: 8, currentWeek: 14, schedule: roundRobin(8, range(1, 14), 14), playoffTeams: 6, records: records.map((r, i) => (i === 0 ? [12, 0, 0] : r)) });
    expect(setupOf(off).resultsLeft).toBeNull();
    expect(oddsOf(off).teams.every((t) => !t.eliminated)).toBe(true);
    // Points-only leagues wait for the end of the regular season: points for can't be bounded.
    const pointsOnly = league({ T: 8, currentWeek: 14, schedule: roundRobin(8, range(1, 14), 14), playoffTeams: 6, settings: { pointsOnly: true }, records: range(0, 7).map((): [number, number, number] => [0, 0, 0]), pointsFor: range(0, 7).map((i) => 2000 - 200 * i) });
    expect(setupOf(pointsOnly).resultsLeft).toBeNull();
    expect(oddsOf(pointsOnly).teams.every((t) => !t.eliminated)).toBe(true);
    expect(oddsOf(pointsOnly).teams.every((t) => t.bestFinish === 1)).toBe(true);
  });

  it("with the league's own rules known, the final standings decide (a tie on record broken by points for)", () => {
    // Teams 6 and 7 finish 7–7; team 6 has more points for, so team 7 is 7th and out.
    const records: [number, number, number][] = [
      [12, 2, 0],
      [11, 3, 0],
      [10, 4, 0],
      [9, 5, 0],
      [8, 6, 0],
      [7, 7, 0],
      [7, 7, 0],
      [2, 12, 0],
    ];
    const known = league({ T: 8, currentWeek: 15, schedule, playoffTeams: 6, records, pointsFor: [1, 1, 1, 1, 1, 1500, 1400, 1] });
    expect(oddsOf(known).teams.map((t) => t.eliminated)).toEqual([false, false, false, false, false, false, true, true]);
    // With the tiebreaker assumed, a team tied with the last playoff seed isn't certainly out; one behind six teams outright is.
    const assumed = league({ T: 8, currentWeek: 15, schedule, playoffTeams: 6, records, pointsFor: [1, 1, 1, 1, 1, 1500, 1400, 1] });
    delete assumed.snapshot.settings.seedingTiebreaker;
    expect(oddsOf(assumed).teams.map((t) => t.eliminated)).toEqual([false, false, false, false, false, false, false, true]);
    // With two divisions, a team must be out with division winners seeded first and without (no platform reports that
    // reliably): team 8, alone in its division, would take a seed as its winner; team 6 would lose its seed to team 8.
    const divisions = league({ T: 8, currentWeek: 15, schedule, playoffTeams: 6, records, settings: { divisions: [{ id: "a", teamIds: ["1", "2", "3", "4", "5", "6", "7"] }, { id: "b", teamIds: ["8"] }] } });
    expect(oddsOf(divisions).teams.map((t) => t.eliminated)).toEqual([false, false, false, false, false, false, true, false]);
    // …and with the tiebreaker assumed too, only a team a division rival outranks and six teams trail outright: nobody here.
    delete divisions.snapshot.settings.seedingTiebreaker;
    expect(oddsOf(divisions).teams.map((t) => t.eliminated)).toEqual([false, false, false, false, false, false, false, false]);
  });

  it("never hangs on a tiebreaker we reconstruct: head-to-head and division records (an unreadable meeting, espn-api's readings) or a tie on points for at the cut", () => {
    // 4 teams, 2 spots, the regular season over: team 1 is 8–6, teams 2 and 3 are 7–7 for the last spot.
    const records: [number, number, number][] = [
      [8, 6, 0],
      [7, 7, 0],
      [7, 7, 0],
      [0, 14, 0],
    ];
    const between = (m: Matchup, x: string, y: string) => (m.teamA === x && m.teamB === y) || (m.teamA === y && m.teamB === x);
    /** Every meeting of teams 2 and 3 decided with `winner` (a team, or "none": decided without a readable result). */
    const meetings = (winner: "2" | "none") => roundRobin(4, range(1, 14), 15).map((m) => (between(m, "2", "3") ? done(m.week, Number(m.teamA), Number(m.teamB), winner === "none" ? "none" : m.teamA === winner ? "a" : "b") : m));
    const at = (tiebreaker: LeagueSettings["seedingTiebreaker"], winner: "2" | "none", pointsFor = [1400, 1300, 1350, 900]) =>
      oddsOf(league({ T: 4, currentWeek: 15, schedule: meetings(winner), playoffTeams: 2, records, pointsFor, settings: { seedingTiebreaker: tiebreaker } }));
    // Head-to-head: team 2 won their meetings, but the results can't be read, so our standings put team 3
    // second on points for. Neither is certainly out: the league's own rule may seed team 2.
    const unread = at("headToHead", "none");
    expect(unread.teams.map((t) => t.rank)).toEqual([1, 3, 2, 4]);
    expect(unread.teams.map((t) => t.eliminated)).toEqual([false, false, false, true]);
    // Readable, team 2 is second by our reading of the rule (espn-api's, not seen live): still not proof for team 3.
    const read = at("headToHead", "2");
    expect(read.teams.map((t) => t.rank)).toEqual([1, 2, 3, 4]);
    expect(read.teams.map((t) => t.eliminated)).toEqual([false, false, false, true]);
    expect(at("divisionRecord", "2").teams.map((t) => t.eliminated)).toEqual([false, false, false, true]);
    // The league's own points-for rule decides on numbers the platform reports: team 2 is out…
    expect(at("pointsFor", "none").teams.map((t) => t.eliminated)).toEqual([false, true, false, true]);
    // …unless the two finish with exactly the same points for (then head-to-head, which we reconstruct).
    const level = at("pointsFor", "2", [1400, 1300, 1300, 900]);
    expect(level.teams.map((t) => t.rank)).toEqual([1, 2, 3, 4]);
    expect(level.teams.map((t) => t.eliminated)).toEqual([false, false, false, true]);
    // Points-only: a tie on points for at the cut is a coin flip (the team index stands in for it), not proof.
    const pointsOnly = (pointsFor: number[]) => oddsOf(league({ T: 4, currentWeek: 15, schedule: roundRobin(4, range(1, 14), 15), playoffTeams: 2, records: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], pointsFor, settings: { pointsOnly: true } }));
    expect(pointsOnly([1400, 1300, 1300, 900]).teams.map((t) => t.eliminated)).toEqual([false, false, false, true]);
    expect(pointsOnly([1400, 1300, 1350, 900]).teams.map((t) => t.eliminated)).toEqual([false, true, false, true]);
  });

  it("ranks teams by today's standings (the league's rules on current records)", () => {
    const x = league({ T: 4, currentWeek: 4, schedule: roundRobin(4, range(1, 14), 4), records: [[1, 2, 0], [3, 0, 0], [2, 1, 0], [0, 3, 0]] });
    const odds = oddsOf(x);
    expect(odds.teams.map((t) => t.rank)).toEqual([3, 1, 2, 4]);
    expect(standingsOrder(setupOf(x).setup)).toEqual([1, 2, 0, 3]);
  });
});

describe("seasonOdds: weekly matchups and determinism", () => {
  it("lists each remaining week's games: the opponent and win chance, a bye (no opponent, no chance), and median games", () => {
    // 3 teams: one has a bye each week.
    const schedule = [open(4, 1, 2), open(4, 3, null), open(5, 1, 3), open(5, 2, null)];
    const x = league({ T: 3, currentWeek: 4, schedule, regular: [4, 5], playoffs: [], playoffTeams: 0, records: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] });
    const odds = oddsOf(x, 1000);
    expect(odds.weekly.map((w) => w.week)).toEqual([4, 5]);
    const week4 = odds.weekly[0]?.games ?? [];
    expect(week4.map((g) => [g.teamId, g.opponentId])).toEqual([
      ["1", "2"],
      ["2", "1"],
      ["3", null],
    ]);
    expect((week4[0]?.pWin as number) + (week4[1]?.pWin as number)).toBeCloseTo(1, 12);
    expect(week4[2]).toEqual({ teamId: "3", opponentId: null, pWin: null, pMedianWin: null });
    // A median league: the bye team still plays the median.
    const median = league({ T: 3, currentWeek: 4, schedule, regular: [4, 5], playoffs: [], playoffTeams: 0, records: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], settings: { medianGame: true } });
    const m4 = oddsOf(median, 1000).weekly[0]?.games ?? [];
    expect(m4[2]?.opponentId).toBeNull();
    expect(m4[2]?.pWin).toBeNull();
    expect(m4[2]?.pMedianWin).toBeGreaterThan(0);
    expect(sum(m4.map((g) => g.pMedianWin as number))).toBeCloseTo(1, 12); // ⌊3/2⌋ = 1 winner a week
    // No playoffs: the title goes to the top of the final standings.
    expect(odds.notes).toContain("No playoffs: the title goes to the top of the final standings.");
    expect(sum(odds.teams.map((t) => t.pTitle as number))).toBeCloseTo(1, 12);
  });

  it("is deterministic, and shares a common-random-numbers matrix when given one (a no-op change moves nothing)", () => {
    const x = league({ T: 8, currentWeek: 4, schedule: roundRobin(8, range(1, 14), 4), playoffTeams: 6 });
    const a = seasonOdds(x.snapshot, x.model, { sims: 500, seed: 11 });
    expect(seasonOdds(x.snapshot, x.model, { sims: 500, seed: 11 })).toEqual(a);
    const built = setupOf(x);
    const normals = simNormals(11, 500, built.setup.weeks.length, built.setup.teams.length);
    expect(seasonOdds(x.snapshot, x.model, { sims: 500, seed: 11, normals })).toEqual(a);
    expect(seasonOdds(x.snapshot, x.model, { sims: 500, seed: 12 })).not.toEqual(a);
    // A better team 1 (its weekly mean + 10) on the same matrix: its odds rise.
    const better = { ...x.model, teams: x.model.teams.map((t, i) => (i === 0 ? { ...t, score: { ...t.score, mean: t.score.mean.map((v) => v + 10) } } : t)) };
    const b = seasonOdds(x.snapshot, better, { sims: 500, seed: 11, normals });
    expect(b?.teams[0]?.pPlayoffs).toBeGreaterThan(a?.teams[0]?.pPlayoffs as number);
    expect(b?.teams[0]?.expWins).toBeGreaterThan(a?.teams[0]?.expWins as number);
  });

  it("pickupSeasonModel: every team's scoreWithPickups as its score, the same weeks; a team without one keeps its own (a model from before Phase 4c)", () => {
    const x = league({ T: 4, currentWeek: 4, schedule: roundRobin(4, range(1, 14), 4) });
    const up = (t: { score: { mean: number[]; sd: number[] } }) => ({ mean: t.score.mean.map((v) => v + 5), sd: t.score.sd });
    const teams = x.model.teams.map((t, i) => (i === 3 ? { ...t } : { ...t, scoreWithPickups: up(t) }));
    const m = pickupSeasonModel({ ...x.model, teams });
    expect([m.weeks, m.regularWeeks, m.playoffWeeks, m.inProgressWeek]).toEqual([x.model.weeks, x.model.regularWeeks, x.model.playoffWeeks, x.model.inProgressWeek]);
    expect(m.teams.map((t) => t.id)).toEqual(["1", "2", "3", "4"]);
    m.teams.forEach((t, i) => expect(t.score, t.id).toEqual(i === 3 ? x.model.teams[3]?.score : up(x.model.teams[i] as { score: { mean: number[]; sd: number[] } })));
    // Simulated on the same seasons, the three teams' pickups lift them and push team 4 down.
    const a = seasonOdds(x.snapshot, x.model, { sims: 500, seed: 11 });
    const b = seasonOdds(x.snapshot, m, { sims: 500, seed: 11 });
    expect(b?.teams[3]?.expWins).toBeLessThan(a?.teams[3]?.expWins as number);
    expect(b?.teams[3]?.pTitle).toBeLessThan(a?.teams[3]?.pTitle as number);
  });

  it("Checkpoint 7c: 2nd and 3rd place, high scores and the points leader in TeamOdds; 2nd and 3rd unknown (null) with the title, whether the simulator or season.ts makes it unknown", () => {
    const x = league({ T: 8, currentWeek: 4, schedule: roundRobin(8, range(1, 14), 4), playoffTeams: 6 });
    const odds = oddsOf(x, 1000);
    expect(sum(odds.teams.map((t) => t.pSecond as number))).toBeCloseTo(1, 12);
    expect(sum(odds.teams.map((t) => t.pThird as number))).toBeCloseTo(1, 12);
    expect(sum(odds.teams.map((t) => t.pPointsLeader))).toBeCloseTo(1, 12);
    for (const t of odds.teams) {
      expect(t.pSecond as number, t.teamId).toBeGreaterThanOrEqual(0);
      expect((t.pTitle as number) + (t.pSecond as number) + (t.pThird as number), t.teamId).toBeLessThanOrEqual(t.pPlayoffs + 1e-12);
      expect(t.expHighScores).toBe(0); // no periods unless asked
    }
    expect(odds.highScorePeriods).toBe(0);
    // A round already played without a result (Sleeper-style): the title, 2nd and 3rd unknown; the regular season's numbers stand.
    const records = range(0, 7).map((i): [number, number, number] => [13 - i, 1 + i, 0]);
    const unknown = oddsOf(league({ T: 8, currentWeek: 16, schedule: roundRobin(8, range(1, 14), 15), playoffTeams: 6, records }));
    expect(unknown.playoffsKnown).toBe(false);
    expect(unknown.teams.every((t) => t.pTitle === null && t.pSecond === null && t.pThird === null)).toBe(true);
    expect(sum(unknown.teams.map((t) => t.pPointsLeader))).toBeCloseTo(1, 12);
    // The league's own playoff schedule pairs teams differently from our bracket (review SPEC-4's case: round 1 listed as
    // 3 v 5 and 4 v 6, ours 4 v 5 and 3 v 6). Here season.ts makes the playoffs unknown while the simulator itself knows
    // them, so its guard is what makes 2nd and 3rd null with the title.
    const listed = (a: number, b: number): Matchup => ({ week: 15, teamA: String(a), teamB: String(b), isPlayoff: true });
    const other = league({ T: 8, currentWeek: 15, schedule: [...roundRobin(8, range(1, 14), 15), listed(3, 5), listed(4, 6)], playoffTeams: 6, records });
    const built = setupOf(other);
    expect(built.playoffsKnown).toBe(false);
    const own = simulateSeason(built.setup, { sims: 400, seed: 7 });
    expect([own.playoffsKnown, own.thirdKnown]).toEqual([true, true]);
    expect(own.teams.every((t) => Number.isFinite(t.pSecond) && Number.isFinite(t.pThird))).toBe(true);
    const mismatch = oddsOf(other);
    expect(mismatch.playoffsKnown).toBe(false);
    expect(mismatch.teams.every((t) => t.pTitle === null && t.pSecond === null && t.pThird === null)).toBe(true);
    // No playoffs: places by the final standings (3 teams: every one of the three).
    const none = oddsOf(league({ T: 3, currentWeek: 4, schedule: [open(4, 1, 2), open(4, 3, null), open(5, 1, 3), open(5, 2, null)], regular: [4, 5], playoffs: [], playoffTeams: 0, records: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] }), 1000);
    for (const t of none.teams) expect((t.pTitle as number) + (t.pSecond as number) + (t.pThird as number), t.teamId).toBeCloseTo(1, 12);
  });

  it("Checkpoint 7c: the 3rd-place rule from settings.thirdPlace: a game, none (the better seed, ⚠️ ours), or absent (a game, assumed, and no note: the Import Report says it)", () => {
    const x = league({ T: 8, currentWeek: 4, schedule: roundRobin(8, range(1, 14), 4), playoffTeams: 6 });
    expect(x.snapshot.settings.thirdPlace).toBeUndefined();
    const assumed = setupOf(x);
    expect(assumed.thirdPlace).toEqual({ rule: "game", assumed: true });
    expect(assumed.setup.thirdPlace).toBe("game");
    const base = oddsOf(x, 1000);
    expect(base.thirdPlace).toEqual({ rule: "game", assumed: true });
    expect(base.notes.some((n) => /3rd/.test(n))).toBe(false);
    const withThird = (thirdPlace: LeagueSettings["thirdPlace"]) => {
      const y = league({ T: 8, currentWeek: 4, schedule: roundRobin(8, range(1, 14), 4), playoffTeams: 6, settings: { thirdPlace } });
      return { built: setupOf(y), odds: oddsOf(y, 1000) };
    };
    const game = withThird({ game: true, basis: "schedule" });
    expect(game.built.thirdPlace).toEqual({ rule: "game", assumed: false });
    expect(game.odds.thirdPlace).toEqual({ rule: "game", assumed: false });
    // The same seasons as the assumed game: only `assumed` differs.
    expect({ ...game.odds, thirdPlace: base.thirdPlace }).toEqual(base);
    const none = withThird({ game: false, basis: "bracket" });
    expect(none.built.setup.thirdPlace).toBe("bySeed");
    expect(none.odds.thirdPlace).toEqual({ rule: "bySeed", assumed: false });
    // Only 3rd place moves: the title and 2nd are the same seasons' numbers.
    expect(none.odds.teams.map((t) => [t.pTitle, t.pSecond])).toEqual(base.teams.map((t) => [t.pTitle, t.pSecond]));
    expect(none.odds.teams.map((t) => t.pThird)).not.toEqual(base.teams.map((t) => t.pThird));
    expect(sum(none.odds.teams.map((t) => t.pThird as number))).toBeCloseTo(1, 12);
  });

  it("Checkpoint 7c: high-score periods only when asked: each remaining matchup period with a game once, a matchup period of several weeks as one, a points-only league each regular week still to score", () => {
    const x = league({ T: 4, currentWeek: 4, schedule: roundRobin(4, range(1, 6), 4), regular: range(1, 6), playoffs: [7, 8] });
    const plain = setupOf(x);
    expect(plain.setup.highScorePeriods).toBeUndefined();
    const asked = buildSimSetup(x.snapshot, x.model, { highScores: true }) as NonNullable<ReturnType<typeof buildSimSetup>>;
    expect(asked.setup.highScorePeriods).toEqual([[4], [5], [6]]);
    // They add no drawn week, and change no other number: the same setup otherwise, the same odds but for the high scores.
    expect({ ...asked.setup, highScorePeriods: undefined }).toEqual({ ...plain.setup, highScorePeriods: undefined });
    const odds = seasonOdds(x.snapshot, x.model, { sims: 1000, seed: 7, highScores: true }) as NonNullable<ReturnType<typeof seasonOdds>>;
    expect(odds.highScorePeriods).toBe(3);
    expect(sum(odds.teams.map((t) => t.expHighScores))).toBeCloseTo(3, 12);
    expect(odds.teams.every((t) => t.expHighScores > 0)).toBe(true);
    expect({ ...odds, highScorePeriods: 0, teams: odds.teams.map((t) => ({ ...t, expHighScores: 0 })) }).toEqual(oddsOf(x, 1000));
    // A matchup period of two weeks (ESPN), under way: one period, decided by its week still to play.
    const pair = (week: number, weeks: number[], decided: boolean): Matchup[] =>
      decided ? [done(week, 1, 2, "a", { weeks }), done(week, 3, 4, "a", { weeks })] : [open(week, 1, 2, { weeks }), open(week, 3, 4, { weeks })];
    const during = league({ T: 4, currentWeek: 3, schedule: [...pair(1, [1], true), ...pair(2, [2, 3], false)], regular: range(1, 3), playoffs: [4, 5] });
    const multi = buildSimSetup(during.snapshot, during.model, { highScores: true }) as NonNullable<ReturnType<typeof buildSimSetup>>;
    expect(multi.setup.highScorePeriods).toEqual([[2, 3]]);
    expect(multi.setup.weeks).toEqual([3, 4, 5]);
    expect(sum((seasonOdds(during.snapshot, during.model, { sims: 200, seed: 7, highScores: true }) as NonNullable<ReturnType<typeof seasonOdds>>).teams.map((t) => t.expHighScores))).toBeCloseTo(1, 12);
    // Byes don't make a period of their own, and a period counts once however many games it has (3 teams: a bye a week).
    const odd = league({ T: 3, currentWeek: 4, schedule: [open(4, 1, 2), open(4, 3, null), open(5, 1, 3), open(5, 2, null)], regular: [4, 5], playoffs: [], playoffTeams: 0, records: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] });
    expect(buildSimSetup(odd.snapshot, odd.model, { highScores: true })?.setup.highScorePeriods).toEqual([[4], [5]]);
    // Points-only: each regular week still to score, games or not.
    const zeros: [number, number, number][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const pointsOnly = league({ T: 4, currentWeek: 5, schedule: [], regular: range(1, 8), playoffs: [9, 10], settings: { pointsOnly: true }, records: zeros });
    expect(buildSimSetup(pointsOnly.snapshot, pointsOnly.model, { highScores: true })?.setup.highScorePeriods).toEqual([[5], [6], [7], [8]]);
    // …but not a week whose matchups are all decided (the current week scored, before the platform rolls over): its points
    // are in points for already, so it isn't drawn, and a period without a drawn week would make the simulator throw.
    const scored = league({ T: 4, currentWeek: 5, schedule: roundRobin(4, range(1, 8), 6), regular: range(1, 8), playoffs: [9, 10], settings: { pointsOnly: true }, records: zeros });
    const s = buildSimSetup(scored.snapshot, scored.model, { highScores: true }) as NonNullable<ReturnType<typeof buildSimSetup>>;
    expect(s.setup.weeks).toEqual([6, 7, 8, 9, 10]);
    expect(s.setup.highScorePeriods).toEqual([[6], [7], [8]]);
    const so = seasonOdds(scored.snapshot, scored.model, { sims: 200, seed: 7, highScores: true }) as NonNullable<ReturnType<typeof seasonOdds>>;
    expect(so.highScorePeriods).toBe(3);
    expect(sum(so.teams.map((t) => t.expHighScores))).toBeCloseTo(3, 12);
    // The regular season over: none left.
    const over = league({ T: 4, currentWeek: 15, schedule: roundRobin(4, range(1, 14), 15), records: [[11, 3, 0], [9, 5, 0], [5, 9, 0], [3, 11, 0]] });
    expect(buildSimSetup(over.snapshot, over.model, { highScores: true })?.setup.highScorePeriods).toEqual([]);
  });

  it("Checkpoint 7c (the review of the reward engine): SeasonOdds.regularLeft, the high-score periods and regular-season weeks a trade can still change, the week under way left out, simulated high scores or not", () => {
    const left = (x: { snapshot: LeagueSnapshot; model: SeasonModel }) => [setupOf(x).regularLeft, (seasonOdds(x.snapshot, x.model, { sims: 100, seed: 7, highScores: true }) as NonNullable<ReturnType<typeof seasonOdds>>).regularLeft];
    // Weeks 4–6 to play: three periods, three weeks, whether or not the high scores are simulated.
    const x = league({ T: 4, currentWeek: 4, schedule: roundRobin(4, range(1, 6), 4), regular: range(1, 6), playoffs: [7, 8] });
    expect(left(x)).toEqual([{ periods: 3, weeks: 3 }, { periods: 3, weeks: 3 }]);
    expect(oddsOf(x).regularLeft).toEqual({ periods: 3, weeks: 3 });
    // Week 4 under way: simulated, but no trade can change it.
    const live = league({ T: 4, currentWeek: 4, schedule: roundRobin(4, range(1, 6), 4), regular: range(1, 6), playoffs: [7, 8], inProgressWeek: 4 });
    expect(left(live)).toEqual([{ periods: 2, weeks: 2 }, { periods: 2, weeks: 2 }]);
    expect(setupOf(live).setup.weeks).toContain(4);
    // The last regular-season week under way: nothing in the regular season a trade can change.
    const last = league({ T: 4, currentWeek: 6, schedule: roundRobin(4, range(1, 6), 6), regular: range(1, 6), playoffs: [7, 8], inProgressWeek: 6 });
    expect(left(last)).toEqual([{ periods: 0, weeks: 0 }, { periods: 0, weeks: 0 }]);
    // A matchup period of two weeks whose first is under way: its second week can still be changed, so the period counts.
    const pair = (week: number, weeks: number[]): Matchup[] => [open(week, 1, 2, { weeks }), open(week, 3, 4, { weeks })];
    const twoWeeks = league({ T: 4, currentWeek: 2, schedule: [...pair(2, [2, 3]), ...pair(4, [4])], regular: range(1, 4), playoffs: [5, 6], inProgressWeek: 2 });
    expect(left(twoWeeks)).toEqual([{ periods: 2, weeks: 2 }, { periods: 2, weeks: 2 }]);
    // Points-only: each regular week still to score.
    const zeros: [number, number, number][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const pointsOnly = league({ T: 4, currentWeek: 5, schedule: [], regular: range(1, 8), playoffs: [9, 10], settings: { pointsOnly: true }, records: zeros, inProgressWeek: 5 });
    expect(left(pointsOnly)).toEqual([{ periods: 3, weeks: 3 }, { periods: 3, weeks: 3 }]);
    // The regular season over.
    const over = league({ T: 4, currentWeek: 15, schedule: roundRobin(4, range(1, 14), 15), records: [[11, 3, 0], [9, 5, 0], [5, 9, 0], [3, 11, 0]] });
    expect(left(over)).toEqual([{ periods: 0, weeks: 0 }, { periods: 0, weeks: 0 }]);
  });

  it("final review of Checkpoint 7c (ui-UI-7C-1): SeasonOdds.playoffLeft, the playoff weeks a trade can still change; a team that lost its semifinal plays for 3rd until the final round's week", () => {
    // Weeks 4–6 to play, playoffs in weeks 7 and 8: both left.
    const x = league({ T: 4, currentWeek: 4, schedule: roundRobin(4, range(1, 6), 4), regular: range(1, 6), playoffs: [7, 8] });
    expect([setupOf(x).playoffLeft, oddsOf(x).playoffLeft]).toEqual([{ weeks: 2 }, { weeks: 2 }]);
    // Seeds = team numbers after 14 weeks; semifinals in week 15 (1 v 4, 2 v 3): 4 and 2 won, so 1 and 3 play for 3rd in
    // week 16, the final's week (a game assumed: the league doesn't say).
    const semi = (a: number, b: number, winner: number): Matchup => ({ week: 15, teamA: String(a), teamB: String(b), isPlayoff: true, decided: true, result: { pointsA: winner === a ? 1 : 0, pointsB: winner === b ? 1 : 0, winnerId: String(winner) } });
    const spec = { T: 4, currentWeek: 16, schedule: [...roundRobin(4, range(1, 14), 15), semi(1, 4, 4), semi(2, 3, 2)], playoffs: [15, 16], records: [[11, 3, 0], [9, 5, 0], [5, 9, 0], [3, 11, 0]] as [number, number, number][] };
    const odds = oddsOf(league(spec));
    expect([odds.regularLeft, odds.playoffLeft]).toEqual([{ periods: 0, weeks: 0 }, { weeks: 1 }]);
    const [one, , three] = odds.teams as [TeamOdds, TeamOdds, TeamOdds, TeamOdds];
    expect([one.eliminated, three.eliminated]).toEqual([true, true]);
    expect(one.pThird).toBeGreaterThan(0.01);
    expect(one.pThird).toBeLessThan(0.99);
    expect((one.pThird as number) + (three.pThird as number)).toBeCloseTo(1, 12);
    const places = { shares: { first: 0.6, second: 0.3, third: 0.1, weeklyHigh: 0, pointsLeader: 0 } };
    expect(prizeStillMovable(places, odds, one)).toBe(true);
    expect(prizeStillMovable({ shares: TITLE_ONLY }, odds, one)).toBe(false);
    // The final round's week under way: simulated, but no trade can change it.
    const live = oddsOf(league({ ...spec, inProgressWeek: 16 }));
    expect(live.playoffLeft).toEqual({ weeks: 0 });
    expect(prizeStillMovable(places, live, live.teams[0] as TeamOdds)).toBe(false);
  });

  it("weekList names weeks plainly, runs of consecutive weeks as ranges", () => {
    expect(weekList([3])).toBe("week 3");
    expect(weekList([5, 3])).toBe("weeks 3 and 5");
    expect(weekList([3, 2, 3])).toBe("weeks 2 and 3");
    expect(weekList([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])).toBe("weeks 4–14");
    expect(weekList([3, 5, 6, 7, 9, 10])).toBe("weeks 3, 5–7, 9 and 10");
  });

  it("never hands the simulator a setup it refuses: 300 random league states (byes, multi-week matchups, unscored weeks, the current week already scored, medians, points-only, playoffs under way)", () => {
    const rand = mulberry32(20260930);
    for (let trial = 0; trial < 300; trial++) {
      const T = 3 + Math.floor(rand() * 10);
      const lastRegular = 6 + Math.floor(rand() * 9);
      const regular = range(1, lastRegular);
      const roundWeeks = rand() < 0.3 ? [1, 2] : undefined;
      const playoffs = rand() < 0.15 ? [] : range(lastRegular + 1, lastRegular + (roundWeeks ? 3 : 2 + Math.floor(rand() * 2)));
      const currentWeek = 1 + Math.floor(rand() * (lastRegular + playoffs.length + 1));
      // A finished week not scored yet (D5) in 20% of the trials; the current week already scored, before the platform
      // rolls over, in 10% (one draw for both, so the other trials stay as they were).
      const lag = rand();
      const decidedThrough = currentWeek - 1 - (lag < 0.2 ? 1 : 0) + (lag >= 0.9 ? 1 : 0);
      const multi = rand() < 0.2;
      const schedule: Matchup[] = [];
      for (let w = 1; w <= lastRegular; w++) {
        if (multi && w % 2 === 0) continue; // periods of two weeks: w − 1 and w
        const weeks = multi && w + 1 <= lastRegular ? [w, w + 1] : [w];
        const order = range(1, T).sort(() => rand() - 0.5);
        for (let i = 0; i + 1 < order.length; i += 2) {
          const a = order[i] as number;
          const b = order[i + 1] as number;
          const last = weeks.at(-1) as number;
          schedule.push(last <= decidedThrough ? done(w, a, b, rand() < 0.1 ? "none" : rand() < 0.5 ? "a" : "b", { weeks }) : open(w, a, b, { weeks }));
        }
        if (order.length % 2 === 1) schedule.push({ ...open(w, order.at(-1) as number, null, { weeks }), ...((weeks.at(-1) as number) <= decidedThrough ? { decided: true } : {}) });
      }
      const x = league({
        T,
        currentWeek,
        schedule,
        regular,
        playoffs,
        playoffTeams: Math.min(T, 2 + Math.floor(rand() * 6)),
        settings: { medianGame: rand() < 0.3, pointsOnly: rand() < 0.15, ...(roundWeeks ? { playoffRoundWeeks: roundWeeks } : {}) },
        inProgressWeek: rand() < 0.3 ? currentWeek : null,
        mean: (t, w) => 80 + ((t * 7 + w * 3) % 40),
        sd: (t) => 10 + t,
      });
      // Checkpoint 7c: high-score periods in every other trial (the simulator checks them like games).
      const highScores = trial % 2 === 0;
      let odds: ReturnType<typeof seasonOdds> = null;
      expect(() => {
        odds = seasonOdds(x.snapshot, x.model, { sims: 50, seed: trial, highScores });
      }, `trial ${trial}`).not.toThrow();
      if (!odds) continue;
      const o = odds as NonNullable<ReturnType<typeof seasonOdds>>;
      expect(sum(o.teams.map((t) => t.pPlayoffs)), `trial ${trial}`).toBeCloseTo(o.playoffTeams, 9);
      if (o.teams.every((t) => t.pTitle !== null)) {
        expect(sum(o.teams.map((t) => t.pTitle as number)), `trial ${trial}`).toBeCloseTo(1, 9);
        expect(sum(o.teams.map((t) => t.pSecond as number)), `trial ${trial}`).toBeCloseTo(1, 9);
      }
      if (o.teams.every((t) => t.pThird !== null)) expect(sum(o.teams.map((t) => t.pThird as number)), `trial ${trial}`).toBeCloseTo(1, 9); // T ≥ 3 here
      expect(sum(o.teams.map((t) => t.expHighScores)), `trial ${trial}`).toBeCloseTo(o.highScorePeriods, 9);
      if (!highScores) expect(o.highScorePeriods).toBe(0);
      expect(sum(o.teams.map((t) => t.pPointsLeader)), `trial ${trial}`).toBeCloseTo(1, 9);
      expect(o.teams.map((t) => t.rank).sort((p, q) => p - q), `trial ${trial}`).toEqual(range(1, T));
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe("Parker's league (committed sanitized ESPN fixture) with synthetic inputs", () => {
  const { snapshot } = normalizeEspnLeague(parkerBundle(), { leagueId: PARKER.leagueId, resolver: fakeResolver(), now: NOW, swid: PARKER.swid });
  const inputs = syntheticInputs(snapshot);
  const model = buildLeagueModel(snapshot, inputs, { now: NOW, scenarios: 8 });

  it("today's standings match ESPN's own order (its playoffSeed: win percentage, then points for)", () => {
    const raw = readEspn<{ teams: { id: number; playoffSeed: number }[] }>(LABELS.league);
    const espnOrder = [...raw.teams].sort((a, b) => a.playoffSeed - b.playoffSeed).map((t) => String(t.id));
    const built = buildSimSetup(snapshot, model);
    expect(built).not.toBeNull();
    const { setup, teamIds } = built as NonNullable<typeof built>;
    expect(standingsOrder(setup).map((t) => teamIds[t])).toEqual(espnOrder);
    expect(model.odds?.teams.map((t) => [t.teamId, t.rank])).toEqual(snapshot.teams.map((t) => [t.id, espnOrder.indexOf(t.id) + 1]));
  });

  it("simulates the rest of the season: weeks 4–14's games from the schedule, weeks 1–3 played, the 6-team bracket with 2 byes", () => {
    const built = buildSimSetup(snapshot, model) as NonNullable<ReturnType<typeof buildSimSetup>>;
    expect(built.setup.weeks).toEqual(range(4, 17));
    expect(built.setup.games).toHaveLength(55);
    expect(built.setup.played).toHaveLength(15);
    expect(built.warnings).toEqual([]);
    const odds = model.odds as NonNullable<typeof model.odds>;
    expect(odds).toMatchObject({ sims: config.simulation.finalSims, seed: config.simulation.seed, playoffTeams: 6, byes: 2, playoffsKnown: true, tiebreaker: { rule: "pointsFor", assumed: false }, reseed: { value: false, assumed: false } });
    expect(odds.notes).toEqual(["Odds from 5,000 simulated seasons.", "Ties in the standings go to points for, the league's rule.", "The playoff bracket is fixed: no re-seeding after each round.", "The top 2 seeds get a first-round bye."]);
  });

  it("Σ P(playoffs) = playoff teams, Σ P(bye) = byes, Σ P(title) = 1; records add up to 14 games", () => {
    const odds = model.odds as NonNullable<typeof model.odds>;
    expect(sum(odds.teams.map((t) => t.pPlayoffs))).toBeCloseTo(6, 9);
    expect(sum(odds.teams.map((t) => t.pBye as number))).toBeCloseTo(2, 9);
    expect(sum(odds.teams.map((t) => t.pTitle as number))).toBeCloseTo(1, 9);
    for (const t of odds.teams) {
      expect(t.expWins + t.expLosses + t.expTies).toBeCloseTo(14, 9);
      expect(sum(t.seedDist)).toBeCloseTo(1, 9);
      expect(t.pTitle as number).toBeLessThanOrEqual(t.pPlayoffs);
      expect(t.eliminated).toBe(false);
    }
    expect(odds.weekly.map((w) => w.week)).toEqual(range(4, 14));
    for (const w of odds.weekly) {
      expect(w.games).toHaveLength(10);
      expect(sum(w.games.map((g) => g.pWin as number))).toBeCloseTo(5, 9);
    }
  });

  it("Checkpoint 7c: Σ P(2nd) = Σ P(3rd) = Σ P(points leader) = 1, places 1–3 within the playoff teams; with the weekly high scores asked, 11 periods (weeks 4–14) and every other number the same", () => {
    const odds = model.odds as NonNullable<typeof model.odds>;
    expect(sum(odds.teams.map((t) => t.pSecond as number))).toBeCloseTo(1, 9);
    expect(sum(odds.teams.map((t) => t.pThird as number))).toBeCloseTo(1, 9);
    expect(sum(odds.teams.map((t) => t.pPointsLeader))).toBeCloseTo(1, 9);
    for (const t of odds.teams) expect((t.pTitle as number) + (t.pSecond as number) + (t.pThird as number), t.teamId).toBeLessThanOrEqual(t.pPlayoffs + 1e-9);
    // The rule as the adapter reads it (absent: a game, assumed).
    const third = snapshot.settings.thirdPlace;
    expect(odds.thirdPlace).toEqual({ rule: third?.game === false ? "bySeed" : "game", assumed: third === undefined });
    expect([odds.highScorePeriods, ...odds.teams.map((t) => t.expHighScores)]).toEqual(new Array(11).fill(0));
    const withHighs = seasonOdds(snapshot, pickupSeasonModel(model), { highScores: true }) as NonNullable<ReturnType<typeof seasonOdds>>;
    expect(withHighs.highScorePeriods).toBe(11);
    expect(sum(withHighs.teams.map((t) => t.expHighScores))).toBeCloseTo(11, 9);
    expect({ ...withHighs, highScorePeriods: 0, teams: withHighs.teams.map((t) => ({ ...t, expHighScores: 0 })) }).toEqual(odds);
  });

  it("is deterministic: two builds from the same snapshot give identical odds (the no-op check)", () => {
    const again = buildLeagueModel(snapshot, inputs, { now: NOW, scenarios: 8 });
    expect(again.odds).toEqual(model.odds);
    // A "trade" that changes nothing (every roster as it was) moves no odds either.
    const same = { ...snapshot, teams: snapshot.teams.map((t) => ({ ...t, roster: [...t.roster] })) };
    expect(buildLeagueModel(same, inputs, { now: NOW, scenarios: 8 }).odds).toEqual(model.odds);
    // Another simulation seed moves them (the seed is the only randomness).
    expect(buildLeagueModel(snapshot, inputs, { now: NOW, scenarios: 8, simSeed: 1 }).odds).not.toEqual(model.odds);
  });

  it("without the rest of the schedule (weeks 4–14 didn't load), no odds, and the League model's warnings say why", () => {
    const partial = { ...snapshot, schedule: snapshot.schedule.filter((m) => m.decided) };
    const m = buildLeagueModel(partial, inputs, { now: NOW, scenarios: 0 });
    expect(m.odds).toBeNull();
    expect(m.warnings).toContain("The schedule has no matchups for the rest of the regular season (weeks 4–14), so the playoff odds are left out; refresh to try again.");
    // Nothing is said when the simulation is simply off.
    expect(buildLeagueModel(partial, inputs, { now: NOW, scenarios: 0, sims: 0 }).warnings.some((w) => w.includes("playoff odds"))).toBe(false);
  });
});
