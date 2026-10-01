/**
 * League page view model (CLAUDE.md §14 item 3, §6 step 7, §7, §9) on a fictional league with a
 * hand-built LeagueModel (src/components/league/testFixtures.ts): sorting, chips, heatmap steps, the
 * week-by-week breakdown, game days (a week in progress), free agents, and the no-team state. Every
 * name is made up.
 */
import { describe, expect, it } from "vitest";
import { BEFORE_KICKOFF, NOW, PRE_KICKOFF, leagueFixture, nameOf, type LeagueFixture } from "@/components/league/testFixtures";
import { config } from "@/engine/config";
import type { BaseRateSource, SeasonOdds, TeamModel, WeekOdds } from "@/engine/leagueModel";
import { fantasyCalcFormat } from "@/engine/market";
import { weekUnderWayNote } from "@/engine/season";
import {
  FREE_AGENT_MOVE_LABEL,
  RISKY_BYES,
  RISKY_WIN_CHANCE,
  SEASON_OVER_PARTNERS_TEXT,
  SEASON_OVER_TEXT,
  UNDER_WAY_TEXT,
  availabilityNoteText,
  buildLeagueView,
  heatStep,
  likelyStarters,
  oddsCell,
  shortName,
  type LeagueViewInput,
  type PlayerRow,
} from "./leagueView";

const TZ = "America/Chicago";

function view(opts: Parameters<typeof leagueFixture>[0] = {}, extra: Partial<LeagueViewInput> = {}) {
  const f = leagueFixture(opts);
  return buildLeagueView({ ...f, myTeamSource: f.model.myTeamId ? "platform" : "none", timeZone: TZ, now: opts.gameDay === false ? BEFORE_KICKOFF : NOW, ...extra });
}

const of = (f: LeagueFixture, extra: Partial<LeagueViewInput> = {}) => buildLeagueView({ ...f, myTeamSource: "platform", timeZone: TZ, now: NOW, ...extra });

/** Game day: MIN's week 12 game kicked off, so week 12 is in progress (the default fixture). */
const v = view();
/** The same league before week 12's first kickoff. */
const before = view({ gameDay: false });
const roster = (teamId: string) => v.rosters.find((r) => r.teamId === teamId);
const player = (teamId: string, id: string) => roster(teamId)?.players.find((p) => p.id === id) as PlayerRow;

const SOURCES: Record<BaseRateSource, number> = { "espn+sleeper": 0, sleeper: 0, espn: 0, season: 0, actual: 0, none: 0 };

describe("buildLeagueView: header (§14 item 3)", () => {
  it("names the league, the week, when the data is from (with its date), and the sources", () => {
    expect(v.header).toEqual({
      name: "The Gloopdorf Invitational",
      platformLabel: "ESPN",
      season: 2026,
      weekLine: "Week 12 · as of Thu, Nov 26, 3:55 PM",
      inProgress: "Week 12 is under way, so team numbers start with week 13.",
      projections: "Sleeper",
      valuesFormat: "8 teams · half-PPR · 1 QB · redraft",
      weeksLeft: "6 weeks left: 3 regular season, 3 playoffs",
    });
    // Before the week's first kickoff, nothing is in progress.
    expect(before.header.inProgress).toBeNull();
    expect(before.header.weekLine).toBe("Week 12 · as of Thu, Nov 26, 9:55 AM");
  });

  it("dates old data in full, so a copy from another week or year never passes for today's", () => {
    // Reopened a week later: the same weekday, but the date says it's last week's data.
    const weekLater = of(leagueFixture(), { now: "2026-12-03T22:00:00.000Z" });
    expect(weekLater.header.weekLine).toBe("Week 12 · as of Thu, Nov 26, 3:55 PM");
    expect(weekLater.sources[0]?.value).toBe("Thu, Nov 26, 3:55 PM");
    const f = leagueFixture();
    f.snapshot = { ...f.snapshot, fetchedAt: "2025-12-30T15:00:00.000Z" };
    expect(of(f, { now: "2026-01-06T15:00:00.000Z" }).header.weekLine).toBe("Week 12 · as of Tue, Dec 30, 2025, 9:00 AM");
  });

  it("credits ESPN when its projections were averaged in (§6)", () => {
    const f = leagueFixture();
    f.model.projection = { ...f.model.projection, espnAveraged: true, agreement: { meanRelDiff: 0.04, players: 26, week: 12 }, sources: { ...SOURCES, "espn+sleeper": 25, sleeper: 8 } };
    const averaged = of(f);
    expect(averaged.header.projections).toBe("ESPN and Sleeper, averaged");
    expect(averaged.explain[0]?.text).toContain("averaged with ESPN's own projection (they agree within 4% on average this week)");
  });

  it("names the projections that actually loaded (model.projection.sources), not Sleeper's by default", () => {
    const withSources = (sources: Partial<Record<BaseRateSource, number>>, agreement: LeagueFixture["model"]["projection"]["agreement"] = null) => {
      const f = leagueFixture();
      f.model.projection = { ...f.model.projection, espnAveraged: false, agreement, sources: { ...SOURCES, ...sources } };
      const built = of(f);
      return { label: built.header.projections, text: built.explain[0]?.text ?? "" };
    };
    // Sleeper's didn't load in an ESPN league: every base rate is ESPN's own.
    const espn = withSources({ espn: 30 });
    expect(espn.label).toBe("ESPN");
    expect(espn.text).toContain("start from ESPN's own projection, in your league's scoring (Sleeper's projections didn't load)");
    expect(espn.text).toContain("There's no week-to-week matchup adjustment: it comes from Sleeper's weekly projections, which didn't load.");
    expect(espn.text).not.toContain("Sleeper's projection, scored");
    expect(withSources({ espn: 30, sleeper: 4 }).text).toContain("(Sleeper's projections cover only 4 players)");
    // Mostly Sleeper, with ESPN's own for the few Sleeper doesn't project.
    const mixed = withSources({ sleeper: 30, espn: 3 }, { meanRelDiff: 0.14, players: 26, week: 12 });
    expect(mixed.label).toBe("Sleeper");
    expect(mixed.text).toContain(
      "start from Sleeper's projection, scored with your league's rules (ESPN's own for 3 players Sleeper doesn't project). ESPN's own projections differ from Sleeper's by 14% on average this week, more than the 10% we allow, so we don't average them in.",
    );
    expect(mixed.text).toContain("adjusted for the matchup");
    // Last resorts.
    expect(withSources({ season: 20 }).label).toBe("Sleeper's season projections");
    expect(withSources({ season: 20 }).text).toContain("Sleeper's season projection per game, scored with your league's rules (its weekly projections didn't load)");
    expect(withSources({ actual: 5 }).label).toBe("points scored so far");
    expect(withSources({}).label).toBe("none loaded");
  });

  it("labels a keeper league's values as the redraft (perception) list it shows (§9)", () => {
    const f = leagueFixture();
    f.snapshot = { ...f.snapshot, settings: { ...f.snapshot.settings, leagueType: "keeper" } };
    // The market's own format is the dynasty list (the future term).
    f.model.market = { ...f.model.market, format: fantasyCalcFormat(f.snapshot.settings) };
    const keeper = of(f);
    expect(keeper.header.valuesFormat).toBe("8 teams · half-PPR · 1 QB · redraft");
    const values = keeper.explain.find((e) => e.title === "Trade values")?.text ?? "";
    expect(values).toContain("In a keeper league these are its redraft values");
    // The size note once; the line naming the list is the keeper sentence's.
    expect(values).toContain("Where your league doesn't match one of FantasyCalc's formats exactly: 4 teams → FantasyCalc's 8-team values. Players");
    expect(values).not.toContain("keeper league →");
  });

  it("has no values format when FantasyCalc couldn't be reached", () => {
    const f = leagueFixture();
    f.model.market = { ...f.model.market, format: null };
    const none = of(f);
    expect(none.header.valuesFormat).toBeNull();
    expect(none.explain.find((e) => e.title === "Trade values")?.text).toMatch(/couldn't be loaded/);
  });

  it("lists where each input came from, dated, flagging a saved copy, plus warnings and notes", () => {
    expect(v.sources).toEqual([
      { label: "League data from ESPN", value: "Thu, Nov 26, 3:55 PM" },
      { label: "Sleeper projections", value: "Thu, Nov 26, 2:00 PM" },
      { label: "FantasyCalc values", value: "Wed, Nov 25, 5:00 PM (a saved copy: the live fetch failed)" },
    ]);
    expect(v.warnings).toEqual(["Sleeper's week 17 projections didn't load.", "No projection for Dabney Drifter."]);
    // The server's value notes repeat the header's format and the explainer's substitutions, so only the other note shows.
    expect(v.notes).toEqual(["Sleeper hasn't published week 18 projections yet."]);
  });

  it("drops every value note the server writes (src/server/modelInputs.ts), keeper leagues' included, so nothing shows twice", async () => {
    const { fantasyCalcNotes } = await import("@/server/modelInputs");
    const own = "Sleeper hasn't published week 18 projections yet.";
    const f = leagueFixture();
    f.inputs = { ...f.inputs, notes: [...fantasyCalcNotes(fantasyCalcFormat(f.snapshot.settings)), own] };
    expect(of(f).notes).toEqual([own]);
    const keeper = leagueFixture();
    keeper.snapshot = { ...keeper.snapshot, settings: { ...keeper.snapshot.settings, leagueType: "keeper" } };
    const dynasty = fantasyCalcFormat(keeper.snapshot.settings);
    keeper.model.market = { ...keeper.model.market, format: dynasty };
    keeper.inputs = { ...keeper.inputs, notes: [...fantasyCalcNotes(dynasty, fantasyCalcFormat(keeper.snapshot.settings, "redraft")), own, own] };
    expect(keeper.inputs.notes).toHaveLength(6);
    expect(of(keeper).notes).toEqual([own]);
    // Without values there's nothing to repeat: every note shows.
    const down = leagueFixture();
    down.model.market = { ...down.model.market, format: null };
    down.inputs = { ...down.inputs, notes: [own] };
    expect(of(down).notes).toEqual([own]);
  });
});

/** The fixture's season odds (never null there), to edit in a test. */
function oddsOf(f: LeagueFixture): SeasonOdds {
  if (!f.model.odds) throw new Error("fixture odds missing");
  return f.model.odds;
}

/** The fixture with a first-round bye: 3 of the 4 teams make the playoffs and the top seed skips round 1. */
function withByes(f: LeagueFixture, pBye: Record<string, number | null> = { "1": 0.18, "2": 0.8, "3": 0.0196, "4": 0.0004 }): LeagueFixture {
  const odds = oddsOf(f);
  f.model.odds = { ...odds, playoffTeams: 3, byes: 1, teams: odds.teams.map((t) => ({ ...t, pBye: pBye[t.teamId] ?? null })) };
  return f;
}

/** Edits team 1's game in a week of SeasonOdds.weekly. */
function myGame(f: LeagueFixture, week: number, edit: Partial<WeekOdds["games"][number]>) {
  const odds = oddsOf(f);
  f.model.odds = { ...odds, weekly: odds.weekly.map((wk) => (wk.week === week ? { ...wk, games: wk.games.map((g) => (g.teamId === "1" ? { ...g, ...edit } : g)) } : wk)) };
}

/** Puts the given players' byes in `week` (only ros.bye: what the schedule's bye list reads). */
function byeIn(f: LeagueFixture, ids: string[], week: number) {
  for (const id of ids) {
    const pm = f.model.players[id];
    if (!pm) throw new Error(`fixture player ${id} missing`);
    f.model.players[id] = { ...pm, ros: { ...pm.ros, bye: { status: "upcoming", week } } };
  }
}

describe("buildLeagueView: standings and playoff odds (§8; §17 Checkpoint 3: next to the current standings)", () => {
  it("lists every team in today's standings order, with its record, points for, playoff and title odds and projected final record", () => {
    expect(v.standings?.rows.map((r) => [r.rank, r.teamId, r.name, r.isMine, r.record, r.pointsFor, r.playoffs?.text, r.bye, r.title.text, r.finalRecord, r.eliminated])).toEqual([
      [1, "2", "Gravel Gophers", false, "8–3", "1210.3", "93%", null, "47%", "9.8–4.2", false],
      [2, "1", "Moonbeam Mudcats", true, "7–4", "1180.4", "86%", null, "43%", "8.5–5.5", false],
      [3, "3", "Quasar Quokkas", false, "5–6", "1100", "21%", null, "10%", "6.5–7.5", false],
      [4, "4", "Tundra Tortoises", false, "2–9", "990.5", "<1%", null, "<1%", "3.3–10.7", false],
    ]);
    expect(v.standings?.empty).toBeNull();
    // The team table keeps its own order (projected points per week).
    expect(v.teams.map((t) => t.id)).toEqual(["2", "3", "1", "4"]);
  });

  it("takes the order from the engine (TeamOdds.rank: the league's own tiebreakers), never re-sorting by record here", () => {
    const f = leagueFixture();
    const ranks: Record<string, number> = { "1": 1, "2": 2, "3": 4, "4": 3 };
    f.model.odds = { ...oddsOf(f), teams: oddsOf(f).teams.map((t) => ({ ...t, rank: ranks[t.teamId] ?? 0 })) };
    expect(of(f).standings?.rows.map((r) => [r.rank, r.teamId])).toEqual([
      [1, "1"],
      [2, "2"],
      [3, "4"],
      [4, "3"],
    ]);
  });

  it("prints odds as whole percents: 0% and 100% only when certain, <1% and >99% when they only round there, — when unknown (said in words)", () => {
    const ps = [0, 0.0001, 0.0049, 0.005, 0.2092, 0.5, 0.994, 0.9949, 0.995, 0.9996, 1, null, Number.NaN];
    expect(ps.map((p) => oddsCell(p).text)).toEqual(["0%", "<1%", "<1%", "1%", "21%", "50%", "99%", "99%", ">99%", ">99%", "100%", "—", "—"]);
    expect(oddsCell(0.003)).toEqual({ text: "<1%", srText: "less than 1%" });
    expect(oddsCell(0.999)).toEqual({ text: ">99%", srText: "more than 99%" });
    expect(oddsCell(null)).toEqual({ text: "—", srText: "unknown" });
    expect(oddsCell(0.43)).toEqual({ text: "43%", srText: null });
    expect(oddsCell(1)).toEqual({ text: "100%", srText: null });
  });

  it("shows the Bye column only when the league has byes and their odds are known; a team's unknown bye odds print —", () => {
    expect(v.standings?.showBye).toBe(false);
    const byes = of(withByes(leagueFixture()));
    expect(byes.standings?.showBye).toBe(true);
    expect(byes.standings?.rows.map((r) => r.bye?.text)).toEqual(["80%", "18%", "2%", "<1%"]);
    expect(of(withByes(leagueFixture(), { "1": 0.2, "2": 0.8 })).standings?.rows.map((r) => r.bye?.text)).toEqual(["80%", "20%", "—", "—"]);
    const unknown = of(withByes(leagueFixture(), {}));
    expect(unknown.standings?.showBye).toBe(false);
    expect(unknown.standings?.rows.every((r) => r.bye === null)).toBe(true);
  });

  it("drops the Playoffs column with fewer than 2 playoff teams: the title goes to the top of the standings (§8), so it would read 0% for all or repeat Title", () => {
    const standings = (playoffTeams: number) => {
      const f = leagueFixture();
      const odds = oddsOf(f);
      // What the simulator gives: nobody makes playoffs that don't exist; with one spot, making it is winning the title.
      f.model.odds = { ...odds, playoffTeams, teams: odds.teams.map((t) => ({ ...t, pPlayoffs: playoffTeams === 0 ? 0 : (t.pTitle ?? 0) })) };
      return of(f).standings;
    };
    for (const n of [0, 1]) {
      const s = standings(n);
      expect(s?.showPlayoffs, `${n} playoff teams`).toBe(false);
      expect(s?.rows.every((r) => r.playoffs === null)).toBe(true);
      expect(s?.rows.map((r) => r.title.text)).toEqual(["47%", "43%", "10%", "<1%"]);
      expect(s?.caption).toBe("Standings today by your league's rules, with each team's chance to win the title, and its projected final record, from 5,000 simulated seasons");
    }
    expect(standings(2)?.showPlayoffs).toBe(true);
    expect(v.standings?.rows.map((r) => r.playoffs?.text)).toEqual(["93%", "86%", "21%", "<1%"]);
  });

  it("says when the playoffs are unknown: title (and bye) odds print —, and the engine's note says why", () => {
    const note = "A playoff game already played has no result we could read, so title and bye odds are unknown.";
    const f = withByes(leagueFixture(), {});
    f.model.odds = { ...oddsOf(f), playoffsKnown: false, teams: oddsOf(f).teams.map((t) => ({ ...t, pTitle: null })), notes: [...oddsOf(f).notes, note] };
    const unknown = of(f);
    expect(unknown.standings?.showBye).toBe(false);
    expect(unknown.standings?.rows.map((r) => [r.playoffs?.text, r.title.text, r.title.srText])).toEqual([
      ["93%", "—", "unknown"],
      ["86%", "—", "unknown"],
      ["21%", "—", "unknown"],
      ["<1%", "—", "unknown"],
    ]);
    expect(unknown.standings?.notes).toContain(note);
  });

  it("projects the final record with one decimal, with ties only when there are some, and none in a points-only league", () => {
    const f = leagueFixture();
    f.model.odds = { ...oddsOf(f), teams: oddsOf(f).teams.map((t) => (t.teamId === "1" ? { ...t, expWins: 8, expLosses: 5, expTies: 1 } : t.teamId === "2" ? { ...t, expTies: 0.04 } : t)) };
    expect(of(f).standings?.rows.slice(0, 2).map((r) => r.finalRecord)).toEqual(["9.8–4.2", "8.0–5.0–1.0"]);
    const g = leagueFixture();
    g.snapshot = { ...g.snapshot, settings: { ...g.snapshot.settings, pointsOnly: true } };
    const pointsOnly = of(g).standings;
    expect(pointsOnly?.pointsOnly).toBe(true);
    expect(pointsOnly?.rows.every((r) => r.finalRecord === null)).toBe(true);
    expect(pointsOnly?.caption).toBe("Standings today by your league's rules, with each team's chance to make the playoffs and win the title, from 5,000 simulated seasons");
  });

  it("captions the table, and lists the odds' notes except any the warnings box already shows", () => {
    expect(v.standings?.caption).toBe(
      "Standings today by your league's rules, with each team's chance to make the playoffs and win the title, and its projected final record, from 5,000 simulated seasons",
    );
    expect(of(withByes(leagueFixture())).standings?.caption).toContain("chance to make the playoffs, get a first-round bye and win the title, and its projected final record");
    expect(v.standings?.notes).toEqual([
      "Odds from 5,000 simulated seasons.",
      "Ties in the standings go to points for, the league's rule.",
      weekUnderWayNote(12),
    ]);
    expect(before.standings?.notes).toHaveLength(2);
    // A note the engine also raised as a warning is shown once, in the warnings box.
    const dup = "Week 11's final scores aren't in yet, so its games are left out of the odds until they are; refresh later.";
    const f = leagueFixture();
    f.model.odds = { ...oddsOf(f), notes: [...oddsOf(f).notes, dup, dup] };
    expect(of(f).standings?.notes.filter((n) => n === dup)).toEqual([dup]);
    f.model.warnings = [...f.model.warnings, dup];
    const once = of(f);
    expect(once.standings?.notes).not.toContain(dup);
    expect(once.warnings).toContain(dup);
  });

  it("says when there are no odds, and shows no standings once no week is left", () => {
    const f = leagueFixture();
    f.model.odds = null;
    const none = of(f);
    expect(none.standings).toEqual({ rows: [], showPlayoffs: false, showBye: false, pointsOnly: false, caption: "", notes: [], empty: "Playoff odds aren't available for this league right now." });
    expect(none.schedule).toBeNull();
    expect(none.eliminated).toBeNull();
    const g = leagueFixture();
    g.model = { ...g.model, weeks: [], regularWeeks: [], playoffWeeks: [], inProgressWeek: null, odds: null, teams: g.model.teams.map((t) => ({ ...t, ev: { lv: [], ros: 0, ppw: 0 }, scen: null })) };
    expect(of(g).standings).toBeNull();
  });

  it(`says "${SEASON_OVER_TEXT}" when my team is certainly out in a redraft league (§8), and only then`, () => {
    const out = (teamId: string, leagueType: "redraft" | "keeper" | "dynasty" = "redraft", myTeamId: string | null = "1") => {
      const f = leagueFixture({ myTeamId });
      f.snapshot = { ...f.snapshot, settings: { ...f.snapshot.settings, leagueType } };
      f.model.odds = { ...oddsOf(f), teams: oddsOf(f).teams.map((t) => (t.teamId === teamId ? { ...t, eliminated: true } : t)) };
      return of(f);
    };
    expect(SEASON_OVER_TEXT).toBe("Your season's over — no trade helps this year.");
    const mine = out("1");
    expect(mine.eliminated).toBe(SEASON_OVER_TEXT);
    expect(mine.standings?.rows.find((r) => r.teamId === "1")?.eliminated).toBe(true);
    // Keeper and dynasty leagues still trade for the future (§8): no message, the row still says "out".
    expect(out("1", "keeper").eliminated).toBeNull();
    expect(out("1", "dynasty").eliminated).toBeNull();
    expect(out("1", "keeper").standings?.rows.find((r) => r.teamId === "1")?.eliminated).toBe(true);
    // Another team out, or no team picked: nothing to say to me.
    expect(out("4").eliminated).toBeNull();
    expect(out("4").standings?.rows.find((r) => r.teamId === "4")?.eliminated).toBe(true);
    expect(out("1", "redraft", null).eliminated).toBeNull();
    expect(v.eliminated).toBeNull();
  });

  it("offers no trade partners once my redraft season is over (no trade helps this year, §8), and says why", () => {
    const out = (teamId: string, leagueType: "redraft" | "keeper" | "dynasty" = "redraft") => {
      const f = leagueFixture();
      f.snapshot = { ...f.snapshot, settings: { ...f.snapshot.settings, leagueType } };
      f.model.odds = { ...oddsOf(f), teams: oddsOf(f).teams.map((t) => (t.teamId === teamId ? { ...t, eliminated: true } : t)) };
      return of(f);
    };
    expect(SEASON_OVER_PARTNERS_TEXT).toBe("Your season's over, so no trade partner can help this year.");
    expect(out("1").partners).toEqual({ cards: [], empty: SEASON_OVER_PARTNERS_TEXT });
    // Keeper and dynasty leagues still trade for the future; another team out changes nothing for me.
    const partners = v.partners.cards.map((c) => c.teamId);
    expect(partners).toHaveLength(3);
    for (const leagueType of ["keeper", "dynasty"] as const) expect(out("1", leagueType).partners).toMatchObject({ empty: null, cards: partners.map((teamId) => ({ teamId })) });
    expect(out("4").partners).toMatchObject({ empty: null, cards: partners.map((teamId) => ({ teamId })) });
  });

  it("works with a model built before the simulator existed (no odds, no scores)", () => {
    const f = leagueFixture();
    const legacy = { ...f.model, teams: f.model.teams.map((t) => ({ ...t, score: undefined })) } as unknown as LeagueFixture["model"];
    delete (legacy as Partial<LeagueFixture["model"]>).odds;
    const built = of({ ...f, model: legacy });
    expect(built.standings?.empty).toBe("Playoff odds aren't available for this league right now.");
    expect(built.schedule).toBeNull();
  });
});

describe("buildLeagueView: my remaining schedule (§8: each remaining week's risk)", () => {
  it("lists each remaining game: opponent, both teams' projected points, my win chance, my likely starters on bye, and a risky week in words", () => {
    expect(v.schedule?.rows.map((r) => [r.weekText, r.opponentId, r.opponent, r.mine, r.theirs, r.win.text, r.median, r.byes?.text ?? null, r.risk?.reasons ?? null, r.underWay])).toEqual([
      ["12", "3", "Quasar Quokkas", "91.4", "88", "54%", null, null, null, UNDER_WAY_TEXT],
      ["13", "4", "Tundra Tortoises", "90", "85", "56%", null, null, null, null],
      ["14", "2", "Gravel Gophers", "84", "94", "38%", null, "D. Quibble", "under 40% to win", null],
    ]);
    expect(v.schedule?.showMedian).toBe(false);
    expect(v.schedule?.empty).toBeNull();
    expect(v.schedule?.rows[2]?.byes).toEqual({ text: "D. Quibble", title: nameOf("102"), count: 1 });
    // The week in progress is played as if none of its games had started (the engine's note says so in full: today's rosters and injury news).
    expect(UNDER_WAY_TEXT).toBe("Under way: projected as if no game had started (live scores aren't read)");
    // Before the week's first kickoff, week 12 is an ordinary week.
    expect(before.schedule?.rows[0]?.underWay).toBeNull();
  });

  it("uses the simulator's own numbers (TeamModel.score): a week in progress shows its pre-game projection, not the partial lineup", () => {
    const f = leagueFixture();
    // Team 1's week 12 lineup value is a partial week on game day; its score keeps the pre-kickoff projection.
    expect(f.model.teams.find((t) => t.id === "1")?.scen?.lv[0]).toBe(82);
    expect(f.model.teams.find((t) => t.id === "1")?.score.mean[0]).toBe(PRE_KICKOFF["1"]);
    expect(v.schedule?.rows[0]?.mine).toBe("91.4");
    // Scores missing for a week: "—", never a made-up number.
    f.model.teams = f.model.teams.map((t) => (t.id === "3" ? { ...t, score: { mean: [], sd: [] } } : t));
    expect(of(f).schedule?.rows[0]?.theirs).toBe("—");
  });

  it("builds on a fixture whose scores keep TeamModel.score's contract: the LV itself, except a week in progress keeps its pre-kickoff projection (the week's LV before kickoff)", () => {
    const lv = (t: TeamModel) => (t.scen ?? t.ev).lv;
    const pre = leagueFixture({ gameDay: false });
    for (const t of pre.model.teams) expect(t.score.mean, `team ${t.id} before kickoff`).toEqual(lv(t));
    const live = leagueFixture();
    for (const t of live.model.teams) {
      expect(t.score.mean, `team ${t.id} on game day`).toEqual(lv(pre.model.teams.find((x) => x.id === t.id) as TeamModel));
      expect(t.score.mean[0]).toBe(PRE_KICKOFF[t.id]);
    }
    // Only team 1 has players in the game that kicked off, so only its week 12 LV is a partial week.
    expect(live.model.teams.map((t) => lv(t)[0] === PRE_KICKOFF[t.id])).toEqual([false, true, true, true]);
    // Before kickoff the page shows week 12's LV itself.
    expect(before.schedule?.rows[0]?.mine).toBe("91.4");
    expect(before.schedule?.rows[0]?.mine).toBe(`${lv(pre.model.teams[0] as TeamModel)[0]}`);
  });

  it(`flags a risky week in words: my chance to win under ${Math.round(RISKY_WIN_CHANCE * 100)}% as printed, or ${RISKY_BYES}+ likely starters on bye`, () => {
    expect(v.schedule?.rows[2]?.risk).toEqual({ label: "Risky week", reasons: "under 40% to win", text: "Risky week: your chance to win is under 40%." });
    // As printed: 39.6% shows "40%", so it isn't flagged; 39.4% shows "39%", so it is.
    const at = (p: number) => {
      const f = leagueFixture();
      myGame(f, 13, { pWin: p });
      return of(f).schedule?.rows[1];
    };
    expect(at(0.396)).toMatchObject({ win: { text: "40%" }, risk: null });
    expect(at(0.394)).toMatchObject({ win: { text: "39%" }, risk: { reasons: "under 40% to win" } });
    // Parker's week 13 kind of week: three likely starters off at once.
    const f = leagueFixture();
    byeIn(f, ["102", "104", "105"], 13);
    const crunch = of(f).schedule?.rows[1];
    expect(crunch?.byes).toEqual({ text: "D. Quibble, N. McSprocket, G. Oddfellow", title: `${nameOf("102")}, ${nameOf("104")}, ${nameOf("105")}`, count: 3 });
    expect(crunch?.risk).toEqual({ label: "Risky week", reasons: "3 starters on bye", text: "Risky week: 3 of your likely starters are on bye." });
    myGame(f, 13, { pWin: 0.2 });
    expect(of(f).schedule?.rows[1]?.risk).toEqual({
      label: "Risky week",
      reasons: "3 starters on bye · under 40% to win",
      text: "Risky week: 3 of your likely starters are on bye, and your chance to win is under 40%.",
    });
    // Two starters off is listed, not flagged.
    const g = leagueFixture();
    byeIn(g, ["102", "104"], 13);
    expect(of(g).schedule?.rows[1]).toMatchObject({ byes: { count: 2 }, risk: null });
  });

  it("takes the risky-week thresholds from config.leaguePage (CLAUDE.md §15: every tunable number from config)", () => {
    expect(RISKY_WIN_CHANCE).toBe(config.leaguePage.riskyWinChance);
    expect(RISKY_BYES).toBe(config.leaguePage.riskyByes);
  });

  it("counts only likely starters on bye: my best lineup by projected points per game left (ROS points ÷ games left)", () => {
    const f = leagueFixture();
    // QB, RB, RB, WR, FLEX, D/ST, in lineup order; the TE and the third WR sit.
    expect(likelyStarters(f.snapshot, f.model, "1")).toEqual(["101", "102", "103", "104", "105", "MIN"]);
    // Bench players and IR players on bye aren't listed.
    byeIn(f, ["106", "108", "107"], 13);
    expect(of(f).schedule?.rows[1]?.byes).toBeNull();
    // A player whose points per game left sink (hurt, most of his games at 0) drops out; the next best takes the FLEX.
    const pm = f.model.players["105"];
    if (!pm) throw new Error("fixture WR missing");
    f.model.players["105"] = { ...pm, ros: { ...pm.ros, total: 6 } };
    expect(likelyStarters(f.snapshot, f.model, "1")).toEqual(["101", "102", "103", "104", "106", "MIN"]);
    byeIn(f, ["105"], 13);
    expect(of(f).schedule?.rows[1]?.byes).toMatchObject({ text: "W. Spoons", count: 1 });
    // No games left, or no model: never a starter.
    const g = leagueFixture();
    const qb = g.model.players["101"];
    if (!qb) throw new Error("fixture QB missing");
    g.model.players["101"] = { ...qb, ros: { ...qb.ros, gamesLeft: 0 } };
    delete g.model.players.MIN;
    expect(likelyStarters(g.snapshot, g.model, "1")).toEqual(["102", "103", "104", "105"]);
    expect(likelyStarters(g.snapshot, g.model, "99")).toEqual([]);
  });

  it("shows the median game's chance in median-game leagues", () => {
    const f = leagueFixture();
    f.snapshot = { ...f.snapshot, settings: { ...f.snapshot.settings, medianGame: true } };
    f.model.odds = { ...oddsOf(f), weekly: oddsOf(f).weekly.map((wk) => ({ ...wk, games: wk.games.map((g) => ({ ...g, pMedianWin: wk.week === 13 ? 0.0021 : 0.5 })) })) };
    const median = of(f).schedule;
    expect(median?.showMedian).toBe(true);
    expect(median?.rows.map((r) => r.median?.text)).toEqual(["50%", "<1%", "50%"]);
    expect(median?.caption).toContain("your chance to win and to beat the league median each week");
    expect(median?.note).toContain("Median: your chance of a top-half score that week, which counts as a second game.");
    // A median league whose odds carry no median chances (none simulated): no column.
    const g = leagueFixture();
    g.snapshot = { ...g.snapshot, settings: { ...g.snapshot.settings, medianGame: true } };
    expect(of(g).schedule?.showMedian).toBe(false);
    expect(of(g).schedule?.rows.every((r) => r.median === null)).toBe(true);
  });

  it("lists a bye week (no opponent) with no opponent's points and no game to win, and flags its byes only when the week still counts", () => {
    const f = leagueFixture();
    myGame(f, 13, { opponentId: null, pWin: null });
    // "—" read as "no game": there's nothing to win, which isn't an unknown chance.
    expect(of(f).schedule?.rows[1]).toMatchObject({ opponentId: null, opponent: "Bye week", mine: "90", theirs: null, win: { text: "—", srText: "no game" }, risk: null });
    // Three likely starters off in a week without a game: listed, not flagged (the simulator plays nothing for a bye, so it can't move the odds), and the note says why.
    byeIn(f, ["102", "104", "105"], 13);
    expect(of(f).schedule?.rows[1]).toMatchObject({ byes: { count: 3 }, risk: null });
    expect(of(f).schedule?.note).toContain("are on bye. A bye week without a game can't change the standings, so it isn't flagged.");
    // A median game that week still counts, so there the crunch is a risk…
    const median = leagueFixture();
    median.snapshot = { ...median.snapshot, settings: { ...median.snapshot.settings, medianGame: true } };
    myGame(median, 13, { opponentId: null, pWin: null, pMedianWin: 0.3 });
    byeIn(median, ["102", "104", "105"], 13);
    expect(of(median).schedule?.rows[1]).toMatchObject({ win: { text: "—", srText: "no game" }, median: { text: "30%" }, risk: { reasons: "3 starters on bye" } });
    expect(of(median).schedule?.note).not.toContain("A bye week without a game");
    // …and so does every week of a points-only league: its points add up.
    const pointsOnly = leagueFixture();
    pointsOnly.snapshot = { ...pointsOnly.snapshot, settings: { ...pointsOnly.snapshot.settings, pointsOnly: true } };
    myGame(pointsOnly, 13, { opponentId: null, pWin: null });
    byeIn(pointsOnly, ["102", "104", "105"], 13);
    expect(of(pointsOnly).schedule?.rows[1]).toMatchObject({ risk: { reasons: "3 starters on bye" } });
    // A game whose chance is missing is still "unknown".
    const g = leagueFixture();
    myGame(g, 13, { pWin: null });
    expect(of(g).schedule?.rows[1]?.win).toEqual({ text: "—", srText: "unknown" });
  });

  it("lists a multi-week matchup once, under its first week, with points and byes over all its weeks", () => {
    const f = leagueFixture();
    // Team 1 plays team 4 over weeks 13–14 (an ESPN two-week matchup period) and has no week 14 game of its own.
    f.snapshot = {
      ...f.snapshot,
      schedule: f.snapshot.schedule.filter((m) => !(m.week === 14 && (m.teamA === "1" || m.teamB === "1"))).map((m) => (m.week === 13 && m.teamB === "1" ? { ...m, weeks: [13, 14] } : m)),
    };
    f.model.odds = { ...oddsOf(f), weekly: oddsOf(f).weekly.map((wk) => (wk.week === 14 ? { ...wk, games: wk.games.filter((g) => g.teamId !== "1" && g.teamId !== "2") } : wk)) };
    const rows = of(f).schedule?.rows;
    expect(rows?.map((r) => [r.week, r.weekText, r.weekLabel, r.opponent, r.mine, r.theirs, r.byes?.text ?? null])).toEqual([
      [12, "12", "Week 12", "Quasar Quokkas", "91.4", "88", null],
      [13, "13–14", "Weeks 13–14", "Tundra Tortoises", "174", "168", "D. Quibble"],
    ]);
    // Every week still to play: nothing to say about it.
    expect(rows?.[1]?.underWay).toBeNull();
  });

  it("says when a multi-week matchup is already under way: its played weeks' points aren't read, so the row covers only the weeks still to play", () => {
    /** Team 1's week 12 game against team 3, made a matchup over `weeks` (an ESPN multi-week matchup period) whose first weeks are played. */
    const spanning = (weeks: number[], gameDay: boolean) => {
      const f = leagueFixture({ gameDay });
      f.snapshot = { ...f.snapshot, schedule: f.snapshot.schedule.map((m) => (m.week === 12 && m.teamA === "1" ? { ...m, week: weeks[0] as number, weeks } : m)) };
      return buildLeagueView({ ...f, myTeamSource: "platform", timeZone: TZ, now: gameDay ? NOW : BEFORE_KICKOFF }).schedule?.rows[0];
    };
    const plain = before.schedule?.rows[0];
    const row = spanning([11, 12], false);
    // Listed under all its weeks, with week 12's numbers alone (the simulator's, as for a plain week 12 game), and a note saying so.
    expect(row).toMatchObject({ week: 12, weekText: "11–12", weekLabel: "Weeks 11–12", opponentId: "3", mine: plain?.mine, theirs: plain?.theirs, win: plain?.win });
    expect(row?.underWay).toBe("Week 11 already played: its points aren't counted, so these numbers cover week 12 only");
    // On game day the week in progress is said too.
    expect(spanning([11, 12], true)?.underWay).toBe(`Week 11 already played: its points aren't counted, so these numbers cover week 12 only. ${UNDER_WAY_TEXT}`);
    expect(spanning([10, 11, 12], false)).toMatchObject({ weekText: "10–12", underWay: "Weeks 10 and 11 already played: their points aren't counted, so these numbers cover week 12 only" });
  });

  it("asks for a team, says when none of my games is left, and has nothing to show without odds or once the regular season is over", () => {
    expect(view({ myTeamId: null }).schedule).toEqual({ rows: [], showMedian: false, caption: "", note: "", empty: "Pick your team to see your remaining games and each week's risk." });
    const f = leagueFixture();
    f.model.odds = { ...oddsOf(f), weekly: oddsOf(f).weekly.map((wk) => ({ ...wk, games: wk.games.filter((g) => g.teamId !== "1") })) };
    expect(of(f).schedule?.empty).toBe("Your team has no regular-season games left to play.");
    f.snapshot = { ...f.snapshot, settings: { ...f.snapshot.settings, pointsOnly: true } };
    expect(of(f).schedule?.empty).toBe("Your league ranks teams by total points, so there's no weekly schedule to show.");
    const g = leagueFixture();
    g.model.odds = { ...oddsOf(g), weekly: [] };
    expect(of(g).schedule).toBeNull();
  });

  it("captions the table and says who counts as a likely starter and when a week is flagged", () => {
    expect(v.schedule?.caption).toBe("Your remaining regular-season games: the opponent, projected points for you and them, and your chance to win each week");
    expect(v.schedule?.note).toBe(
      `"On bye" names your likely starters who are off that week: your best lineup by each player's projected points per game left. A week is flagged risky when your chance to win it is under 40%, or when ${RISKY_BYES} or more of those starters are on bye.`,
    );
  });

  it("in a points-only league, flags only bye crunches: its games don't count in the standings, so a low win chance isn't a risk", () => {
    const f = leagueFixture();
    f.snapshot = { ...f.snapshot, settings: { ...f.snapshot.settings, pointsOnly: true } };
    byeIn(f, ["102", "104", "105"], 13);
    const pointsOnly = of(f);
    expect(pointsOnly.schedule?.rows.map((r) => [r.week, r.win.text, r.risk?.reasons ?? null])).toEqual([
      [12, "54%", null],
      [13, "56%", "3 starters on bye"],
      [14, "38%", null],
    ]);
    expect(pointsOnly.schedule?.note).toBe(
      `Your league ranks teams by total points, so these games don't change the standings: only your points count. "On bye" names your likely starters who are off that week: your best lineup by each player's projected points per game left. A week is flagged risky when ${RISKY_BYES} or more of those starters are on bye.`,
    );
    expect(pointsOnly.explain.find((e) => e.title === "Playoff odds")?.text).toContain(
      `Your remaining schedule flags a week as risky when ${RISKY_BYES} or more of your likely starters (your best lineup by projected points per game left) are on bye.`,
    );
  });
});

describe("buildLeagueView: team table (§7 needs and trade chips)", () => {
  it("ranks teams by projected points per week, from scenario lineups when there are any", () => {
    expect(before.teams.map((t) => [t.rank, t.id, t.perWeekText, t.rosText, t.record, t.pointsFor])).toEqual([
      [1, "2", "93", "558", "8–3", "1210.3"],
      [2, "1", "88.5", "529", "7–4", "1180.4"], // scenario lineups (expected-value ones would say 87.8)
      [3, "3", "88", "528", "5–6", "1100"], // no scenarios: expected-value lineups
      [4, "4", "84", "504", "2–9", "990.5"],
    ]);
    expect(before.teams.filter((t) => t.isMine).map((t) => t.id)).toEqual(["1"]);
    expect(before.teamsNote).toBe("Ranked by projected points per week.");
  });

  it("skips a week in progress: per-week and ROS points count from the next week, and the note says so (game days)", () => {
    // Team 1's scenario LV is 82 | 90 84 | 88 88 88: week 12 is a partial week once MIN has kicked off.
    expect(v.teams.map((t) => [t.rank, t.id, t.perWeekText, t.rosText])).toEqual([
      [1, "2", "93", "465"],
      [2, "3", "88", "440"],
      [3, "1", "87", "438"],
      [4, "4", "84", "420"],
    ]);
    expect(v.teamsNote).toBe("Ranked by projected points per week from week 13 on (week 12 is under way).");
    expect(roster("1")?.summary).toBe("87 pts/wk · 438 ROS pts");
  });

  it("averages the playoff weeks when the week in progress was the last regular one, and has nothing to count when it's the last week", () => {
    const f = leagueFixture();
    f.model = { ...f.model, weeks: [14, 15, 16, 17], regularWeeks: [14], playoffWeeks: [15, 16, 17], inProgressWeek: 14, teams: f.model.teams.map((t) => ({ ...t, ev: { lv: [40, 100, 90, 80], ros: 337.5, ppw: 0 }, scen: null })) };
    const last = of(f);
    expect(last.teams[0]?.perWeekText).toBe("90");
    expect(last.teams[0]?.rosText).toBe("270");
    expect(last.header.inProgress).toBe("Week 14 is under way, so team numbers start with week 15.");
    const g = leagueFixture();
    g.model = { ...g.model, weeks: [17], regularWeeks: [], playoffWeeks: [17], inProgressWeek: 17, teams: g.model.teams.map((t) => ({ ...t, ev: { lv: [40], ros: 0, ppw: 0 }, scen: null })) };
    const final = of(g);
    expect(final.teams.every((t) => t.perWeekText === "—" && t.rosText === "0")).toBe(true);
    expect(final.header.inProgress).toBe("Week 17 is under way and it's the last week, so team numbers have no weeks left to count.");
    expect(final.teamsNote).toBe("Ranked by projected points per week.");
    expect(final.over).toBe(false);
  });

  it("shows the worst needs first, with next-weeks needs marked, at most needsShown", () => {
    expect(v.teams.find((t) => t.id === "1")?.needs.map((c) => [c.text, c.kind])).toEqual([
      ["RB1", "need-ros"],
      ["RB2", "need-ros"],
    ]);
    const t4 = v.teams.find((t) => t.id === "4")?.needs ?? [];
    expect(t4).toHaveLength(config.needs.needsShown);
    expect(t4.map((c) => [c.text, c.kind])).toEqual([
      ["QB", "need-ros"],
      ["WR · next 4 wks", "need-next"],
      ["D/ST", "need-ros"],
    ]);
    expect(v.teams.find((t) => t.id === "1")?.needs[0]?.title).toBe("Need at RB1 (rest of season): 11.8 pts/wk vs the league median 14");
    expect(t4[1]?.title).toBe("Need at WR (next 4 weeks): 13 pts/wk vs the league median 14.1");
  });

  it("shows each team's biggest trade chips, at most chipsShown: who, his gap in lineup points, and the team he'd help most ('you' for mine)", () => {
    expect(config.needs.chipsShown).toBe(3);
    const t2 = v.teams.find((t) => t.id === "2")?.chips ?? [];
    // Team 2 has four chips (the engine lists them biggest gap first); the table shows three.
    expect(t2.map((c) => [c.text, c.kind])).toEqual([
      ["C. Snoot: worth +31 to you", "chip"],
      ["I. Fumblewick: worth +18 to Tundra Tortoises", "chip"],
      ["P. Plunk: worth +12 to Quasar Quokkas", "chip"],
    ]);
    // The title gives both parts, to a tenth, in lineup points weighted like lineup cost.
    const w = `(playoffs count ${config.lineups.playoffWeight}×)`;
    expect(t2[0]?.title).toBe(
      `Cornelius Snoot (RB): worth 31.2 more lineup pts ${w} to Moonbeam Mudcats (your team) than to his own team. Moonbeam Mudcats (your team) would gain 35.2 with him (after its best free-agent move); his team would lose 4 without him.`,
    );
    expect(t2[1]?.title).toBe(`Ignatius Fumblewick (RB): worth 18.4 more lineup pts ${w} to Tundra Tortoises than to his own team. Tundra Tortoises would gain 27.4 with him (after its best free-agent move); his team would lose 9 without him.`);
    expect(v.teams.find((t) => t.id === "1")?.chips.map((c) => c.text)).toEqual(["W. Spoons: worth +15 to Gravel Gophers"]);
    expect(v.teams.find((t) => t.id === "4")?.chips.map((c) => c.text)).toEqual(["O. Wren: worth +13 to you"]);
    expect(v.chipLegend).toBe("trade chip: worth at least 10 more lineup pts to another team than to his own");
  });

  it("drops the playoff weighting from a chip's title once no playoff week is left to count", () => {
    const f = leagueFixture();
    f.model = { ...f.model, weeks: [12, 13, 14], regularWeeks: [12, 13, 14], playoffWeeks: [] };
    expect(of(f).teams.find((t) => t.id === "1")?.chips[0]?.title).toBe(
      "Wiggleton Spoons (WR): worth 14.6 more lineup pts to Gravel Gophers than to his own team. Gravel Gophers would gain 16.6 with him (after its best free-agent move); his team would lose 2 without him.",
    );
  });
});

describe("heatStep (5 steps, |needZThreshold| wide, so below/weak cells are needs)", () => {
  it("buckets z-scores", () => {
    expect([1.5, 1, 0.99, 0.5, 0.49, 0, -0.49, -0.5, -0.99, -1, -2].map((z) => heatStep(z))).toEqual([
      "strong",
      "strong",
      "above",
      "above",
      "average",
      "average",
      "average",
      "below",
      "below",
      "weak",
      "weak",
    ]);
    expect(heatStep(-0.3, -0.25)).toBe("below");
  });
});

describe("buildLeagueView: positional strength heatmap", () => {
  it("has one column per starting slot and the team table's row order", () => {
    expect(v.heatmap.columns.map((c) => c.label)).toEqual(["QB", "RB1", "RB2", "WR", "FLEX", "D/ST"]);
    expect(v.heatmap.rows.map((r) => r.teamId)).toEqual(["2", "3", "1", "4"]);
    expect(v.heatmap.windowLabel).toEqual({ ros: "Rest of season", next: "Next 4 weeks" });
  });

  it("names the weeks each window covers, starting after a week in progress", () => {
    expect(v.heatmap.caption).toEqual({
      ros: "Points per week from each team's starter in each lineup slot, rest of season (weeks 13–17). Colors compare each team with the league median.",
      next: "Points per week from each team's starter in each lineup slot, next 4 weeks (weeks 13–16). Colors compare each team with the league median.",
    });
    expect(before.heatmap.caption.ros).toContain("rest of season (weeks 12–17).");
    expect(before.heatmap.caption.next).toContain("next 4 weeks (weeks 12–15).");
  });

  it("colors each cell by its z-score, with the points as text, for both windows", () => {
    const mine = v.heatmap.rows.find((r) => r.teamId === "1");
    expect(mine?.isMine).toBe(true);
    expect(mine?.cells.ros.map((c) => [c.text, c.step])).toEqual([
      ["21.5", "strong"],
      ["11.8", "weak"],
      ["8.6", "below"],
      ["16.1", "average"],
      ["12.4", "above"],
      ["7", "average"],
    ]);
    expect(mine?.cells.next.map((c) => [c.text, c.step])).toEqual([
      ["20.5", "strong"],
      ["10.8", "average"],
      ["7.6", "below"],
      ["15.1", "average"],
      ["11.4", "above"],
      ["6", "average"],
    ]);
    expect(mine?.cells.ros[1]?.title).toBe("Moonbeam Mudcats · RB1: 11.8 pts/wk, weak (league median 14, rest of season)");
  });
});

describe("buildLeagueView: best trade partners (§7, from trade chips)", () => {
  it("shows my best fits with each side's trade chips, in points per week, the first chipsShown and a count of the rest", () => {
    expect(v.partners.empty).toBeNull();
    expect(v.partners.cards.map((c) => [c.name, c.fitText, c.theyCanGive.players.map((p) => p.text), c.theyCanGive.more?.text ?? null, c.youCanGive.players.map((p) => p.text)])).toEqual([
      ["Gravel Gophers", "Fit 2.4", ["C. Snoot (+2.1/wk)", "I. Fumblewick (+1.2/wk)", "M. Gloop (+0.8/wk)"], "and 1 more", ["W. Spoons (+1.8/wk)"]],
      ["Quasar Quokkas", "Fit 1.1", ["L. Mop (+0.9/wk)"], null, ["W. Spoons (+1.3/wk)"]],
      ["Tundra Tortoises", "Would start for you", ["O. Wren (+1.6/wk)"], null, []], // one-sided: after every mutual fit
    ]);
    // The rest are named on hover and for screen readers.
    expect(v.partners.cards[0]?.theyCanGive.more).toEqual({ text: "and 1 more", title: "Percival Plunk: +0.5 points per week to the other lineup", srText: "and 1 more: P. Plunk (+0.5/wk)" });
    expect(v.partners.cards[0]?.youCanGive.more).toBeNull();
    expect(v.partners.cards.map((c) => c.mutual)).toEqual([true, true, false]);
    expect(v.partners.cards.length).toBeLessThanOrEqual(config.needs.partnersShown);
  });

  it("labels a one-sided fit by what was measured, so a team with no needs isn't told a partner fills them", () => {
    const f = leagueFixture();
    f.model.teams = f.model.teams.map((t) => (t.id === "1" ? { ...t, needs: [] } : t));
    const noNeeds = of(f);
    expect(noNeeds.teams.find((t) => t.id === "1")?.needs).toEqual([]);
    expect(noNeeds.partners.cards.find((c) => !c.mutual)?.fitText).toBe("Would start for you");
    expect(JSON.stringify(noNeeds)).not.toContain("Fills your needs");
  });

  it("explains an empty list: no team picked, or no fit", () => {
    expect(view({ myTeamId: null }).partners).toEqual({ cards: [], empty: "Pick your team to see which teams fit you best as trade partners." });
    const f = leagueFixture();
    f.model.partners = [];
    expect(of(f, { myTeamSource: "you" }).partners.empty).toBe("No clear fits right now: no team has a trade chip who would start for you.");
  });

  it("doesn't depend on trade values: with FantasyCalc down, chips and partners show as usual (they're lineup points)", () => {
    const f = leagueFixture();
    f.model.market = { ...f.model.market, format: null };
    const down = of(f, { myTeamSource: "you" });
    expect(down.partners.cards.map((c) => c.teamId)).toEqual(["2", "3", "4"]);
    expect(down.teams.find((t) => t.id === "2")?.chips).toHaveLength(3);
    expect(JSON.stringify(down)).not.toMatch(/surplus/i);
  });
});

describe("buildLeagueView: rosters with ROS points (§6 step 7)", () => {
  it("puts my team first, then the table's order; IR and taxi after the active roster, by position then ROS", () => {
    expect(v.rosters.map((r) => [r.teamId, r.isMine])).toEqual([
      ["1", true],
      ["2", false],
      ["3", false],
      ["4", false],
    ]);
    expect(roster("1")?.players.map((p) => [p.id, p.group])).toEqual([
      ["101", "active"],
      ["102", "active"],
      ["103", "active"],
      ["104", "active"],
      ["105", "active"],
      ["106", "active"],
      ["108", "active"],
      ["MIN", "active"],
      ["107", "ir"],
    ]);
    expect(roster("2")?.players.slice(-1).map((p) => [p.id, p.group])).toEqual([["206", "ir"]]);
    expect(roster("3")?.players.slice(-1).map((p) => [p.id, p.group])).toEqual([["306", "taxi"]]);
    expect(before.rosters[0]?.summary).toBe("88.5 pts/wk · 529 ROS pts");
  });

  it("shows ROS points split into regular season and playoffs, games left and bye status", () => {
    expect(player("1", "101")).toMatchObject({ name: nameOf("101"), pos: "QB", nflTeam: "MIN", injury: null, rosText: "110", splitText: "44 / 66", gamesText: "5 games", byeText: "bye done" });
    expect(player("1", "102")).toMatchObject({ byeText: "bye wk 14", gamesText: "5 games" });
    expect(player("1", "MIN")).toMatchObject({ pos: "D/ST", name: "Vikings D/ST" });
    // Before kickoff his week 12 game still counts.
    expect(before.rosters[0]?.players.find((p) => p.id === "101")).toMatchObject({ rosText: "132", gamesText: "6 games" });
  });

  it("badges injuries, PROBABLE included, and an IR-slot player whose status isn't IR (labels.ts INJURY_LABEL)", () => {
    expect(player("1", "103").injury).toEqual({ short: "Q", long: "Questionable", tone: "warn" });
    expect(player("1", "104").injury).toEqual({ short: "P", long: "Probable", tone: "muted" });
    expect(player("1", "107").injury).toEqual({ short: "IR", long: "Injured reserve", tone: "danger" });
    expect(player("2", "206")).toMatchObject({ group: "ir", injury: { short: "D", long: "Doubtful", tone: "warn" }, lineupCost: null });
  });

  it("shows values, saying what ~ means (an estimate or a flat minimum), and the lineup cost (scenario MV_lose, else expected-value)", () => {
    expect(player("1", "101").value).toEqual({ text: "7,342", estimated: false, title: "FantasyCalc trade value", srText: null });
    expect(player("1", "108").value).toMatchObject({ text: "~180", estimated: true, srText: "(our estimate)" });
    expect(player("1", "MIN").value).toMatchObject({ text: "~107", estimated: true, srText: "(our minimum value)" });
    expect(player("1", "101").lineupCost).toBe("58.2");
    expect(player("1", "106").lineupCost).toBe("2"); // no scenario value: expected-value lineups
    expect(player("1", "107").lineupCost).toBeNull(); // IR: not in the lineup
  });

  it("defines lineup cost in lineup points, with the playoff weighting while playoff weeks count", () => {
    expect(v.lineupCostTitle).toBe(`Rest-of-season lineup points his team would lose without him, with playoff weeks counted ${config.lineups.playoffWeight}×`);
    const f = leagueFixture();
    f.model = { ...f.model, weeks: [12, 13, 14], regularWeeks: [12, 13, 14], playoffWeeks: [] };
    expect(of(f).lineupCostTitle).toBe("Rest-of-season lineup points his team would lose without him");
  });

  it("breaks ROS points down week by week, with byes, injuries, playoff weeks, and a game already under way shown like a bye", () => {
    const qb = player("1", "101");
    expect(qb.weeks.map((w) => [w.week, w.pointsText, w.availabilityText, w.note, w.playoff, w.started])).toEqual([
      [12, "—", "—", "Game already started", false, true],
      [13, "22", "100%", null, false, false],
      [14, "22", "100%", null, false, false],
      [15, "22", "100%", null, true, false],
      [16, "22", "100%", null, true, false],
      [17, "22", "100%", null, true, false],
    ]);
    expect(qb.weeks[0]?.points).toBe(0);
    // Not a 0% chance to play: nobody's "Plays" reads 0% for a game that has kicked off.
    expect(v.rosters.flatMap((r) => r.players).flatMap((p) => p.weeks.filter((w) => w.started).map((w) => w.availabilityText))).toEqual(["—", "—", "—"]);
    expect(player("1", "104").weeks[0]).toMatchObject({ pointsText: "—", note: "Game already started", started: true });
    expect(player("1", "102").weeks.find((w) => w.week === 14)).toMatchObject({ pointsText: "—", availabilityText: "—", note: "Bye", started: false });
    expect(player("1", "103").weeks[0]).toMatchObject({ availabilityText: "85%", note: "Questionable", started: false });
    expect(player("1", "103").weeks[1]?.note).toBeNull();
    expect(player("1", "107").weeks.map((w) => w.note)).toEqual(["Injured reserve", "Injured reserve", "Injured reserve", null, null, null]);
    expect(qb.weeksText.split("\n")).toEqual([
      "Wk 12: game already started",
      "Wk 13: 22 pts, 100%",
      "Wk 14: 22 pts, 100%",
      "Wk 15 (playoffs): 22 pts, 100%",
      "Wk 16 (playoffs): 22 pts, 100%",
      "Wk 17 (playoffs): 22 pts, 100%",
    ]);
    expect(player("1", "102").weeksText).toContain("Wk 14: bye");
    // Before kickoff the same week is an ordinary one.
    const qbBefore = before.rosters[0]?.players.find((p) => p.id === "101");
    expect(qbBefore?.weeks[0]).toMatchObject({ pointsText: "22", availabilityText: "100%", note: null, started: false });
  });
});

describe("buildLeagueView: conflicting ESPN signals (§6 step 3, PlayerModel.availabilityNote)", () => {
  it("says which signal a conflicted player follows: a short line for his row, the sentence for his breakdown and hover", () => {
    // Team 1's questionable RB: ESPN expects him back in week 15, but Sleeper still projects him this week.
    const q = player("1", "103");
    expect(q.availabilityNote).toEqual({ short: "ESPN says back wk 15; using Sleeper", long: "ESPN: questionable, return week 15 — using Sleeper's projection (questionable this week, then healthy)" });
    expect(q.weeksText.split("\n")[0]).toBe(q.availabilityNote?.long);
    expect(q.weeks[0]?.note).toBe("Questionable"); // the tag's one-week table this week
    // Team 2's doubtful RB follows his return date (week 16, give or take a week): the weeks he's sure to miss say so.
    const d = player("2", "206");
    expect(d.availabilityNote).toEqual({ short: "Out until ~wk 16 (ESPN)", long: "ESPN: doubtful, return week 16 — following the return date (Sleeper doesn't project him this week)" });
    expect(d.weeks.map((w) => w.note)).toEqual(["Out until ~wk 16 (ESPN)", "Out until ~wk 16 (ESPN)", "Out until ~wk 16 (ESPN)", null, null, null]);
    // Everyone else has none.
    expect(v.rosters.flatMap((r) => r.players).filter((p) => p.availabilityNote).map((p) => p.id)).toEqual(["103", "206"]);
  });

  it("words every case: out for the season (a return week after the NFL's last), a low Sleeper projection, no healthy rate to compare", () => {
    const note = (over: Partial<Parameters<typeof availabilityNoteText>[0]>) => ({ status: "QUESTIONABLE" as const, returnWeek: 8, used: "returnDate" as const, sleeperNow: null, healthyRate: 14.26, ...over });
    expect(availabilityNoteText(note({ status: "PROBABLE", returnWeek: 19, used: "sleeper", sleeperNow: 13 }), 18)).toEqual({
      short: "ESPN says out for the season; using Sleeper",
      long: "ESPN: probable, out for the season — using Sleeper's projection (probable this week, then healthy)",
    });
    expect(availabilityNoteText(note({ returnWeek: 19 }), 18)).toEqual({ short: "Out for the season (ESPN)", long: "ESPN: questionable, out for the season — following the return date (Sleeper doesn't project him this week)" });
    // Without the NFL's last week, week 19 is just a week.
    expect(availabilityNoteText(note({ returnWeek: 19 }), undefined).short).toBe("Out until ~wk 19 (ESPN)");
    expect(availabilityNoteText(note({ sleeperNow: 3.14 }), 18).long).toBe(
      `ESPN: questionable, return week 8 — following the return date (Sleeper projects him for only 3.1 points this week, under ${Math.round(config.projections.staleReturnShare * 100)}% of his healthy 14.3)`,
    );
    expect(availabilityNoteText(note({ sleeperNow: 3.14, healthyRate: null, status: "DOUBTFUL" }), 18).long).toBe(
      "ESPN: doubtful, return week 8 — following the return date (there's no healthy projection to compare Sleeper's with)",
    );
    // In his bye week Sleeper projects nobody: the sentence says why the date is followed.
    expect(availabilityNoteText(note({}), 18, true).long).toBe("ESPN: questionable, return week 8 — following the return date (it's his bye week, so Sleeper doesn't project him)");
    // Sleeper's projections for this week didn't load (the engine's sleeperUnavailable): the tiebreaker is missing, which isn't Sleeper not projecting him.
    expect(availabilityNoteText(note({ sleeperUnavailable: true }), 18)).toEqual({
      short: "Out until ~wk 8 (ESPN)",
      long: "ESPN: questionable, return week 8 — following the return date (Sleeper's projections for this week didn't load, so there's nothing to break the tie)",
    });
    expect(availabilityNoteText(note({ sleeperUnavailable: false }), 18).long).toContain("(Sleeper doesn't project him this week)");
  });

  it("reads the bye from the model: a conflicted player whose team is off this week", () => {
    const f = leagueFixture({ gameDay: false });
    const pm = f.model.players["206"];
    if (!pm) throw new Error("fixture RB missing");
    f.model.players["206"] = { ...pm, weekly: pm.weekly.map((w, i) => (i === 0 ? { ...w, bye: true, p: 0, a: 0 } : w)) };
    const view = of(f, { now: BEFORE_KICKOFF });
    expect(view.rosters.find((r) => r.teamId === "2")?.players.find((p) => p.id === "206")?.availabilityNote?.long).toBe(
      "ESPN: doubtful, return week 16 — following the return date (it's his bye week, so Sleeper doesn't project him)",
    );
  });
});

describe("buildLeagueView: each team's best free-agent move (§7, TeamModel.waiver)", () => {
  const withWaiver = (teamId: string, waiver: TeamModel["waiver"]) => {
    const f = leagueFixture();
    f.model.teams = f.model.teams.map((t) => (t.id === teamId ? { ...t, waiver } : t));
    return of(f).rosters.find((r) => r.teamId === teamId)?.waiver;
  };

  it("heads a roster with its best move and the lineup points it gains (weighted like lineup cost, and saying so), from scenario lineups when there are any", () => {
    expect(roster("1")?.waiver).toEqual({
      move: `add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}`,
      gain: "+4.6 lineup pts",
      weighting: `(playoffs count ${config.lineups.playoffWeight}×)`,
      text: `Best free-agent move: add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}: +4.6 lineup pts (playoffs count ${config.lineups.playoffWeight}×)`,
    });
    expect(FREE_AGENT_MOVE_LABEL).toBe("Best free-agent move");
    // Never "ROS pts": that's the plain total in the same header.
    expect(v.rosters.map((r) => r.waiver?.text ?? "").join(" ")).not.toContain("ROS pts");
  });

  it("drops the weighting note when no playoff week is left to count", () => {
    const f = leagueFixture();
    f.model = { ...f.model, weeks: [12, 13, 14], regularWeeks: [12, 13, 14], playoffWeeks: [] };
    expect(of(f).rosters[0]?.waiver).toMatchObject({ gain: "+4.6 lineup pts", weighting: null, text: `Best free-agent move: add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}: +4.6 lineup pts` });
  });

  it("says when the free agent goes into an open spot, with the expected-value gain when a team has no scenarios", () => {
    expect(roster("3")?.waiver?.text).toBe(`Best free-agent move: add ${nameOf("902")} (RB, NE) into an open spot: +2.4 lineup pts (playoffs count ${config.lineups.playoffWeight}×)`);
  });

  it("shows no move when none helps, or when its gain rounds to nothing", () => {
    expect(roster("2")?.waiver).toBeNull();
    // Team 4: a scenario gain of 0.04 (its expected-value gain of 0.3 doesn't count when scenarios exist).
    expect(roster("4")?.waiver).toBeNull();
    expect(withWaiver("4", { add: "901", drop: null, gainEv: 0.3, gainScen: 0.05 })?.gain).toBe("+0.1 lineup pts");
    expect(withWaiver("4", { add: "901", drop: null, gainEv: 2, gainScen: -0.5 })).toBeNull();
    expect(withWaiver("3", { add: "902", drop: null, gainEv: Number.NaN, gainScen: null })).toBeNull();
  });

  it("names a team defense by its name (plus DEF when the name doesn't say it), leaves out a missing NFL team, and never breaks on an unknown player", () => {
    expect(withWaiver("3", { add: "BAL", drop: "PHI", gainEv: 12.06, gainScen: null })?.move).toBe("add Ravens D/ST, drop Eagles D/ST");
    // Sleeper names a defense after its team ("Baltimore Ravens").
    const f = leagueFixture({ platform: "sleeper" });
    const bal = f.snapshot.players.BAL;
    if (bal) f.snapshot.players.BAL = { ...bal, name: "Baltimore Ravens" };
    f.model.teams = f.model.teams.map((t) => (t.id === "3" ? { ...t, waiver: { add: "BAL", drop: "PHI", gainEv: 5, gainScen: null } } : t));
    expect(of(f).rosters.find((r) => r.teamId === "3")?.waiver?.move).toBe("add Baltimore Ravens (DEF), drop Eagles D/ST");
    expect(withWaiver("1", { add: "903", drop: "999", gainEv: 1, gainScen: null })?.move).toBe(`add ${nameOf("903")} (WR), drop Unknown player (999)`);
    expect(withWaiver("3", { add: "LV", drop: null, gainEv: 1, gainScen: null })?.move).toBe("add Unknown player (LV) into an open spot");
    expect(withWaiver("3", { add: "904", drop: null, gainEv: 1, gainScen: null })?.move).toBe(`add ${nameOf("904")} (K, LV) into an open spot`);
  });
});

describe("buildLeagueView: free agents", () => {
  it("lists the best few by ROS points at each startable position only", () => {
    expect(v.freeAgents.map((g) => [g.pos, g.players.map((p) => p.id)])).toEqual([
      ["RB", ["901", "902"]],
      ["WR", ["903"]],
    ]);
    const drifter = v.freeAgents[1]?.players[0];
    expect(drifter).toMatchObject({ nflTeam: "FA", byeText: "bye unknown", value: null, lineupCost: null, group: "fa" });
    expect(drifter?.injury).toEqual({ short: "NA", long: "Not an active NFL player", tone: "muted" });
    expect(drifter?.weeks.every((w) => w.note === "Not an active NFL player")).toBe(true);
    expect(v.freeAgents[0]?.players[1]?.value).toBeNull();
  });
});

describe("buildLeagueView: without a team", () => {
  const none = view({ myTeamId: null });

  it("asks the user to pick one, marks no row as mine, and keeps the table's order for rosters", () => {
    expect(none.myTeam).toEqual({ id: null, name: null, source: "none", hint: "Pick your team on the Import Report to see your needs and trade partners." });
    expect(none.teams.some((t) => t.isMine)).toBe(false);
    expect(none.rosters.map((r) => r.teamId)).toEqual(["2", "3", "1", "4"]);
  });

  it("asks to confirm a team taken from a pasted link", () => {
    const link = view({}, { myTeamSource: "link" });
    expect(link.myTeam.hint).toBe("We guessed Moonbeam Mudcats from your link. Confirm it on the Import Report.");
    expect(v.myTeam).toEqual({ id: "1", name: "Moonbeam Mudcats", source: "platform", hint: null });
  });
});

describe("buildLeagueView: how these numbers work", () => {
  it("explains the model with config's numbers", () => {
    const text = v.explain.map((e) => `${e.title}: ${e.text}`).join("\n");
    expect(v.explain.map((e) => e.title)).toEqual(["Projected points", "Availability", "Depth counts", "Rest-of-season (ROS) points", "Week 12 is under way", "Playoff odds", "Trade values", "Needs, trade chips and partners"]);
    expect(text).toContain(`up to ${Math.round(config.projections.actualWeight * 100)}% once he has played ${config.projections.actualFullGames} games`);
    expect(text).toContain("ESPN's own projections differ from Sleeper's by 14% on average this week, more than the 10% we allow");
    expect(text).toContain("Out: 0% this week, 50% next week, 85% in 2 weeks; Doubtful 25%, Questionable 85% and Probable 95% this week");
    expect(text).toContain("RB 14%, TE 14%, WR 12%, QB 6%, K 2%");
    expect(text).toContain(`${config.lineups.scenarios} simulated runs of injuries and byes`);
    expect(text).toContain("from week 12 through week 17 (the last playoff week)");
    expect(text).toContain(
      `Lineup cost and each team's best free-agent move (shown at the top of its roster when one helps) are in lineup points: starting-lineup points over the rest of the season, with playoff weeks counted ${config.lineups.playoffWeight}× (they decide titles), so they don't add up exactly with ROS points.`,
    );
    expect(text).toContain("It's measured after the team's best free-agent move, so it's never negative.");
    expect(text).toContain("FantasyCalc in your league's format (8 teams · half-PPR · 1 QB · redraft).");
    // The format's substitutions are said here once (the server's notes repeating them are dropped).
    expect(text).toContain("Where your league doesn't match one of FantasyCalc's formats exactly: 4 teams → FantasyCalc's 8-team values. Players FantasyCalc doesn't value");
    // The two parts as the engine measures them (league.ts step 6): the receiving team keeps its best free-agent move (a pickup it
    // could make anyway doesn't count), but his own team's cost gives it one move, so the pickup it would make anyway can be spent
    // replacing him (CHIPS-2: never "a pickup either team could make anyway doesn't count").
    expect(text).toContain(
      `A trade chip is a player worth at least ${config.needs.chipMinGap} more lineup points to another team than to his own: what he'd add to that team's lineup, measured after its best free-agent move (so a pickup it could make anyway doesn't count), minus what his own team would lose without him when it can make only one free-agent move (a replacement for him, or the pickup it would make anyway).`,
    );
    expect(text).not.toContain("either team could make anyway");
    // The positions trade search leaves out that this league starts (a D/ST, no kicker).
    expect(text).toContain("Team defenses aren't trade chips: trade suggestions leave them out.");
    expect(text).toContain("teams with a trade chip who would start for you, when none of yours would start for them, come after them.");
    expect(text).not.toMatch(/surplus/i);
  });

  it("names every excluded position the league starts, in the platform's words", () => {
    const f = leagueFixture({ platform: "sleeper" });
    f.snapshot = { ...f.snapshot, settings: { ...f.snapshot.settings, lineup: [...f.snapshot.settings.lineup, { slot: "K", count: 1, eligible: ["K"] }, { slot: "IDP_FLEX", count: 1, eligible: ["DL", "LB", "DB"] }] } };
    expect(of(f).explain.find((e) => e.title === "Needs, trade chips and partners")?.text).toContain("Kickers, team defenses and defensive players aren't trade chips");
  });

  it("says what a week in progress does to the numbers, only while one is", () => {
    const weekText =
      'Once a week\'s first game kicks off, the team numbers (points per week, team ROS points, positional strength, needs, lineup cost, free-agent moves and trade partners) count from the next week, week 13: lineups are locking and week 12\'s points are being scored, so it no longer says how good a team is. A player\'s own ROS points still count his week 12 game if it hasn\'t kicked off; one that has shows "Game already started".';
    // The playoff odds still play that week, from pre-game projections (§8; lead decision D6).
    expect(v.explain.find((e) => e.title === "Week 12 is under way")?.text).toBe(
      `${weekText} The playoff odds still play all of week 12's games from projections, as if none had started: live scores aren't read yet, and the rosters and injury news are today's.`,
    );
    expect(before.explain.map((e) => e.title)).not.toContain("Week 12 is under way");
    // Without odds, there's nothing to say about them.
    const f = leagueFixture();
    f.model.odds = null;
    expect(of(f).explain.find((e) => e.title === "Week 12 is under way")?.text).toBe(weekText);
  });

  it("explains the playoff odds with the simulation's own numbers and the league's rules (§8)", () => {
    expect(v.explain.find((e) => e.title === "Playoff odds")?.text).toBe(
      `We play out the rest of the season 5,000 times. Each week, every team's score is drawn around its projected starting lineup (its average over the 32 simulated runs of injuries and byes), with a spread that covers its starters' week-to-week swings and how much injuries and byes could change the lineup. Each simulated game adds to today's records. Each simulated season is then ranked by your league's rules: win percentage, then points for. The top 2 make the playoffs and meet for the title. A team's chance of a playoff spot or the title is the share of those seasons where it happened. Each time the odds are worked out, every team and week gets the same random draws (common random numbers), so when trade ideas compare the odds before and after a trade, the difference comes from the trade, not from the luck of the draw. Your remaining schedule flags a week as risky when your chance to win it is under ${Math.round(RISKY_WIN_CHANCE * 100)}%, or when ${RISKY_BYES} or more of your likely starters (your best lineup by projected points per game left) are on bye.`,
    );
  });

  it("words the league's own playoff rules: byes, re-seeding, the tiebreaker, division winners, median games, and what's assumed", () => {
    const text = (edit: (f: LeagueFixture) => void, opts: Parameters<typeof leagueFixture>[0] = {}) => {
      const f = leagueFixture(opts);
      edit(f);
      return of(f).explain.find((e) => e.title === "Playoff odds")?.text ?? "";
    };
    const odds = (f: LeagueFixture, edit: Partial<SeasonOdds>) => (f.model.odds = { ...oddsOf(f), ...edit });
    const settings = (f: LeagueFixture, edit: Partial<LeagueFixture["snapshot"]["settings"]>) => (f.snapshot = { ...f.snapshot, settings: { ...f.snapshot.settings, ...edit } });
    // Parker's league: 6 teams make it, the top 2 seeds get byes, a fixed bracket (ESPN's own tiebreaker).
    expect(text((f) => odds(f, { playoffTeams: 6, byes: 2 }))).toContain(
      "win percentage, then points for. The top 6 make the playoffs, and the top 2 seeds get a first-round bye. The bracket is fixed: no re-seeding after each round.",
    );
    expect(text((f) => odds(f, { playoffTeams: 3, byes: 1, reseed: { value: true, assumed: false } }))).toContain(
      "The top 3 make the playoffs, and the top seed gets a first-round bye. After each round the teams left are re-seeded, best seed against worst.",
    );
    expect(text((f) => odds(f, { playoffTeams: 4, reseed: { value: false, assumed: true }, tiebreaker: { rule: "pointsFor", assumed: true } }))).toContain(
      "win percentage, then points for (assumed: the platform doesn't say which tiebreaker your league uses). The top 4 make the playoffs. The bracket is fixed: no re-seeding after each round (assumed: the platform doesn't say).",
    );
    expect(text((f) => odds(f, { tiebreaker: { rule: "headToHead", assumed: false } }))).toContain("win percentage, then head-to-head record.");
    expect(text((f) => odds(f, { tiebreaker: { rule: "divisionRecord", assumed: false } }))).toContain("win percentage, then division record.");
    // Division winners seeded first (Sleeper), which takes 2+ divisions.
    const divisions = [
      { id: "a", teamIds: ["1", "2"] },
      { id: "b", teamIds: ["3", "4"] },
    ];
    expect(text((f) => settings(f, { divisions, playoffSeeding: { reseed: false, divisionWinnersFirst: true } }))).toContain("win percentage, then points for, with division winners seeded first.");
    expect(text((f) => settings(f, { divisions: divisions.slice(0, 1), playoffSeeding: { reseed: false, divisionWinnersFirst: true } }))).not.toContain("division winners");
    // …said to be assumed when the adapter warns the platform doesn't say (season.ts DIVISION_RULE_ASSUMED), as the
    // standings notes say it: a Sleeper layout its help center doesn't cover (SETTING_INFERRED at settings.divisions), or ESPN.
    const warned = (code: string, platformPath?: string) => (f: LeagueFixture) => {
      settings(f, { divisions, playoffSeeding: { reseed: false, divisionWinnersFirst: true } });
      f.snapshot = { ...f.snapshot, warnings: [...f.snapshot.warnings, { code, message: "(the adapter's words)", ...(platformPath ? { platformPath } : {}) }] };
    };
    const assumedFirst = "win percentage, then points for, with division winners seeded first (assumed: the platform doesn't say).";
    expect(text(warned("SETTING_INFERRED", "settings.divisions"))).toContain(assumedFirst);
    expect(text(warned("ESPN_SEEDING_DIVISIONS_UNKNOWN"))).toContain(assumedFirst);
    // Another inferred setting isn't this rule.
    expect(text(warned("SETTING_INFERRED", "settings.trade_deadline"))).toContain("win percentage, then points for, with division winners seeded first.");
    // Median games, points-only leagues, no playoffs, no availability scenarios.
    expect(text((f) => settings(f, { medianGame: true }))).toContain(
      "Each simulated game adds to today's records, as does a weekly game against the league median (a win for a top-half score). Each simulated season is then ranked",
    );
    expect(text((f) => settings(f, { pointsOnly: true }))).toContain("Each simulated season ranks teams by total points. The top 2 make the playoffs");
    // No playoffs, or one team: worded like the engine's note, and only the title's chance is named (the standings show no Playoffs column).
    expect(text((f) => odds(f, { playoffTeams: 0 }))).toContain(
      "There are no playoffs, so the title goes to the top of the final standings. A team's chance of the title is the share of those seasons where it happened.",
    );
    expect(text((f) => odds(f, { playoffTeams: 1 }))).toContain(
      "One team makes the playoffs, so the title goes to the top of the final standings. A team's chance of the title is the share of those seasons where it happened.",
    );
    // The odds named are the ones the standings show: a bye only when the league has byes whose odds are known.
    expect(text((f) => withByes(f))).toContain("A team's chance of a playoff spot, a bye or the title is the share of those seasons where it happened.");
    expect(text((f) => withByes(f, {}))).toContain("A team's chance of a playoff spot or the title is the share");
    expect(text((f) => (f.model = { ...f.model, scenarios: 0 }))).toContain("drawn around its projected starting lineup, with a spread that covers its starters' week-to-week swings. Each");
    // The schedule's risk rule only when the schedule shows; no paragraph without odds.
    expect(text(() => {}, { myTeamId: null })).not.toContain("remaining schedule");
    expect(text((f) => (f.model.odds = null))).toBe("");
  });

  it("says how unvalued players got their values: an estimate from projected points, and a flat minimum where FantasyCalc values too few (K, D/ST)", () => {
    const valuesText = (edit: (f: LeagueFixture) => void) => {
      const f = leagueFixture();
      f.model.market = { ...f.model.market, format: { isDynasty: false, numQbs: 1, numTeams: 8, ppr: 0.5, substitutions: [] } };
      edit(f);
      return of(f).explain.find((e) => e.title === "Trade values")?.text;
    };
    const intro = "Values come from FantasyCalc in your league's format (8 teams · half-PPR · 1 QB · redraft).";
    const estimate = "Players FantasyCalc doesn't value (it skips deep bench players) get our estimate from their projected points";
    const floor = "At K and D/ST, FantasyCalc values too few players to estimate from, so those without a FantasyCalc value get a flat minimum value (~107), whatever they project";
    expect(valuesText(() => {})).toBe(`${intro} ${estimate}. ${floor}. Both are marked ~.`);
    const only = (source: "estimate" | "floor") => (f: LeagueFixture) => {
      for (const pm of Object.values(f.model.players)) if (pm.value && pm.value.source !== source) pm.value = { ...pm.value, source: "fantasycalc" };
    };
    expect(valuesText(only("estimate"))).toBe(`${intro} ${estimate}, marked ~.`);
    expect(valuesText(only("floor"))).toBe(`${intro} ${floor}, marked ~.`);
    expect(valuesText(only("fantasycalc" as never))).toBe(intro);
    // Different minimums at different positions: no single amount to quote.
    expect(
      valuesText((f) => {
        const k = f.model.players["904"];
        if (k?.value) k.value = { value: 90, source: "floor" };
      }),
    ).toContain("get a flat minimum value, whatever they project");
    // Sleeper's name for team defenses.
    expect(valuesText((f) => (f.snapshot = { ...f.snapshot, platform: "sleeper" }))).toContain("At K and DEF, FantasyCalc values too few players");
  });
});

describe("buildLeagueView: the season is over", () => {
  it("has no weeks left to project", () => {
    const f = leagueFixture();
    f.model = { ...f.model, weeks: [], regularWeeks: [], playoffWeeks: [], inProgressWeek: null, teams: f.model.teams.map((t) => ({ ...t, ev: { lv: [], ros: 0, ppw: 0 }, scen: null })) };
    const over = of(f);
    expect(over.over).toBe(true);
    expect(over.header.weeksLeft).toBe("No weeks left");
    expect(over.header.inProgress).toBeNull();
    expect(over.teams.every((t) => t.perWeekText === "—")).toBe(true);
    expect(over.explain.find((e) => e.title.startsWith("Rest-of-season"))?.text).toMatch(/season is over/);
    expect(over.playoffsLeft).toBe(false);
  });

  it("averages the playoff weeks once the regular season is done", () => {
    const f = leagueFixture();
    f.model = { ...f.model, weeks: [15, 16], regularWeeks: [], playoffWeeks: [15, 16], inProgressWeek: null, teams: f.model.teams.map((t) => ({ ...t, ev: { lv: [100, 90], ros: 237.5, ppw: 0 }, scen: null })) };
    const po = of(f);
    expect(po.teams[0]?.perWeekText).toBe("95");
    expect(po.header.weeksLeft).toBe("2 weeks left: 0 regular season, 2 playoffs");
    // Fewer weeks left than the strength window: the labels say so.
    expect(po.heatmap.windowLabel.next).toBe("Next 2 weeks");
    expect(po.heatmap.caption.next).toContain("next 2 weeks (weeks 15–16).");
    expect(po.playoffsLeft).toBe(true);
  });
});

describe("shortName", () => {
  it("shortens player names, keeping team defenses whole", () => {
    expect(shortName("Justin Jefferson")).toBe("J. Jefferson");
    expect(shortName("Travis Etienne Jr.")).toBe("T. Etienne");
    expect(shortName("Gardner Minshew II")).toBe("G. Minshew");
    expect(shortName("Amon-Ra St. Brown")).toBe("A. St. Brown");
    expect(shortName("Bartholomew Maximilian Worthington-Fitzgerald III")).toBe("B. Worthington-Fitzgerald");
    expect(shortName("Kyle Van Noy")).toBe("K. Van Noy");
    expect(shortName("Van Jefferson")).toBe("V. Jefferson");
    expect(shortName("Jacory Croskey-Merritt")).toBe("J. Croskey-Merritt");
    expect(shortName("Vikings D/ST", "DEF")).toBe("Vikings D/ST");
    expect(shortName("Cher")).toBe("Cher");
  });
});
