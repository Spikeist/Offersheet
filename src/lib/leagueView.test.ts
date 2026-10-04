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
  BEST_TARGET_HARDER_LABEL,
  BEST_TARGET_LABEL,
  BEST_TARGET_MIN,
  BEST_TARGET_NOTE,
  BIGGER_UPGRADE_LABEL,
  FREE_AGENT_PICKUPS_LABEL,
  HARDER_TO_GET_TAG,
  RISKY_BYES,
  RISKY_WIN_CHANCE,
  SEASON_OVER_PARTNERS_TEXT,
  SEASON_OVER_TEXT,
  SETTINGS_HREF,
  STARTER_TAG,
  UNDER_WAY_TEXT,
  availabilityNoteText,
  blendIsOwnPoint,
  blendText,
  buildLeagueView,
  heatStep,
  likelyStarters,
  oddsCell,
  shortName,
  type LeagueViewInput,
  type PartnerCard,
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

  it("shows each team's biggest trade chips, at most chipsShown: who, his gap in lineup points, the team he'd help most ('you' for mine), and what he costs his team a week", () => {
    expect(config.needs.chipsShown).toBe(3);
    const t2 = v.teams.find((t) => t.id === "2")?.chips ?? [];
    // Team 2 has four chips (the engine lists them biggest gap first); the table shows three. Each costs "his team" so many
    // lineup points a week (TradeChip.costPerWeek: 4, 9 and 16 over Σ ω = 2 + 3 × 1.25 on game day); its starters are tagged.
    // Not "costs them": right after "to Quasar Quokkas" it read as if that team lost the points (review of track A1).
    expect(t2.map((c) => [c.text, c.kind, c.tags.map((t) => t.text)])).toEqual([
      ["C. Snoot: worth +31 to you · costs his team 0.7 pts/wk", "chip", []],
      ["I. Fumblewick: worth +18 to Tundra Tortoises · costs his team 1.6 pts/wk", "chip", [STARTER_TAG]],
      ["P. Plunk: worth +12 to Quasar Quokkas · costs his team 2.8 pts/wk", "chip", [STARTER_TAG]],
    ]);
    expect(v.teams.flatMap((t) => t.chips.map((c) => c.text)).some((x) => x.includes("costs them"))).toBe(false);
    // The title gives every part, to a tenth, in lineup points weighted like lineup cost, and per week; a starter says so.
    const w = `(playoffs count ${config.lineups.playoffWeight}×)`;
    expect(t2[0]?.title).toBe(
      `Cornelius Snoot (RB): worth 31.2 more lineup pts ${w} to Moonbeam Mudcats (your team) than to his own team. Moonbeam Mudcats (your team) would gain 35.2 with him (after its free-agent pickups); his team would lose 4 without him, 0.7 a week.`,
    );
    expect(t2[1]?.title).toBe(
      `Ignatius Fumblewick (RB): worth 18.4 more lineup pts ${w} to Tundra Tortoises than to his own team. Tundra Tortoises would gain 27.4 with him (after its free-agent pickups); his team would lose 9 without him, 1.6 a week. He starts for his team.`,
    );
    // My own chip costs "you"; a starter of mine would start "for you".
    const mine = v.teams.find((t) => t.id === "1")?.chips ?? [];
    expect(mine.map((c) => [c.text, c.tags])).toEqual([["W. Spoons: worth +15 to Gravel Gophers · costs you 0.3 pts/wk", []]]);
    expect(mine[0]?.title).toContain("; your team would lose 2 without him, 0.3 a week.");
    const f = leagueFixture();
    f.model.teams = f.model.teams.map((t) => (t.id === "1" ? { ...t, chips: t.chips.map((c) => ({ ...c, starter: true })) } : t));
    expect(of(f).teams.find((t) => t.id === "1")?.chips[0]?.title).toMatch(/0\.3 a week\. He starts for you\.$/);
    expect(v.teams.find((t) => t.id === "4")?.chips.map((c) => c.text)).toEqual(["O. Wren: worth +13 to you · costs his team 2.4 pts/wk"]);
    expect(v.teams.flatMap((t) => t.needs).every((n) => n.tags.length === 0)).toBe(true);
    expect(v.chipLegend).toBe("trade chip: worth at least 10 more lineup pts to another team than to his own");
  });

  it("tags a chip 'starter' as the engine does (after his team's pickups), and says when those pickups would drop him anyway (review of track A2)", () => {
    // The engine never tags a player its pickups drop (TradeChip.starter reads V*(T)'s lineup): his cost is 0, and the title says why.
    const f = leagueFixture();
    f.model.teams = f.model.teams.map((t) =>
      t.id === "2"
        ? { ...t, faMoves: [{ add: "901", drop: "203", gainEv: 5, gainScen: 4 }], chips: t.chips.map((c) => (c.playerId === "203" ? { ...c, cost: 0, costPerWeek: 0, gap: c.maxOther, starter: false } : c)) }
        : t.id === "1"
          ? { ...t, faMoves: [{ add: "901", drop: "106", gainEv: 5, gainScen: 4 }] }
          : t,
    );
    const view = of(f);
    const fumblewick = view.teams.find((t) => t.id === "2")?.chips.find((c) => c.key === "203");
    expect(fumblewick?.tags).toEqual([]);
    expect(fumblewick?.title).toMatch(/his team would lose 0 without him, 0 a week\. His team's free-agent pickups would drop him anyway\.$/);
    // My own chip: "Your" pickups.
    expect(view.teams.find((t) => t.id === "1")?.chips[0]?.title).toMatch(/; your team would lose 2 without him, 0\.3 a week\. Your free-agent pickups would drop him anyway\.$/);
    // A chip no pickup drops says nothing of the kind.
    expect(view.teams.find((t) => t.id === "4")?.chips[0]?.title).not.toContain("drop him anyway");
  });

  it("tags another team's trade chip 'Harder to get' after 'starter' when his manager would want a little extra (planner addendum to Checkpoint 3, §2), the title saying why", () => {
    const t3 = v.teams.find((t) => t.id === "3")?.chips ?? [];
    expect(t3.map((c) => [c.key, c.tags])).toEqual([
      [
        "302",
        [
          { text: STARTER_TAG, kind: "starter" },
          { text: HARDER_TO_GET_TAG, kind: "harder" },
        ],
      ],
      ["303", [{ text: STARTER_TAG, kind: "starter" }]],
    ]);
    expect(t3[0]?.text).toBe("O. Kettleburn: worth +12 to Tundra Tortoises · costs his team 5.2 pts/wk");
    expect(t3[0]?.title).toMatch(/ He starts for his team\. Harder to get: his team's second most valuable player and one of the top 12 players by trade value, so his manager will likely want a little extra for him\.$/);
    // Never on my own chips, whatever their premium: it would read as advice about my own players.
    const f = leagueFixture();
    f.model.teams = f.model.teams.map((t) => (t.id === "1" ? { ...t, premiums: { ...t.premiums, "106": { e: 0.2, rank: 1, elite: true, harderToGet: true } } } : t));
    expect(of(f).teams.find((t) => t.id === "1")?.chips[0]?.tags).toEqual([]);
    // A model without premiums (built before the addendum) tags nobody.
    const g = leagueFixture();
    g.model.teams = g.model.teams.map((t) => ({ ...t, premiums: undefined }));
    expect(of(g).teams.flatMap((t) => t.chips.flatMap((c) => c.tags)).filter((x) => x.kind === "harder")).toEqual([]);
  });

  it("drops the playoff weighting from a chip's title once no playoff week is left to count", () => {
    const f = leagueFixture();
    f.model = { ...f.model, weeks: [12, 13, 14], regularWeeks: [12, 13, 14], playoffWeeks: [] };
    expect(of(f).teams.find((t) => t.id === "1")?.chips[0]?.title).toBe(
      "Wiggleton Spoons (WR): worth 14.6 more lineup pts to Gravel Gophers than to his own team. Gravel Gophers would gain 16.6 with him (after its free-agent pickups); your team would lose 2 without him, 0.3 a week.",
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

describe("buildLeagueView: best trade partners (§7, from trade chips; planner addendum to Checkpoint 3, §2)", () => {
  const cardsOf = (f: LeagueFixture) => of(f).partners.cards;
  const leads = (c: PartnerCard | undefined) => c?.targets.map((t) => `${t.label}: ${t.text}`);
  /** The fixture with team 2's partner list replaced. */
  const withTeam2 = (theyCanGive: { playerId: string; ppw: number }[], premiums?: TeamModel["premiums"]) => {
    const f = leagueFixture();
    f.model.partners = f.model.partners.map((p) => (p.teamId === "2" ? { ...p, theyCanGive } : p));
    if (premiums !== undefined) f.model.teams = f.model.teams.map((t) => (t.id === "2" ? { ...t, premiums } : t));
    return f;
  };

  it("leads each card with who to aim for, then each side's other trade chips, in points per week, the first chipsShown and a count of the rest", () => {
    expect(v.partners.empty).toBeNull();
    expect(
      v.partners.cards.map((c) => [c.name, c.fitText, leads(c), c.theyCanGive.label, c.theyCanGive.players.map((p) => p.text), c.theyCanGive.more?.text ?? null, c.youCanGive.label, c.youCanGive.players.map((p) => p.text)]),
    ).toEqual([
      // Gloop would help me most, but he's harder to get: the best untagged one leads, Gloop second.
      [
        "Gravel Gophers",
        "Fit 2.4",
        ["Best of their trade chips: C. Snoot, +2.1/wk", "Bigger upgrade, harder to get: M. Gloop, +2.5/wk"],
        "They could also give:",
        ["I. Fumblewick (+1.2/wk)", "P. Plunk (+0.5/wk)", "P. Wobbleton (+0.4/wk)"],
        null,
        "You could give:",
        ["W. Spoons (+1.8/wk)"],
      ],
      // Mop adds less than the floor (config.needs.bestTargetMin) and nobody tagged adds more: no lead line, he's listed.
      ["Quasar Quokkas", "Fit 1.1", [], "They could give:", ["L. Mop (+0.9/wk)"], null, "You could give:", ["W. Spoons (+1.3/wk)"]],
      ["Tundra Tortoises", "Would start for you", ["Best of their trade chips: O. Wren, +1.6/wk"], "They could also give:", [], null, "You could give:", []], // one-sided: after every mutual fit
    ]);
    expect(v.partners.cards[0]?.youCanGive.more).toBeNull();
    expect(v.partners.cards.map((c) => c.mutual)).toEqual([true, true, false]);
    expect(v.partners.cards.length).toBeLessThanOrEqual(config.needs.partnersShown);
  });

  it("says on hover what each target adds to my lineup, and why a tagged one is harder to get", () => {
    const [best, bigger] = v.partners.cards[0]?.targets ?? [];
    expect(best).toEqual({ id: "204", label: BEST_TARGET_LABEL, text: "C. Snoot, +2.1/wk", name: "C. Snoot", perWeek: "+2.1/wk", title: "Cornelius Snoot: +2.1 points per week to your lineup.", harderToGet: false });
    expect(bigger).toEqual({
      id: "202",
      label: BIGGER_UPGRADE_LABEL,
      text: "M. Gloop, +2.5/wk",
      name: "M. Gloop",
      perWeek: "+2.5/wk",
      title: "Mortimer Gloop: +2.5 points per week to your lineup. Harder to get: his team's most valuable player and one of the top 12 players by trade value, so his manager will likely want a little extra for him.",
      harderToGet: true,
    });
  });

  it("marks their other harder-to-get players in the rest of the list, never mine, and says so to screen readers when they're counted", () => {
    const rest = v.partners.cards[0]?.theyCanGive.players ?? [];
    expect(rest.map((p) => [p.id, p.tag?.text ?? null])).toEqual([
      ["203", null], // their third most valuable: a top-12 player, but not harder to get
      ["205", null],
      ["201", HARDER_TO_GET_TAG],
    ]);
    expect(rest[2]?.title).toBe("Pip Wobbleton: +0.4 points per week to the other lineup. Harder to get: his team's second most valuable player and one of the top 12 players by trade value, so his manager will likely want a little extra for him.");
    // My players are never marked, whatever their premium for me.
    expect(v.partners.cards.flatMap((c) => c.youCanGive.players).every((p) => p.tag === null)).toBe(true);
    // Counted ones: named with the tag in words for screen readers, and on hover.
    const f = withTeam2([
      { playerId: "204", ppw: 2.1 },
      { playerId: "203", ppw: 1.2 },
      { playerId: "205", ppw: 0.5 },
      { playerId: "206", ppw: 0.46 },
      { playerId: "201", ppw: 0.4 },
    ]);
    const more = cardsOf(f)[0]?.theyCanGive;
    expect(more?.players.map((p) => p.text)).toEqual(["I. Fumblewick (+1.2/wk)", "P. Plunk (+0.5/wk)", "R. Wimbleton (+0.5/wk)"]);
    expect(more?.more).toEqual({
      text: "and 1 more",
      title: "Pip Wobbleton: +0.4 points per week to the other lineup. Harder to get: his team's second most valuable player and one of the top 12 players by trade value, so his manager will likely want a little extra for him.",
      srText: "and 1 more: P. Wobbleton (+0.4/wk, harder to get)",
    });
  });

  it("leads with the best target alone when the single best one isn't harder to get", () => {
    const f = withTeam2([
      { playerId: "204", ppw: 2.1 },
      { playerId: "202", ppw: 0.8 },
    ]);
    expect(leads(cardsOf(f)[0])).toEqual(["Best of their trade chips: C. Snoot, +2.1/wk"]);
    // Gloop stays in the rest of the list, marked.
    expect(cardsOf(f)[0]?.theyCanGive.players.map((p) => [p.text, p.tag?.text ?? null])).toEqual([["M. Gloop (+0.8/wk)", HARDER_TO_GET_TAG]]);
  });

  it("says 'Best of their trade chips, harder to get' when every one is tagged (no untagged one to be bigger than), and 'They could give' without targets", () => {
    const allTagged = withTeam2([
      { playerId: "202", ppw: 2.5 },
      { playerId: "201", ppw: 0.4 },
    ]);
    const card = cardsOf(allTagged)[0];
    expect(leads(card)).toEqual(["Best of their trade chips, harder to get: M. Gloop, +2.5/wk"]);
    expect(card?.theyCanGive.players.map((p) => p.text)).toEqual(["P. Wobbleton (+0.4/wk)"]);
    expect(BEST_TARGET_HARDER_LABEL).toBe("Best of their trade chips, harder to get");
    // Nobody adds anything (the engine lists only players who do; defensively): no targets, the list as before.
    const none = withTeam2([{ playerId: "204", ppw: 0 }]);
    expect(cardsOf(none)[0]?.targets).toEqual([]);
    expect(cardsOf(none)[0]?.theyCanGive).toMatchObject({ label: "They could give:", players: [{ id: "204", text: "C. Snoot (0/wk)" }] });
  });

  it("names a best target only when he adds at least config.needs.bestTargetMin a week, as the card prints it (lead decision N12)", () => {
    expect(BEST_TARGET_MIN).toBe(config.needs.bestTargetMin);
    expect(BEST_TARGET_MIN).toBe(1); // config's default, which these cases are built around
    // Team 3's only partner player for me adds +0.9/wk: untagged, under the floor, and nobody tagged adds more. No lead line.
    expect(v.partners.cards.find((c) => c.teamId === "3")).toMatchObject({ targets: [], theyCanGive: { label: "They could give:", players: [{ id: "303", text: "L. Mop (+0.9/wk)", tag: null }], more: null } });
    // At the floor he leads ("at least"); judged as printed: 0.96 shows "+1/wk" and leads, 0.94 shows "+0.9/wk" and doesn't.
    const alone = (ppw: number) => cardsOf(withTeam2([{ playerId: "204", ppw }]))[0];
    expect(leads(alone(1))).toEqual(["Best of their trade chips: C. Snoot, +1/wk"]);
    expect(leads(alone(0.96))).toEqual(["Best of their trade chips: C. Snoot, +1/wk"]);
    expect(alone(0.94)).toMatchObject({ targets: [], theyCanGive: { label: "They could give:", players: [{ id: "204", text: "C. Snoot (+0.9/wk)" }] } });
    // An untagged best under the floor leads nothing, even next to a tagged one who adds less (he'd be no best target).
    const under = cardsOf(withTeam2([{ playerId: "204", ppw: 0.9 }, { playerId: "202", ppw: 0.5 }]))[0];
    expect(under?.targets).toEqual([]);
    expect(under?.theyCanGive.players.map((p) => [p.text, p.tag?.text ?? null])).toEqual([
      ["C. Snoot (+0.9/wk)", null],
      ["M. Gloop (+0.5/wk)", HARDER_TO_GET_TAG],
    ]);
    // Someone who shows "0/wk" leads nothing, tagged or not.
    const zero = cardsOf(withTeam2([{ playerId: "202", ppw: 0.04 }]))[0];
    expect(zero).toMatchObject({ targets: [], theyCanGive: { label: "They could give:", players: [{ id: "202", text: "M. Gloop (0/wk)", tag: { text: HARDER_TO_GET_TAG } }] } });
    // Weaker untagged chips follow the best target, in the engine's order.
    const weaker = cardsOf(withTeam2([{ playerId: "204", ppw: 2.1 }, { playerId: "203", ppw: 0.6 }, { playerId: "205", ppw: 0.2 }]))[0];
    expect(leads(weaker)).toEqual(["Best of their trade chips: C. Snoot, +2.1/wk"]);
    expect(weaker?.theyCanGive).toMatchObject({ label: "They could also give:", players: [{ text: "I. Fumblewick (+0.6/wk)" }, { text: "P. Plunk (+0.2/wk)" }] });
  });

  it("leads with the tagged one alone when no untagged one reaches the floor: the review's Team 1 card in Parker's league, +0.1/wk next to +7.2/wk", () => {
    // Parker's league with week 4 under way: Team 1's card read "Best target" for an untagged back adding +0.1/wk (ESPN
    // questionable with a far return date) and "Bigger upgrade, harder to get" for a tagged star adding +7.2/wk, and
    // nothing else. Here Snoot plays the back and Gloop (team 2's most valuable player, a top-12 one: tagged) the star.
    const card = cardsOf(withTeam2([{ playerId: "202", ppw: 7.2 }, { playerId: "204", ppw: 0.1 }]))[0];
    expect(leads(card)).toEqual(["Best of their trade chips, harder to get: M. Gloop, +7.2/wk"]);
    expect(card?.targets[0]).toMatchObject({ id: "202", label: BEST_TARGET_HARDER_LABEL, harderToGet: true, title: expect.stringMatching(/^Mortimer Gloop: \+7\.2 points per week to your lineup\. Harder to get: /) });
    // The back goes to "They could also give".
    expect(card?.theyCanGive).toEqual({ label: "They could also give:", players: [{ id: "204", text: "C. Snoot (+0.1/wk)", title: "Cornelius Snoot: +0.1 points per week to the other lineup", tag: null }], more: null });
    // With the back at the floor, the card reads as before the floor: him first, the star second as the bigger upgrade.
    expect(leads(cardsOf(withTeam2([{ playerId: "202", ppw: 7.2 }, { playerId: "204", ppw: 1 }]))[0])).toEqual(["Best of their trade chips: C. Snoot, +1/wk", "Bigger upgrade, harder to get: M. Gloop, +7.2/wk"]);
    // The floor holds for a tagged lead too (the lead's call on N12 after the final review): a "+0.5/wk" star leads nothing.
    const weakStar = cardsOf(withTeam2([{ playerId: "202", ppw: 0.5 }, { playerId: "204", ppw: 0.1 }]))[0];
    expect(leads(weakStar)).toEqual([]);
    expect(weakStar?.theyCanGive.players.map((p) => [p.text, p.tag?.text ?? null])).toEqual([
      ["M. Gloop (+0.5/wk)", HARDER_TO_GET_TAG],
      ["C. Snoot (+0.1/wk)", null],
    ]);
    // At the floor he leads.
    expect(leads(cardsOf(withTeam2([{ playerId: "202", ppw: 1 }, { playerId: "204", ppw: 0.1 }]))[0])).toEqual(["Best of their trade chips, harder to get: M. Gloop, +1/wk"]);
  });

  it("breaks ties the card's way: the untagged one is the better on a tie as printed, and 'at least' the floor counts", () => {
    // A tie: the untagged one is the best target, and the tagged one isn't "bigger".
    const tie = withTeam2([
      { playerId: "202", ppw: 2.1 },
      { playerId: "204", ppw: 2.1 },
    ]);
    expect(leads(cardsOf(tie)[0])).toEqual(["Best of their trade chips: C. Snoot, +2.1/wk"]);
    expect(cardsOf(tie)[0]?.theyCanGive.players.map((p) => p.id)).toEqual(["202"]);
    // A tie as printed: 2.14 and 2.06 both show "+2.1/wk", so the tagged one isn't called bigger either.
    const printed = cardsOf(withTeam2([{ playerId: "202", ppw: 2.14 }, { playerId: "204", ppw: 2.06 }]))[0];
    expect(leads(printed)).toEqual(["Best of their trade chips: C. Snoot, +2.1/wk"]);
    expect(printed?.theyCanGive.players.map((p) => [p.text, p.tag?.text ?? null])).toEqual([["M. Gloop (+2.1/wk)", HARDER_TO_GET_TAG]]);
    // A tie at the floor: the untagged one leads ("at least"); the tagged one isn't bigger.
    expect(leads(cardsOf(withTeam2([{ playerId: "202", ppw: 1 }, { playerId: "204", ppw: 1 }]))[0])).toEqual(["Best of their trade chips: C. Snoot, +1/wk"]);
    // A tie under the floor: the untagged one is the better but under the floor, so nobody leads; both are listed.
    const under = cardsOf(withTeam2([{ playerId: "202", ppw: 0.5 }, { playerId: "204", ppw: 0.5 }]))[0];
    expect(under?.targets).toEqual([]);
    expect(under?.theyCanGive).toMatchObject({ label: "They could give:", players: [{ id: "202" }, { id: "204" }] });
    // Two untagged ones tied: the engine's order decides.
    expect(leads(cardsOf(withTeam2([{ playerId: "205", ppw: 1.5 }, { playerId: "204", ppw: 1.5 }]))[0])).toEqual(["Best of their trade chips: P. Plunk, +1.5/wk"]);
  });

  it("says under the cards what 'Best of their trade chips' means, with config's floor", () => {
    expect(BEST_TARGET_NOTE).toBe(
      "“Best of their trade chips” is the one of their trade chips who'd help you most without the “Harder to get” mark, as long as he adds at least 1 point a week; when none does, a marked one who'd help you more leads instead, if he adds at least that much too. A marked player is one of their best, so expect their manager to want a little extra for him.",
    );
  });

  it("still leads with the best target in a model without premiums (built before the addendum), tagging nobody", () => {
    const f = leagueFixture();
    f.model.teams = f.model.teams.map((t) => ({ ...t, premiums: undefined }));
    const cards = cardsOf(f);
    expect(leads(cards[0])).toEqual(["Best of their trade chips: M. Gloop, +2.5/wk"]);
    expect(cards.flatMap((c) => [...c.theyCanGive.players, ...c.youCanGive.players]).every((p) => p.tag === null)).toBe(true);
    expect(cards.flatMap((c) => c.targets).every((t) => !t.harderToGet)).toBe(true);
  });

  it("reads 'Best of their trade chips' (planner reply to Checkpoint 4, change 6: it read 'Best target')", () => {
    expect(BEST_TARGET_LABEL).toBe("Best of their trade chips");
    expect(BEST_TARGET_HARDER_LABEL).toBe("Best of their trade chips, harder to get");
    expect(JSON.stringify(v.partners)).not.toContain("Best target");
  });

  it("ends each card with 'See trade ideas with <team>', the one-partner Trade Finder (planner reply to Checkpoint 4, change 6)", () => {
    expect(v.partners.cards.map((c) => c.ideas)).toEqual([
      { text: "See trade ideas with Gravel Gophers", href: "/trades?partner=2" },
      { text: "See trade ideas with Quasar Quokkas", href: "/trades?partner=3" },
      { text: "See trade ideas with Tundra Tortoises", href: "/trades?partner=4" },
    ]);
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

  it("tags other teams' players 'Harder to get' (their two most valuable when top-12 players), IR and taxi included; never mine or a free agent", () => {
    const tagged = (teamId: string) => roster(teamId)?.players.filter((p) => p.tag !== null).map((p) => p.id);
    // Team 1's Pemberton and McSprocket earn the tag for their owner, but team 1 is mine.
    expect(v.teams.find((t) => t.id === "1")?.isMine).toBe(true);
    expect(tagged("1")).toEqual([]);
    expect(tagged("2")).toEqual(["201", "202"]);
    expect(tagged("3")).toEqual(["302", "304"]);
    expect(tagged("4")).toEqual(["401", "404"]);
    expect(player("2", "202").tag).toEqual({
      text: HARDER_TO_GET_TAG,
      title: "Harder to get: his team's most valuable player and one of the top 12 players by trade value, so his manager will likely want a little extra for him.",
    });
    expect(player("2", "201").tag?.title).toContain("Harder to get: his team's second most valuable player and one of the top 12");
    // A top-12 player who is his team's third most valuable isn't.
    expect(player("2", "203").tag).toBeNull();
    expect(v.freeAgents.flatMap((g) => g.players).every((p) => p.tag === null)).toBe(true);
    // IR and taxi players are their manager's too.
    const f = leagueFixture();
    const tag = { e: 0.2, rank: 1, elite: true, harderToGet: true };
    f.model.teams = f.model.teams.map((t) => (t.id === "2" ? { ...t, premiums: { ...t.premiums, "206": tag } } : t.id === "3" ? { ...t, premiums: { ...t.premiums, "306": tag } } : t));
    const edited = of(f);
    expect(edited.rosters.find((r) => r.teamId === "2")?.players.find((p) => p.id === "206")).toMatchObject({ group: "ir", tag: { text: HARDER_TO_GET_TAG } });
    expect(edited.rosters.find((r) => r.teamId === "3")?.players.find((p) => p.id === "306")).toMatchObject({ group: "taxi", tag: { text: HARDER_TO_GET_TAG } });
    // Without a team of mine, every team's tagged players show.
    expect(view({ myTeamId: null }).rosters.flatMap((r) => r.players.filter((p) => p.tag).map((p) => p.id))).toEqual(expect.arrayContaining(["101", "104", "201", "202"]));
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

describe("buildLeagueView: the market blend (§6 step 8, PlayerModel.blend; planner reply to Checkpoint 4, change 1)", () => {
  /** The league before kickoff, with Team 1's questionable RB (103) blended toward the trade market. */
  const blended = (): LeagueFixture => {
    const f = leagueFixture({ gameDay: false });
    const pm = f.model.players["103"];
    if (!pm) throw new Error("fixture RB missing");
    f.model.players["103"] = { ...pm, blend: { ours: 210.4, market: 169.6, used: 190, weight: 0.5 } };
    return f;
  };

  it("shows our projection, the trade market's and the blend used, rounded, in a blended player's breakdown and hover (after his conflict note)", () => {
    const view = of(blended(), { now: BEFORE_KICKOFF });
    const rb = view.rosters.find((r) => r.teamId === "1")?.players.find((p) => p.id === "103") as PlayerRow;
    expect(rb.blend).toEqual({
      text: "Our projection 210 · Trade market 170 · Used 190",
      title:
        "Rest-of-season points. Our projection: our own model's. Trade market: the same games at the points per game our model gives healthy players with his trade value. Used: 50% ours and 50% the market's, which every number on this page uses.",
    });
    expect(rb.weeksText.split("\n").slice(0, 2)).toEqual([rb.availabilityNote?.long, rb.blend?.text]);
    // Nobody else was blended, so nobody else has the line.
    expect(view.rosters.flatMap((r) => r.players).filter((p) => p.blend).map((p) => p.id)).toEqual(["103"]);
    expect(blendText({ ours: 100, market: 140, used: 110, weight: 0.25 }).title).toContain("Used: 75% ours and 25% the market's");
  });

  it("in a dynasty league, says the trade market is this season's values, not the dynasty values the page shows (review of track A)", () => {
    const b = { ours: 100, market: 140, used: 120, weight: 0.5 };
    expect(blendText(b, "dynasty").title).toContain("healthy players with his trade value this season (FantasyCalc's redraft values).");
    for (const type of ["redraft", "keeper"] as const) expect(blendText(b, type).title).toContain("healthy players with his trade value. Used:");
    const dynasty = blended();
    dynasty.snapshot = { ...dynasty.snapshot, settings: { ...dynasty.snapshot.settings, leagueType: "dynasty" } };
    const view = of(dynasty, { now: BEFORE_KICKOFF });
    expect(view.rosters.find((r) => r.teamId === "1")?.players.find((p) => p.id === "103")?.blend?.title).toBe(blendText(b, "dynasty").title);
    expect(view.explain.find((e) => e.title === "Projected points")?.text).toContain("with a FantasyCalc trade value this season (its redraft values, not the dynasty values shown here), points per game are pulled halfway");
  });

  it("says the market has no comparison for a player at the top or bottom of his position's value range, never three equal numbers (review of Phase 4b)", () => {
    // Blended RBs: Gloop (7,900, the top value: his market number is his own), Snoot (4,200, read off the curve) and
    // Quibble (2,400, the lowest: his own number too).
    const f = leagueFixture({ gameDay: false });
    const set = (id: string, blend: { ours: number; market: number; used: number; weight: number }) => {
      const pm = f.model.players[id];
      if (!pm) throw new Error(`fixture player ${id} missing`);
      f.model.players[id] = { ...pm, blend };
    };
    set("202", { ours: 313.2, market: 313.2, used: 313.2, weight: 0.5 });
    set("204", { ours: 150, market: 130, used: 140, weight: 0.5 });
    set("102", { ours: 120.4, market: 120.4, used: 120.4, weight: 0.5 });
    const rows = of(f, { now: BEFORE_KICKOFF }).rosters.flatMap((r) => r.players);
    const row = (id: string) => rows.find((p) => p.id === id)?.blend;
    expect(row("202")).toEqual({
      text: "Our projection 313 · Trade market: no comparison (top value at his position) · Used 313",
      title:
        "Rest-of-season points. Our projection: our own model's. Trade market: none for him: no other healthy player at his position has a trade value as high as his, so the market can't say more than our projection, which every number on this page uses as it is.",
    });
    expect(row("102")?.text).toBe("Our projection 120 · Trade market: no comparison (lowest value at his position) · Used 120");
    expect(row("102")?.title).toContain("no other healthy player at his position has a trade value as low as his");
    expect(row("204")?.text).toBe("Our projection 150 · Trade market 130 · Used 140");
    // The hover's breakdown says the same.
    expect(rows.find((p) => p.id === "202")?.weeksText).toContain("Trade market: no comparison (top value at his position)");
    // Which end isn't known (a dynasty league shows other values than the blend reads): said without it.
    expect(blendText({ ours: 313.2, market: 313.2, used: 313.2, weight: 0.5 }).text).toBe("Our projection 313 · Trade market: no comparison (his value is at the end of his position's range) · Used 313");
    const dynasty = { ...f, snapshot: { ...f.snapshot, settings: { ...f.snapshot.settings, leagueType: "dynasty" as const } } };
    const dynRow = of(dynasty, { now: BEFORE_KICKOFF }).rosters.flatMap((r) => r.players).find((p) => p.id === "202")?.blend;
    expect(dynRow?.text).toBe("Our projection 313 · Trade market: no comparison (his value is at the end of his position's range) · Used 313");
    expect(dynRow?.title).toContain("his trade value this season (FantasyCalc's redraft values) is at one end of his position's range");
    // Equal to floating-point precision (another blend weight), and only then.
    expect(blendIsOwnPoint({ ours: 200, market: 200 * (1 + 4e-16) })).toBe(true);
    expect(blendIsOwnPoint({ ours: 200, market: 200.01 })).toBe(false);
    expect(blendIsOwnPoint({ ours: 120.3, market: 120.4 })).toBe(false);
  });

  it("says in 'Projected points' which positions were blended, how far and that it is per game; nothing when nobody was", () => {
    const text = (f: LeagueFixture) => of(f, { now: BEFORE_KICKOFF }).explain.find((e) => e.title === "Projected points")?.text ?? "";
    expect(text(blended())).toContain(
      "Then, for RBs with a FantasyCalc trade value, points per game are pulled halfway toward what our model gives healthy players with about the same trade value, so a projection the trade market disagrees with counts for less; byes and injuries stay as projected (a player's breakdown shows both numbers).",
    );
    expect(text(leagueFixture({ gameDay: false }))).not.toContain("trade market");
  });
});

describe("buildLeagueView: each team's free-agent pickups (§7 V*, TeamModel.faMoves)", () => {
  const withMoves = (teamId: string, faMoves: TeamModel["faMoves"]) => {
    const f = leagueFixture();
    f.model.teams = f.model.teams.map((t) => (t.id === teamId ? { ...t, faMoves } : t));
    return of(f).rosters.find((r) => r.teamId === teamId)?.pickups;
  };
  const w = `(playoffs count ${config.lineups.playoffWeight}×)`;

  it("lists a team's pickups in order, each with what it adds with injuries and byes simulated, the gain the optimizer picks moves by (weighted like lineup cost, and saying so), and the projected one in its title", () => {
    // Review of Phase 4: the optimizer picks and keeps moves by their gain in scenario lineups when scenarios run, so
    // that's the number shown (never under faMinGain, in the order made); the expected-value gain goes in the title.
    expect(roster("1")?.pickups).toEqual({
      items: [
        {
          move: `add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}`,
          gain: "+3.9 lineup pts",
          title: `Add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}: +3.9 lineup pts with injuries and byes simulated (+4.6 on projected lineups), playoffs count ${config.lineups.playoffWeight}×.`,
        },
      ],
      summary: "1, +3.9 lineup pts",
      weighting: w,
      text: `Free-agent pickups that would help: add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}: +3.9 lineup pts ${w}`,
    });
    expect(FREE_AGENT_PICKUPS_LABEL).toBe("Free-agent pickups that would help");
    // Two pickups (no scenarios for this team, so no simulated gain: the projected ones, saying so): into an open spot, then for a bench WR; the summary adds them up.
    expect(roster("3")?.pickups).toMatchObject({
      items: [
        { move: `add ${nameOf("902")} (RB, NE) into an open spot`, gain: "+3.4 lineup pts", title: `Add ${nameOf("902")} (RB, NE) into an open spot: +3.4 lineup pts on projected lineups, playoffs count ${config.lineups.playoffWeight}×.` },
        { move: `add ${nameOf("901")} (RB, CAR), drop ${nameOf("305")}`, gain: "+3.1 lineup pts" },
      ],
      summary: "2, +6.5 lineup pts",
    });
    // Never "ROS pts": that's the plain total in the same header.
    expect(v.rosters.map((r) => r.pickups?.text ?? "").join(" ")).not.toContain("ROS pts");
  });

  it("drops the weighting note when no playoff week is left to count", () => {
    const f = leagueFixture();
    f.model = { ...f.model, weeks: [12, 13, 14], regularWeeks: [12, 13, 14], playoffWeeks: [] };
    expect(of(f).rosters[0]?.pickups).toMatchObject({ weighting: null, text: `Free-agent pickups that would help: add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}: +3.9 lineup pts` });
    expect(of(f).rosters[0]?.pickups?.items[0]?.title).toBe(`Add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}: +3.9 lineup pts with injuries and byes simulated (+4.6 on projected lineups).`);
  });

  it("shows the projected gains when the optimizer judges moves on projected lineups: no scenarios, or starter limits that bind", () => {
    const ev = (f: ReturnType<typeof leagueFixture>) => of(f).rosters.find((r) => r.teamId === "1")?.pickups;
    // Starter limits (MFL): the optimizer judges in expected-value lineups even with scenarios.
    const limited = leagueFixture();
    limited.snapshot = { ...limited.snapshot, settings: { ...limited.snapshot.settings, starterLimits: { QB: { min: 1, max: 1 } } } };
    expect(ev(limited)).toMatchObject({
      items: [{ gain: "+4.6 lineup pts", title: `Add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}: +4.6 lineup pts on projected lineups (+3.9 with injuries and byes simulated), playoffs count ${config.lineups.playoffWeight}×.` }],
      summary: "1, +4.6 lineup pts",
    });
    // No scenarios.
    const none = leagueFixture();
    none.model = { ...none.model, scenarios: 0, teams: none.model.teams.map((t) => ({ ...t, faMoves: t.faMoves.map((m) => ({ ...m, gainScen: null })) })) };
    expect(ev(none)?.items[0]).toEqual({
      move: `add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}`,
      gain: "+4.6 lineup pts",
      title: `Add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}: +4.6 lineup pts on projected lineups, playoffs count ${config.lineups.playoffWeight}×.`,
    });
  });

  it("says one lineup point in the singular", () => {
    expect(withMoves("1", [{ add: "901", drop: "108", gainEv: 1.02, gainScen: 3.5 }])?.items[0]?.title).toBe(
      `Add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}: +3.5 lineup pts with injuries and byes simulated (+1 on projected lineups), playoffs count ${config.lineups.playoffWeight}×.`,
    );
    const f = leagueFixture();
    f.model = { ...f.model, scenarios: 0 };
    f.model.teams = f.model.teams.map((t) => (t.id === "1" ? { ...t, faMoves: [{ add: "901", drop: "108", gainEv: 0.96, gainScen: null }] } : t));
    expect(of(f).rosters.find((r) => r.teamId === "1")?.pickups).toMatchObject({ items: [{ gain: "+1 lineup pt" }], summary: "1, +1 lineup pt" });
  });

  it("shows nothing when no pickup helps, and leaves out a move without a number", () => {
    expect(roster("2")?.pickups).toBeNull();
    expect(roster("4")?.pickups).toBeNull();
    expect(withMoves("3", [{ add: "902", drop: null, gainEv: Number.NaN, gainScen: null }])).toBeNull();
    // A depth pickup: it adds little, even less than nothing, to projected lineups, and more once injuries and byes are simulated.
    expect(withMoves("3", [{ add: "902", drop: null, gainEv: Number.NaN, gainScen: null }, { add: "901", drop: "305", gainEv: -0.4, gainScen: 3.5 }])?.items).toEqual([
      { move: `add ${nameOf("901")} (RB, CAR), drop ${nameOf("305")}`, gain: "+3.5 lineup pts", title: `Add ${nameOf("901")} (RB, CAR), drop ${nameOf("305")}: +3.5 lineup pts with injuries and byes simulated (−0.4 on projected lineups), playoffs count ${config.lineups.playoffWeight}×.` },
    ]);
  });

  it("names a team defense by its name (plus DEF when the name doesn't say it), leaves out a missing NFL team, and never breaks on an unknown player", () => {
    expect(withMoves("3", [{ add: "BAL", drop: "PHI", gainEv: 12.06, gainScen: null }])?.items[0]?.move).toBe("add Ravens D/ST, drop Eagles D/ST");
    // Sleeper names a defense after its team ("Baltimore Ravens").
    const f = leagueFixture({ platform: "sleeper" });
    const bal = f.snapshot.players.BAL;
    if (bal) f.snapshot.players.BAL = { ...bal, name: "Baltimore Ravens" };
    f.model.teams = f.model.teams.map((t) => (t.id === "3" ? { ...t, faMoves: [{ add: "BAL", drop: "PHI", gainEv: 5, gainScen: null }] } : t));
    expect(of(f).rosters.find((r) => r.teamId === "3")?.pickups?.items[0]?.move).toBe("add Baltimore Ravens (DEF), drop Eagles D/ST");
    expect(withMoves("1", [{ add: "903", drop: "999", gainEv: 3, gainScen: null }])?.items[0]?.move).toBe(`add ${nameOf("903")} (WR), drop Unknown player (999)`);
    expect(withMoves("3", [{ add: "LV", drop: null, gainEv: 3, gainScen: null }])?.items[0]?.move).toBe("add Unknown player (LV) into an open spot");
    expect(withMoves("3", [{ add: "904", drop: null, gainEv: 3, gainScen: null }])?.items[0]?.move).toBe(`add ${nameOf("904")} (K, LV) into an open spot`);
  });
});

describe("buildLeagueView: one free agent, one team (§7; LeagueModel.faAllocation; planner reply to Checkpoint 4, change 3)", () => {
  const withAllocation = (faAllocation: NonNullable<LeagueFixture["model"]["faAllocation"]>, opts: Parameters<typeof leagueFixture>[0] = {}) => {
    const f = leagueFixture(opts);
    f.model = { ...f.model, faAllocation };
    return of(f);
  };

  it("says above the rosters how free agents are shared out, and where my team picks", () => {
    expect(withAllocation({ basis: "waiver", order: ["3", "1", "2", "4"] }).pickupsNote).toBe("Free-agent pickups: each free agent goes to one team only, in your league's waiver order. Your team picks 2nd of 4.");
    expect(withAllocation({ basis: "faab", order: ["1", "2", "3", "4"] }).pickupsNote).toBe("Free-agent pickups: each free agent goes to one team only, in FAAB order (the most budget left first). Your team picks 1st of 4.");
    // "Wasn't available", never "doesn't report" (review of track F): an import saved before the adapters read ESPN's
    // waiver order has none although the league reports one.
    expect(withAllocation({ basis: "gain", order: ["2", "4", "3", "1"] }).pickupsNote).toBe(
      "Free-agent pickups: each free agent goes to one team only, the team that gains the most from its best pickup first (your league's waiver order wasn't available). Your team picks 4th of 4.",
    );
    expect(withAllocation({ basis: "gain", order: ["2", "4", "3", "1"] }).pickupsNote).not.toContain("doesn't report");
  });

  it("leaves out where I pick without a team, and says nothing for a model built before Phase 4b or once the season is over", () => {
    expect(withAllocation({ basis: "waiver", order: ["3", "2", "4"] }, { myTeamId: null }).pickupsNote).toBe("Free-agent pickups: each free agent goes to one team only, in your league's waiver order.");
    expect(v.pickupsNote).toBeNull();
    const over = leagueFixture();
    over.model = {
      ...over.model,
      weeks: [],
      regularWeeks: [],
      playoffWeeks: [],
      inProgressWeek: null,
      teams: over.model.teams.map((t) => ({ ...t, ev: { lv: [], ros: 0, ppw: 0 }, scen: null })),
      faAllocation: { basis: "waiver", order: ["1", "2", "3", "4"] },
    };
    expect(of(over).pickupsNote).toBeNull();
    expect(withAllocation({ basis: "waiver", order: [] }).pickupsNote).toBeNull();
  });
});

describe("buildLeagueView: streaming positions (§7; planner reply to Checkpoint 3, model change 1)", () => {
  it("lists this week's streaming picks at the positions the lineup starts (D/ST here: no kicker slot), each with his opponent in short and in words", () => {
    const s = v.streaming as NonNullable<typeof v.streaming>;
    expect(s.week).toBe(12);
    expect(s.groups).toEqual([
      {
        pos: "DEF",
        label: "D/ST",
        caption: "Best free-agent D/STs for week 12, by this week's projection",
        picks: [
          { id: "SEA", name: "Seahawks D/ST", nflTeam: "SEA", opponent: "vs ARI", opponentLong: "at home against ARI", projection: "8.2" },
          { id: "NYG", name: "Giants D/ST", nflTeam: "NYG", opponent: "@ DAL", opponentLong: "away at DAL", projection: "6.6" },
        ],
      },
    ]);
    expect(s.empty).toBeNull();
    // Sleeper calls them DEF; an opponent the schedule doesn't know reads "—" (and "opponent unknown" to screen readers).
    const f = leagueFixture({ platform: "sleeper" });
    f.model.streaming = { ...f.model.streaming, picks: [{ playerId: "SEA", pos: "DEF", projection: 8.24, opponent: null }] };
    expect(of(f).streaming?.groups).toEqual([
      {
        pos: "DEF",
        label: "DEF",
        caption: "Best free-agent team defenses for week 12, by this week's projection",
        picks: [{ id: "SEA", name: "Seahawks D/ST", nflTeam: "SEA", opponent: "—", opponentLong: "opponent unknown", projection: "8.2" }],
      },
    ]);
  });

  it("lists a kicker group too when the lineup starts a kicker, K first", () => {
    const f = leagueFixture();
    f.snapshot = { ...f.snapshot, settings: { ...f.snapshot.settings, lineup: [...f.snapshot.settings.lineup, { slot: "K", count: 1, eligible: ["K"] }] } };
    f.model.streaming = { ...f.model.streaming, picks: [{ playerId: "904", pos: "K", projection: 8, opponent: { team: "DEN", home: false } }, ...f.model.streaming.picks] };
    const groups = of(f).streaming?.groups ?? [];
    expect(groups.map((g) => [g.label, g.caption, g.picks.map((p) => [p.name, p.opponent])])).toEqual([
      ["K", "Best free-agent kickers for week 12, by this week's projection", [[nameOf("904"), "@ DEN"]]],
      ["D/ST", "Best free-agent D/STs for week 12, by this week's projection", [[nameOf("SEA"), "vs ARI"], [nameOf("NYG"), "@ DAL"]]],
    ]);
  });

  it("says what I stream (my setting) and which other teams stream, with the adds that show it", () => {
    expect(v.streaming?.mine).toBe("You stream D/ST.");
    expect(v.streaming?.others).toBe("Other teams that stream (2 or more adds at the position this season): Quasar Quokkas (D/ST, 3 adds).");
    expect(SETTINGS_HREF).toBe("/settings");
    // My setting streams nothing, and no other team streams: the streamable positions this lineup starts are named.
    const f = leagueFixture();
    f.model.streaming = {
      ...f.model.streaming,
      byTeam: Object.fromEntries(Object.entries(f.model.streaming.byTeam).map(([id, t]) => [id, { ...t, positions: [] }])),
    };
    expect(of(f).streaming?.mine).toBe("You don't stream any position.");
    expect(of(f).streaming?.others).toBe("No other team has made 2 or more adds at QB, TE or D/ST this season, so the others count only their own players.");
    // Without a team of mine, every team is detected (team 1's single add isn't enough).
    const none = view({ myTeamId: null }).streaming;
    expect(none?.mine).toBeNull();
    expect(none?.others).toBe("Teams that stream (2 or more adds at the position this season): Quasar Quokkas (D/ST, 3 adds).");
  });

  it("explains how a streamed slot counts, with the replacement's average over the weeks team numbers count, and the game-day rule", () => {
    const base =
      "A streamed slot counts, each week, the better of the team's own player and the streaming replacement: the 3rd-best free agent at that position that week (other teams stream too). Over the weeks left, the replacement averages 6.6 points a week at D/ST. A team that starts two at a position still gets one streamer.";
    expect(v.streaming?.note).toBe(`${base} Free agents whose game this week has already started aren't picks.`);
    expect(before.streaming?.note).toBe(base);
    expect(config.streaming.streamRank).toBe(3);
    // The average skips a week in progress: a replacement of 0 in week 12 (its games started) doesn't pull it down.
    const f = leagueFixture();
    f.model.streaming = { ...f.model.streaming, replacement: { DEF: [0, 6, 7, 8, 6, 7] } };
    expect(of(f).streaming?.note).toContain("the replacement averages 6.8 points a week at D/ST.");
    // A team that streams TE, which this lineup's FLEX takes too: the streamer is one more player who can start there.
    const te = leagueFixture();
    te.model.streaming = {
      ...te.model.streaming,
      byTeam: { ...te.model.streaming.byTeam, "3": { positions: ["TE", "DEF"], source: "detected", adds: { TE: 2, DEF: 3 } } },
      replacement: { ...te.model.streaming.replacement, TE: [5, 5, 5, 5, 5, 5] },
    };
    expect(of(te).streaming?.note).toContain(
      "A team that starts two at a position still gets one streamer. A streamed TE can also start in a flex spot, when that helps the lineup more: the replacement is one more player that week.",
    );
  });

  it("says so when no free agent at those positions plays this week, and is left out once no week is left or when nothing streams and no K or D/ST starts", () => {
    const f = leagueFixture();
    f.model.streaming = { ...f.model.streaming, picks: [] };
    const empty = of(f).streaming;
    expect(empty?.groups.map((g) => g.picks)).toEqual([[]]);
    expect(empty?.empty).toBe("No free-agent D/STs are projected to play this week.");
    const over = leagueFixture();
    over.model = { ...over.model, weeks: [], regularWeeks: [], playoffWeeks: [], inProgressWeek: null, teams: over.model.teams.map((t) => ({ ...t, ev: { lv: [], ros: 0, ppw: 0 }, scen: null })) };
    expect(of(over).streaming).toBeNull();
    // No D/ST or K slot, and nobody streams: nothing to show.
    const g = leagueFixture();
    g.snapshot = { ...g.snapshot, settings: { ...g.snapshot.settings, lineup: g.snapshot.settings.lineup.filter((s) => s.slot !== "D/ST") } };
    g.model.streaming = { byTeam: {}, replacement: {}, picks: [] };
    expect(of(g).streaming).toBeNull();
  });

  it("says on each roster what its team streams: mine by my setting, another team by its adds", () => {
    expect(roster("1")?.streams).toBe("Streams D/ST (your setting)");
    expect(roster("3")?.streams).toBe("Streams D/ST (3 adds this season)");
    expect(roster("2")?.streams).toBeNull();
    expect(roster("4")?.streams).toBeNull();
    const f = leagueFixture();
    f.model.streaming = { ...f.model.streaming, byTeam: { ...f.model.streaming.byTeam, "3": { positions: ["QB", "DEF"], source: "detected", adds: { QB: 2, DEF: 3 } } } };
    expect(of(f).rosters.find((r) => r.teamId === "3")?.streams).toBe("Streams QB and D/ST (adds this season: QB 2, D/ST 3)");
  });

  it("explains streaming in 'How these numbers work', with config's numbers", () => {
    const text = v.explain.find((e) => e.title === "Streaming")?.text ?? "";
    expect(text).toBe(
      "Many managers stream kickers and D/STs: each week they pick up whichever free agent is projected highest. A streamed slot counts, each week, the better of the team's own player and the 3rd-best free agent at that position that week (other teams stream too), in every team number: points per week, positional strength and needs, lineup cost, trade chips, partners and the playoff odds. You choose the positions you stream in Settings (K and D/ST unless you change it; QB and TE can be added). Another team counts as streaming a position once it has made 2 or more adds there this season; the others count only their own players. A team that starts two at a position still gets one streamer. A streamed TE can also start in a flex spot, when that helps the lineup more: the replacement is one more player that week.",
    );
    expect(config.streaming.detectAdds).toBe(2);
    // A superflex lineup takes a QB in a flex too; a lineup whose flex takes neither leaves the sentence out.
    const sf = leagueFixture();
    sf.snapshot = { ...sf.snapshot, settings: { ...sf.snapshot.settings, lineup: [...sf.snapshot.settings.lineup, { slot: "SUPER_FLEX", count: 1, eligible: ["QB", "RB", "WR", "TE"] }] } };
    expect(of(sf).explain.find((e) => e.title === "Streaming")?.text).toMatch(/still gets one streamer\. A streamed QB or TE can also start in a flex spot, when that helps the lineup more: the replacement is one more player that week\.$/);
    const noFlex = leagueFixture();
    noFlex.snapshot = { ...noFlex.snapshot, settings: { ...noFlex.snapshot.settings, lineup: noFlex.snapshot.settings.lineup.filter((x) => x.slot !== "FLEX") } };
    expect(of(noFlex).explain.find((e) => e.title === "Streaming")?.text).toMatch(/still gets one streamer\.$/);
  });

  it("labels lineup points with the model's playoff weight (the user's setting), not config's", () => {
    const f = leagueFixture();
    f.model.playoffWeight = 1.5;
    const custom = of(f);
    expect(custom.teams.find((t) => t.id === "2")?.chips[0]?.title).toContain("worth 31.2 more lineup pts (playoffs count 1.5×) to");
    expect(custom.lineupCostTitle).toBe("Rest-of-season lineup points his team would lose without him, with playoff weeks counted 1.5×");
    expect(custom.explain.find((e) => e.title === "Rest-of-season (ROS) points")?.text).toContain("with playoff weeks counted 1.5× (they decide titles)");
    expect(custom.rosters.find((r) => r.teamId === "1")?.pickups?.weighting).toBe("(playoffs count 1.5×)");
    // A weight of 1: lineup points are plain projected points, so nothing is labeled.
    f.model.playoffWeight = 1;
    const plain = of(f);
    expect(plain.teams.find((t) => t.id === "2")?.chips[0]?.title).not.toContain("playoffs count");
    expect(plain.lineupCostTitle).toBe("Rest-of-season lineup points his team would lose without him");
  });
});

describe("buildLeagueView: free agents", () => {
  it("lists the best few by ROS points at each startable position only", () => {
    expect(v.freeAgents.map((g) => [g.pos, g.players.map((p) => p.id)])).toEqual([
      ["RB", ["901", "902"]],
      ["WR", ["903"]],
      ["D/ST", ["SEA", "NYG"]],
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
    expect(v.explain.map((e) => e.title)).toEqual([
      "Projected points",
      "Availability",
      "Depth counts",
      "Streaming",
      "Free-agent pickups",
      "Rest-of-season (ROS) points",
      "Week 12 is under way",
      "Playoff odds",
      "Trade values",
      "Needs, trade chips and partners",
      "Harder to get",
    ]);
    expect(text).toContain(`up to ${Math.round(config.projections.actualWeight * 100)}% once he has played ${config.projections.actualFullGames} games`);
    expect(text).toContain("ESPN's own projections differ from Sleeper's by 14% on average this week, more than the 10% we allow");
    expect(text).toContain("Out: 0% this week, 50% next week, 85% in 2 weeks; Doubtful 25%, Questionable 85% and Probable 95% this week");
    expect(text).toContain("RB 14%, TE 14%, WR 12%, QB 6%, K 2%");
    expect(text).toContain(`${config.lineups.scenarios} simulated runs of injuries and byes`);
    expect(text).toContain("from week 12 through week 17 (the last playoff week)");
    expect(text).toContain(
      `Lineup cost and the gains of each team's free-agent pickups (listed on its roster) are in lineup points: starting-lineup points over the rest of the season, with playoff weeks counted ${config.lineups.playoffWeight}× (they decide titles), so they don't add up exactly with ROS points.`,
    );
    expect(text).toContain("Lineup cost is how many his team would lose without him, after its free-agent pickups (it would pick up a free agent in his place when that helps); it's never negative.");
    // The free-agent optimizer (§7 V*) with config's numbers: kickers and D/STs never, the guard only in dynasty and keeper leagues.
    const o = config.freeAgentOptimizer;
    // Judged with injuries and byes simulated (scenarios ran, no starter limits): review of Phase 4.
    expect(text).toContain(
      `Free-agent pickups: Each team is measured after the free-agent pickups that would help it, made one at a time: each time the add (dropping a player, or into an open roster spot) that adds the most lineup points with injuries and byes simulated (so a backup who'd start when a starter is hurt or on bye counts), as long as it adds at least ${o.faMinGain}, up to ${o.faMaxMoves} pickups. Kickers and D/STs are never picked up (they're streamed or kept), nor is a position the team streams, and a player its starting lineup needs is never dropped. Lineup cost, trade chips and partners all start from those rosters, so a trade never gets credit for a pickup a team could make anyway. Each team is measured on its own, so two teams may count on the same free agent.`,
    );
    // One free agent, one team (planner reply to Checkpoint 4, change 3): with an allocation, the last sentence says how
    // free agents are shared out instead (a model built before Phase 4b, like the fixture's, keeps the old one).
    const shared = leagueFixture();
    shared.model = { ...shared.model, faAllocation: { basis: "waiver", order: ["3", "1", "2", "4"] } };
    const sharedText = of(shared).explain.find((e) => e.title === "Free-agent pickups")?.text ?? "";
    expect(sharedText).toContain(
      "so a trade never gets credit for a pickup a team could make anyway. Each free agent goes to one team only, in your league's waiver order: each team picks from the free agents the teams before it left, and in a trade the two teams pick again from the ones every other team left.",
    );
    expect(sharedText).not.toContain("two teams may count on the same free agent");
    // On projected lineups without scenarios.
    const noScen = leagueFixture();
    noScen.model = { ...noScen.model, scenarios: 0 };
    expect(of(noScen).explain.find((e) => e.title === "Free-agent pickups")?.text).toContain(
      `each time the add (dropping a player, or into an open roster spot) that adds the most projected lineup points, as long as it adds at least ${o.faMinGain}, up to ${o.faMaxMoves} pickups.`,
    );
    expect(text).toContain("FantasyCalc in your league's format (8 teams · half-PPR · 1 QB · redraft).");
    // The format's substitutions are said here once (the server's notes repeating them are dropped).
    expect(text).toContain("Where your league doesn't match one of FantasyCalc's formats exactly: 4 teams → FantasyCalc's 8-team values. Players FantasyCalc doesn't value");
    // The two parts as the engine measures them (league.ts step 6): the receiving team after its free-agent pickups (a pickup it
    // could make anyway doesn't count, one the newcomer makes possible does), against his own team's lineup cost.
    expect(text).toContain(
      `A trade chip is a player worth at least ${config.needs.chipMinGap} more lineup points to another team than to his own: what he'd add to that team's lineup, measured after its free-agent pickups (so a pickup it could make anyway doesn't count, while one his arrival makes possible does), minus what his own team would lose without him.`,
    );
    expect(text).not.toContain("either team could make anyway");
    // The positions trade search leaves out that this league starts (a D/ST, no kicker).
    expect(text).toContain("Team defenses aren't trade chips: trade suggestions leave them out.");
    expect(text).toContain("teams with a trade chip who would start for you, when none of yours would start for them, come after them.");
    expect(text).not.toMatch(/surplus/i);
  });

  it("explains 'Harder to get' with config's numbers, only when the model has premiums (planner addendum to Checkpoint 3, §2)", () => {
    const sp = config.acceptance.starPremium;
    expect(v.explain.find((e) => e.title === HARDER_TO_GET_TAG)?.text).toBe(
      `Managers value their own best players a bit above their trade value. Another team's player marked Harder to get is one of his team's two most valuable players and one of the top ${sp.eliteTop} players by trade value (FantasyCalc's, in your league's format), so expect his manager to want a little extra for him: trade ideas count that in the chance they accept. Partner cards lead with the best of their trade chips: the unmarked one who'd add the most to your lineup, if he adds at least 1 point a week. A marked player who'd add more than any unmarked one is named next, or alone when no unmarked one adds that much (he too has to add at least 1 point a week to lead). Your own players are never marked.`,
    );
    const f = leagueFixture();
    f.model.teams = f.model.teams.map((t) => ({ ...t, premiums: undefined }));
    expect(of(f).explain.map((e) => e.title)).not.toContain(HARDER_TO_GET_TAG);
  });

  it("says the pickups' dynasty guard only where the engine applies it: dynasty and keeper leagues whose dynasty values loaded (review of track A2)", () => {
    const pickups = (f: ReturnType<typeof leagueFixture>) => of(f).explain.find((e) => e.title === "Free-agent pickups")?.text ?? "";
    const guard = "In a dynasty or keeper league, a player worth clearly more in dynasty value than the free agent is never dropped for him.";
    const off = "this league's dynasty values didn't load this time, so that check is off.";
    // A redraft league: no guard, nothing said.
    expect(pickups(leagueFixture())).not.toMatch(/dynasty/);
    // A keeper league with its dynasty list (the market's own format): the guard is on.
    const keeper = leagueFixture();
    keeper.snapshot = { ...keeper.snapshot, settings: { ...keeper.snapshot.settings, leagueType: "keeper" } };
    keeper.model.market = { ...keeper.model.market, format: fantasyCalcFormat(keeper.snapshot.settings) };
    expect(keeper.model.market.format?.isDynasty).toBe(true);
    expect(pickups(keeper)).toContain(guard);
    // Its dynasty list didn't load (the server falls back to the redraft list): the guard is off, and the text says so.
    const fallback = leagueFixture();
    fallback.snapshot = keeper.snapshot;
    fallback.model.market = { ...fallback.model.market, format: fantasyCalcFormat(keeper.snapshot.settings, "redraft") };
    expect(fallback.model.market.format?.isDynasty).toBe(false);
    expect(pickups(fallback)).not.toContain(guard);
    expect(pickups(fallback)).toContain(off);
    // FantasyCalc down: no values at all, in a dynasty league too.
    const down = leagueFixture();
    down.snapshot = { ...keeper.snapshot, settings: { ...keeper.snapshot.settings, leagueType: "dynasty" } };
    down.model.market = { ...down.model.market, format: null, topValue: 0 };
    expect(pickups(down)).toContain(off);
  });

  it("names every excluded position the league starts, in the platform's words", () => {
    const f = leagueFixture({ platform: "sleeper" });
    f.snapshot = { ...f.snapshot, settings: { ...f.snapshot.settings, lineup: [...f.snapshot.settings.lineup, { slot: "K", count: 1, eligible: ["K"] }, { slot: "IDP_FLEX", count: 1, eligible: ["DL", "LB", "DB"] }] } };
    expect(of(f).explain.find((e) => e.title === "Needs, trade chips and partners")?.text).toContain("Kickers, team defenses and defensive players aren't trade chips");
  });

  it("says what a week in progress does to the numbers, only while one is", () => {
    const weekText =
      'Once a week\'s first game kicks off, the team numbers (points per week, team ROS points, positional strength, needs, lineup cost, free-agent pickups, trade chips and partners) count from the next week, week 13: lineups are locking and week 12\'s points are being scored, so it no longer says how good a team is. A player\'s own ROS points still count his week 12 game if it hasn\'t kicked off; one that has shows "Game already started".';
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
