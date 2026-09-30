/**
 * League page view model (CLAUDE.md §14 item 3, §6 step 7, §7, §9) on a fictional league with a
 * hand-built LeagueModel (src/components/league/testFixtures.ts): sorting, chips, heatmap steps, the
 * week-by-week breakdown, game days (a week in progress), free agents, and the no-team state. Every
 * name is made up.
 */
import { describe, expect, it } from "vitest";
import { BEFORE_KICKOFF, NOW, leagueFixture, nameOf, type LeagueFixture } from "@/components/league/testFixtures";
import { config } from "@/engine/config";
import type { BaseRateSource, TeamModel } from "@/engine/leagueModel";
import { fantasyCalcFormat } from "@/engine/market";
import { FREE_AGENT_MOVE_LABEL, buildLeagueView, heatStep, shortName, type LeagueViewInput, type PlayerRow } from "./leagueView";

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

describe("buildLeagueView: team table (§7 needs and surplus)", () => {
  it("ranks teams by projected points per week, from scenario lineups when there are any", () => {
    expect(before.teams.map((t) => [t.rank, t.id, t.perWeekText, t.rosText, t.record, t.pointsFor])).toEqual([
      [1, "2", "93", "558", "8–3", "1210.3"],
      [2, "3", "88", "528", "5–6", "1100"], // no scenarios: expected-value lineups
      [3, "1", "85.3", "520", "7–4", "1180.4"],
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

  it("names surplus players by short name, most surplus first", () => {
    const t2 = v.teams.find((t) => t.id === "2")?.surplus ?? [];
    expect(t2.map((c) => [c.text, c.kind])).toEqual([
      ["C. Snoot", "surplus"],
      ["I. Fumblewick", "surplus"],
    ]);
    expect(t2[0]?.title).toBe("Cornelius Snoot (RB): would start for 1 other team");
    expect(t2[1]?.title).toBe("Ignatius Fumblewick (RB): would start for 3 other teams");
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

describe("buildLeagueView: best trade partners (§7)", () => {
  it("shows my best fits with what each side could give, in points per week", () => {
    expect(v.partners.empty).toBeNull();
    expect(v.partners.cards.map((c) => [c.name, c.fitText, c.theyCanGive.map((p) => p.text), c.youCanGive.map((p) => p.text)])).toEqual([
      ["Gravel Gophers", "Fit 2.4", ["C. Snoot (+2.1/wk)", "I. Fumblewick (+1.2/wk)"], ["W. Spoons (+1.8/wk)"]],
      ["Quasar Quokkas", "Fit 1.1", ["L. Mop (+0.9/wk)"], ["W. Spoons (+1.3/wk)"]],
      ["Tundra Tortoises", "Would start for you", ["O. Wren (+1.6/wk)"], []], // one-sided: after every mutual fit
    ]);
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
    expect(of(f, { myTeamSource: "you" }).partners.empty).toBe("No clear fits right now: no team has a spare player who would start for you.");
  });

  it("says trade values are missing, not that nobody fits, when FantasyCalc didn't load (review PERF-4)", () => {
    const f = leagueFixture();
    f.model.partners = [];
    f.model.market = { ...f.model.market, format: null };
    const v = of(f, { myTeamSource: "you" });
    expect(v.partners.empty).toBe("Trade values couldn't be loaded, so surplus players and trade partners can't be picked right now. Refresh to try again.");
    expect(v.explain.find((e) => e.title === "Needs, surplus and partners")?.text).toMatch(/hidden while FantasyCalc's values are unavailable/);
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
    expect(before.rosters[0]?.summary).toBe("85.3 pts/wk · 520 ROS pts");
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
    expect(v.explain.map((e) => e.title)).toEqual(["Projected points", "Availability", "Depth counts", "Rest-of-season (ROS) points", "Week 12 is under way", "Trade values", "Needs, surplus and partners"]);
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
    expect(text).toContain("teams with a spare player who would start for you, but who need nothing you can spare, come after them.");
  });

  it("says what a week in progress does to the numbers, only while one is", () => {
    expect(v.explain.find((e) => e.title === "Week 12 is under way")?.text).toBe(
      'Once a week\'s first game kicks off, the team numbers (points per week, team ROS points, positional strength, needs, lineup cost, free-agent moves and trade partners) count from the next week, week 13: lineups are locking and week 12\'s points are being scored, so it no longer says how good a team is. A player\'s own ROS points still count his week 12 game if it hasn\'t kicked off; one that has shows "Game already started".',
    );
    expect(before.explain.map((e) => e.title)).not.toContain("Week 12 is under way");
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
