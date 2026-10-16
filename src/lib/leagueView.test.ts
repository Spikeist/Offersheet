/**
 * League page view model (CLAUDE.md §14 item 3, §6 step 7, §7, §9) on a fictional league with a
 * hand-built LeagueModel (src/components/league/testFixtures.ts): sorting, chips, heatmap steps, the
 * week-by-week breakdown, game days (a week in progress), free agents, and the no-team state. Every
 * name is made up.
 */
import { describe, expect, it } from "vitest";
import { BEFORE_KICKOFF, NOW, PICKUP_GAIN, PRE_KICKOFF, leagueFixture, nameOf, type LeagueFixture } from "@/components/league/testFixtures";
import { inactiveTeams } from "@/engine/acceptance";
import { titleOnlyReward } from "@/engine/benefit";
import { config } from "@/engine/config";
import type { BaseRateSource, PlayoffWeightAuto, SeasonOdds, TeamModel, WeekOdds } from "@/engine/leagueModel";
import { fantasyCalcFallbackText, fantasyCalcFormat } from "@/engine/market";
import type { InjuryStatus, LeagueSettings, Pos } from "@/engine/model";
import { TITLE_ONLY, type Reward } from "@/engine/reward";
import { weekUnderWayNote } from "@/engine/season";
import { fmtNum } from "./format";
import { waiverOrderText } from "./importReport";
import { titleOddsText } from "./tradeView";
import {
  AS_ROSTERS_STAND_LABEL,
  BEST_TARGET_HARDER_LABEL,
  BEST_TARGET_LABEL,
  BEST_TARGET_MIN,
  BEST_TARGET_NOTE,
  BIGGER_UPGRADE_LABEL,
  FREE_AGENT_PICKUPS_LABEL,
  HARDER_TO_GET_TAG,
  ODDS_BASIS_TEXT,
  RETURNS_FROM_IR_LABEL,
  RISKY_BYES,
  RISKY_WIN_CHANCE,
  SEASON_OVER_PARTNERS_TEXT,
  SEASON_OVER_TEXT,
  SETTINGS_HREF,
  STARTER_TAG,
  UNDER_WAY_TEXT,
  VALUES_ESTIMATED_LINE,
  VALUES_ESTIMATED_TITLE,
  VALUES_HIDDEN_ESTIMATED_TEXT,
  VALUES_HIDDEN_TEXT,
  WAIVER_ORDER_LABEL,
  YOUR_ODDS_LABEL,
  availabilityNoteText,
  blendIsOwnPoint,
  blendText,
  buildLeagueView,
  heatStep,
  likelyStarters,
  noFormText,
  oddsCell,
  pickupsUnderWayNote,
  playoffWeightLabel,
  rosterAfterPickups,
  scheduleByeRule,
  seasonOver,
  shortName,
  titleCell,
  type LeagueViewInput,
  type PartnerCard,
  type PlayerRow,
} from "./leagueView";

const TZ = "America/Chicago";

/** The standings caption's last words in a Phase 4c model: its odds count each team's pickups. */
const COUNTING = ", counting each team's free-agent pickups that would help";

/** How far the market may move a projection (config.marketBlend.factorClamp), as the page words it: up "35%", down "25%". */
const CAP = {
  up: `${Math.round((config.marketBlend.factorClamp[1] - 1) * 100)}%`,
  down: `${Math.round((1 - config.marketBlend.factorClamp[0]) * 100)}%`,
};

/**
 * The fixture's playoff weight, config's fallback (1.25), as the page prints it: one decimal, "1.3" (planner reply to
 * Checkpoint 7a, §6.1: the Settings page prints it the same).
 */
const PW = playoffWeightLabel(config.lineups.playoffWeight);

/** An automatic playoff weight as the League model reports it (LeagueModel.playoffWeightAuto; league.ts step 5c). */
function autoWeight(omega: number, basis: PlayoffWeightAuto["basis"] = "auto"): PlayoffWeightAuto {
  const measured = basis === "auto";
  return {
    omega,
    basis,
    reason: measured ? null : "noOdds",
    goal: "title",
    reward: titleOnlyReward("title"),
    gain: 3,
    sims: measured ? 1000 : 0,
    regularPerPoint: measured ? 0.4 : null,
    playoffPerPoint: measured ? 0.4 * omega : null,
    ratio: measured ? omega : null,
    clamped: null,
    runs: null,
  };
}

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
      // FantasyCalc answered: no fallback to note (the "FantasyCalc's fallbacks" block below has them).
      valuesNote: null,
      weeksLeft: "6 weeks left: 3 regular season, 3 playoffs",
    });
    expect(v.valuesBanner).toBeNull();
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
      "start from Sleeper's projection, scored with your league's rules (ESPN's own for 3 players Sleeper doesn't project). ESPN's own projections differ from Sleeper's by 14% on average this week, more than the 10% we allow, so we don't average ESPN's in.",
    );
    expect(mixed.text).toContain("adjusted for the matchup");
    // Last resorts.
    expect(withSources({ season: 20 }).label).toBe("Sleeper's season projections");
    expect(withSources({ season: 20 }).text).toContain("Sleeper's season projection per game, scored with your league's rules (its weekly projections didn't load)");
    expect(withSources({ actual: 5 }).label).toBe("points scored so far");
    expect(withSources({}).label).toBe("none loaded");
  });

  it("says the averaging test left kickers and D/STs aside, and states a gap beside the bar to one decimal (planner reply to Checkpoint 7e, item 6)", () => {
    const explainer = (espnAveraged: boolean, agreement: LeagueFixture["model"]["projection"]["agreement"], sources: Partial<Record<BaseRateSource, number>>) => {
      const f = leagueFixture();
      f.model.projection = { ...f.model.projection, espnAveraged, agreement, sources: { ...SOURCES, ...sources } };
      return of(f).explain[0]?.text ?? "";
    };
    const averaged = { "espn+sleeper": 25, sleeper: 8 };
    // The positions left aside in parentheses with the players compared, as the Import Report words it, and, averaged, that
    // theirs are averaged too (review of Checkpoint 7f, the averaging reviewer's note: "kickers and D/STs aside" read as if
    // they weren't averaged).
    const avg = explainer(true, { meanRelDiff: 0.04, players: 22, week: 12, leftOut: ["K", "DEF"] }, averaged);
    expect(avg).toContain("averaged with ESPN's own projection (they agree within 4% on average this week over 22 rostered players, kickers and D/STs aside, though theirs are averaged too)");
    expect(explainer(false, { meanRelDiff: 0.14, players: 22, week: 12, leftOut: ["K", "DEF"] }, { sleeper: 33 })).toContain(
      "ESPN's own projections differ from Sleeper's by 14% on average this week (22 rostered players, kickers and D/STs aside), more than the 10% we allow, so we don't average ESPN's in.",
    );
    expect(explainer(false, { meanRelDiff: 0.14, players: 24, week: 12, leftOut: ["K"] }, { sleeper: 33 })).toContain("by 14% on average this week (24 rostered players, kickers aside), more than the 10% we allow, so we don't average ESPN's in");
    // Nowhere does "kickers and D/STs aside" sit right before "averaged" or "them", in either branch.
    for (const text of [avg, explainer(false, { meanRelDiff: 0.14, players: 22, week: 12, leftOut: ["K", "DEF"] }, { sleeper: 33 })]) {
      expect(text).not.toMatch(/aside[),]* (more than [^,]*, )?so we don't average them/);
      expect(text).not.toContain("so we don't average them in");
    }
    // Beside the bar: one decimal (Oct 9's league read 9.86% without kickers and D/STs), two where one would be the bar's.
    expect(explainer(true, { meanRelDiff: 0.09855, players: 22, week: 12, leftOut: ["K", "DEF"] }, averaged)).toContain("(they agree within 9.9% on average this week over 22 rostered players, kickers and D/STs aside, though theirs are averaged too)");
    expect(explainer(false, { meanRelDiff: 0.1033, players: 22, week: 12, leftOut: ["K", "DEF"] }, { sleeper: 33 })).toContain("differ from Sleeper's by 10.3% on average this week (22 rostered players, kickers and D/STs aside), more than the 10% we allow");
    expect(explainer(false, { meanRelDiff: 0.10026, players: 22, week: 12, leftOut: ["K", "DEF"] }, { sleeper: 33 })).toContain("differ from Sleeper's by 10.03% on average this week (22 rostered players, kickers and D/STs aside), more than the 10% we allow");
    // Nothing left aside: no parentheses (the text before Checkpoint 7f but for "ESPN's").
    expect(explainer(true, { meanRelDiff: 0.04, players: 22, week: 12 }, averaged)).toContain("averaged with ESPN's own projection (they agree within 4% on average this week)");
  });

  it("names the injury tags the averaging test left aside after the positions, and averaged, whose projections are averaged too (Checkpoint 7g; planner reply to Checkpoint 7f, answer 4)", () => {
    const explainer = (espnAveraged: boolean, agreement: LeagueFixture["model"]["projection"]["agreement"], sources: Partial<Record<BaseRateSource, number>>) => {
      const f = leagueFixture();
      f.model.projection = { ...f.model.projection, espnAveraged, agreement, sources: { ...SOURCES, ...sources } };
      return of(f).explain[0]?.text ?? "";
    };
    const averaged = { "espn+sleeper": 25, sleeper: 8 };
    const both = { leftOut: ["K", "DEF"] as Pos[], leftOutStatuses: ["QUESTIONABLE"] as InjuryStatus[] };
    // Averaged: the tagged players' base rates read a later week, so "theirs" would say it of them too: the positions are named.
    expect(explainer(true, { meanRelDiff: 0.0991, players: 98, week: 6, ...both }, averaged)).toContain(
      "averaged with ESPN's own projection (they agree within 9.9% on average this week over 98 rostered players, kickers, D/STs and questionable players aside, though kickers and D/STs are averaged too)",
    );
    expect(explainer(false, { meanRelDiff: 0.11, players: 98, week: 6, ...both }, { sleeper: 33 })).toContain(
      "ESPN's own projections differ from Sleeper's by 11% on average this week (98 rostered players, kickers, D/STs and questionable players aside), more than the 10% we allow, so we don't average ESPN's in.",
    );
    // Tagged players alone aside: nobody to say is averaged too.
    expect(explainer(true, { meanRelDiff: 0.04, players: 22, week: 6, leftOutStatuses: ["QUESTIONABLE", "DOUBTFUL"] }, averaged)).toContain(
      "averaged with ESPN's own projection (they agree within 4% on average this week over 22 rostered players, questionable or doubtful players aside)",
    );
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
    expect(v.notices).toEqual(["Sleeper's projections for week 17 didn't load, so that week skips the matchup adjustment. Refresh later to try again.", "No projection for Dabney Drifter."]);
    // The server's value notes repeat the header's format and the explainer's substitutions, so only the other note shows.
    expect(v.notes).toEqual(["Sleeper hasn't published week 18 projections yet."]);
  });

  it("says when another team's likely starter has no projections, judged without them, since our points can't make him one (a review of Phase 7b)", () => {
    // Team 2's top RB, Mortimer Gloop, with nothing to project from: 0 points every week, so he starts nowhere in our lineups.
    const f = leagueFixture();
    const pm = f.model.players["202"];
    if (!pm) throw new Error("fixture player missing");
    f.model.players["202"] = { ...pm, base: { ...pm.base, b: 0, source: "none" }, weekly: pm.weekly.map((w) => ({ ...w, p: 0 })), ros: { ...pm.ros, total: 0, regular: 0, playoffs: 0 } };
    const gloop = "We have no projections for Mortimer Gloop (RB, Gravel Gophers), so he counts as 0 points.";
    // Without FantasyCalc's values nothing says he'd start (Team 2 has two other projected RBs for its two RB spots).
    expect(of(f).notices).not.toContain(gloop);
    // FantasyCalc rates him above an RB his team starts: a likely starter, said on the banner.
    f.inputs = { ...f.inputs, market: { format: fantasyCalcFormat(f.snapshot.settings), fetchedAt: "2026-11-25T23:00:00.000Z", values: { "202": 7900, "203": 6100, "204": 4200 }, knownIds: [], topValue: 10722 } };
    expect(of(f).notices).toContain(gloop);
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

/**
 * Puts the given players' byes in `week`, as a model has them: ros.bye, and that week's projection a bye (no points: the
 * likely starters' weekly lineups and the bye list read PlayerModel.weekly), his old bye week a full one again (the
 * fixture's points: his base rate, available).
 */
function byeIn(f: LeagueFixture, ids: string[], week: number) {
  const at = f.model.weeks.indexOf(week);
  for (const id of ids) {
    const pm = f.model.players[id];
    if (!pm) throw new Error(`fixture player ${id} missing`);
    const full = pm.base.b;
    const weekly = pm.weekly.map((w, i) => (i === at ? { ...w, p: 0, a: 0, bye: true, sd: 0 } : w.bye ? { ...w, p: full, a: 1, bye: false, sd: 0.5 * full + 2 } : w));
    f.model.players[id] = { ...pm, weekly, ros: { ...pm.ros, bye: { status: "upcoming", week } } };
  }
}

/** Sets a player's availability per model week (his points: his base rate × a; a bye week stays a bye), as an injury would. */
function availability(f: LeagueFixture, id: string, a: readonly number[]) {
  const pm = f.model.players[id];
  if (!pm) throw new Error(`fixture player ${id} missing`);
  const weekly = pm.weekly.map((w, i) => {
    if (w.bye) return w;
    const ai = a[i] ?? 1;
    const p = pm.base.b * ai;
    return { ...w, a: ai, p, sd: p > 0 ? 0.5 * p + 2 : 0 };
  });
  f.model.players[id] = { ...pm, weekly };
}

describe("buildLeagueView: standings and playoff odds (§8; §17 Checkpoint 3: next to the current standings)", () => {
  it("lists every team in today's standings order, with its record, points for, playoff and title odds and projected final record", () => {
    // Title odds with one decimal (titleCell), as the headline and every trade idea print them; playoff odds whole.
    expect(v.standings?.rows.map((r) => [r.rank, r.teamId, r.name, r.isMine, r.record, r.pointsFor, r.playoffs?.text, r.bye, r.title.text, r.finalRecord, r.eliminated])).toEqual([
      [1, "2", "Gravel Gophers", false, "8–3", "1210.3", "93%", null, "47.0%", "9.8–4.2", false],
      [2, "1", "Moonbeam Mudcats", true, "7–4", "1180.4", "86%", null, "43.0%", "8.5–5.5", false],
      [3, "3", "Quasar Quokkas", false, "5–6", "1100", "21%", null, "10.0%", "6.5–7.5", false],
      [4, "4", "Tundra Tortoises", false, "2–9", "990.5", "<1%", null, "<0.1%", "3.3–10.7", false],
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

  it("prints title odds with one decimal, as the headline and every trade idea do: <0.1% and >99.9% when they only round there, — when unknown (said in words)", () => {
    // Review of track UIP: the headline read "9.9% title" over my row's "10%".
    const ps = [0, 0.0001, 0.0004, 0.0005, 0.0998, 0.099, 0.43, 0.999, 0.9996, 1, null, Number.NaN];
    expect(ps.map((p) => titleCell(p).text)).toEqual(["0.0%", "<0.1%", "<0.1%", "0.1%", "10.0%", "9.9%", "43.0%", "99.9%", ">99.9%", "100.0%", "—", "—"]);
    expect(titleCell(0.0002)).toEqual({ text: "<0.1%", srText: "less than 0.1%" });
    expect(titleCell(0.9999)).toEqual({ text: ">99.9%", srText: "more than 99.9%" });
    expect(titleCell(null)).toEqual({ text: "—", srText: "unknown" });
    // Every printed title is the cards' own words for the same number (tradeView.ts titleOddsText).
    for (const p of [0.0002, 0.099, 0.4321, 0.9999]) expect(titleCell(p).text).toBe(titleOddsText(p));
    // My row prints what the headline prints.
    const mine = v.standings?.rows.find((r) => r.isMine);
    expect(`${mine?.title.text} title`).toBe(v.standings?.mine?.headline.at(-1)?.text);
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
      expect(s?.rows.map((r) => r.title.text)).toEqual(["47.0%", "43.0%", "10.0%", "<0.1%"]);
      expect(s?.caption).toBe(`Standings today by your league's rules, with each team's chance to win the title, and its projected final record, from 20,000 simulated seasons${COUNTING}`);
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
    expect(pointsOnly?.caption).toBe(`Standings today by your league's rules, with each team's chance to make the playoffs and win the title, from 20,000 simulated seasons${COUNTING}`);
  });

  it("captions the table, and lists the odds' notes except any the warnings box already shows", () => {
    expect(v.standings?.caption).toBe(
      `Standings today by your league's rules, with each team's chance to make the playoffs and win the title, and its projected final record, from 20,000 simulated seasons${COUNTING}`,
    );
    expect(of(withByes(leagueFixture())).standings?.caption).toContain("chance to make the playoffs, get a first-round bye and win the title, and its projected final record");
    // Game day: right after the engine's note about the week under way, when the odds count pickups from (Phase 4c).
    expect(v.standings?.notes).toEqual([
      "Odds from 20,000 simulated seasons.",
      "Ties in the standings go to points for, the league's rule.",
      weekUnderWayNote(12),
      pickupsUnderWayNote(12, 13),
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
    expect(once.notices).toContain(dup);
  });

  it("says when there are no odds, and shows no standings once no week is left", () => {
    const f = leagueFixture();
    f.model.odds = null;
    const none = of(f);
    expect(none.standings).toEqual({ mine: null, basis: null, rows: [], showPlayoffs: false, showBye: false, pointsOnly: false, caption: "", notes: [], empty: "Playoff odds aren't available for this league right now." });
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

describe("buildLeagueView: one baseline everywhere (planner reply to Checkpoint 4b, change 9)", () => {
  it("leads the standings with my odds (every team after its free-agent pickups, what trade ideas start from) and, smaller, the same as rosters stand", () => {
    // Printed as every trade idea prints my odds before it (tradeView.ts oddsViews): playoffs whole, the title with one decimal.
    expect(v.standings?.mine).toEqual({
      headline: [
        { text: "86% playoffs", srText: null },
        { text: "43.0% title", srText: null },
      ],
      asRostersStand: [
        { text: "82% playoffs", srText: null },
        { text: "40.0% title", srText: null },
      ],
      text: `${YOUR_ODDS_LABEL}: 86% playoffs · 43.0% title`,
      asRostersStandText: `${AS_ROSTERS_STAND_LABEL}: 82% playoffs · 40.0% title`,
    });
    expect(v.standings?.mine?.headline[1]?.text).toBe(`${titleOddsText(0.43)} title`);
    expect(YOUR_ODDS_LABEL).toBe("Your odds");
    expect(AS_ROSTERS_STAND_LABEL).toBe("As rosters stand");
    expect(v.standings?.basis).toBe(`${ODDS_BASIS_TEXT} “As rosters stand” counts no pickups.`);
    expect(ODDS_BASIS_TEXT).toBe("These odds count the free-agent pickups that would help each team (listed on its roster): trade ideas start from the same odds.");
    // The table, the schedule and "Your season's over" read the headline (LeagueModel.odds), never the second line; my
    // row prints the headline's numbers (the title with one decimal there too: review of track UIP).
    expect(v.standings?.rows.find((r) => r.isMine)).toMatchObject({ playoffs: { text: "86%" }, title: { text: "43.0%" } });
    expect(v.schedule?.rows.map((r) => r.win.text)).toEqual(["54%", "56%", "38%"]);
    const f = leagueFixture();
    const stand = f.model.oddsAsRostersStand as SeasonOdds;
    f.model.oddsAsRostersStand = { ...stand, teams: stand.teams.map((t) => (t.teamId === "1" ? { ...t, eliminated: true } : t)) };
    expect(of(f).eliminated).toBeNull();
  });

  it("prints the headline as trade ideas print my odds before them: playoff odds only with 2+ playoff teams, the title with one decimal, symbolic odds in words, unknown ones as unknown", () => {
    // Team 4 (<1% both ways): read out in words.
    const four = view({ myTeamId: "4" }).standings?.mine;
    expect(four?.headline).toEqual([
      { text: "<1% playoffs", srText: "less than 1% playoffs" },
      { text: "<0.1% title", srText: "less than 0.1% title" },
    ]);
    expect(four?.text).toBe("Your odds: <1% playoffs · <0.1% title");
    // One playoff team: the title alone, as the table shows it (no Playoffs column).
    const one = leagueFixture();
    for (const key of ["odds", "oddsAsRostersStand"] as const) {
      const o = one.model[key] as SeasonOdds;
      one.model[key] = { ...o, playoffTeams: 1, teams: o.teams.map((t) => ({ ...t, pPlayoffs: t.pTitle ?? 0 })) };
    }
    expect(of(one).standings?.mine).toMatchObject({ text: "Your odds: 43.0% title", asRostersStandText: "As rosters stand: 40.0% title" });
    // Title odds unknown (a played playoff round we can't read): said in words, not "— title".
    const unknown = leagueFixture();
    unknown.model.odds = { ...oddsOf(unknown), teams: oddsOf(unknown).teams.map((t) => ({ ...t, pTitle: null })) };
    expect(of(unknown).standings?.mine?.headline).toEqual([
      { text: "86% playoffs", srText: null },
      { text: "title unknown", srText: null },
    ]);
  });

  it("has no headline without a team, and no second line or basis in a model built before Phase 4c (its odds are as rosters stand)", () => {
    const none = view({ myTeamId: null }).standings;
    expect(none?.mine).toBeNull();
    // What the odds count still says so; there's no second line to mention.
    expect(none?.basis).toBe(ODDS_BASIS_TEXT);
    const old = leagueFixture();
    delete old.model.oddsAsRostersStand;
    const built = of(old).standings;
    expect(built?.mine).toEqual({ headline: v.standings?.mine?.headline, asRostersStand: null, text: v.standings?.mine?.text, asRostersStandText: null });
    expect(built?.basis).toBeNull();
    expect(built?.caption).not.toContain("pickups");
    expect(built?.notes).not.toContain(pickupsUnderWayNote(12, 13));
  });

  it("says while a week is under way that the odds count pickups from the next week only (league.ts \"Game days\"), after the engine's own note about that week", () => {
    // What the model does (it plays the week under way with today's rosters), never a platform rule: a free agent whose
    // game hasn't started can still be picked up and started (review of track UIP).
    expect(pickupsUnderWayNote(12, 13)).toBe("While week 12 is under way, these odds count free-agent pickups from week 13 on: week 12 is played with today's rosters.");
    expect(pickupsUnderWayNote(17, undefined)).toBe("Week 17 is under way and it's the last week, so these odds play it with today's rosters, without free-agent pickups.");
    for (const n of [pickupsUnderWayNote(12, 13), pickupsUnderWayNote(17, undefined)]) expect(n).not.toMatch(/can't play/);
    const notes = v.standings?.notes ?? [];
    expect(notes.indexOf(pickupsUnderWayNote(12, 13))).toBe(notes.indexOf(weekUnderWayNote(12)) + 1);
    // Before kickoff the odds count the pickups in this week too: nothing to say.
    expect(before.standings?.notes.some((n) => n.includes("free-agent pickups"))).toBe(false);
    // The engine's note missing (another league's notes): still said, last.
    const f = leagueFixture();
    f.model.odds = { ...oddsOf(f), notes: oddsOf(f).notes.filter((n) => n !== weekUnderWayNote(12)) };
    expect(of(f).standings?.notes.at(-1)).toBe(pickupsUnderWayNote(12, 13));
  });
});

describe("buildLeagueView: league prizes (planner reply to Checkpoint 7b, §6; Checkpoint 7c)", () => {
  const shares = (o: Partial<Reward["shares"]>): Reward["shares"] => ({ first: 0, second: 0, third: 0, weeklyHigh: 0, pointsLeader: 0, ...o });
  /** Parker's split (2,000 / 1,600 / 900), one paying 2nd but not 3rd, one paying weekly high scores, one the points title. */
  const PARKER: Reward = { goal: "prizes", shares: shares({ first: 4 / 9, second: 16 / 45, third: 1 / 5 }), periods: 14, empty: false };
  const TOP2: Reward = { goal: "prizes", shares: shares({ first: 0.6, second: 0.4 }), periods: 14, empty: false };
  const WEEKLY: Reward = { goal: "prizes", shares: shares({ first: 0.8, weeklyHigh: 0.2 }), periods: 14, empty: false };
  const LEADER: Reward = { goal: "prizes", shares: shares({ first: 0.9, pointsLeader: 0.1 }), periods: 14, empty: false };
  const TITLE: Reward = { goal: "title", shares: TITLE_ONLY, periods: 14, empty: false };
  const withReward = (reward: Reward | undefined, edit: (f: LeagueFixture) => void = () => {}, opts: Parameters<typeof leagueFixture>[0] = {}) => {
    const f = leagueFixture(opts);
    if (reward) f.model.reward = reward;
    edit(f);
    return f;
  };

  it("adds my chance of a top-3 finish to both odds lines when the split pays 3rd place (top 2 when it pays 2nd only), between playoffs and title, as the cards print it", () => {
    // The fixture: 2 playoff spots, so 1st and 2nd are the finalists and 3rd seed 3 (sim.ts); team 1's 43% + 43% + 13%.
    const mine = of(withReward(PARKER)).standings?.mine;
    expect(mine?.text).toBe(`${YOUR_ODDS_LABEL}: 86% playoffs · 99% top 3 · 43.0% title`);
    expect(mine?.asRostersStandText).toBe(`${AS_ROSTERS_STAND_LABEL}: 82% playoffs · 98% top 3 · 40.0% title`);
    expect(mine?.headline[1]).toEqual({ text: "99% top 3", srText: null });
    expect(of(withReward(TOP2)).standings?.mine?.text).toBe(`${YOUR_ODDS_LABEL}: 86% playoffs · 86% top 2 · 43.0% title`);
    // "Only the champion", a split paying neither 2nd nor 3rd, or a model built before Checkpoint 7c (no reward): as before.
    for (const reward of [TITLE, WEEKLY, undefined]) expect(of(withReward(reward)).standings?.mine?.text).toBe(`${YOUR_ODDS_LABEL}: 86% playoffs · 43.0% title`);
    // A part not known (3rd place's odds): left out, never a partial sum; the symbolic edges as the playoff odds print them.
    const unknown = withReward(PARKER, (f) => (f.model.odds = { ...oddsOf(f), teams: oddsOf(f).teams.map((t) => (t.teamId === "1" ? { ...t, pThird: null } : t)) }));
    expect(of(unknown).standings?.mine?.text).toBe(`${YOUR_ODDS_LABEL}: 86% playoffs · 43.0% title`);
    const four = of(withReward(PARKER, () => {}, { myTeamId: "4" })).standings?.mine?.headline;
    expect(four?.[1]).toEqual({ text: "6% top 3", srText: null });
    const edge = withReward(PARKER, (f) => (f.model.odds = { ...oddsOf(f), teams: oddsOf(f).teams.map((t) => (t.teamId === "1" ? { ...t, pTitle: 0.6, pSecond: 0.39, pThird: 0.0099 } : t)) }));
    expect(of(edge).standings?.mine?.headline[1]).toEqual({ text: ">99% top 3", srText: "more than 99% top 3" });
  });

  it("says how 2nd and 3rd place are decided in “How these numbers work” when my odds show a top-N finish", () => {
    const explain = (f: LeagueFixture) => of(f).explain.find((e) => e.title === "Playoff odds")?.text ?? "";
    // The fixture's 2 playoff spots: 3rd is the best team that misses them.
    expect(explain(withReward(PARKER))).toContain(
      "The top 2 make the playoffs and meet for the title. 2nd place goes to the final's loser, and 3rd to the best team that misses the playoffs. A team's chance of a playoff spot, a top-3 finish or the title is the share of those seasons where it happened.",
    );
    expect(explain(withReward(TOP2))).toContain("meet for the title. 2nd place goes to the final's loser. A team's chance of a playoff spot, a top-2 finish or the title");
    const odds = (reward: Reward, edit: Partial<SeasonOdds>) => explain(withReward(reward, (f) => (f.model.odds = { ...oddsOf(f), ...edit })));
    // 4+ playoff teams: the 3rd-place game (assumed when the league doesn't say), or the better seed when it has none.
    expect(odds(PARKER, { playoffTeams: 6, byes: 2, thirdPlace: { rule: "game", assumed: true } })).toContain(
      "The bracket is fixed: no re-seeding after each round. 2nd place goes to the final's loser, and 3rd to the winner of a game between the two semifinal losers (assumed: your league doesn't say whether it plays one).",
    );
    expect(odds(PARKER, { playoffTeams: 4, thirdPlace: { rule: "game", assumed: false } })).toContain("and 3rd to the winner of a game between the two semifinal losers. A team's chance");
    // No game in the league's data: the better seed takes 3rd, and that (not the missing game) is our assumption (review of
    // the prizes UI, prizes-ui-2).
    expect(odds(PARKER, { playoffTeams: 4, thirdPlace: { rule: "bySeed", assumed: false } })).toContain("and 3rd to the better seed of the two semifinal losers (our assumption, since your league plays no 3rd-place game).");
    expect(odds(PARKER, { playoffTeams: 3, byes: 1 })).toContain("and 3rd to the loser of the only semifinal (the top seed has a bye).");
    expect(odds(PARKER, { playoffTeams: 1, teams: oddsOf(leagueFixture()).teams.map((t) => ({ ...t, pPlayoffs: t.pTitle ?? 0 })) })).toContain(
      "the title goes to the top of the final standings. 2nd and 3rd place go to the next teams in the final standings.",
    );
    // Nothing of it otherwise.
    for (const reward of [TITLE, WEEKLY, undefined]) expect(explain(withReward(reward))).not.toMatch(/2nd place|top-\d finish/);
  });

  it("says my season's over only when no prize the league pays can still move: a weekly high score or the points title can still be won out of the title race", () => {
    const out = (reward: Reward | undefined, left: SeasonOdds["regularLeft"], leagueType: LeagueSettings["leagueType"] = "redraft", bestFinish = 4) =>
      of(
        withReward(reward, (f) => {
          f.snapshot = { ...f.snapshot, settings: { ...f.snapshot.settings, leagueType } };
          f.model.odds = { ...oddsOf(f), regularLeft: left, teams: oddsOf(f).teams.map((t) => (t.teamId === "1" ? { ...t, eliminated: true, bestFinish } : t)) };
        }),
      );
    const weeks = { periods: 2, weeks: 2 };
    const none = { periods: 0, weeks: 0 };
    // Out of the title race, and only places the playoffs decide pay: over, as before.
    for (const reward of [undefined, TITLE, PARKER, TOP2]) {
      const v = out(reward, weeks);
      expect(v.eliminated).toBe(SEASON_OVER_TEXT);
      expect(v.partners).toEqual({ cards: [], empty: SEASON_OVER_PARTNERS_TEXT });
    }
    // With the fixture's 2 playoff spots the final standings decide 3rd place (sim.ts): a team that can still finish 3rd
    // isn't done while a week is left (reward.ts prizeStillMovable's bestFinish).
    expect(out(PARKER, weeks, "redraft", 3).eliminated).toBeNull();
    expect(out(PARKER, none, "redraft", 3).eliminated).toBe(SEASON_OVER_TEXT);
    expect(out(TOP2, weeks, "redraft", 3).eliminated).toBe(SEASON_OVER_TEXT);
    // A weekly high score with a prize period left, or the points title with a week left: not over, the partners show.
    for (const reward of [WEEKLY, LEADER]) {
      const v = out(reward, weeks);
      expect(v.eliminated).toBeNull();
      expect(v.partners.empty).toBeNull();
      expect(v.partners.cards.length).toBeGreaterThan(0);
      // With none left, it's over.
      expect(out(reward, none).eliminated).toBe(SEASON_OVER_TEXT);
    }
    // The weekly high score needs a prize period left, the points title a week: a week left without a period moves only the latter.
    expect(out(WEEKLY, { periods: 0, weeks: 2 }).eliminated).toBe(SEASON_OVER_TEXT);
    expect(out(LEADER, { periods: 0, weeks: 2 }).eliminated).toBeNull();
    // Dynasty and keeper leagues still trade for later seasons: never.
    for (const leagueType of ["dynasty", "keeper"] as const) expect(out(TITLE, none, leagueType).eliminated).toBeNull();
    // The same reading as the engine's own stop and Waiver upgrades' (seasonOver).
    const f = withReward(WEEKLY, (g) => (g.model.odds = { ...oddsOf(g), teams: oddsOf(g).teams.map((t) => (t.teamId === "1" ? { ...t, eliminated: true } : t)) }));
    expect(seasonOver(f.model, "1", "redraft")).toBe(false);
    expect(seasonOver({ ...f.model, reward: TITLE }, "1", "redraft")).toBe(true);
    expect(seasonOver(f.model, "2", "redraft")).toBe(false);
    expect(seasonOver({ ...f.model, odds: null }, "1", "redraft")).toBe(false);
    expect(seasonOver(f.model, null, "redraft")).toBe(false);
  });

  it("for a pickup (Waiver upgrades), a regular-season week under way still counts: a trade can't change it, a pickup can (review of the prizes UI, prizes-ui-5)", () => {
    const at = (reward: Reward, left: SeasonOdds["regularLeft"], bestFinish = 4) =>
      withReward(reward, (f) => (f.model.odds = { ...oddsOf(f), regularLeft: left, teams: oddsOf(f).teams.map((t) => (t.teamId === "1" ? { ...t, eliminated: true, bestFinish } : t)) })).model;
    // The last regular-season week under way (none left but it): over for trades, not for a pickup while a paid prize can move.
    const none = { periods: 0, weeks: 0 };
    for (const model of [at(WEEKLY, none), at(LEADER, none), at(PARKER, none, 3)]) {
      expect(seasonOver(model, "1", "redraft")).toBe(true);
      expect(seasonOver(model, "1", "redraft", { weekUnderWay: true })).toBe(false);
    }
    // Nothing a pickup can win: over either way (the title alone; a place the final standings decide out of reach).
    for (const model of [at(TITLE, none), at(PARKER, none, 4)]) expect(seasonOver(model, "1", "redraft", { weekUnderWay: true })).toBe(true);
    // Odds made before Checkpoint 7c (no counts): a paid prize is taken as still within reach, as for trades.
    const weekly = at(WEEKLY, none);
    const old = { ...weekly, odds: { ...(weekly.odds as SeasonOdds), regularLeft: undefined } as unknown as SeasonOdds };
    expect([seasonOver(old, "1", "redraft"), seasonOver(old, "1", "redraft", { weekUnderWay: true })]).toEqual([false, false]);
  });

  it("a team that lost its semifinal still plays for a paid 3rd place: not over while the 3rd-place game is still to play (final review of Checkpoint 7c, ui-UI-7C-1)", () => {
    // 4 playoff teams and a 3rd-place game: my team lost its semifinal (eliminated), the final round still ahead, the
    // regular season over; its chance of 3rd, `third`.
    const semiLoser = (reward: Reward | undefined, third: number | null, playoffWeeks = 1) =>
      withReward(reward, (f) => {
        f.model.odds = {
          ...oddsOf(f),
          playoffTeams: 4,
          byes: 0,
          thirdPlace: { rule: "game", assumed: false },
          regularLeft: { periods: 0, weeks: 0 },
          playoffLeft: { weeks: playoffWeeks },
          teams: oddsOf(f).teams.map((t) => (t.teamId === "1" ? { ...t, pPlayoffs: 1, pTitle: 0, pSecond: 0, pThird: third, eliminated: true, bestFinish: 1 } : t)),
        };
      });
    const v = of(semiLoser(PARKER, 0.56));
    expect(v.eliminated).toBeNull();
    expect(v.partners.empty).not.toBe(SEASON_OVER_PARTNERS_TEXT);
    expect(v.standings?.mine?.text).toBe(`${YOUR_ODDS_LABEL}: 100% playoffs · 56% top 3 · 0.0% title`);
    expect(seasonOver(semiLoser(PARKER, 0.56).model, "1", "redraft")).toBe(false);
    // 3rd place settled (won, or lost to the better seed with no game), or only the champion paid: over, as before.
    for (const f of [semiLoser(PARKER, 1), semiLoser(PARKER, 0), semiLoser(PARKER, null), semiLoser(TOP2, 0.56), semiLoser(TITLE, 0.56), semiLoser(undefined, 0.56)]) {
      expect(of(f).eliminated).toBe(SEASON_OVER_TEXT);
      expect(seasonOver(f.model, "1", "redraft")).toBe(true);
    }
    // ⚠️ The 3rd-place game's week under way: no trade can change it (SeasonOdds.playoffLeft leaves it out), so over, as a
    // regular-season week under way reads for trades; Waiver upgrades' count of a week under way is the regular season's.
    const live = semiLoser(PARKER, 0.56, 0);
    expect(of(live).eliminated).toBe(SEASON_OVER_TEXT);
    expect(seasonOver(live.model, "1", "redraft", { weekUnderWay: true })).toBe(true);
    // Odds made before (no playoff count): a paid 3rd place still open is taken as within reach.
    const old = semiLoser(PARKER, 0.56);
    old.model.odds = { ...(old.model.odds as SeasonOdds), playoffLeft: undefined } as unknown as SeasonOdds;
    expect(seasonOver(old.model, "1", "redraft")).toBe(false);
    // A bracket of 2 (the fixture's): 3rd goes to the final standings, which no week can move now; its open chance is the
    // week under way's, not a game a trade can change.
    const standings = withReward(PARKER, (f) => (f.model.odds = { ...oddsOf(f), regularLeft: { periods: 0, weeks: 0 }, teams: oddsOf(f).teams.map((t) => (t.teamId === "1" ? { ...t, pThird: 0.4, eliminated: true, bestFinish: 3 } : t)) }));
    expect(seasonOver(standings.model, "1", "redraft")).toBe(true);
  });
});

describe("buildLeagueView: my remaining schedule (§8: each remaining week's risk)", () => {
  it("lists each remaining game: opponent, both teams' projected points, my win chance, my likely starters on bye, and a risky week in words", () => {
    expect(v.schedule?.rows.map((r) => [r.weekText, r.opponentId, r.opponent, r.mine, r.theirs, r.win.text, r.median, r.byes?.text ?? null, r.risk?.reasons ?? null, r.underWay])).toEqual([
      // Projected points with each team's pickups (TeamModel.scoreWithPickups), as the odds beside them count them: mine
      // with my pickup from week 13 on (game day: the engine plays week 12 with today's rosters), team 4's and team 2's
      // without any to make.
      ["12", "3", "Quasar Quokkas", "91.4", "88", "54%", null, null, null, UNDER_WAY_TEXT],
      ["13", "4", "Tundra Tortoises", "91.5", "85", "56%", null, null, null, null],
      ["14", "2", "Gravel Gophers", "85.5", "94", "38%", null, "D. Quibble", "under 40% to win", null],
    ]);
    expect(v.schedule?.showMedian).toBe(false);
    expect(v.schedule?.empty).toBeNull();
    expect(v.schedule?.rows[2]?.byes).toEqual({ text: "D. Quibble", title: nameOf("102"), count: 1 });
    // The week in progress is played as if none of its games had started (the engine's note says so in full: today's rosters and injury news).
    expect(UNDER_WAY_TEXT).toBe("Under way: projected as if no game had started (live scores aren't read)");
    // Before the week's first kickoff, week 12 is an ordinary week.
    expect(before.schedule?.rows[0]?.underWay).toBeNull();
  });

  it("uses the odds' own numbers (TeamModel.scoreWithPickups, Phase 4c): a week in progress shows its pre-game projection, not the partial lineup", () => {
    const f = leagueFixture();
    // Team 1's week 12 lineup value is a partial week on game day; its scores keep the pre-kickoff projection, and the
    // pickups count from week 13 (the engine plays a week under way with today's rosters).
    const mine = f.model.teams.find((t) => t.id === "1");
    expect(mine?.scen?.lv[0]).toBe(82);
    expect(mine?.score.mean[0]).toBe(PRE_KICKOFF["1"]);
    expect(mine?.scoreWithPickups?.mean[0]).toBe(PRE_KICKOFF["1"]);
    expect(v.schedule?.rows[0]?.mine).toBe("91.4");
    expect(v.schedule?.rows[1]?.mine).toBe(fmtNum(mine?.scoreWithPickups?.mean[1] ?? Number.NaN, 1));
    expect(v.schedule?.rows[1]?.mine).not.toBe(fmtNum(mine?.score.mean[1] ?? Number.NaN, 1));
    // Scores missing for a week: "—", never a made-up number.
    f.model.teams = f.model.teams.map((t) => (t.id === "3" ? { ...t, scoreWithPickups: { mean: [], sd: [] } } : t));
    expect(of(f).schedule?.rows[0]?.theirs).toBe("—");
    // A model built before Phase 4c has no scores with pickups (its odds are as rosters stand): the scores themselves.
    const g = leagueFixture();
    g.model.teams = g.model.teams.map((t) => ({ ...t, scoreWithPickups: undefined }));
    delete g.model.oddsAsRostersStand;
    expect(of(g).schedule?.rows.map((r) => [r.mine, r.theirs])).toEqual([
      ["91.4", "88"],
      ["90", "85"],
      ["84", "94"],
    ]);
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
    // Phase 4c: each team's scores with its pickups are its scores plus what they add (PICKUP_GAIN), from the week in
    // progress on before kickoff, and from the next week on game day (week 12 keeps the score's).
    for (const t of pre.model.teams) expect(t.scoreWithPickups?.mean, `team ${t.id} before kickoff`).toEqual(t.score.mean.map((x) => x + (PICKUP_GAIN[t.id] ?? 0)));
    for (const t of live.model.teams) {
      expect(t.scoreWithPickups?.mean, `team ${t.id} on game day`).toEqual(t.score.mean.map((x, i) => (i === 0 ? x : x + (PICKUP_GAIN[t.id] ?? 0))));
      expect(t.scoreWithPickups?.sd).toEqual(t.score.sd);
    }
    // Before kickoff the page shows week 12's LV with my pickups.
    expect(before.schedule?.rows[0]?.mine).toBe("92.9");
    expect(before.schedule?.rows[0]?.mine).toBe(fmtNum((lv(pre.model.teams[0] as TeamModel)[0] ?? Number.NaN) + (PICKUP_GAIN["1"] ?? 0), 1));
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

  it("counts only likely starters on bye: in my best lineup each week (projected points that week) in at least half the weeks they play, the trade cards' rule", () => {
    const f = leagueFixture();
    // QB, RB, RB, WR, FLEX, D/ST every week team numbers count (13–17), by position; the TE and the third WR sit.
    expect(likelyStarters(f.snapshot, f.model, "1")).toEqual(["101", "102", "103", "104", "105", "MIN"]);
    // Bench players and IR players on bye aren't listed.
    byeIn(f, ["106", "108", "107"], 13);
    expect(of(f).schedule?.rows[1]?.byes).toBeNull();
    // A player hurt for most of his games (projected 0 until week 17) drops out; the next best takes the FLEX.
    availability(f, "105", [1, 0, 0, 0, 0, 0.5]);
    expect(likelyStarters(f.snapshot, f.model, "1")).toEqual(["101", "102", "103", "104", "106", "MIN"]);
    byeIn(f, ["105"], 13);
    expect(of(f).schedule?.rows[1]?.byes).toMatchObject({ text: "W. Spoons", count: 1 });
    // No games left, or no model: never a starter.
    const g = leagueFixture();
    availability(g, "101", [0, 0, 0, 0, 0, 0]);
    delete g.model.players.MIN;
    expect(likelyStarters(g.snapshot, g.model, "1")).toEqual(["102", "103", "104", "105"]);
    expect(likelyStarters(g.snapshot, g.model, "99")).toEqual([]);
  });

  it("counts a player as a likely starter when he's in the lineup in at least half the weeks he plays, never the week in progress", () => {
    // Spoons outscores Oddfellow at FLEX from week 15 on (3 of the 5 weeks that count): he starts, Oddfellow doesn't.
    const f = leagueFixture();
    availability(f, "105", [1, 1, 1, 0.8, 0.8, 0.8]);
    expect(likelyStarters(f.snapshot, f.model, "1")).toEqual(["101", "102", "103", "104", "106", "MIN"]);
    // 2 of the 4 weeks he plays (a bye in week 17): exactly half still counts.
    availability(f, "105", [1, 1, 1, 0.8, 0.8, 1]);
    byeIn(f, ["105"], 17);
    expect(likelyStarters(f.snapshot, f.model, "1")).toContain("105");
    // A week under way doesn't count: Oddfellow starting only in week 12 (today) isn't a likely starter.
    const g = leagueFixture();
    availability(g, "105", [1, 0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(likelyStarters(g.snapshot, g.model, "1")).toEqual(["101", "102", "103", "104", "106", "MIN"]);
  });

  it("counts the streaming replacement where I stream: a rostered D/ST it outscores isn't a likely starter (the trade cards' rule)", () => {
    // Review of track UIP: the page listed a D/ST its team streams as a starter on bye, in a week no trade idea called risky.
    const f = leagueFixture();
    expect(f.model.streaming.byTeam["1"]?.positions).toEqual(["DEF"]);
    // The replacement (6.6) projects under the Vikings (7), so they start every week.
    expect(likelyStarters(f.snapshot, f.model, "1")).toContain("MIN");
    // A replacement who projects higher every week starts instead.
    f.model.streaming = { ...f.model.streaming, replacement: { DEF: f.model.weeks.map(() => 7.5) } };
    expect(likelyStarters(f.snapshot, f.model, "1")).toEqual(["101", "102", "103", "104", "105"]);
    byeIn(f, ["102", "104", "MIN"], 13);
    expect(of(f).schedule?.rows[1]).toMatchObject({ byes: { text: "D. Quibble, N. McSprocket", count: 2 }, risk: null });
    // Higher in 2 of the 5 weeks that count: the Vikings still start in 3, so they're a likely starter.
    const g = leagueFixture();
    g.model.streaming = { ...g.model.streaming, replacement: { DEF: [6.6, 7.5, 7.5, 6, 6, 6] } };
    expect(likelyStarters(g.snapshot, g.model, "1")).toContain("MIN");
    // A team that doesn't stream its D/ST starts its own.
    expect(likelyStarters(g.snapshot, g.model, "2")).toContain("DET");
  });

  it("Phase 4c (lead decision): never counts or lists a likely starter at a position I stream on bye: the streaming replacement covers his slot (evaluate.ts riskyWeeksOf's rule)", () => {
    // The Vikings start every week (the replacement, 6.6, projects under their 7), but I stream D/ST: their bye in week 13,
    // with two other starters', is two starters off, not three.
    const f = leagueFixture();
    expect(likelyStarters(f.snapshot, f.model, "1")).toContain("MIN");
    byeIn(f, ["102", "104", "MIN"], 13);
    expect(of(f).schedule?.rows[1]).toMatchObject({ byes: { text: "D. Quibble, N. McSprocket", count: 2 }, risk: null });
    // Not streaming D/ST (my setting): the Vikings' bye counts, and three starters off flags the week.
    const g = leagueFixture();
    g.model.streaming = { ...g.model.streaming, byTeam: { ...g.model.streaming.byTeam, "1": { positions: [], source: "setting", adds: {} } } };
    byeIn(g, ["102", "104", "MIN"], 13);
    expect(of(g).schedule?.rows[1]).toMatchObject({ byes: { count: 3 }, risk: { reasons: "3 starters on bye" } });
    // The note and the explainer say so; a team streaming nothing isn't told.
    expect(v.schedule?.note).toContain("in at least half the weeks they play. D/STs don't count: you stream them, so the streaming replacement covers their byes. A week is flagged risky");
    expect(v.schedule?.note).not.toContain("where you stream");
    expect(v.explain.find((e) => e.title === "Playoff odds")?.text).toContain(" are on bye, not counting D/STs, whose byes the streaming replacement covers since you stream them.");
    const noStream = of(g);
    expect(noStream.schedule?.note).not.toContain("don't count");
    expect(noStream.explain.find((e) => e.title === "Playoff odds")?.text).not.toContain("not counting");
  });

  it("Phase 4c (lead decision): a streamed QB's bye still counts, since only a streamed K or D/ST covers it (config.leaguePage.streamCoversBye)", () => {
    // I stream QB and D/ST: my QB, RB1 and WR1 off in week 13 are three starters on bye (a streamed QB's replacement is much
    // weaker), and the note names only the D/STs as covered.
    const f = leagueFixture();
    f.model.streaming = { ...f.model.streaming, byTeam: { ...f.model.streaming.byTeam, "1": { positions: ["QB", "DEF"], source: "setting", adds: {} } } };
    expect(likelyStarters(f.snapshot, f.model, "1")).toContain("101");
    byeIn(f, ["101", "102", "104"], 13);
    const view13 = of(f);
    expect(view13.schedule?.rows[1]).toMatchObject({ byes: { count: 3 }, risk: { reasons: "3 starters on bye" } });
    expect(view13.schedule?.note).toContain("D/STs don't count: you stream them");
    expect(view13.schedule?.note).not.toContain("quarterbacks");
  });

  it("counts my IR returners from their expected return week (league.ts step 5b): a bye before it isn't listed, one after it is", () => {
    /** Team 1 with Fiddlesticks (IR) back in week 14 (ESPN's date), a returner the model lists with his team, his bye in `bye`. */
    const returner = (bye: number) => {
      const f = leagueFixture();
      const info = f.snapshot.players["107"];
      if (!info) throw new Error("fixture WR missing");
      f.snapshot = { ...f.snapshot, players: { ...f.snapshot.players, "107": { ...info, injuryReturnWeek: 14 } } };
      availability(f, "107", [0, 0, 0.75, 1, 1, 1]);
      f.model.teams = f.model.teams.map((t) => (t.id === "1" ? { ...t, players: { ...t.players, "107": { mvLoseEv: 3, mvLoseScen: 3, autoAdd: null, surplusScore: 0 } } } : t));
      byeIn(f, ["107"], bye);
      return f;
    };
    // Back in week 14, his bye in week 13: on IR then anyway, so it isn't my crunch, though he starts once he's back.
    const early = returner(13);
    expect(likelyStarters(early.snapshot, early.model, "1", { afterPickups: true })).toContain("107");
    expect(of(early).schedule?.rows[1]?.byes).toBeNull();
    // His bye in week 14, once he's back: listed with Quibble's.
    const late = returner(14);
    expect(likelyStarters(late.snapshot, late.model, "1", { afterPickups: true })).toContain("107");
    expect(of(late).schedule?.rows[2]?.byes).toEqual({ text: "D. Quibble, H. Fiddlesticks", title: `${nameOf("102")}, ${nameOf("107")}`, count: 2 });
    // An IR player the model doesn't list with his team (not back within the weeks left) never starts.
    expect(likelyStarters(leagueFixture().snapshot, leagueFixture().model, "1")).not.toContain("107");
  });

  it("counts my likely starters after my free-agent pickups (Phase 4c: the odds and points beside them count them), on the roster V*(T) leaves", () => {
    // Team 1's pickup (Freeman for the TE) doesn't start, so the fixture's starters are the same either way.
    const f = leagueFixture();
    expect(likelyStarters(f.snapshot, f.model, "1", { afterPickups: true })).toEqual(likelyStarters(f.snapshot, f.model, "1"));
    // A pickup that drops my FLEX receiver: his backup starts there instead, and his bye counts; Oddfellow's doesn't.
    f.model.teams = f.model.teams.map((t) => (t.id === "1" ? { ...t, faMoves: [{ add: "901", drop: "105", gainEv: 4, gainScen: 4, gainEvPlain: 3.5, gainScenPlain: 3.5 }] } : t));
    expect(likelyStarters(f.snapshot, f.model, "1", { afterPickups: true })).toEqual(["101", "102", "103", "104", "106", "MIN"]);
    byeIn(f, ["106"], 13);
    expect(of(f).schedule?.rows[1]?.byes).toMatchObject({ text: "W. Spoons", count: 1 });
    // A model built before Phase 4c (odds as rosters stand): the roster as it stands, so Spoons sits.
    delete f.model.oddsAsRostersStand;
    expect(of(f).schedule?.rows[1]?.byes).toBeNull();
  });

  it("scheduleByeRule, the schedule's bye rule the league report reads too (review POL-1): the pool after my pickups with my returners, likely starters without a position I stream, a returner's bye only from his week", () => {
    const f = leagueFixture();
    // Fiddlesticks (IR) back in week 14, a returner the model lists with team 1; a pickup drops Oddfellow for Freeman.
    const info = f.snapshot.players["107"];
    if (!info) throw new Error("fixture WR missing");
    f.snapshot = { ...f.snapshot, players: { ...f.snapshot.players, "107": { ...info, injuryReturnWeek: 14 } } };
    availability(f, "107", [0, 0, 0.75, 1, 1, 1]);
    f.model.teams = f.model.teams.map((t) =>
      t.id === "1" ? { ...t, faMoves: [{ add: "901", drop: "105", gainEv: 4, gainScen: 4, gainEvPlain: 3.5, gainScenPlain: 3.5 }], players: { ...t.players, "107": { mvLoseEv: 3, mvLoseScen: 3, autoAdd: null, surplusScore: 0 } } } : t,
    );
    byeIn(f, ["106", "107", "MIN"], 13);
    const rule = scheduleByeRule(f.snapshot, f.model, "1", undefined);
    expect(rule.pickups).toBe(true);
    // The pool: the roster after the pickup (Freeman in Oddfellow's place), then the returner.
    expect(rule.players).toEqual(["101", "102", "103", "104", "901", "106", "108", "MIN", "107"]);
    // The likely starters after the pickup, but for the Vikings: I stream D/ST.
    const likely = likelyStarters(f.snapshot, f.model, "1", { afterPickups: true });
    expect(likely).toContain("MIN");
    expect(rule.starters).toEqual(likely.filter((id) => id !== "MIN"));
    // Fiddlesticks starts once he's back (at FLEX, over Spoons), so he's a likely starter whose week-13 bye won't count.
    expect(rule.starters).toContain("107");
    // Off in any of a game's weeks the model has: Spoons and the Vikings in week 13; Fiddlesticks isn't back until 14.
    expect(["106", "MIN", "107"].map((id) => rule.onBye(id, [13]))).toEqual([true, true, false]);
    expect([rule.onBye("106", [12, 13]), rule.onBye("106", [14]), rule.onBye("106", [99])]).toEqual([true, false, false]);
    // A model built before Phase 4c (odds as rosters stand): no pickups, the roster as it stands.
    delete f.model.oddsAsRostersStand;
    const stands = scheduleByeRule(f.snapshot, f.model, "1", undefined);
    expect(stands.pickups).toBe(false);
    expect(stands.players).toEqual(["101", "102", "103", "104", "105", "106", "108", "MIN", "107"]);
    // No such team: nobody.
    expect(scheduleByeRule(f.snapshot, f.model, "99", undefined)).toMatchObject({ players: [], starters: [] });

    // A likely starter the snapshot lists on the active roster and IR alike (a data error) is an active player, as the
    // engine reads him (league.ts TeamWork.ir): listed once, his week-13 bye counts though his IR tag says week 15.
    const g = leagueFixture();
    availability(g, "105", [1, 0, 0, 0, 0, 0.5]);
    const spoons = g.snapshot.players["106"];
    if (!spoons) throw new Error("fixture WR missing");
    g.snapshot = {
      ...g.snapshot,
      teams: g.snapshot.teams.map((t) => (t.id === "1" ? { ...t, ir: [...t.ir, "106"] } : t)),
      players: { ...g.snapshot.players, "106": { ...spoons, injury: "IR", injuryReturnWeek: 15 } },
    };
    byeIn(g, ["106"], 13);
    const both = scheduleByeRule(g.snapshot, g.model, "1", undefined);
    expect(both.starters).toContain("106");
    expect(both.players.filter((id) => id === "106")).toHaveLength(1);
    expect(both.onBye("106", [13])).toBe(true);
    expect(of(g).schedule?.rows[1]?.byes).toMatchObject({ text: "W. Spoons", count: 1 });
  });

  it("applies a team's free-agent pickups in order, as the optimizer does (optimizer.ts applyStep): in the drop's place, or at the end for an open spot", () => {
    expect(rosterAfterPickups(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
    expect(rosterAfterPickups(["a", "b", "c"], [{ add: "x", drop: "b" }])).toEqual(["a", "x", "c"]);
    expect(rosterAfterPickups(["a", "b"], [{ add: "x", drop: null }])).toEqual(["a", "b", "x"]);
    // A later move can swap an earlier pickup away; each id once.
    expect(
      rosterAfterPickups(
        ["a", "b", "a"],
        [
          { add: "x", drop: null },
          { add: "y", drop: "x" },
        ],
      ),
    ).toEqual(["a", "b", "y"]);
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
    expect(of(f).schedule?.rows[1]).toMatchObject({ opponentId: null, opponent: "Bye week", mine: "91.5", theirs: null, win: { text: "—", srText: "no game" }, risk: null });
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
      [13, "13–14", "Weeks 13–14", "Tundra Tortoises", "177", "168", "D. Quibble"],
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
    const starters = `"On bye" names your likely starters who are off that week: players in your best lineup, after your free-agent pickups, in at least half the weeks they play. D/STs don't count: you stream them, so the streaming replacement covers their byes. A week is flagged risky when your chance to win it is under 40%, or when ${RISKY_BYES} or more of those starters are on bye.`;
    expect(before.schedule?.note).toBe(`Projected points and chances count each team's free-agent pickups that would help, as the odds above do. ${starters}`);
    // While a week is under way the pickups count from the next week, as the odds' notes say: the model plays the week
    // under way with today's rosters (review of track UIP: the row of that week counted no pickups, though the note said so).
    expect(v.schedule?.note).toBe(`Projected points and chances count each team's free-agent pickups that would help from week 13 on, as the odds above do: week 12 is played with today's rosters. ${starters}`);
    // …and when the week under way is the last one, none at all.
    const last = leagueFixture();
    last.model = { ...last.model, weeks: [12], regularWeeks: [12], playoffWeeks: [] };
    last.model.odds = { ...oddsOf(last), weekly: oddsOf(last).weekly.filter((wk) => wk.week === 12) };
    expect(of(last).schedule?.note).toMatch(/^Projected points and chances play week 12 with today's rosters, without free-agent pickups, as the odds above do\. "On bye"/);
    for (const note of [v.schedule?.note, before.schedule?.note, of(last).schedule?.note]) expect(note).not.toMatch(/can't play/);
    // A model built before Phase 4c: its odds and points count no pickups, and the note doesn't say they do.
    const f = leagueFixture();
    delete f.model.oddsAsRostersStand;
    expect(of(f).schedule?.note).toBe(
      `"On bye" names your likely starters who are off that week: players in your best lineup in at least half the weeks they play. D/STs don't count: you stream them, so the streaming replacement covers their byes. A week is flagged risky when your chance to win it is under 40%, or when ${RISKY_BYES} or more of those starters are on bye.`,
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
      `Your league ranks teams by total points, so these games don't change the standings: only your points count. Projected points and chances count each team's free-agent pickups that would help from week 13 on, as the odds above do: week 12 is played with today's rosters. "On bye" names your likely starters who are off that week: players in your best lineup, after your free-agent pickups, in at least half the weeks they play. D/STs don't count: you stream them, so the streaming replacement covers their byes. A week is flagged risky when ${RISKY_BYES} or more of those starters are on bye.`,
    );
    expect(pointsOnly.explain.find((e) => e.title === "Playoff odds")?.text).toContain(
      `Your remaining schedule flags a week as risky when ${RISKY_BYES} or more of your likely starters (players in your best lineup, after your free-agent pickups, in at least half the weeks they play) are on bye, not counting D/STs, whose byes the streaming replacement covers since you stream them.`,
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
    const w = `(playoffs count ${PW}×)`;
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
        ? { ...t, faMoves: [{ add: "901", drop: "203", gainEv: 5, gainScen: 4, gainEvPlain: 4.5, gainScenPlain: 3.5 }], chips: t.chips.map((c) => (c.playerId === "203" ? { ...c, cost: 0, costPerWeek: 0, gap: c.maxOther, starter: false } : c)) }
        : t.id === "1"
          ? { ...t, faMoves: [{ add: "901", drop: "106", gainEv: 5, gainScen: 4, gainEvPlain: 4.5, gainScenPlain: 3.5 }] }
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

  it("shows no trade values (planner reply to Checkpoint 7a, 5.4), and the lineup cost (scenario MV_lose, else expected-value)", () => {
    // Offer Sheet uses FantasyCalc's values in its own numbers but never shows them: no row carries one, FantasyCalc's own,
    // our estimates and the flat minimum alike (src/lib/fantasyCalcHidden.test.ts guards every page's words).
    for (const row of [...v.rosters.flatMap((r) => r.players), ...v.freeAgents.flatMap((g) => g.players)]) expect(row).not.toHaveProperty("value");
    expect(player("1", "101").lineupCost).toBe("58.2");
    expect(player("1", "106").lineupCost).toBe("2"); // no scenario value: expected-value lineups
    expect(player("1", "107").lineupCost).toBeNull(); // IR: not in the lineup
  });

  it("defines lineup cost in lineup points, with the playoff weighting while playoff weeks count", () => {
    expect(v.lineupCostTitle).toBe(`Rest-of-season lineup points his team would lose without him, with playoff weeks counted ${PW}×`);
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

  /** How the lean works in a redraft or keeper league (blendText's title), the weight 0.5 and today's clamp. */
  const HOW = `Per game, his projection moves halfway toward what our model gives healthy players with about the same trade value, at most ${CAP.up} up or ${CAP.down} down. Byes and injuries stay as projected, and every number on this page uses the result.`;
  /** A line with no number but the clamp's percents: neither the market's number nor ours before the blend (with his ROS shown and the weight, ours gives the market's back). */
  const noNumbers = (line: { text: string; title: string } | null | undefined) => `${line?.text ?? ""} ${line?.title ?? ""}`.replaceAll(CAP.up, "").replaceAll(CAP.down, "");

  it("says which way the trade market moved a blended player's projection, in words, in his breakdown and hover (after his conflict note), never a number of the market's (planner reply to Checkpoint 7a, 5.4)", () => {
    const view = of(blended(), { now: BEFORE_KICKOFF });
    const rb = view.rosters.find((r) => r.teamId === "1")?.players.find((p) => p.id === "103") as PlayerRow;
    expect(rb.blend).toEqual({ text: "His projection leans down toward the trade market's view.", title: HOW });
    expect(rb.weeksText.split("\n").slice(0, 2)).toEqual([rb.availabilityNote?.long, rb.blend?.text]);
    // Nobody else was blended, so nobody else has the line.
    expect(view.rosters.flatMap((r) => r.players).filter((p) => p.blend).map((p) => p.id)).toEqual(["103"]);
    // Up; another weight.
    expect(blendText({ ours: 100, market: 140, used: 120, weight: 0.5 }).text).toBe("His projection leans up toward the trade market's view.");
    expect(blendText({ ours: 100, market: 140, used: 110, weight: 0.25 }).title).toContain("his projection moves 25% of the way toward what our model gives");
    // No number of the market's, nor ours before the blend (review of Phase 7b: "Our projection 210 · Trade market 170 · Used 190").
    expect(noNumbers(rb.blend)).not.toMatch(/\d/);
    expect(`${rb.blend?.text} ${rb.blend?.title} ${rb.weeksText}`).not.toMatch(/Our projection|Trade market \d|Used \d|\b210\b|\b170\b/);
  });

  it("in a dynasty league, says the blend reads this season's values, not the dynasty values Offer Sheet uses for long-term worth (review of track A)", () => {
    const b = { ours: 100, market: 140, used: 120, weight: 0.5 };
    expect(blendText(b, "dynasty").title).toContain("healthy players with about the same trade value this season (FantasyCalc's redraft values), at most");
    for (const type of ["redraft", "keeper"] as const) expect(blendText(b, type).title).toBe(HOW);
    const dynasty = blended();
    dynasty.snapshot = { ...dynasty.snapshot, settings: { ...dynasty.snapshot.settings, leagueType: "dynasty" } };
    const view = of(dynasty, { now: BEFORE_KICKOFF });
    expect(view.rosters.find((r) => r.teamId === "1")?.players.find((p) => p.id === "103")?.blend?.title).toBe(blendText(b, "dynasty").title);
    const explained = view.explain.find((e) => e.title === "Projected points")?.text ?? "";
    expect(explained).toContain("with a FantasyCalc trade value this season (its redraft values, not the dynasty values Offer Sheet uses for long-term worth), points per game are pulled halfway");
    // The page shows no values (5.4), dynasty ones included.
    expect(explained).not.toMatch(/shown here|values the page shows/);
  });

  it("says the market barely moves a player whose printed ROS doesn't change, one at either end of his position's value range among them, never which end (review of Phase 4b; 7b)", () => {
    // Blended RBs: Gloop (the top value: his market number is his own), Snoot (read off the curve) and Quibble (the lowest:
    // his own number too); and a player the market moves by under half a point.
    const f = leagueFixture({ gameDay: false });
    const set = (id: string, blend: { ours: number; market: number; used: number; weight: number }) => {
      const pm = f.model.players[id];
      if (!pm) throw new Error(`fixture player ${id} missing`);
      f.model.players[id] = { ...pm, blend };
    };
    set("202", { ours: 313.2, market: 313.2, used: 313.2, weight: 0.5 });
    set("204", { ours: 150, market: 130, used: 140, weight: 0.5 });
    set("102", { ours: 120.4, market: 120.4, used: 120.4, weight: 0.5 });
    set("203", { ours: 88.1, market: 88.6, used: 88.35, weight: 0.5 });
    const rows = of(f, { now: BEFORE_KICKOFF }).rosters.flatMap((r) => r.players);
    const row = (id: string) => rows.find((p) => p.id === id)?.blend;
    const BARELY = "The trade market barely moves his projection.";
    expect(row("202")).toEqual({ text: BARELY, title: HOW });
    expect(row("102")?.text).toBe(BARELY);
    expect(row("203")?.text).toBe(BARELY);
    expect(row("204")?.text).toBe("His projection leans down toward the trade market's view.");
    expect(rows.find((p) => p.id === "202")?.weeksText).toContain(BARELY);
    // Never which end of his position's FantasyCalc range he's at (it named FantasyCalc's top player), nor any number.
    const dynasty = { ...f, snapshot: { ...f.snapshot, settings: { ...f.snapshot.settings, leagueType: "dynasty" as const } } };
    for (const p of [...rows, ...of(dynasty, { now: BEFORE_KICKOFF }).rosters.flatMap((r) => r.players)].filter((x) => x.blend)) {
      expect(`${p.blend?.text} ${p.blend?.title} ${p.weeksText}`, p.id).not.toMatch(/top value|lowest value|no comparison|end of his position/);
      expect(noNumbers(p.blend), p.id).not.toMatch(/\d/);
    }
    // Equal to floating-point precision (another blend weight), and only then.
    expect(blendIsOwnPoint({ ours: 200, market: 200 * (1 + 4e-16) })).toBe(true);
    expect(blendIsOwnPoint({ ours: 200, market: 200.01 })).toBe(false);
    expect(blendIsOwnPoint({ ours: 120.3, market: 120.4 })).toBe(false);
  });

  it("says in 'Projected points' which positions were blended, how far (at most config.marketBlend.factorClamp's bounds) and that it is per game; nothing when nobody was", () => {
    const text = (f: LeagueFixture) => of(f, { now: BEFORE_KICKOFF }).explain.find((e) => e.title === "Projected points")?.text ?? "";
    expect(text(blended())).toContain(
      `Then, for RBs with a FantasyCalc trade value, points per game are pulled halfway toward what our model gives healthy players with about the same trade value, at most ${CAP.up} up or ${CAP.down} down, so a projection the trade market disagrees with counts for less; byes and injuries stay as projected (a player's breakdown says which way his leans).`,
    );
    expect(text(leagueFixture({ gameDay: false }))).not.toContain("trade market");
  });

  it("says when the market moved a player as far as it may (PlayerBlend.clamped; planner reply to Checkpoint 4b, change 4), worded from config.marketBlend.factorClamp, never what the blend would have been", () => {
    const [lo, hi] = config.marketBlend.factorClamp;
    // Capped high: ours × hi, where the half-and-half blend would be more.
    const high = { ours: 100, market: 200, used: 100 * hi, weight: 0.5, clamped: "high" as const };
    expect(blendText(high)).toEqual({ text: `His projection leans up toward the trade market's view, by the most it can: ${CAP.up}.`, title: HOW });
    const low = { ours: 200, market: 50, used: 200 * lo, weight: 0.5, clamped: "low" as const };
    expect(blendText(low).text).toBe(`His projection leans down toward the trade market's view, by the most it can: ${CAP.down}.`);
    // The uncapped blend (150, 125: it gives the market's number back) is never said (review of Phase 7b).
    for (const b of [high, low]) expect(noNumbers(blendText(b))).not.toMatch(/\d|would be/);
    // The words follow the clamp, never a fixed number.
    expect(blendText(high, "redraft", [0.8, 1.2]).text).toBe("His projection leans up toward the trade market's view, by the most it can: 20%.");
    expect(blendText(low, "redraft", [0.8, 1.2]).title).toContain("at most 20% up or 20% down.");
    // A factor inside the clamp says nothing about it.
    expect(blendText({ ours: 210.4, market: 169.6, used: 190, weight: 0.5 }).text).not.toContain("the most it can");
    // On the page: a capped player's breakdown and his hover.
    const f = blended();
    const pm = f.model.players["103"];
    if (!pm?.blend) throw new Error("fixture blend missing");
    f.model.players["103"] = { ...pm, blend: { ...pm.blend, ours: 150, market: 400, used: 150 * hi, clamped: "high" } };
    const row = of(f, { now: BEFORE_KICKOFF }).rosters.find((r) => r.teamId === "1")?.players.find((p) => p.id === "103");
    expect(row?.blend?.text).toBe(`His projection leans up toward the trade market's view, by the most it can: ${CAP.up}.`);
    expect(row?.weeksText).toContain(`by the most it can: ${CAP.up}.`);
  });
});

describe("buildLeagueView: each team's free-agent pickups (§7 V*, TeamModel.faMoves)", () => {
  const withMoves = (teamId: string, faMoves: TeamModel["faMoves"]) => {
    const f = leagueFixture();
    f.model.teams = f.model.teams.map((t) => (t.id === teamId ? { ...t, faMoves } : t));
    return of(f).rosters.find((r) => r.teamId === teamId)?.pickups;
  };
  /** A move whose gains read the same with ω or each week once (the cases below that are about the words, not the weighting). */
  const move = (add: string, drop: string | null, gainEv: number, gainScen: number | null): TeamModel["faMoves"][number] => ({ add, drop, gainEv, gainScen, gainEvPlain: gainEv, gainScenPlain: gainScen });

  it("lists a team's pickups in order, each with what it adds with injuries and byes simulated, each week counted once (Waiver upgrades' number: planner reply to Checkpoint 7b, Q6), and the projected one in its title", () => {
    // Review of Phase 4: the optimizer picks and keeps moves by their gain in scenario lineups when scenarios run, so
    // those are the lineups shown; the expected-value gain goes in the title. Since the planner's reply to Checkpoint 7b,
    // Q6, both count each week once (FaMove.gainScenPlain and gainEvPlain: 3.31 and 3.71 here), not the optimizer's own
    // gains with the playoff weeks weighted by ω (3.92 and 4.64), and nothing says "(playoffs count N×)" after them.
    expect(roster("1")?.pickups).toEqual({
      items: [
        {
          move: `add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}`,
          gain: "+3.3 lineup pts",
          title: `Add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}: +3.3 lineup pts with injuries and byes simulated (+3.7 on projected lineups), each week counted once.`,
        },
      ],
      summary: "1, +3.3 lineup pts",
      text: `Free-agent pickups that would help: add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}: +3.3 lineup pts`,
    });
    expect(FREE_AGENT_PICKUPS_LABEL).toBe("Free-agent pickups that would help");
    // Two pickups (no scenarios for this team, so no simulated gain: the projected ones, saying so): into an open spot, then for a bench WR; the summary adds them up.
    // ⚠️ The second is counted after the first (the optimizer's order), where Waiver upgrades prices each pickup alone, so
    // its title says so (review of Q6: "one number in both places" holds for the first pickup only).
    expect(roster("3")?.pickups).toMatchObject({
      items: [
        { move: `add ${nameOf("902")} (RB, NE) into an open spot`, gain: "+2.9 lineup pts", title: `Add ${nameOf("902")} (RB, NE) into an open spot: +2.9 lineup pts on projected lineups, each week counted once.` },
        {
          move: `add ${nameOf("901")} (RB, CAR), drop ${nameOf("305")}`,
          gain: "+2.6 lineup pts",
          title: `Add ${nameOf("901")} (RB, CAR), drop ${nameOf("305")}: +2.6 lineup pts on projected lineups, each week counted once, after the pickups above it.`,
        },
      ],
      summary: "2, +5.5 lineup pts",
    });
    // Never "ROS pts" (that's the plain total in the same header), and never the playoff weighting lineup cost carries.
    const words = v.rosters.flatMap((r) => (r.pickups ? [r.pickups.text, r.pickups.summary, ...r.pickups.items.flatMap((i) => [i.gain, i.title])] : [])).join(" ");
    expect(words).not.toContain("ROS pts");
    expect(words).not.toContain("playoffs count");
    expect(roster("1")?.pickups).not.toHaveProperty("weighting");
  });

  it("says nothing about how weeks count when no playoff week is left to count (lineup cost isn't weighted then either)", () => {
    const f = leagueFixture();
    f.model = { ...f.model, weeks: [12, 13, 14], regularWeeks: [12, 13, 14], playoffWeeks: [] };
    expect(of(f).rosters[0]?.pickups?.text).toBe(`Free-agent pickups that would help: add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}: +3.3 lineup pts`);
    expect(of(f).rosters[0]?.pickups?.items[0]?.title).toBe(`Add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}: +3.3 lineup pts with injuries and byes simulated (+3.7 on projected lineups).`);
  });

  it("shows the projected gains when the optimizer judges moves on projected lineups: no scenarios, or starter limits that bind", () => {
    const ev = (f: ReturnType<typeof leagueFixture>) => of(f).rosters.find((r) => r.teamId === "1")?.pickups;
    // Starter limits (MFL): the optimizer judges in expected-value lineups even with scenarios.
    const limited = leagueFixture();
    limited.snapshot = { ...limited.snapshot, settings: { ...limited.snapshot.settings, starterLimits: { QB: { min: 1, max: 1 } } } };
    expect(ev(limited)).toMatchObject({
      items: [{ gain: "+3.7 lineup pts", title: `Add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}: +3.7 lineup pts on projected lineups (+3.3 with injuries and byes simulated), each week counted once.` }],
      summary: "1, +3.7 lineup pts",
    });
    // No scenarios.
    const none = leagueFixture();
    none.model = { ...none.model, scenarios: 0, teams: none.model.teams.map((t) => ({ ...t, faMoves: t.faMoves.map((m) => ({ ...m, gainScen: null, gainScenPlain: null })) })) };
    expect(ev(none)?.items[0]).toEqual({
      move: `add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}`,
      gain: "+3.7 lineup pts",
      title: `Add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}: +3.7 lineup pts on projected lineups, each week counted once.`,
    });
  });

  it("says one lineup point in the singular", () => {
    expect(withMoves("1", [{ add: "901", drop: "108", gainEv: 1.3, gainScen: 4.2, gainEvPlain: 1.02, gainScenPlain: 3.5 }])?.items[0]?.title).toBe(
      `Add ${nameOf("901")} (RB, CAR), drop ${nameOf("108")}: +3.5 lineup pts with injuries and byes simulated (+1 on projected lineups), each week counted once.`,
    );
    const f = leagueFixture();
    f.model = { ...f.model, scenarios: 0 };
    f.model.teams = f.model.teams.map((t) => (t.id === "1" ? { ...t, faMoves: [{ add: "901", drop: "108", gainEv: 1.2, gainScen: null, gainEvPlain: 0.96, gainScenPlain: null }] } : t));
    expect(of(f).rosters.find((r) => r.teamId === "1")?.pickups).toMatchObject({ items: [{ gain: "+1 lineup pt" }], summary: "1, +1 lineup pt" });
  });

  it("shows nothing when no pickup helps, and leaves out a move without a number", () => {
    expect(roster("2")?.pickups).toBeNull();
    expect(roster("4")?.pickups).toBeNull();
    expect(withMoves("3", [move("902", null, Number.NaN, null)])).toBeNull();
    // A depth pickup: it adds little, even less than nothing, to projected lineups, and more once injuries and byes are simulated.
    expect(withMoves("3", [move("902", null, Number.NaN, null), { add: "901", drop: "305", gainEv: -0.5, gainScen: 4.2, gainEvPlain: -0.4, gainScenPlain: 3.5 }])?.items).toEqual([
      {
        move: `add ${nameOf("901")} (RB, CAR), drop ${nameOf("305")}`,
        gain: "+3.5 lineup pts",
        title: `Add ${nameOf("901")} (RB, CAR), drop ${nameOf("305")}: +3.5 lineup pts with injuries and byes simulated (−0.4 on projected lineups), each week counted once.`,
      },
    ]);
    // ⚠️ A pickup the optimizer made for its weighted gain that counts for less than nothing with each week once (all its
    // gain in the playoff weeks, ω above 1, and a loss before) shows that number as it is: the title says how weeks count.
    expect(withMoves("3", [{ add: "901", drop: "305", gainEv: 3.2, gainScen: 3.6, gainEvPlain: -0.2, gainScenPlain: -0.1 }])?.items[0]?.gain).toBe("−0.1 lineup pts");
  });

  it("names a team defense by its name (plus DEF when the name doesn't say it), leaves out a missing NFL team, and never breaks on an unknown player", () => {
    expect(withMoves("3", [move("BAL", "PHI", 12.06, null)])?.items[0]?.move).toBe("add Ravens D/ST, drop Eagles D/ST");
    // Sleeper names a defense after its team ("Baltimore Ravens").
    const f = leagueFixture({ platform: "sleeper" });
    const bal = f.snapshot.players.BAL;
    if (bal) f.snapshot.players.BAL = { ...bal, name: "Baltimore Ravens" };
    f.model.teams = f.model.teams.map((t) => (t.id === "3" ? { ...t, faMoves: [move("BAL", "PHI", 5, null)] } : t));
    expect(of(f).rosters.find((r) => r.teamId === "3")?.pickups?.items[0]?.move).toBe("add Baltimore Ravens (DEF), drop Eagles D/ST");
    expect(withMoves("1", [move("903", "999", 3, null)])?.items[0]?.move).toBe(`add ${nameOf("903")} (WR), drop Unknown player (999)`);
    expect(withMoves("3", [move("LV", null, 3, null)])?.items[0]?.move).toBe("add Unknown player (LV) into an open spot");
    expect(withMoves("3", [move("904", null, 3, null)])?.items[0]?.move).toBe(`add ${nameOf("904")} (K, LV) into an open spot`);
  });
});

describe("buildLeagueView: my IR players' returns (Checkpoint 7f; planner reply to Checkpoint 7e, answer 4, the lead's R2; RosterCard.returns)", () => {
  /** The fixture with these releases after each team's pickups (TeamModel.displacedWithPickups), for team 1 (mine) unless told. */
  const withReleases = (released: NonNullable<TeamModel["displacedWithPickups"]>, teamId = "1", opts: Parameters<typeof leagueFixture>[0] = {}) => {
    const f = leagueFixture(opts);
    f.model.teams = f.model.teams.map((t) => (t.id === teamId ? { ...t, displacedWithPickups: released } : t));
    return f;
  };
  const returns = (f: LeagueFixture, teamId = "1") => of(f).rosters.find((r) => r.teamId === teamId)?.returns;
  const when = `Week 15, when ${nameOf("107")} returns from IR`;

  it("says whom the odds release at each of my returns, in a trade card's words, and why when the near-tie rule decided it", () => {
    expect(RETURNS_FROM_IR_LABEL).toBe("Returns from IR");
    // The lineup decided: the card's words, the returner himself "instead of dropping someone else".
    expect(returns(withReleases([{ id: "107", week: 15, returner: "107" }]))).toEqual([`${when}: release him instead of dropping someone else.`]);
    expect(returns(withReleases([{ id: "108", week: 15, returner: "107" }]))).toEqual([`${when}: release ${nameOf("108")} (TE).`]);
    // The rule decided: the reason, and the lock for my player (it's on this card).
    expect(returns(withReleases([{ id: "107", week: 15, returner: "107", keptInstead: "106" }]))).toEqual([
      `${when}: release him. From week 15 on, he and ${nameOf("106")} add about the same to your starting lineup, and Spoons has more trade value. Lock Fiddlesticks to keep him instead.`,
    ]);
    expect(returns(withReleases([{ id: "108", week: 15, returner: "107", keptInstead: "106" }]))).toEqual([
      `${when}: release ${nameOf("108")} (TE). From week 15 on, he and ${nameOf("106")} add about the same to your starting lineup, and Spoons has more trade value. Lock Thimble to keep him instead.`,
    ]);
    // A free agent my pickups add (not on my roster as imported): no lock to offer.
    expect(returns(withReleases([{ id: "901", week: 15, returner: "107", keptInstead: "106" }]))).toEqual([
      `${when}: release ${nameOf("901")} (RB). From week 15 on, he and ${nameOf("106")} add about the same to your starting lineup, and Spoons has more trade value.`,
    ]);
    // Two of my players on IR, two returns: one line each, in the engine's order (by week).
    const two = withReleases([
      { id: "108", week: 15, returner: "107" },
      { id: "105", week: 16, returner: "103", keptInstead: "106" },
    ]);
    two.snapshot = { ...two.snapshot, teams: two.snapshot.teams.map((t) => (t.id === "1" ? { ...t, roster: t.roster.filter((id) => id !== "103"), ir: [...t.ir, "103"] } : t)) };
    expect(returns(two)).toEqual([
      `${when}: release ${nameOf("108")} (TE).`,
      `Week 16, when ${nameOf("103")} returns from IR: release ${nameOf("105")} (WR). From week 16 on, he and ${nameOf("106")} add about the same to your starting lineup, and Spoons has more trade value. Lock Oddfellow to keep him instead.`,
    ]);
  });

  it("names a player by his full name when another player of mine shares his surname, and keeps the lock on this card (review of Checkpoint 7f, PIERCE-3 and INTEGRATION-5)", () => {
    const f = withReleases([{ id: "108", week: 15, returner: "107", keptInstead: "106" }]);
    const renamed = (id: string, name: string) => ({ ...f.snapshot.players[id], name }) as LeagueFixture["snapshot"]["players"][string];
    // 102 is on my roster: "Thimble" alone could be either of two players of mine.
    f.snapshot = { ...f.snapshot, players: { ...f.snapshot.players, "102": renamed("102", "Ophelia Thimble") } };
    expect(returns(f)).toEqual([`${when}: release ${nameOf("108")} (TE). From week 15 on, he and ${nameOf("106")} add about the same to your starting lineup, and Spoons has more trade value. Lock ${nameOf("108")} to keep him instead.`]);
    // Another team's player sharing it (201, team 2's) changes nothing.
    f.snapshot = { ...f.snapshot, players: { ...f.snapshot.players, "102": renamed("102", nameOf("102")), "201": renamed("201", "Ophelia Thimble") } };
    expect(returns(f)).toEqual([`${when}: release ${nameOf("108")} (TE). From week 15 on, he and ${nameOf("106")} add about the same to your starting lineup, and Spoons has more trade value. Lock Thimble to keep him instead.`]);
  });

  it("only on my roster card, from the odds' own roster (after the pickups); none without a release, without a team of mine, or in a model that doesn't say", () => {
    // Another team's release: its card says nothing (the lock and the advice are mine).
    const theirs = withReleases([{ id: "206", week: 15, returner: "206", keptInstead: "205" }], "2");
    expect(returns(theirs, "2")).toBeNull();
    expect(of(theirs).rosters.every((r) => r.returns === null)).toBe(true);
    // As rosters stand (TeamModel.displaced) isn't what the odds count: no line from it alone.
    const asStands = leagueFixture();
    asStands.model.teams = asStands.model.teams.map((t) => (t.id === "1" ? { ...t, displaced: [{ id: "108", week: 15, returner: "107" }] } : t));
    expect(returns(asStands)).toBeNull();
    // Nobody released, or a model built before Phase 7b (no field).
    expect(returns(withReleases([]))).toBeNull();
    expect(returns(leagueFixture())).toBeNull();
    // No team of mine: no card is mine.
    const noTeam = withReleases([{ id: "107", week: 15, returner: "107" }], "1", { myTeamId: null });
    expect(of(noTeam).rosters.every((r) => r.returns === null)).toBe(true);
  });
});

describe("buildLeagueView: one free agent, one team (§7; LeagueModel.faAllocation; planner reply to Checkpoint 4, change 3)", () => {
  const withAllocation = (faAllocation: NonNullable<LeagueFixture["model"]["faAllocation"]>, opts: Parameters<typeof leagueFixture>[0] = {}, edit?: (f: LeagueFixture) => void) => {
    const f = leagueFixture(opts);
    f.model = { ...f.model, faAllocation };
    edit?.(f);
    return of(f);
  };
  /** The snapshot as the Phase 4c adapters leave a league whose order resets weekly: every team ranked by the reset order. */
  const weeklyReset = (f: LeagueFixture) => {
    const ranks: Record<string, number> = { "3": 1, "1": 2, "2": 3, "4": 4 };
    f.snapshot = {
      ...f.snapshot,
      settings: { ...f.snapshot.settings, waiverOrderUsed: "weeklyReset" },
      teams: f.snapshot.teams.map((t) => ({ ...t, waiverRank: ranks[t.id] as number, liveWaiverRank: ranks[t.id] as number })),
    };
  };
  /** A FAAB league whose every team reports its budget left. */
  const faab = (f: LeagueFixture) => {
    f.snapshot = {
      ...f.snapshot,
      settings: { ...f.snapshot.settings, faabBudget: 100, waiverOrderUsed: "faab" },
      teams: f.snapshot.teams.map((t, i) => ({ ...t, faabRemaining: 100 - 10 * i })),
    };
  };

  /** The Import Report's "Waiver order used" row for the fixture's snapshot after `edit` (importReport.ts waiverOrderText: its words are pinned there). */
  const rowFor = (edit?: (f: LeagueFixture) => void) => {
    const f = leagueFixture();
    edit?.(f);
    return waiverOrderText(f.snapshot);
  };

  it("says above the rosters how free agents are shared out, where my team picks, and the waiver order used, word for word the Import Report's row (planner reply to Checkpoint 4b, change 5)", () => {
    const reset = withAllocation({ basis: "waiver", order: ["3", "1", "2", "4"] }, {}, weeklyReset);
    expect(reset.pickupsNote).toEqual({ text: "Free-agent pickups: each free agent goes to one team only. Your team picks 2nd of 4.", waiverOrder: rowFor(weeklyReset) });
    expect(reset.pickupsNote?.waiverOrder).toMatch(/weekly reset/i);
    expect(WAIVER_ORDER_LABEL).toBe("Waiver order used");
    const budgets = withAllocation({ basis: "faab", order: ["1", "2", "3", "4"] }, {}, faab);
    expect(budgets.pickupsNote).toEqual({ text: "Free-agent pickups: each free agent goes to one team only. Your team picks 1st of 4.", waiverOrder: rowFor(faab) });
    expect(budgets.pickupsNote?.waiverOrder).toMatch(/FAAB/);
    // No order reported (the fixture's snapshot ranks no team): the biggest gain first, as the Import Report says.
    const gain = withAllocation({ basis: "gain", order: ["2", "4", "3", "1"] });
    expect(gain.pickupsNote).toEqual({ text: "Free-agent pickups: each free agent goes to one team only. Your team picks 4th of 4.", waiverOrder: waiverOrderText(leagueFixture().snapshot) });
  });

  it("names the basis in words instead when the snapshot doesn't read as the allocation's basis (it can't name the order then)", () => {
    expect(withAllocation({ basis: "waiver", order: ["3", "1", "2", "4"] }).pickupsNote).toEqual({
      text: "Free-agent pickups: each free agent goes to one team only, in your league's waiver order. Your team picks 2nd of 4.",
      waiverOrder: null,
    });
    expect(withAllocation({ basis: "faab", order: ["1", "2", "3", "4"] }, {}, weeklyReset).pickupsNote).toEqual({
      text: "Free-agent pickups: each free agent goes to one team only, in FAAB order (the most budget left first). Your team picks 1st of 4.",
      waiverOrder: null,
    });
    // "Wasn't available", never "doesn't report" (review of track F).
    expect(withAllocation({ basis: "gain", order: ["2", "4", "3", "1"] }, {}, weeklyReset).pickupsNote?.text).toBe(
      "Free-agent pickups: each free agent goes to one team only, the team that gains the most from its best pickup first (your league's waiver order wasn't available). Your team picks 4th of 4.",
    );
  });

  it("says on an inactive team's roster that it makes no pickups, never on mine, and states the rule in the explainer (planner reply to Checkpoint 4c, A4)", () => {
    // Week 12: Team 2 made a move in week 11; Teams 3 and 4 none in the last 5 weeks; my team (1) none, but never inactive.
    const drop = { id: "d2", type: "drop" as const, week: 11, timestamp: "2026-11-20T00:00:00Z", teams: ["2"], moves: [{ playerId: "x", from: "2", to: null }] };
    const view = withAllocation({ basis: "waiver", order: ["3", "1", "2", "4"] }, {}, (f) => {
      f.snapshot = { ...f.snapshot, transactions: [drop] };
    });
    const note = "Inactive: no transactions in the last 5 weeks, so no free-agent pickups are assumed.";
    expect(Object.fromEntries(view.rosters.map((r) => [r.teamId, r.inactive]))).toEqual({ "1": null, "2": null, "3": note, "4": note });
    // The engine's own rule on the same snapshot (acceptance.inactiveTeams).
    expect(inactiveTeams({ ...leagueFixture().snapshot, transactions: [drop] }, "1", config.allocation.inactiveWeeks)).toEqual(["3", "4"]);
    expect(view.explain.find((e) => e.title === "Free-agent pickups")?.text).toContain(
      "A team with no transactions in the last 5 weeks (in the first weeks of the season: none this season) is assumed to make no pickups and to stream nothing; your team always counts as active.",
    );
    // A league without any transaction (the fixture's own): nobody is (acceptance.inactiveTeams' guard); nor without an allocation.
    expect(withAllocation({ basis: "waiver", order: ["3", "1", "2", "4"] }).rosters.every((r) => r.inactive === null)).toBe(true);
    const old = leagueFixture();
    old.snapshot = { ...old.snapshot, transactions: [drop] };
    expect(of(old).rosters.every((r) => r.inactive === null)).toBe(true);
  });

  it("⚠️ counts where my team picks among the teams expected to make pickups: an inactive team keeps its place but claims nobody (review of track AL, finding AL-3)", () => {
    // Week 12: Teams 3 and 4 made no move in the last 5 weeks (inactive); Team 2 one in week 11; mine (1) none, never inactive.
    const drop = { id: "d2", type: "drop" as const, week: 11, timestamp: "2026-11-20T00:00:00Z", teams: ["2"], moves: [{ playerId: "x", from: "2", to: null }] };
    const quiet = (f: LeagueFixture) => {
      f.snapshot = { ...f.snapshot, transactions: [drop] };
    };
    // The order 3 > 1 > 2 > 4: inactive Team 3 ahead of me claims nobody, so I pick first of the 2 teams that pick.
    expect(withAllocation({ basis: "waiver", order: ["3", "1", "2", "4"] }, {}, quiet).pickupsNote?.text).toBe(
      "Free-agent pickups: each free agent goes to one team only, in your league's waiver order. Your team picks 1st of the 2 teams expected to make pickups.",
    );
    expect(withAllocation({ basis: "waiver", order: ["2", "4", "1", "3"] }, {}, quiet).pickupsNote?.text).toMatch(/Your team picks 2nd of the 2 teams expected to make pickups\.$/);
    // Every other team inactive: mine is the only one that picks.
    const alone = (f: LeagueFixture) => {
      f.snapshot = { ...f.snapshot, transactions: [{ ...drop, teams: ["1"], moves: [{ playerId: "x", from: "1", to: null }] }] };
    };
    expect(withAllocation({ basis: "waiver", order: ["3", "1", "2", "4"] }, {}, alone).pickupsNote?.text).toMatch(/\. Your team is the only one expected to make pickups\.$/);
    // Nobody inactive (the fixture has no transaction): the place in the whole order, as before.
    expect(withAllocation({ basis: "waiver", order: ["3", "1", "2", "4"] }).pickupsNote?.text).toMatch(/Your team picks 2nd of 4\.$/);
    // Without a team of mine: no place.
    expect(withAllocation({ basis: "waiver", order: ["3", "1", "2", "4"] }, { myTeamId: null }, quiet).pickupsNote?.text).toBe("Free-agent pickups: each free agent goes to one team only, in your league's waiver order.");
  });

  it("⚠️ says in the explainer that no team is treated as inactive when the league's transactions can't tell (review of track AL, finding AL-1)", () => {
    const drop = { id: "d2", type: "drop" as const, week: 11, timestamp: "2026-11-20T00:00:00Z", teams: ["2"], moves: [{ playerId: "x", from: "2", to: null }] };
    const unsure = " Right now no team is treated that way: some of this league's transactions didn't load or came back incomplete, so every team is assumed to make its pickups.";
    const explain = (warnings: LeagueFixture["snapshot"]["warnings"], transactions: LeagueFixture["snapshot"]["transactions"] = [drop]) =>
      withAllocation({ basis: "waiver", order: ["3", "1", "2", "4"] }, {}, (f) => {
        f.snapshot = { ...f.snapshot, transactions, warnings };
      });
    const gap = explain([{ code: "TRANSACTIONS_MISSING", message: "…", platformPath: "transactions/10" }]);
    expect(gap.rosters.every((r) => r.inactive === null)).toBe(true);
    expect(gap.explain.find((e) => e.title === "Free-agent pickups")?.text).toContain(`your team always counts as active.${unsure}`);
    expect(gap.pickupsNote?.text).toMatch(/Your team picks 2nd of 4\.$/);
    // A trade in the window without one of its teams: the same.
    const trade = { id: "t9", type: "trade" as const, week: 10, timestamp: "2026-11-12T00:00:00Z", teams: ["2"], moves: [] };
    expect(explain([], [drop, trade]).explain.find((e) => e.title === "Free-agent pickups")?.text).toContain(unsure);
    // A gap before the window (league week 3 at week 12) hides nothing the rule reads: Teams 3 and 4 are inactive, no sentence.
    const old = explain([{ code: "TRANSACTIONS_MISSING", message: "…", platformPath: "transactions/3" }]);
    expect(old.rosters.filter((r) => r.inactive !== null).map((r) => r.teamId)).toEqual(["3", "4"]);
    expect(old.explain.find((e) => e.title === "Free-agent pickups")?.text).not.toContain("Right now");
    // No transaction at all: the rule simply has nothing to read (the explainer adds nothing; the Import Report says why).
    expect(explain([], []).explain.find((e) => e.title === "Free-agent pickups")?.text).not.toContain("Right now");
  });

  it("leaves out where I pick without a team, and says nothing for a model built before Phase 4b or once the season is over", () => {
    expect(withAllocation({ basis: "waiver", order: ["3", "2", "4"] }, { myTeamId: null }, weeklyReset).pickupsNote).toEqual({
      text: "Free-agent pickups: each free agent goes to one team only.",
      waiverOrder: rowFor(weeklyReset),
    });
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

  it("⚠️ names an inactive team that made a streamer's adds as having stopped, never as a team without them (planner reply to Checkpoint 4c, A4; review of track AL, finding AL-2)", () => {
    // Week 12: only Team 2 (a drop in week 11) and, below, Team 4 moved in the last 5 weeks. Team 3's 3 D/ST adds came
    // earlier: inactive, so the engine has it stream nothing (league.ts streamedPositions), its adds kept.
    const drop = (teamId: string, week: number) => ({ id: `d${teamId}`, type: "drop" as const, week, timestamp: "2026-11-20T00:00:00Z", teams: [teamId], moves: [{ playerId: "x", from: teamId, to: null }] });
    const dormant = (f: LeagueFixture, extra: Record<string, NonNullable<LeagueFixture["model"]["streaming"]>["byTeam"][string]> = {}, transactions = [drop("2", 11)]) => {
      f.model = { ...f.model, faAllocation: { basis: "waiver", order: ["3", "1", "2", "4"] } };
      f.snapshot = { ...f.snapshot, transactions };
      f.model.streaming = { ...f.model.streaming, byTeam: { ...f.model.streaming.byTeam, "3": { positions: [], source: "detected", adds: { DEF: 3 } }, ...extra } };
    };
    const stopped = "Quasar Quokkas (D/ST, 3 adds this season) has made no transactions in the last 5 weeks, so it's assumed to have stopped streaming.";
    const f = leagueFixture();
    dormant(f);
    expect(of(f).streaming?.others).toBe(`No other team is assumed to stream, so the others count only their own players. ${stopped}`);
    expect(of(f).rosters.find((r) => r.teamId === "3")?.streams).toBeNull();
    // Another team that streams is listed first.
    const g = leagueFixture();
    dormant(g, { "4": { positions: ["DEF"], source: "detected", adds: { DEF: 2 } } }, [drop("2", 11), drop("4", 10)]);
    expect(of(g).streaming?.others).toBe(`Other teams that stream (2 or more adds at the position this season): Tundra Tortoises (D/ST, 2 adds). ${stopped}`);
    // Two of them: one sentence.
    const h = leagueFixture();
    dormant(h, { "4": { positions: [], source: "detected", adds: { DEF: 2, TE: 1 } } });
    expect(of(h).streaming?.others).toBe(
      "No other team is assumed to stream, so the others count only their own players. Quasar Quokkas (D/ST, 3 adds this season) and Tundra Tortoises (D/ST, 2 adds this season) have made no transactions in the last 5 weeks, so they're assumed to have stopped streaming.",
    );
    // Without a team of mine.
    const k = leagueFixture({ myTeamId: null });
    dormant(k);
    expect(of(k).streaming?.others).toBe(`No team is assumed to stream, so every team counts only their own players. ${stopped}`);
    // An inactive team without the adds is no streamer to name; nor is one the engine has streaming (no allocation: no inactive teams).
    const m = leagueFixture();
    dormant(m, { "3": { positions: [], source: "detected", adds: { DEF: 1 } } });
    expect(of(m).streaming?.others).toBe("No other team has made 2 or more adds at QB, TE or D/ST this season, so the others count only their own players.");
    expect(view().streaming?.others).toBe("Other teams that stream (2 or more adds at the position this season): Quasar Quokkas (D/ST, 3 adds).");
    // The explainer states the exception where the model allocates free agents.
    expect(of(f).explain.find((e) => e.title === "Streaming")?.text).toContain(
      "Another team counts as streaming a position once it has made 2 or more adds there this season, unless it has made no transactions in the last 5 weeks; the others count only their own players.",
    );
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

  it("labels lineup points with the model's playoff weight (set automatically from my odds), one decimal, and says where it comes from (planner reply to Checkpoint 7a, §6.1)", () => {
    const ros = (x: ReturnType<typeof of>) => x.explain.find((e) => e.title === "Rest-of-season (ROS) points")?.text ?? "";
    const f = leagueFixture();
    f.model.playoffWeight = 1.5;
    f.model.playoffWeightAuto = autoWeight(1.5);
    const custom = of(f);
    expect(custom.teams.find((t) => t.id === "2")?.chips[0]?.title).toContain("worth 31.2 more lineup pts (playoffs count 1.5×) to");
    expect(custom.lineupCostTitle).toBe("Rest-of-season lineup points his team would lose without him, with playoff weeks counted 1.5×");
    expect(ros(custom)).toContain(
      "with playoff weeks counted 1.5× (set automatically from how much a point in a playoff week moves your odds next to one in a regular-season week), so they don't add up exactly with ROS points.",
    );
    // The free-agent pickups' gains count each week once (planner reply to Checkpoint 7b, Q6): never labeled with the
    // weight, and their title says so while lineup cost beside them weights the playoff weeks; the explainer names the
    // weighting of the optimizer's own bar.
    const pickups = (x: ReturnType<typeof of>) => x.rosters.find((r) => r.teamId === "1")?.pickups;
    expect(pickups(custom)?.summary).toBe("1, +3.3 lineup pts");
    expect(pickups(custom)?.items[0]?.title).toMatch(/, each week counted once\.$/);
    expect(JSON.stringify(pickups(custom))).not.toContain("playoffs count");
    const bar = (x: ReturnType<typeof of>) => x.explain.find((e) => e.title === "Free-agent pickups")?.text ?? "";
    expect(bar(custom)).toContain(`as long as it adds at least ${config.freeAgentOptimizer.faMinGain} lineup points with playoff weeks counted 1.5×, up to`);
    // One decimal, as the Settings page prints it (the engine keeps two: config.lineups.playoffWeightAuto.decimals).
    expect([2, 1.63, 1.25, 0.5, Number.NaN].map(playoffWeightLabel)).toEqual(["2.0", "1.6", "1.3", "0.5", "1.0"]);
    f.model.playoffWeight = 1.63;
    f.model.playoffWeightAuto = autoWeight(1.63);
    expect(bar(of(f))).toContain("lineup points with playoff weeks counted 1.6×, up to");
    // Below 1 (a point in a playoff week moves my odds less than one in a regular-season week): labeled the same, and
    // nothing says playoff weeks matter more.
    f.model.playoffWeight = 0.6;
    f.model.playoffWeightAuto = autoWeight(0.6);
    const low = of(f);
    expect(low.lineupCostTitle).toBe("Rest-of-season lineup points his team would lose without him, with playoff weeks counted 0.6×");
    expect(ros(low)).toContain("with playoff weeks counted 0.6× (set automatically from how much a point in a playoff week moves your odds");
    expect(low.explain.map((e) => e.text).join(" ")).not.toMatch(/decide titles|count more/);
    // ⚠️ Below 1 a gain listed is under the bar only when the pickup costs in the playoff weeks: not said then.
    expect(bar(low)).toContain(`lineup points with playoff weeks counted 0.6×, up to ${config.freeAgentOptimizer.faMaxMoves} pickups; the gains listed count each week once, like Waiver upgrades.`);
    expect(bar(low)).not.toContain("so one can be under");
    // The fallback: config's weight, saying it couldn't be set from my odds.
    f.model.playoffWeight = config.lineups.playoffWeight;
    f.model.playoffWeightAuto = autoWeight(config.lineups.playoffWeight, "fallback");
    expect(ros(of(f))).toContain(`with playoff weeks counted ${PW}× (the default weight: it couldn't be set from your odds this time), so they don't add up exactly with ROS points.`);
    // A weight that prints 1.0: lineup points are plain projected points, so nothing is labeled.
    for (const omega of [1, 1.04]) {
      f.model.playoffWeight = omega;
      f.model.playoffWeightAuto = autoWeight(omega);
      const plain = of(f);
      expect(plain.teams.find((t) => t.id === "2")?.chips[0]?.title).not.toContain("playoffs count");
      expect(plain.lineupCostTitle).toBe("Rest-of-season lineup points his team would lose without him");
      expect(ros(plain)).not.toContain("playoff weeks counted");
      // Nor do the pickups say how weeks count: lineup cost beside them counts each week once too.
      expect(pickups(plain)?.items[0]?.title).not.toContain("each week counted once");
      expect(bar(plain)).toContain(`as long as it adds at least ${config.freeAgentOptimizer.faMinGain}, up to`);
      expect(bar(plain)).not.toContain("each week once");
      // ⚠️ Whatever the weighting, each gain is counted after the pickups above it (review of Q6).
      expect(bar(plain)).toContain(`up to ${config.freeAgentOptimizer.faMaxMoves} pickups. Each pickup's gain is counted after the pickups above it, so a later pickup of yours can show a different gain in Waiver upgrades`);
    }
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
    expect(drifter).toMatchObject({ nflTeam: "FA", byeText: "bye unknown", lineupCost: null, group: "fa" });
    expect(drifter?.injury).toEqual({ short: "NA", long: "Not an active NFL player", tone: "muted" });
    expect(drifter?.weeks.every((w) => w.note === "Not an active NFL player")).toBe(true);
    // No trade values on free agents either (planner reply to Checkpoint 7a, 5.4).
    expect(v.freeAgents.flatMap((g) => g.players).some((p) => "value" in p)).toBe(false);
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
  it("says which positions' recent form counts for nothing, from config (planner reply to Checkpoint 7d, item 1.2: K and DEF 0)", () => {
    const { snapshot } = leagueFixture();
    const withK = { ...snapshot, settings: { ...snapshot.settings, lineup: [...snapshot.settings.lineup, { slot: "K", count: 1, eligible: ["K" as const] }] } };
    expect(config.projections.actualWeightByPos).toEqual({ K: 0, DEF: 0 });
    expect(noFormText(withK)).toBe(" (not for kickers and D/STs, whose points per game come from the projections alone)");
    expect(noFormText({ ...withK, platform: "sleeper" })).toBe(" (not for kickers and team defenses, whose points per game come from the projections alone)");
    // Only the positions the league starts, and only those config weighs 0.
    expect(noFormText(snapshot)).toBe(" (not for D/STs, whose points per game come from the projections alone)");
    expect(noFormText(withK, { actualWeight: 0.25, actualWeightByPos: { K: 0 } })).toBe(" (not for kickers, whose points per game come from the projections alone)");
    expect(noFormText(withK, { actualWeight: 0.25, actualWeightByPos: { K: 0.1 } })).toBe("");
    expect(noFormText(withK, { actualWeight: 0.25, actualWeightByPos: {} })).toBe("");
    expect(noFormText(withK, { actualWeight: 0.25 })).toBe("");
    // A Sleeper league's page says it in its own words.
    const sleeper = view({ platform: "sleeper" }).explain.find((e) => e.title === "Projected points")?.text;
    expect(sleeper).toContain("once he has played 6 games (not for team defenses, whose points per game come from the projections alone).");
  });

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
    // Not for D/STs (the fixture starts one, no kicker): config weighs their recent form 0 (planner reply to Checkpoint 7d, item 1.2).
    expect(text).toContain(`up to ${Math.round(config.projections.actualWeight * 100)}% once he has played ${config.projections.actualFullGames} games (not for D/STs, whose points per game come from the projections alone).`);
    expect(text).toContain("ESPN's own projections differ from Sleeper's by 14% on average this week, more than the 10% we allow");
    expect(text).toContain("Out: 0% this week, 50% next week, 85% in 2 weeks; Doubtful 25%, Questionable 85% and Probable 95% this week");
    expect(text).toContain("RB 14%, TE 14%, WR 12%, QB 6%, K 2%");
    expect(text).toContain(`${config.lineups.scenarios} simulated runs of injuries and byes`);
    expect(text).toContain("from week 12 through week 17 (the last playoff week)");
    // Lineup cost weights the playoff weeks; the pickups' gains count each week once (planner reply to Checkpoint 7b, Q6).
    expect(text).toContain(
      `Lineup cost is in lineup points: starting-lineup points over the rest of the season, with playoff weeks counted ${PW}×, so they don't add up exactly with ROS points. The gains of each team's free-agent pickups (listed on its roster) are starting-lineup points with each week counted once, like Waiver upgrades.`,
    );
    expect(text).toContain("Lineup cost is how many his team would lose without him, after its free-agent pickups (it would pick up a free agent in his place when that helps); it's never negative.");
    // The free-agent optimizer (§7 V*) with config's numbers: kickers and D/STs never, the guard only in dynasty and keeper leagues.
    const o = config.freeAgentOptimizer;
    // Judged with injuries and byes simulated (scenarios ran, no starter limits): review of Phase 4.
    expect(text).toContain(
      `Free-agent pickups: Each team is measured after the free-agent pickups that would help it, made one at a time: each time the add (dropping a player, or into an open roster spot) that adds the most lineup points with injuries and byes simulated (so a backup who'd start when a starter is hurt or on bye counts), as long as it adds at least ${o.faMinGain} lineup points with playoff weeks counted ${PW}×, up to ${o.faMaxMoves} pickups; the gains listed count each week once, like Waiver upgrades, so one can be under ${o.faMinGain}. Each pickup's gain is counted after the pickups above it, so a later pickup of yours can show a different gain in Waiver upgrades, which counts each pickup alone, from your roster as it stands. When the player it would drop has trade value and dropping a less valuable one instead costs at most ${config.lineups.dropNearTieWeekly} points a week, the less valuable one goes (any player worth less than the best free agent no team is expected to pick up counts as worth that much), so a pickup can add a little less. Kickers and D/STs are never picked up (they're streamed or kept), nor is a position the team streams, and a player its starting lineup needs is never dropped. Lineup cost, trade chips and partners all start from those rosters, so a trade never gets credit for a pickup a team could make anyway. Each team is measured on its own, so two teams may count on the same free agent.`,
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
      `each time the add (dropping a player, or into an open roster spot) that adds the most projected lineup points, as long as it adds at least ${o.faMinGain} lineup points with playoff weeks counted ${PW}×, up to ${o.faMaxMoves} pickups; the gains listed count each week once, like Waiver upgrades, so one can be under ${o.faMinGain}.`,
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
    // ⚠️ The near-ties in whom a pickup drops (verification of the final review of Phase 4c, finding VF-1) apply where the
    // guard doesn't (no long-term values, as roster legality's), and are said only there.
    const nearTie = "When the player it would drop has trade value and dropping a less valuable one instead costs at most";
    // A keeper league with its dynasty list (the market's own format): the guard is on.
    const keeper = leagueFixture();
    keeper.snapshot = { ...keeper.snapshot, settings: { ...keeper.snapshot.settings, leagueType: "keeper" } };
    keeper.model.market = { ...keeper.model.market, format: fantasyCalcFormat(keeper.snapshot.settings) };
    expect(keeper.model.market.format?.isDynasty).toBe(true);
    expect(pickups(keeper)).toContain(guard);
    expect(pickups(keeper)).not.toContain(nearTie);
    expect(pickups(leagueFixture())).toContain(nearTie);
    // Its dynasty list didn't load (the server falls back to the redraft list): the guard is off, and the text says so.
    const fallback = leagueFixture();
    fallback.snapshot = keeper.snapshot;
    fallback.model.market = { ...fallback.model.market, format: fantasyCalcFormat(keeper.snapshot.settings, "redraft") };
    expect(fallback.model.market.format?.isDynasty).toBe(false);
    expect(pickups(fallback)).not.toContain(guard);
    expect(pickups(fallback)).toContain(off);
    expect(pickups(fallback)).toContain(nearTie);
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
    // What the model does with the pickups, never a platform rule (review of track UIP: "a pickup made now can't play in
    // week 12" wasn't true: a free agent whose game hasn't started can be picked up and started).
    expect(v.explain.find((e) => e.title === "Week 12 is under way")?.text).toBe(
      `${weekText} The playoff odds still play all of week 12's games from projections, as if none had started: live scores aren't read yet, and the rosters and injury news are today's, without free-agent pickups. Each team's free-agent pickups count from week 13 on.`,
    );
    // The last week under way: no week is left to count pickups in.
    const last = leagueFixture();
    last.model = { ...last.model, weeks: [12], regularWeeks: [12], playoffWeeks: [] };
    expect(of(last).explain.find((e) => e.title === "Week 12 is under way")?.text).toMatch(/and the rosters and injury news are today's, without free-agent pickups\.$/);
    // A model built before Phase 4c counts no pickups, so nothing is said about them.
    const old = leagueFixture();
    delete old.model.oddsAsRostersStand;
    expect(of(old).explain.find((e) => e.title === "Week 12 is under way")?.text).toBe(
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
      `We play out the rest of the season 20,000 times. Each week, every team's score is drawn around its projected starting lineup (its average over the 32 simulated runs of injuries and byes), with a spread that covers its starters' week-to-week swings and how much injuries and byes could change the lineup. Every team's lineup counts the free-agent pickups that would help it (listed on its roster); trade ideas start from these same odds. Your odds as rosters stand, with no team's pickups, are the smaller line under yours. Each simulated game adds to today's records. Each simulated season is then ranked by your league's rules: win percentage, then points for. The top 2 make the playoffs and meet for the title. A team's chance of a playoff spot or the title is the share of those seasons where it happened. Each time the odds are worked out, every team and week gets the same random draws (common random numbers), so when trade ideas compare the odds before and after a trade, the difference comes from the trade, not from the luck of the draw. Your remaining schedule flags a week as risky when your chance to win it is under ${Math.round(RISKY_WIN_CHANCE * 100)}%, or when ${RISKY_BYES} or more of your likely starters (players in your best lineup, after your free-agent pickups, in at least half the weeks they play) are on bye, not counting D/STs, whose byes the streaming replacement covers since you stream them.`,
    );
    // Without a team there's no second line to point to; a model built before Phase 4c counts no pickups at all.
    const noTeam = view({ myTeamId: null }).explain.find((e) => e.title === "Playoff odds")?.text ?? "";
    expect(noTeam).toContain("Every team's lineup counts the free-agent pickups that would help it (listed on its roster); trade ideas start from these same odds. Each simulated game");
    const old = leagueFixture();
    delete old.model.oddsAsRostersStand;
    const oldText = of(old).explain.find((e) => e.title === "Playoff odds")?.text ?? "";
    expect(oldText).not.toContain("free-agent pickups");
    expect(oldText).toContain("of your likely starters (players in your best lineup in at least half the weeks they play) are on bye, not counting D/STs, whose byes the streaming replacement covers since you stream them.");
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
    expect(text((f) => (f.model = { ...f.model, scenarios: 0 }))).toContain("drawn around its projected starting lineup, with a spread that covers its starters' week-to-week swings. Every team's lineup counts");
    // The schedule's risk rule only when the schedule shows; no paragraph without odds.
    expect(text(() => {}, { myTeamId: null })).not.toContain("remaining schedule");
    expect(text((f) => (f.model.odds = null))).toBe("");
  });

  it("says how unvalued players got their values, without an amount: an estimate from projected points, and a flat minimum where FantasyCalc values too few (K, D/ST) (planner reply to Checkpoint 7a, 5.4: no value shows)", () => {
    const valuesText = (edit: (f: LeagueFixture) => void) => {
      const f = leagueFixture();
      f.model.market = { ...f.model.market, format: { isDynasty: false, numQbs: 1, numTeams: 8, ppr: 0.5, substitutions: [] } };
      edit(f);
      return of(f).explain.find((e) => e.title === "Trade values")?.text;
    };
    const intro = `Trade values come from FantasyCalc in your league's format (8 teams · half-PPR · 1 QB · redraft). ${VALUES_HIDDEN_TEXT}`;
    expect(VALUES_HIDDEN_TEXT).toBe(
      "Offer Sheet uses them in its own numbers (the chance a manager accepts a trade, Helps you, and how far projections lean toward the trade market) but never shows them.",
    );
    const estimate = "Players FantasyCalc doesn't value (it skips deep bench players) get our estimate from their projected points";
    const floor = "At K and D/ST, FantasyCalc values too few players to estimate from, so those without a FantasyCalc value get a flat minimum value, whatever they project";
    expect(valuesText(() => {})).toBe(`${intro} ${estimate}. ${floor}.`);
    // Nothing marked "~" any more, and no amount quoted.
    expect(valuesText(() => {})).not.toMatch(/~|107/);
    const only = (source: "estimate" | "floor") => (f: LeagueFixture) => {
      for (const pm of Object.values(f.model.players)) if (pm.value && pm.value.source !== source) pm.value = { ...pm.value, source: "fantasycalc" };
    };
    expect(valuesText(only("estimate"))).toBe(`${intro} ${estimate}.`);
    expect(valuesText(only("floor"))).toBe(`${intro} ${floor}.`);
    expect(valuesText(only("fantasycalc" as never))).toBe(intro);
    // Different minimums at different positions: the same words.
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

describe("buildLeagueView: FantasyCalc's fallbacks (planner reply to Checkpoint 4b, change 12; MarketInputs.fallback)", () => {
  const SAVED = { kind: "saved" as const, listDate: "2026-11-22T09:00:00.000Z" };
  const CURVE = { kind: "curve" as const, listDate: "2026-11-02T09:00:00.000Z" };
  /** The fixture with FantasyCalc's fallback in its model inputs, as src/server/modelInputs.ts leaves them. */
  const withFallback = (fallback: typeof SAVED | typeof CURVE, edit?: (f: LeagueFixture) => void) => {
    const f = leagueFixture();
    const market = { values: {}, knownIds: [], topValue: 10722, fetchedAt: "2026-11-22T09:00:00.000Z", format: f.model.market.format as NonNullable<LeagueFixture["model"]["market"]["format"]>, fallback };
    f.inputs = { ...f.inputs, market };
    if (fallback.kind === "saved") f.inputs = { ...f.inputs, notes: [...f.inputs.notes, fantasyCalcFallbackText(fallback)] };
    else {
      f.inputs = { ...f.inputs, warnings: [...f.inputs.warnings, { code: "FANTASYCALC_VALUES_ESTIMATED", message: fantasyCalcFallbackText(fallback), platformPath: "values/current" }] };
      // Every value is the curve's estimate (market.curveMarketValues), K and D/ST at the floor.
      for (const pm of Object.values(f.model.players)) if (pm.value?.source === "fantasycalc") pm.value = { ...pm.value, source: "estimate" };
    }
    edit?.(f);
    return of(f);
  };

  it("dates a saved list next to the values credit, once (the inputs' own note isn't repeated), and in the explainer", () => {
    const saved = withFallback(SAVED);
    expect(fantasyCalcFallbackText(SAVED)).toBe("Trade values from Nov 22: FantasyCalc didn't answer.");
    expect(saved.header.valuesNote).toBe("Trade values from Nov 22: FantasyCalc didn't answer.");
    expect(saved.header.valuesFormat).toBe("8 teams · half-PPR · 1 QB · redraft");
    expect(saved.valuesBanner).toBeNull();
    expect(saved.notes).toEqual(["Sleeper hasn't published week 18 projections yet."]);
    expect(saved.explain.find((e) => e.title === "Trade values")?.text).toContain(
      `Trade values come from FantasyCalc in your league's format (8 teams · half-PPR · 1 QB · redraft), from its list of Nov 22: FantasyCalc didn't answer this time, so the newest list we saved stands in. ${VALUES_HIDDEN_TEXT}`,
    );
    // Its values aren't shown either (planner reply to Checkpoint 7a, 5.4).
    const quibble = saved.rosters.find((r) => r.teamId === "1")?.players.find((p) => p.id === "102");
    expect(quibble).toBeDefined();
    expect(quibble).not.toHaveProperty("value");
  });

  it("puts a banner at the top when every value is our own estimate (the curve), in place of the inputs' warning, and says so where the values show", () => {
    const curve = withFallback(CURVE);
    expect(curve.valuesBanner).toEqual({ title: VALUES_ESTIMATED_TITLE, text: fantasyCalcFallbackText(CURVE) });
    expect(VALUES_ESTIMATED_TITLE).toBe("FantasyCalc is unavailable");
    expect(curve.valuesBanner?.text).toContain("Trade values are our own estimates, not FantasyCalc's");
    // Said once: not in the warnings box too.
    expect(curve.notices).toEqual(["Sleeper's projections for week 17 didn't load, so that week skips the matchup adjustment. Refresh later to try again.", "No projection for Dabney Drifter."]);
    expect(curve.header.valuesNote).toBe(VALUES_ESTIMATED_LINE);
    expect(VALUES_ESTIMATED_LINE).toBe("Trade values are our own estimates for now.");
    // No value shows, our estimates included (planner reply to Checkpoint 7a, 5.4).
    const quibble = curve.rosters.find((r) => r.teamId === "1")?.players.find((p) => p.id === "102");
    expect(quibble).toBeDefined();
    expect(quibble).not.toHaveProperty("value");
    // The explainer: every value ours, never "Players FantasyCalc doesn't value"; the flat minimum where the old list values too few.
    const values = curve.explain.find((e) => e.title === "Trade values")?.text ?? "";
    expect(values).toBe(
      `Every trade value is our own estimate for now (the note at the top of the page says why), in your league's format (8 teams · half-PPR · 1 QB · redraft): each player's comes from his projected points for the rest of the season, on a curve fitted to FantasyCalc's list from Nov 2. ${VALUES_HIDDEN_ESTIMATED_TEXT} Where your league doesn't match one of FantasyCalc's formats exactly: 4 teams → FantasyCalc's 8-team values. At K and D/ST, FantasyCalc's list values too few players to fit a curve, so each gets a flat minimum value, whatever he projects.`,
    );
    expect(VALUES_HIDDEN_ESTIMATED_TEXT).toBe("Offer Sheet uses them in the chance a manager accepts a trade but never shows them.");
    expect(values).not.toContain("doesn't value");
    // Nothing is pulled toward the market meanwhile, and the explainer says so.
    expect(curve.explain.find((e) => e.title === "Projected points")?.text).toContain("While FantasyCalc is unavailable, projections aren't pulled toward the trade market: the values are our own estimates.");
    // "Harder to get" ranks the top 12 by our own estimates then (premium.ts eliteIds), not FantasyCalc's list (review of track UIP).
    const harder = curve.explain.find((e) => e.title === HARDER_TO_GET_TAG)?.text ?? "";
    expect(harder).toContain(`one of the top ${config.acceptance.starPremium.eliteTop} players by trade value (our own estimates while FantasyCalc is unavailable), so expect`);
    expect(harder).not.toContain("FantasyCalc's, in your league's format");
    // A saved list is FantasyCalc's own: it says so.
    expect(withFallback(SAVED).explain.find((e) => e.title === HARDER_TO_GET_TAG)?.text).toContain("players by trade value (FantasyCalc's, in your league's format)");
  });

  it("says long-term value and the pickups' dynasty guard are off in a dynasty or keeper league while the values are our estimates", () => {
    const dynasty = withFallback(CURVE, (f) => {
      f.snapshot = { ...f.snapshot, settings: { ...f.snapshot.settings, leagueType: "dynasty" } };
      f.model.market = { ...f.model.market, format: fantasyCalcFormat(f.snapshot.settings) };
    });
    expect(dynasty.explain.find((e) => e.title === "Trade values")?.text).toContain("Long-term value is left out of trade ideas until FantasyCalc is back: our estimates say nothing about later seasons.");
    const pickups = dynasty.explain.find((e) => e.title === "Free-agent pickups")?.text ?? "";
    expect(pickups).toContain("but while the values are our own estimates (FantasyCalc is unavailable) that check is off.");
    expect(pickups).not.toContain("is never dropped for him.");
  });

  it("shows the banner from the inputs' warning alone (inputs without the fallback field), and nothing when FantasyCalc answered", () => {
    const f = leagueFixture();
    f.inputs = { ...f.inputs, warnings: [...f.inputs.warnings, { code: "FANTASYCALC_VALUES_ESTIMATED", message: "(the server's words)" }] };
    const warned = of(f);
    expect(warned.valuesBanner).toEqual({ title: VALUES_ESTIMATED_TITLE, text: "(the server's words)" });
    expect(warned.notices).not.toContain("(the server's words)");
    expect(warned.header.valuesNote).toBe(VALUES_ESTIMATED_LINE);
    expect(v.valuesBanner).toBeNull();
    expect(v.header.valuesNote).toBeNull();
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
