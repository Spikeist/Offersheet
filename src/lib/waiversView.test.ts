/**
 * "Waiver upgrades" on the League page (planner reply to Checkpoint 7a, §6.2; ./waiversView.ts): the words and numbers of
 * the lists, from a made-up league run through the engine (CLAUDE.md §16): labels ("This week" for a week under way's games
 * still to play, "Next week" for the week after it), the notes naming the one-week lists the page actually has (review:
 * the note pointed to a "This week" the page didn't show), the gain and the drop in words ("No gain" when the gain prints
 * as 0), "No room", who and why when none of mine at his position plays ("No TE of yours plays in week 4 (T. Block:
 * bye)"), the waiver status ("On waivers until Wed", "Free agent now", none on Sleeper), opponents on the one-week lists,
 * the D/ST label, and nothing once my redraft season is over. Checkpoint 7f (planner reply to Checkpoint 7e, item 3): the
 * rows that help first, then (its review, WAIVERS-1) the moves that can't be made, the "No gain" rows folded behind "N more
 * pickups that don't help you (show)", on every list; the rating note without a count of the moves played out longest
 * (INTEGRATION-7).
 */
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import { buildLeagueModel, type LeagueModelConfig } from "@/engine/league";
import type { LeagueModel, SeasonOdds, WaiverBlocked } from "@/engine/leagueModel";
import type { LeagueSnapshot, Pos } from "@/engine/model";
import { TITLE_ONLY, type Reward } from "@/engine/reward";
import { defaultTradeSettings } from "@/engine/settings";
import { TEST_NOW, buildTestLeague, type TestPlayer } from "@/engine/testLeague";
import { smallLeague } from "@/engine/trade.testing";
import { seasonOver } from "./leagueView";
import { percentText, titleOddsText } from "./tradeView";
import {
  CANT_ADD_TEXT,
  CANT_FIT_TEXT,
  CANT_FIT_WHY,
  DEPTH_ONLY_TAG,
  DEPTH_ONLY_WORDS,
  NO_GAIN_TEXT,
  SAME_POSITION_HINT,
  SAME_POSITION_LABEL,
  WAIVERS_HREF,
  WAIVERS_NO_TEAM,
  WAIVERS_NO_WEEKS,
  WAIVERS_PICK_TEAM,
  WAIVERS_SECTION_ID,
  WAIVERS_NONE_HELPS,
  WAIVERS_NONE_YOU_CAN_MAKE,
  WAIVERS_SEASON_OVER,
  ODDS_WHY,
  ODDS_WHY_HEADLINE,
  buildWaiversView,
  positionPlural,
  waiverOddsLines,
  waiverStatusText,
  waiversRestText,
  type WaiverListView,
} from "./waiversView";

const ZERO_MISS: Record<Pos, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, P: 0, DEF: 0, DL: 0, LB: 0, DB: 0 };
const NO_RISK: LeagueModelConfig = { ...config, projections: { ...config.projections, injuryRisk: { ...config.projections.injuryRisk, missShare: ZERO_MISS } } };
const NY = "America/New_York";
const p = (id: string, pos: Pos, points: number, name: string, extra: Partial<TestPlayer> = {}): TestPlayer => ({ id, pos, points, name, ...extra });

const MINE: TestPlayer[] = [
  p("q1", "QB", 20, "Quinn Arrow"),
  p("r1", "RB", 15, "Rudy Bolt"),
  p("r2", "RB", 12, "Reggie Dash"),
  p("r3", "RB", 6, "Ronnie Slow"),
  p("w1", "WR", 14, "Wes Catch"),
  p("w2", "WR", 11, "Walt Hands"),
  p("w3", "WR", 7, "Wade Route"),
  p("t1", "TE", 8, "Ty Block"),
  p("k1", "K", 8, "Kip Boot"),
  p("d1", "DEF", 7, "Ducks D/ST"),
];
const THEM: TestPlayer[] = [p("q2", "QB", 18, "Other QB"), p("r4", "RB", 14, "Other RB"), p("w4", "WR", 13, "Other WR"), p("t2", "TE", 7, "Other TE")];
const FAS: TestPlayer[] = [p("fa1", "RB", 13, "Frankie Burst", { nflTeam: "BBB" }), p("fa5", "RB", 6.5, "Fred Depth"), p("fd", "DEF", 9, "Geese D/ST", { nflTeam: "CCC" })];

function setup(opts: { platform?: "espn" | "sleeper"; kickoffs?: Record<number, Record<string, string>>; status?: LeagueSnapshot["freeAgentStatus"]; mine?: TestPlayer[]; freeAgents?: TestPlayer[]; byeWeek?: Record<string, number> } = {}) {
  const l = buildTestLeague({ platform: opts.platform ?? "espn", teams: [{ id: "1", roster: opts.mine ?? MINE }, { id: "2", roster: THEM }], freeAgents: opts.freeAgents ?? FAS, byeWeek: opts.byeWeek ?? { AAA: 9 }, ...(opts.kickoffs ? { kickoffs: opts.kickoffs } : {}) });
  const snapshot: LeagueSnapshot = opts.status ? { ...l.snapshot, freeAgentStatus: opts.status } : l.snapshot;
  const inputs = { ...l.inputs, nfl: { ...l.inputs.nfl, opponents: { 4: { BBB: { team: "ZZZ", home: true }, CCC: { team: "YYY", home: false } } } } };
  const model = buildLeagueModel(snapshot, inputs, { now: TEST_NOW, sims: 0 }, NO_RISK);
  return { snapshot, inputs, model };
}

const view = (s: ReturnType<typeof setup>, now = TEST_NOW.toISOString()) => buildWaiversView({ snapshot: s.snapshot, model: s.model, inputs: s.inputs, timeZone: NY, now });
const row = (list: WaiverListView | null | undefined, name: string) => list?.rows.find((r) => r.name === name);

describe("buildWaiversView", () => {
  const s = setup();
  const v = view(s);

  it("two lists, rest of season first, linked from the header (/league#waivers)", () => {
    expect(WAIVERS_HREF).toBe(`/league#${WAIVERS_SECTION_ID}`);
    expect(v?.first).toBe("ros");
    expect(v?.ros?.label).toBe("Rest of season");
    expect(v?.week?.label).toBe("This week");
    expect(v?.week?.underWay).toBeNull();
    // No week under way: no list for one.
    expect(v?.underWay).toBeNull();
    expect(v?.ros?.weekLabel).toBe("Wk 4");
    expect(v?.ros?.shown).toBe(config.waivers.rowsShown);
    // Checkpoint 7h (planner reply to Checkpoint 7g, section 1): one line, what the main number is, and the rest behind "Why?".
    expect(v?.ros?.lead).toBe("Lineup gain: what each move adds to your starting lineup over weeks 4–17.");
    expect(v?.ros?.note).toContain("It counts each week once, with injuries and byes simulated, after dropping the player named.");
    expect(v?.week?.lead).toBe("Lineup gain: what each move adds to your starting lineup in week 4.");
    // The positions I stream (K and D/ST by default) wait for the one-week list.
    expect(v?.ros?.note).toContain("Positions you stream weekly (K, D/ST) are under “This week”.");
  });

  it("a row in words: the player, his points, whom he beats, the gain and the drop (an open roster spot)", () => {
    const r = row(v?.ros, "Frankie Burst");
    expect(r).toMatchObject({ pos: "RB", nflTeam: "BBB", bye: "bye unknown", rosText: "182", weekText: "13", betterThan: "R. Dash, R. Slow", drop: null, dropText: "Open roster spot", depthOnly: false, status: null, opponent: null, blocked: null });
    // Unrated (no season simulated here): the lineup gain is the main number; an open spot's second number is his own points.
    expect(r?.main).toEqual({ label: "Lineup gain", ...r?.gain });
    expect(r?.outscores).toBe("No drop needed: 182 rest-of-season points");
    expect(r?.lineupGain).toBeNull();
    // +6 a week (he starts at RB, R. Dash moves to the FLEX over W. Route), and all 13 in week 9, when my whole roster
    // (team AAA) is on bye and his team isn't: 13 × 6 + 13.
    expect(r?.gain).toEqual({ text: "+91 pts", positive: true, title: "Adding him into an open roster spot adds 91 points to your starting lineup over weeks 4–17." });
    expect(row(v?.ros, "Fred Depth")?.gain.text).toBe(NO_GAIN_TEXT);
    expect(row(v?.ros, "Fred Depth")?.depthOnly).toBe(true);
  });

  it("the one-week list: ESPN's D/ST label, this week's opponent, its own gain", () => {
    const d = row(v?.week, "Geese D/ST");
    expect(d?.pos).toBe("D/ST");
    expect(d?.opponent).toEqual({ short: "@ YYY", long: "away at YYY" });
    expect(d?.gain.text).toBe("+2 pts");
    expect(d?.betterThan).toBe("Ducks D/ST");
    expect(row(v?.week, "Frankie Burst")?.opponent).toEqual({ short: "vs ZZZ", long: "at home against ZZZ" });
  });

  it("on the one-week list, my player on bye that week isn't one a free agent 'beats': a free agent must beat one who plays", () => {
    const mine = MINE.map((x) => (x.id === "w3" ? { ...x, nflTeam: "BYE4" } : x));
    const b = view(setup({ mine, byeWeek: { AAA: 9, BYE4: 4 }, freeAgents: [p("fw", "WR", 5, "Wally Free"), p("fb", "RB", 13, "Bobby Bye", { nflTeam: "BYE4" })] }));
    // Before the review he read "Better than W. Route (bye)": every free-agent WR did.
    expect(row(b?.week, "Wally Free")).toBeUndefined();
    // The rest of season knows no single week: W. Route (7 a week, 13 games) out-scores him there.
    expect(row(b?.ros, "Wally Free")).toBeUndefined();
    // A free agent on bye in the week the projection column shows says "bye", not 0.
    expect(row(b?.ros, "Bobby Bye")?.weekText).toBe("bye");
    expect(row(b?.ros, "Bobby Bye")?.bye).toBe("bye wk 4");
  });

  it("where none of mine at his position plays that week, it says who and why", () => {
    const mine = MINE.map((x) => (x.id === "t1" ? { ...x, nflTeam: "BYE4" } : x));
    const b = view(setup({ mine, byeWeek: { AAA: 9, BYE4: 4 }, freeAgents: [p("ft", "TE", 4, "Tad Fill")] }));
    expect(row(b?.week, "Tad Fill")?.betterThan).toBe("No TE of yours plays in week 4 (T. Block: bye)");
    expect(row(b?.week, "Tad Fill")?.gain.text).toBe("+4 pts");
    // Nobody at his position at all: as before.
    const none = view(setup({ mine: MINE.filter((x) => x.id !== "t1"), freeAgents: [p("ft", "TE", 4, "Tad Fill")] }));
    expect(row(none?.ros, "Tad Fill")?.betterThan).toBe("No TE on your roster");
  });

  it("while the current week is under way and every game of it has kicked off, the one-week list is next week's, and the notes say so", () => {
    const kick = new Date(TEST_NOW.getTime() - 3_600_000).toISOString();
    const u = view(setup({ kickoffs: { 4: { AAA: kick } } }));
    expect(u?.underWay).toBeNull();
    expect(u?.week?.label).toBe("Next week");
    expect(u?.week?.underWay).toBe("Week 4 is under way, so this list is for week 5.");
    expect(u?.week?.weekLabel).toBe("Wk 5");
    expect(u?.ros?.lead).toContain("weeks 5–17");
    // Review: the note named a "This week" the toggle didn't show.
    expect(u?.ros?.note).toContain("Positions you stream weekly (K, D/ST) are under “Next week”.");
    expect(u?.ros?.note).not.toContain("“This week”");
  });

  describe("while the current week is under way with games still to play (review: 'Streaming picks this week' lists that week)", () => {
    const EAR = new Date(TEST_NOW.getTime() - 3_600_000).toISOString();
    const LAT = new Date(TEST_NOW.getTime() + 86_400_000).toISOString();
    // My TE (Ty Block) and kicker played; everyone else plays later.
    const mine = MINE.map((x) => ({ ...x, nflTeam: x.id === "t1" || x.id === "k1" ? "EAR" : "LAT" }));
    const fas = [p("fa1", "RB", 13, "Frankie Burst", { nflTeam: "LAT" }), p("ft", "TE", 9, "Tad Fill", { nflTeam: "LAT" }), p("fe", "RB", 20, "Early Bird", { nflTeam: "EAR" })];
    const u = view(setup({ mine, freeAgents: fas, kickoffs: { 4: { EAR, LAT } } }));

    it("three lists: the rest of season, 'This week' for its games still to play, and 'Next week'", () => {
      expect([u?.ros?.label, u?.underWay?.label, u?.week?.label]).toEqual(["Rest of season", "This week", "Next week"]);
      expect(u?.underWay?.underWay).toBe("Week 4 is under way: this list counts only its games still to play.");
      expect(u?.underWay?.weekLabel).toBe("Wk 4");
      expect(u?.underWay?.caption).toBe("Waiver upgrades for week 4's games still to play");
      expect(u?.underWay?.lead).toBe("Lineup gain: what each move adds to your starting lineup in the rest of week 4.");
      expect(u?.underWay?.note).toContain("Players whose games have started are locked");
      expect(u?.week?.underWay).toBe("Week 4 is under way, so this list is for week 5.");
      expect(u?.ros?.note).toContain("Positions you stream weekly (K, D/ST) are under “This week” and “Next week”.");
    });

    it("rows: no free agent whose game has started; my TE's game started, so a TE still to play fills the FLEX instead", () => {
      expect(row(u?.underWay, "Early Bird")).toBeUndefined();
      const te = row(u?.underWay, "Tad Fill");
      expect(te?.betterThan).toBe("No TE of yours plays in the rest of week 4 (T. Block: game started)");
      // He takes the FLEX from W. Route (7): +2.
      expect(te?.gain.text).toBe("+2 pts");
      expect(te?.gain.title).toBe("Adding him into an open roster spot adds 2 points to your starting lineup in the rest of week 4.");
      // A free agent still to play who beats one of mine who does: as on any list.
      expect(row(u?.underWay, "Frankie Burst")?.betterThan).toBe("R. Dash, R. Slow");
    });
  });

  it("'No room' when nobody can make room (no gain, no drop)", () => {
    const base = setup();
    const ros = base.model.waiverUpgrades?.ros;
    if (!ros) throw new Error("no list");
    const model: LeagueModel = { ...base.model, waiverUpgrades: { teamId: "1", ros: { ...ros, rows: ros.rows.map((r) => ({ ...r, gain: null, drop: null, depthOnly: false })) }, underWay: null, week: null } };
    const r = buildWaiversView({ snapshot: base.snapshot, model, inputs: base.inputs, timeZone: NY, now: TEST_NOW.toISOString() })?.ros?.rows[0];
    expect(r?.gain.text).toBe(CANT_FIT_TEXT);
    expect(r?.drop).toBeNull();
  });

  it("nothing to show from a model built without the lists; my redraft season over: one line instead", () => {
    expect(buildWaiversView({ snapshot: s.snapshot, model: { ...s.model, waiverUpgrades: null }, inputs: s.inputs, timeZone: NY, now: TEST_NOW.toISOString() })).toBeNull();
    const odds = { teams: [{ teamId: "1", eliminated: true }, { teamId: "2", eliminated: false }] } as unknown as SeasonOdds;
    const over = buildWaiversView({ snapshot: s.snapshot, model: { ...s.model, odds }, inputs: s.inputs, timeZone: NY, now: TEST_NOW.toISOString() });
    expect(over).toEqual({ ros: null, underWay: null, week: null, first: "ros", intro: expect.any(String), empty: WAIVERS_SEASON_OVER, emptyLink: null });
  });

  it("under “Several prizes”, out of the title race isn't over while a prize the league pays can still move (planner reply to Checkpoint 7b, §6; the League page's own reading)", () => {
    const shares = (o: Partial<Reward["shares"]>): Reward["shares"] => ({ first: 0, second: 0, third: 0, weeklyHigh: 0, pointsLeader: 0, ...o });
    const odds = (left: { periods: number; weeks: number }) =>
      ({ playoffTeams: 4, regularLeft: left, teams: [{ teamId: "1", eliminated: true, bestFinish: 5 }, { teamId: "2", eliminated: false, bestFinish: 1 }] }) as unknown as SeasonOdds;
    const at = (reward: Reward, left: { periods: number; weeks: number }) => buildWaiversView({ snapshot: s.snapshot, model: { ...s.model, reward, odds: odds(left) }, inputs: s.inputs, timeZone: NY, now: TEST_NOW.toISOString() });
    const weekly: Reward = { goal: "prizes", shares: shares({ first: 0.8, weeklyHigh: 0.2 }), periods: 14, empty: false };
    // A weekly high score still to win: the lists, as for a team in the race.
    const open = at(weekly, { periods: 3, weeks: 3 });
    expect(open?.empty).toBeNull();
    expect(open?.ros?.rows.length).toBeGreaterThan(0);
    // None left, or the title alone paying: over.
    expect(at(weekly, { periods: 0, weeks: 0 })?.empty).toBe(WAIVERS_SEASON_OVER);
    expect(at({ goal: "title", shares: TITLE_ONLY, periods: 14, empty: false }, { periods: 3, weeks: 3 })?.empty).toBe(WAIVERS_SEASON_OVER);
    // Dynasty and keeper leagues never read as over (their later seasons): the lists.
    const dynasty = { ...s.snapshot, settings: { ...s.snapshot.settings, leagueType: "dynasty" as const } };
    expect(buildWaiversView({ snapshot: dynasty, model: { ...s.model, odds: odds({ periods: 0, weeks: 0 }) }, inputs: s.inputs, timeZone: NY, now: TEST_NOW.toISOString() })?.empty).toBeNull();
  });

  it("counts a regular-season week under way while its games are still to play: a pickup can still change it, a trade can't (review of the prizes UI, prizes-ui-5)", () => {
    const weekly: Reward = { goal: "prizes", shares: { first: 0.8, second: 0, third: 0, weeklyHigh: 0.2, pointsLeader: 0 }, periods: 14, empty: false };
    // Out of the title race, no week left but the one under way (SeasonOdds.regularLeft leaves it out: every trade holds it).
    const odds = { playoffTeams: 4, regularLeft: { periods: 0, weeks: 0 }, teams: [{ teamId: "1", eliminated: true, bestFinish: 5 }, { teamId: "2", eliminated: false, bestFinish: 1 }] } as unknown as SeasonOdds;
    const under = (base: ReturnType<typeof setup>, reward: Reward) => {
      const model: LeagueModel = { ...base.model, reward, odds };
      return { model, view: buildWaiversView({ snapshot: base.snapshot, model, inputs: base.inputs, timeZone: NY, now: TEST_NOW.toISOString() }) };
    };
    // Week 4 under way, my TE's and kicker's games played, the rest still to play: its weekly high score can still be won.
    const EAR = new Date(TEST_NOW.getTime() - 3_600_000).toISOString();
    const LAT = new Date(TEST_NOW.getTime() + 86_400_000).toISOString();
    const mine = MINE.map((x) => ({ ...x, nflTeam: x.id === "t1" || x.id === "k1" ? "EAR" : "LAT" }));
    const live = setup({ mine, freeAgents: [p("fa1", "RB", 13, "Frankie Burst", { nflTeam: "LAT" }), p("ft", "TE", 9, "Tad Fill", { nflTeam: "LAT" })], kickoffs: { 4: { EAR, LAT } } });
    const open = under(live, weekly);
    expect(open.model.inProgressWeek).toBe(4);
    // Over for a trade (the League page's own reading), not for a pickup: the lists, "This week" among them.
    expect(seasonOver(open.model, "1", "redraft")).toBe(true);
    expect(open.view?.empty).toBeNull();
    expect(open.view?.underWay?.label).toBe("This week");
    // Every game of it kicked off (no "This week" list), or the title alone paying: over.
    const done = setup({ kickoffs: { 4: { AAA: new Date(TEST_NOW.getTime() - 3_600_000).toISOString() } } });
    expect(done.model.inProgressWeek).toBe(4);
    expect(under(done, weekly).view?.empty).toBe(WAIVERS_SEASON_OVER);
    expect(under(live, { goal: "title", shares: TITLE_ONLY, periods: 14, empty: false }).view?.empty).toBe(WAIVERS_SEASON_OVER);
  });

  it("a team that lost its semifinal, under a split paying 3rd place: the lists while the 3rd-place game is still to play (final review of Checkpoint 7c, ui-UI-7C-1)", () => {
    const places: Reward = { goal: "prizes", shares: { first: 4 / 9, second: 16 / 45, third: 1 / 5, weeklyHigh: 0, pointsLeader: 0 }, periods: 14, empty: false };
    const title: Reward = { goal: "title", shares: TITLE_ONLY, periods: 14, empty: false };
    /** Out of the title race (the semifinal lost), the regular season over; `third` my chance of 3rd, `left` the playoff weeks a trade can change. */
    const odds = (third: number, left: number) =>
      ({ playoffTeams: 4, regularLeft: { periods: 0, weeks: 0 }, playoffLeft: { weeks: left }, teams: [{ teamId: "1", eliminated: true, bestFinish: 1, pThird: third }, { teamId: "2", eliminated: false, bestFinish: 1 }] }) as unknown as SeasonOdds;
    const at = (base: ReturnType<typeof setup>, reward: Reward, o: SeasonOdds) => buildWaiversView({ snapshot: base.snapshot, model: { ...base.model, reward, odds: o }, inputs: base.inputs, timeZone: NY, now: TEST_NOW.toISOString() });
    // The final round ahead: the lists.
    const ahead = at(s, places, odds(0.56, 1));
    expect(ahead?.empty).toBeNull();
    expect(ahead?.ros?.rows.length).toBeGreaterThan(0);
    // 3rd place settled, or the title alone paying: over.
    expect(at(s, places, odds(0, 1))?.empty).toBe(WAIVERS_SEASON_OVER);
    expect(at(s, places, odds(1, 1))?.empty).toBe(WAIVERS_SEASON_OVER);
    expect(at(s, title, odds(0.56, 1))?.empty).toBe(WAIVERS_SEASON_OVER);
    // ⚠️ No playoff week a trade can change (the 3rd-place game's own week under way): over, the League page's reading. A
    // "This week" list for it would need a week after it (src/engine/waivers.ts), which keeps the season going anyway.
    expect(at(s, places, odds(0.56, 0))?.empty).toBe(WAIVERS_SEASON_OVER);
  });

  it("no team picked, or no week left: the section still shows, with one line (and a link to pick the team) instead of the lists (review of Phase 7b)", () => {
    // No team: the engine builds no lists (LeagueModel.waiverUpgrades null), and the header's "Waivers" link leads here.
    const l = buildTestLeague({ platform: "espn", teams: [{ id: "1", roster: MINE }, { id: "2", roster: THEM }], freeAgents: FAS, byeWeek: { AAA: 9 } });
    const noTeam = { ...l.snapshot, myTeamId: null };
    const model = buildLeagueModel(noTeam, l.inputs, { now: TEST_NOW, sims: 0 }, NO_RISK);
    expect(model.waiverUpgrades).toBeNull();
    const none = buildWaiversView({ snapshot: noTeam, model, inputs: l.inputs, timeZone: NY, now: TEST_NOW.toISOString() });
    expect(none).toEqual({ ros: null, underWay: null, week: null, first: "ros", intro: expect.any(String), empty: WAIVERS_NO_TEAM, emptyLink: { href: "/import#your-team", text: "Pick your team" } });
    expect(WAIVERS_NO_TEAM).toBe("Pick your team on the Import Report to see waiver upgrades for it.");
    expect(WAIVERS_PICK_TEAM.href).toBe("/import#your-team");
    // A team the league doesn't have reads as none picked, as the League page reads it.
    expect(buildWaiversView({ snapshot: s.snapshot, model: { ...s.model, myTeamId: "99" }, inputs: s.inputs, timeZone: NY, now: TEST_NOW.toISOString() })?.empty).toBe(WAIVERS_NO_TEAM);
    // No week left for a pickup (the season over, or its last week under way): one line.
    const done = { ...s.model, waiverUpgrades: { teamId: "1", ros: null, underWay: null, week: null } };
    expect(buildWaiversView({ snapshot: s.snapshot, model: done, inputs: s.inputs, timeZone: NY, now: TEST_NOW.toISOString() })).toEqual({
      ros: null,
      underWay: null,
      week: null,
      first: "ros",
      intro: expect.any(String),
      empty: WAIVERS_NO_WEEKS,
      emptyLink: null,
    });
  });

  it("'Depth only' in words: under the list whenever a row carries it, and as the tag's hover, reading right on a 'No gain' row (review of Phase 7b)", () => {
    const depth = row(v?.ros, "Fred Depth");
    expect(depth?.depthOnly).toBe(true);
    expect(depth?.gain.text).toBe(NO_GAIN_TEXT);
    expect(v?.ros?.note).toContain(`${DEPTH_ONLY_TAG}: ${DEPTH_ONLY_WORDS.ros}.`);
    expect(v?.ros?.depthOnlyTitle).toBe("He wouldn't start for you in a normal week, so he'd only play when injuries or byes open a spot.");
    // A one-week list words it for that week.
    expect(v?.week?.depthOnlyTitle).toBe("He wouldn't start for you that week, so he'd only play if an injury opens a spot.");
    // A list without a depth-only row doesn't explain the tag.
    for (const list of [v?.ros, v?.underWay, v?.week]) if (list && !list.rows.some((r) => r.depthOnly)) expect(list.note).not.toContain(DEPTH_ONLY_TAG);
  });
});

describe("the waiver status (ESPN's; none on Sleeper)", () => {
  // TEST_NOW is Tuesday, Sep 29, 2026, 20:00 UTC; ESPN runs this league's claims on Wednesday at 07:00 UTC (3 AM Eastern).
  const WED = "2026-09-30T07:00:00.000Z";

  it("'On waivers until Wed' (the viewer's weekday), 'Free agent now', a date a week or more away, and once it has passed", () => {
    expect(waiverStatusText({ kind: "waivers", until: WED }, TEST_NOW.toISOString(), NY)?.text).toBe("On waivers until Wed");
    expect(waiverStatusText({ kind: "waivers", until: WED }, TEST_NOW.toISOString(), "Pacific/Honolulu")?.text).toBe("On waivers until Tue");
    expect(waiverStatusText({ kind: "freeAgent" }, TEST_NOW.toISOString(), NY)?.text).toBe("Free agent now");
    expect(waiverStatusText({ kind: "waivers", until: "2026-10-08T16:00:00.000Z" }, TEST_NOW.toISOString(), NY)?.text).toBe("On waivers until Oct 8");
    expect(waiverStatusText({ kind: "waivers", until: WED }, "2026-10-01T12:00:00.000Z", NY)?.text).toBe("Was on waivers until Wed");
    expect(waiverStatusText({ kind: "waivers" }, TEST_NOW.toISOString(), NY)?.text).toBe("On waivers");
    expect(waiverStatusText(undefined, TEST_NOW.toISOString(), NY)).toBeNull();
    expect(waiverStatusText({ kind: "waivers", until: WED }, TEST_NOW.toISOString(), NY)?.title).toBe("On waivers until Wed, Sep 30, 3:00 AM: claims run then, in your league's waiver order.");
  });

  it("on the rows, from the import (an ESPN league); none where the platform reports none", () => {
    const espn = view(setup({ status: { fa1: { kind: "waivers", until: WED }, fd: { kind: "freeAgent" } } }));
    expect(row(espn?.ros, "Frankie Burst")?.status?.text).toBe("On waivers until Wed");
    expect(row(espn?.week, "Geese D/ST")?.status?.text).toBe("Free agent now");
    expect(row(espn?.ros, "Fred Depth")?.status).toBeNull();
    const sleeper = view(setup({ platform: "sleeper" }));
    expect(sleeper?.ros?.rows.every((r) => r.status === null)).toBe(true);
    expect(row(sleeper?.week, "Geese D/ST")?.pos).toBe("DEF");
  });
});

describe("Checkpoint 7e: one move per row, Helps you, the switch and the untouchables (planner reply to Checkpoint 7d, items 3.1–3.4)", () => {
  /** MINE with six bench players who never start: a full roster of 16, so every pickup drops someone. */
  const FULL_MINE: TestPlayer[] = [
    ...MINE,
    p("b1", "RB", 1, "Benny One"),
    p("b2", "RB", 1.5, "Benny Two"),
    p("b3", "WR", 2, "Bert Three"),
    p("b4", "WR", 2.5, "Bert Four"),
    p("b5", "QB", 3, "Bo Five"),
    p("b6", "TE", 1, "Bud Six"),
  ];
  const full = setup({ mine: FULL_MINE });
  const f = view(full);

  it("a row reads as one move: add him, drop the player named (with his position), and how many more points he scores (3.1)", () => {
    const r = row(f?.ros, "Frankie Burst");
    expect(r?.drop).toEqual({ id: "b1", name: "B. One", fullName: "Benny One", pos: "RB" });
    expect(r?.dropText).toBe("Drop B. One");
    // 13 a week for 14 weeks against 1 a week for 13 (B. One's team has its bye in week 9): whole points on the season list.
    expect(r?.outscores).toBe("Outscores B. One by 169");
    // Unrated here (no season simulated): the lineup gain stays the main number, and isn't repeated in the details.
    expect(r?.main.label).toBe("Lineup gain");
    expect(r?.lineupGain).toBeNull();
    // The one-week list: that week's projections, one decimal, "this week".
    expect(row(f?.week, "Frankie Burst")?.outscores).toBe("Outscores B. One by 12 this week");
    expect(row(f?.week, "Frankie Burst")?.main.label).toBe("Lineup gain");
    expect(f?.ros?.note).toContain("Outscores: his rest-of-season points against the player you'd drop.");
    expect(f?.week?.note).toContain("Outscores: his projection this week against the player you'd drop.");
  });

  it("when the drop scores more, it says so the other way round; even, it says even", () => {
    const base = full.model.waiverUpgrades?.ros;
    if (!base) throw new Error("no list");
    const at = (dropPoints: number) => {
      const model: LeagueModel = { ...full.model, waiverUpgrades: { ...(full.model.waiverUpgrades as NonNullable<LeagueModel["waiverUpgrades"]>), ros: { ...base, rows: base.rows.map((r) => (r.playerId === "fa1" ? { ...r, dropPoints } : r)) } } };
      return row(buildWaiversView({ snapshot: full.snapshot, model, inputs: full.inputs, timeZone: NY, now: TEST_NOW.toISOString() })?.ros, "Frankie Burst")?.outscores;
    };
    expect(at(185.4)).toBe("B. One outscores him by 3");
    expect(at(182.2)).toBe("Even with B. One");
  });

  it("the switch and my untouchables above the lists (3.2, 3.3)", () => {
    expect(f?.samePosition).toBe(true);
    expect(f?.untouchables).toEqual([]);
    const l = buildTestLeague({ platform: "espn", teams: [{ id: "1", roster: FULL_MINE }, { id: "2", roster: THEM }], freeAgents: FAS, byeWeek: { AAA: 9 } });
    const settings = { ...defaultTradeSettings(), waiverSamePosition: false, untouchables: ["b2", "r1"] };
    const model = buildLeagueModel(l.snapshot, l.inputs, { now: TEST_NOW, sims: 0, settings }, NO_RISK);
    const v2 = buildWaiversView({ snapshot: l.snapshot, model, inputs: l.inputs, timeZone: NY, now: TEST_NOW.toISOString() });
    expect(v2?.samePosition).toBe(false);
    expect(v2?.untouchables).toEqual([
      { id: "r1", name: "R. Bolt", fullName: "Rudy Bolt" },
      { id: "b2", name: "B. Two", fullName: "Benny Two" },
    ]);
    expect(SAME_POSITION_LABEL).toBe("Drop from the same position");
  });

  it("a move that can't be made says why (3.3): all untouchable at his position, with the suggestion and the players to unlock; any position; no room", () => {
    const base = full.model.waiverUpgrades?.ros;
    if (!base) throw new Error("no list");
    const blockedAs = (blocked: WaiverBlocked) => {
      const model: LeagueModel = { ...full.model, waiverUpgrades: { ...(full.model.waiverUpgrades as NonNullable<LeagueModel["waiverUpgrades"]>), ros: { ...base, rows: base.rows.map((r) => (r.playerId === "fa1" ? { ...r, gain: null, drop: null, dropPoints: null, blocked } : r)) } } };
      return row(buildWaiversView({ snapshot: full.snapshot, model, inputs: full.inputs, timeZone: NY, now: TEST_NOW.toISOString() })?.ros, "Frankie Burst");
    };
    const all = blockedAs({ why: "untouchable", atPosition: true, otherPosition: true, untouchable: ["r2", "r3"] });
    // The trade's own words, naming them (review of wave C, UI-C-4 and UI-C-7: their locks are on the untouchables line).
    expect(all?.blocked).toEqual({
      text: "Every RB you could drop is untouchable: R. Dash, R. Slow.",
      hint: SAME_POSITION_HINT,
      unlock: [
        { id: "r2", name: "R. Dash", fullName: "Reggie Dash" },
        { id: "r3", name: "R. Slow", fullName: "Ronnie Slow" },
      ],
    });
    expect(SAME_POSITION_HINT).toBe("Turn off “Drop from the same position” to drop a player at another position.");
    // Its number says it can't be added, under the list's own label, its hover the row's sentence (UI-C-4).
    expect(all?.main).toEqual({ label: "Lineup gain", text: CANT_ADD_TEXT, positive: false, title: `Every RB you could drop is untouchable: R. Dash, R. Slow. ${SAME_POSITION_HINT}` });
    expect(all?.drop).toBeNull();
    expect(all?.dropText).toBeNull();
    expect(all?.outscores).toBeNull();
    expect(blockedAs({ why: "untouchable", atPosition: false, otherPosition: false, untouchable: ["b1"] })?.blocked).toEqual({
      text: "All the players you could drop are untouchable: B. One.",
      hint: null,
      unlock: [{ id: "b1", name: "B. One", fullName: "Benny One" }],
    });
    const room = blockedAs({ why: "room", atPosition: true, otherPosition: true, untouchable: [] });
    expect(room?.blocked).toEqual({ text: "No RB of yours can make room for him.", hint: SAME_POSITION_HINT, unlock: [] });
    expect(room?.main).toMatchObject({ text: CANT_FIT_TEXT, title: `No RB of yours can make room for him. ${SAME_POSITION_HINT}` });
    expect(blockedAs({ why: "room", atPosition: false, otherPosition: false, untouchable: [] })?.blocked?.text).toBe(CANT_FIT_WHY);
    expect(CANT_FIT_WHY).toBe("None of your players can make room for him under your league's roster rules.");
    // The words' plurals: kickers and ESPN's D/STs.
    expect(positionPlural("K", "espn")).toBe("kickers");
    expect(positionPlural("DEF", "espn")).toBe("D/STs");
  });

  describe("the rated season list (a made-up league with its season, 400 seasons)", () => {
    const RATED: LeagueModelConfig = { ...config, waivers: { ...config.waivers, ratingScreenSims: 100, ratingFinishRows: 2 } };
    // FantasyCalc's values made distinctive (987,650 and down), so none can show by accident (CLAUDE.md §2.9).
    const l = smallLeague(11);
    const market = l.inputs.market;
    if (!market) throw new Error("no values");
    const values = Object.fromEntries(Object.keys(market.values).map((id, i) => [id, 987_650 - i * 3]));
    const inputs = { ...l.inputs, market: { ...market, values, topValue: 987_650 } };
    const model = buildLeagueModel(l.snapshot, inputs, { now: TEST_NOW, sims: 400, waiverRating: true }, RATED);
    const rv = buildWaiversView({ snapshot: l.snapshot, model, inputs, timeZone: NY, now: TEST_NOW.toISOString() });

    it("Helps you is the main number, the lineup gain in the details, and the note says how the moves were rated", () => {
      expect(rv?.ros?.rated).toBe(true);
      expect(rv?.week?.rated).toBe(false);
      const rows = rv?.ros?.rows ?? [];
      expect(rows.length).toBeGreaterThan(2);
      for (const r of rows) {
        if (r.blocked) continue;
        expect(r.main.label).toBe("Helps you");
        expect(r.main.text === NO_GAIN_TEXT || /^\d+$/.test(r.main.text)).toBe(true);
        expect(r.lineupGain).toMatch(/^(\+1 point|\+[\d.]+ points|None) over weeks /);
        expect(r.outscores).toMatch(/^(Outscores .+ by [\d,]+|.+ outscores him by [\d,]+|Even with .+|No drop needed: [\d,]+ rest-of-season points)$/);
      }
      const first = rows[0];
      if (first && first.main.text !== NO_GAIN_TEXT)
        expect(first.main.title).toMatch(/^Helps you \d+: about as good as adding (less than 0\.1 points|1 point|[\d.]+ points) a week to your lineup for the rest of the season, on the same scale as trade ideas \(from [\d,]+ simulated seasons\)\.$/);
      // One line (Checkpoint 7h, section 1), the rest behind "Why?".
      expect(rv?.ros?.lead).toBe("Helps you: how much each move raises your chances over weeks 6–10, on the same scale as trade ideas.");
      expect(rv?.ros?.note).toContain("It's worked out from seasons simulated with and without each move, weighing your chances at what your league rewards.");
      // What the odds lines in each move's details are (section 5): the rating's own "before", not the League page's.
      expect(rv?.ros?.note).toContain(ODDS_WHY);
      // The trade value a move gives up only (the final review of Checkpoint 7e, ENG-7E-2: a gain counts as none).
      expect(rv?.ros?.note).toContain("It counts the trade value you'd give up too, as your “Protect my trade value” setting asks.");
      // No count of the moves played out longest (review of Checkpoint 7f, INTEGRATION-7: "The 6 best moves …" above a list
      // showing 3, the others folded as "No gain").
      expect(rv?.ros?.note).toContain("The best moves are played out 400 times, the others 100 times.");
      expect(rv?.ros?.note).not.toMatch(/The \d+ best moves/);
      // The one-week list stays in points.
      for (const r of rv?.week?.rows ?? []) if (!r.blocked) expect(r.main.label).toBe("Lineup gain");
    });

    /** The rated list with its first row's rating and gain replaced, and that row's view. */
    const rowWith = (rating: { b: number | null; bWin?: number | null; helps: number | null }, gain?: number, weighs?: "tradeValue" | "longTerm" | null) => {
      const ros = model.waiverUpgrades?.ros;
      const first = ros?.rows.find((r) => r.gain !== null);
      if (!ros?.rating || !first) throw new Error("no rated row");
      const rows = ros.rows.map((r) => (r === first ? { ...r, ...(gain === undefined ? {} : { gain }), rating: { ...rating, sims: 400 } } : r));
      const m: LeagueModel = { ...model, waiverUpgrades: { ...(model.waiverUpgrades as NonNullable<LeagueModel["waiverUpgrades"]>), ros: { ...ros, rows, rating: { ...ros.rating, ...(weighs === undefined ? {} : { weighs }) } } } };
      return buildWaiversView({ snapshot: l.snapshot, model: m, inputs, timeZone: NY, now: TEST_NOW.toISOString() })?.ros?.rows.find((r) => r.id === first.playerId);
    };

    it("a “No gain” row whose odds part is a gain says the value it gives up outweighs it, visibly and on hover (review of wave C, UI-C-2)", () => {
      const traded = rowWith({ b: -0.2, bWin: 0.3, helps: null });
      expect(traded?.main.text).toBe(NO_GAIN_TEXT);
      expect(traded?.main.title).toMatch(/^Adding him (and dropping .+|into an open roster spot) raises your chances at what your league rewards, but the trade value you'd give up outweighs that, as your “Protect my trade value” setting counts it \(from 400 simulated seasons\)\.$/);
      expect(traded?.why).toBe("It raises your chances, but the trade value you'd give up outweighs that (your “Protect my trade value” setting).");
      const longTerm = rowWith({ b: -0.2, bWin: 0.3, helps: null }, undefined, "longTerm");
      expect(longTerm?.why).toBe("It raises your chances this season, but the long-term value you'd give up outweighs that (your Win now ↔ Future setting).");
      // Its odds part no gain either: it doesn't raise them, no line.
      const none = rowWith({ b: -0.2, bWin: -0.1, helps: null });
      expect(none?.main.title).toMatch(/doesn't raise your chances at what your league rewards \(from 400 simulated seasons\)\.$/);
      expect(none?.why).toBeNull();
      // B above 0 that rounds to no Helps you: too little to show.
      const tiny = rowWith({ b: 0.001, bWin: 0.001, helps: null });
      expect(tiny?.main.title).toMatch(/raises your chances at what your league rewards too little to show \(from 400 simulated seasons\)\.$/);
      expect(tiny?.why).toBeNull();
      // A list weighing nothing else (no values, the deadline passed): no line.
      expect(rowWith({ b: -0.2, bWin: 0.3, helps: null }, undefined, null)?.why).toBeNull();
    });

    it("says “less than 0.1 points a week” and “1 point”, never “0 points” or “1 points” (review of wave C, UI-C-6)", () => {
      const b3 = model.waiverUpgrades?.ros?.rating?.b3 as number;
      const small = rowWith({ b: 0.01 * b3, helps: 1 });
      expect(small?.main.title).toContain("about as good as adding less than 0.1 points a week to your lineup");
      expect(rowWith({ b: b3 / 3, helps: 28 })?.main.title).toContain("about as good as adding 1 point a week to your lineup");
      const one = rowWith({ b: b3 / 3, helps: 28 }, 1);
      expect(one?.lineupGain).toMatch(/^\+1 point over weeks /);
      expect(one?.gain.title).toMatch(/ adds 1 point to your starting lineup over weeks /);
    });

    it("says how many seasons are behind the moves as they are: never “the others” when every move was finished, nothing when none could be rated (the final review of Checkpoint 7e, UI-F-5)", () => {
      // Every row finished (no floor, room for all): one count.
      const ALL: LeagueModelConfig = { ...RATED, waivers: { ...config.waivers, ratingScreenSims: 100, ratingFinishRows: 99, ratingFinishFloor: Number.NEGATIVE_INFINITY } };
      const every = buildLeagueModel(l.snapshot, inputs, { now: TEST_NOW, sims: 400, waiverRating: true }, ALL);
      const rows = every.waiverUpgrades?.ros?.rows.filter((r) => r.rating) ?? [];
      expect(rows.length).toBeGreaterThan(2);
      expect(rows.every((r) => r.rating?.sims === 400)).toBe(true);
      const note = buildWaiversView({ snapshot: l.snapshot, model: every, inputs, timeZone: NY, now: TEST_NOW.toISOString() })?.ros?.note ?? "";
      expect(note).toContain("Each move is played out 400 times.");
      expect(note).not.toContain("the others");
      // One move played out longest: "The best move is", still without a count (⚠️ ours: the review of Checkpoint 7f,
      // INTEGRATION-7, dropped the count; one move is one).
      const ONE: LeagueModelConfig = { ...RATED, waivers: { ...config.waivers, ratingScreenSims: 100, ratingFinishRows: 1 } };
      const one = buildLeagueModel(l.snapshot, inputs, { now: TEST_NOW, sims: 400, waiverRating: true }, ONE);
      expect(one.waiverUpgrades?.ros?.rows.filter((r) => r.rating?.sims === 400)).toHaveLength(1);
      const oneNote = buildWaiversView({ snapshot: l.snapshot, model: one, inputs, timeZone: NY, now: TEST_NOW.toISOString() })?.ros?.note ?? "";
      expect(oneNote).toContain("The best move is played out 400 times, the others 100 times.");
      // No move rated (every one blocked, say): no count at all.
      const ros = model.waiverUpgrades?.ros;
      if (!ros) throw new Error("no list");
      const none: LeagueModel = { ...model, waiverUpgrades: { ...(model.waiverUpgrades as NonNullable<LeagueModel["waiverUpgrades"]>), ros: { ...ros, rows: ros.rows.map(({ rating: _r, ...r }) => (void _r, r)) } } };
      const noneNote = buildWaiversView({ snapshot: l.snapshot, model: none, inputs, timeZone: NY, now: TEST_NOW.toISOString() })?.ros?.note ?? "";
      expect(buildWaiversView({ snapshot: l.snapshot, model: none, inputs, timeZone: NY, now: TEST_NOW.toISOString() })?.ros?.lead).toContain("Helps you: how much each move raises your chances");
      expect(noneNote).not.toMatch(/played out/);
      // No move rated: no odds lines, and the note doesn't speak of them (Checkpoint 7h).
      expect(noneNote).not.toContain(ODDS_WHY);
    });

    it("Checkpoint 7h: every rated row's details carry my odds before → after from the runs behind its Helps you, in the cards' forms; the one-week list none", () => {
      const ros = rv?.ros;
      const engine = model.waiverUpgrades?.ros;
      if (!ros || !engine) throw new Error("no list");
      let seen = 0;
      for (const r of ros.rows) {
        const e = engine.rows.find((x) => x.playerId === r.id);
        if (!e?.rating) {
          expect(r.odds, r.name).toBeNull();
          continue;
        }
        const odds = e.rating.odds;
        if (!odds) throw new Error(`no odds for ${r.name}`);
        seen++;
        // "Only the champion" (smallLeague's reward): the title, then the playoffs, no top-N line.
        expect(r.odds?.lines.map((o) => o.label)).toEqual(["Title odds", "Playoff odds"]);
        // Their frame names the seasons behind them, the row's own (its Helps you's).
        expect(r.odds?.frame).toBe(`without a pickup → with this one (from ${e.rating.sims === 400 ? "400" : "100"} simulated seasons)`);
        expect(r.odds?.srFrame).toBe(`without a pickup, then with this one (from ${e.rating.sims === 400 ? "400" : "100"} simulated seasons)`);
        const [title, playoffs] = r.odds?.lines ?? [];
        // Each side printed as it is, the title to a tenth, the playoffs whole, the arrow in words for screen readers.
        const t = (p: number | null) => titleOddsText(p as number);
        expect(title).toEqual({ label: "Title odds", value: `${t(odds.before.prizes.first)} → ${t(odds.after.prizes.first)}`, srValue: `from ${t(odds.before.prizes.first)} to ${t(odds.after.prizes.first)}` });
        expect(playoffs).toEqual({ label: "Playoff odds", value: `${percentText(odds.before.pPlayoffs)} → ${percentText(odds.after.pPlayoffs)}`, srValue: `from ${percentText(odds.before.pPlayoffs)} to ${percentText(odds.after.pPlayoffs)}` });
        expect(title?.value).toMatch(/^(?:\d+\.\d%|<0\.1%|>99\.9%) → (?:\d+\.\d%|<0\.1%|>99\.9%)$/);
        expect(playoffs?.value).toMatch(/^(?:\d+%|<1%|>99%) → (?:\d+%|<1%|>99%)$/);
      }
      expect(seen).toBeGreaterThan(2);
      // The one-week lists stay in points (the planner: "This week and Next week stay in points"): no odds lines.
      for (const r of rv?.week?.rows ?? []) expect(r.odds).toBeNull();
      // Under "Several prizes" paying 3rd place, the top-3 line between them, as on the cards.
      const prizes: LeagueModel = { ...model, reward: { goal: "prizes", shares: { first: 0.5, second: 0.3, third: 0.2, weeklyHigh: 0, pointsLeader: 0 }, periods: 5, empty: false } };
      const pv = buildWaiversView({ snapshot: l.snapshot, model: prizes, inputs, timeZone: NY, now: TEST_NOW.toISOString() });
      const rated = pv?.ros?.rows.find((r) => r.odds !== null);
      expect(rated?.odds?.lines.map((o) => o.label)).toEqual(["Title odds", "Top 3 odds", "Playoff odds"]);
      // The rows played out on both blocks: the note says their "before" differs a little, each its own.
      expect(rv?.ros?.note).toContain(`${ODDS_WHY}, so a move played out 100 times starts from slightly different odds than one played out 400 times. ${ODDS_WHY_HEADLINE}`);
    });

    it("shows no trade value: none of FantasyCalc's (distinctive) values, nor W, anywhere in the section", () => {
      const text = JSON.stringify(rv);
      expect(text).not.toMatch(/9876\d\d|987,6\d\d/);
      expect(text).not.toContain(String(model.market.waiverCredit));
    });

    it("Checkpoint 7f: the rows whose Helps you prints above 0 first and shown, the rest folded behind “N more pickups that don't help you (show)”", () => {
      const ros = rv?.ros;
      if (!ros) throw new Error("no list");
      const helps = ros.rows.filter((r) => r.main.label === "Helps you" && /^[1-9]\d*$/.test(r.main.text));
      expect(ros.helping).toBe(helps.length);
      expect(ros.helping).toBeGreaterThan(0);
      expect(ros.helping).toBeLessThan(ros.rows.length);
      expect(ros.rows.slice(0, ros.helping).every((r) => r.helps && r.main.positive)).toBe(true);
      // Then the moves that can't be made, above the fold too (review of Checkpoint 7f, WAIVERS-1), then the "No gain" rows.
      const above = ros.helping + ros.blocked;
      expect(ros.rows.slice(ros.helping, above).every((r) => !r.helps && r.blocked !== null)).toBe(true);
      expect(ros.rows.slice(above).every((r) => !r.helps && r.blocked === null && r.main.text === NO_GAIN_TEXT)).toBe(true);
      const folded = ros.rows.length - above;
      expect(ros.rest).toEqual({
        count: folded,
        show: `${folded} more ${folded === 1 ? "pickup that doesn't" : "pickups that don't"} help you (show)`,
        hide: `${folded} more ${folded === 1 ? "pickup that doesn't" : "pickups that don't"} help you (hide)`,
        caption: "Pickups that don't help you over the rest of the season",
      });
      expect(ros.noneHelps).toBeNull();
      // The engine's order puts them so already; the view keeps it within each group (a stable partition): the first row,
      // made to print no gain where it stands in the engine's order, moves behind every row that helps (and every move that
      // can't be made), the first of the "No gain" rows, the others in order.
      const first = ros.rows[0];
      const engine = model.waiverUpgrades?.ros;
      if (!first || !engine) throw new Error("no row");
      const rows = engine.rows.map((r) => (r.playerId === first.id ? { ...r, rating: { b: -0.2, bWin: -0.1, helps: null, sims: 400 } } : r));
      const m: LeagueModel = { ...model, waiverUpgrades: { ...(model.waiverUpgrades as NonNullable<LeagueModel["waiverUpgrades"]>), ros: { ...engine, rows } } };
      const demoted = buildWaiversView({ snapshot: l.snapshot, model: m, inputs, timeZone: NY, now: TEST_NOW.toISOString() })?.ros;
      expect(demoted?.helping).toBe(ros.helping - 1);
      expect(demoted?.rows.map((r) => r.id)).toEqual([...ros.rows.slice(1, ros.helping), ...ros.rows.slice(ros.helping, above), first, ...ros.rows.slice(above)].map((r) => r.id));
    });

    it("Checkpoint 7f: waiting for its rating (or when it fails), the season list folds by the number each row shows then: the lineup gain (⚠️ ours)", () => {
      // The League page's own build: without the rating, which it asks for on its own request (pendingRating).
      const unrated = buildLeagueModel(l.snapshot, inputs, { now: TEST_NOW, sims: 400 }, RATED);
      const pv = buildWaiversView({ snapshot: l.snapshot, model: unrated, inputs, timeZone: NY, now: TEST_NOW.toISOString() });
      expect(pv?.pendingRating).not.toBeNull();
      const ros = pv?.ros;
      if (!ros) throw new Error("no list");
      expect(ros.rated).toBe(false);
      expect(ros.helping).toBeGreaterThan(0);
      for (const [i, r] of ros.rows.entries()) {
        expect(r.main.label).toBe("Lineup gain");
        expect(r.helps).toBe(i < ros.helping);
        expect(r.helps).toBe(/^\+[\d.]+ pts$/.test(r.main.text));
      }
      expect(ros.rest?.show).toMatch(/^\d+ more pickups? that (doesn't|don't) help you \(show\)$/);
    });
  });
});

describe("Checkpoint 7h: the odds lines of a rated row (planner reply to Checkpoint 7g, section 5; waiverOddsLines)", () => {
  const prizes = (shares: Partial<Reward["shares"]>): Reward => ({ goal: "prizes", shares: { first: 0, second: 0, third: 0, weeklyHigh: 0, pointsLeader: 0, ...shares }, periods: 14, empty: false });
  const run = (pPlayoffs: number, first: number | null, second: number | null, third: number | null) => ({ pPlayoffs, prizes: { first, second, third, weeklyHigh: 0, pointsLeader: 0 } });
  const odds = { before: run(0.6057, 0.0893, 0.0805, 0.1022), after: run(0.6123, 0.0917, 0.0811, 0.1031) };

  it("the cards' forms: the title to a tenth, the top-N and the playoffs whole, before → after, “from … to” for screen readers", () => {
    expect(waiverOddsLines(odds, { goal: "title", shares: TITLE_ONLY })).toEqual([
      { label: "Title odds", value: "8.9% → 9.2%", srValue: "from 8.9% to 9.2%" },
      { label: "Playoff odds", value: "61% → 61%", srValue: "from 61% to 61%" },
    ]);
    // "Several prizes" paying 3rd place: the top 3 (1st + 2nd + 3rd), 27.2% → 27.6%.
    expect(waiverOddsLines(odds, prizes({ first: 0.44, second: 0.36, third: 0.2 }))?.map((o) => [o.label, o.value])).toEqual([
      ["Title odds", "8.9% → 9.2%"],
      ["Top 3 odds", "27% → 28%"],
      ["Playoff odds", "61% → 61%"],
    ]);
    // Paying 2nd but not 3rd: the top 2; paying neither (the weekly high score alone besides 1st): none.
    expect(waiverOddsLines(odds, prizes({ first: 0.7, second: 0.3 }))?.map((o) => o.label)).toEqual(["Title odds", "Top 2 odds", "Playoff odds"]);
    expect(waiverOddsLines(odds, prizes({ first: 0.8, weeklyHigh: 0.2 }))?.map((o) => o.label)).toEqual(["Title odds", "Playoff odds"]);
    // No reward known (a model built before Checkpoint 7c): the title and the playoffs.
    expect(waiverOddsLines(odds, null)?.map((o) => o.label)).toEqual(["Title odds", "Playoff odds"]);
  });

  it("each side as it is, never before + a change; “unknown” for a title either side doesn't know, a top-N with a part unknown left out", () => {
    // 0.08949… and 0.08950…: a tenth apart as printed, though their difference is 2e-7.
    expect(waiverOddsLines({ before: run(0.5, 0.0894999, null, null), after: run(0.5, 0.0895001, null, null) }, null)?.[0]?.value).toBe("8.9% → 9.0%");
    const unknown = waiverOddsLines({ before: run(0.5, null, null, null), after: run(0.52, null, null, null) }, prizes({ first: 0.6, second: 0.3, third: 0.1 }));
    expect(unknown).toEqual([
      { label: "Title odds", value: "unknown", srValue: "unknown" },
      { label: "Playoff odds", value: "50% → 52%", srValue: "from 50% to 52%" },
    ]);
    // 3rd unknown on one side: no partial sum.
    expect(waiverOddsLines({ before: run(0.5, 0.1, 0.1, 0.1), after: run(0.5, 0.1, 0.1, null) }, prizes({ first: 0.6, second: 0.3, third: 0.1 }))?.map((o) => o.label)).toEqual(["Title odds", "Playoff odds"]);
    // The edges as the cards print them.
    expect(waiverOddsLines({ before: run(0.996, 0.0003, null, null), after: run(0.9999, 0.9996, null, null) }, null)?.map((o) => o.value)).toEqual(["<0.1% → >99.9%", ">99% → >99%"]);
    expect(waiverOddsLines(undefined, null)).toBeNull();
  });
});

describe("Checkpoint 7f: the rows that don't help fold (planner reply to Checkpoint 7e, item 3)", () => {
  // The planner: "Show the rows that rate above 0, followed by a collapsed “N more pickups that don't help you (show).”"
  it("the fold's words: plural or singular, the week on a one-week list, no “more” when no row helps; and the line when none does", () => {
    expect(waiversRestText(42, "ros", { more: true, open: false })).toBe("42 more pickups that don't help you (show)");
    expect(waiversRestText(42, "ros", { more: true, open: true })).toBe("42 more pickups that don't help you (hide)");
    expect(waiversRestText(1, "ros", { more: true, open: false })).toBe("1 more pickup that doesn't help you (show)");
    expect(waiversRestText(59, "thisWeek", { more: true, open: false })).toBe("59 more pickups that don't help you this week (show)");
    expect(waiversRestText(1, "nextWeek", { more: true, open: true })).toBe("1 more pickup that doesn't help you next week (hide)");
    expect(waiversRestText(21, "ros", { more: false, open: false })).toBe("21 pickups that don't help you (show)");
    expect(waiversRestText(1, "thisWeek", { more: false, open: true })).toBe("1 pickup that doesn't help you this week (hide)");
    expect(WAIVERS_NONE_HELPS).toEqual({ ros: "No pickup helps you over the rest of the season.", thisWeek: "No pickup helps you this week.", nextWeek: "No pickup helps you next week." });
  });

  it("an unrated list: the rows whose lineup gain prints above 0 show; a “Depth only” row at no gain folds, its tag still explained under the list", () => {
    const v = view(setup());
    const ros = v?.ros;
    expect(ros?.rows.map((r) => [r.name, r.helps])).toEqual([
      ["Frankie Burst", true],
      ["Fred Depth", false],
    ]);
    expect(ros?.helping).toBe(1);
    expect(ros?.rest).toEqual({ count: 1, show: "1 more pickup that doesn't help you (show)", hide: "1 more pickup that doesn't help you (hide)", caption: "Pickups that don't help you over the rest of the season" });
    expect(ros?.noneHelps).toBeNull();
    expect(row(ros, "Fred Depth")?.depthOnly).toBe(true);
    // The note's sentence is unchanged: said whenever a row of the list carries the tag, folded or not (the lead's call).
    expect(ros?.note).toContain(`${DEPTH_ONLY_TAG}: ${DEPTH_ONLY_WORDS.ros}.`);
    // "This week": the week named, the folded list's caption naming it.
    expect(v?.week?.helping).toBe(2);
    expect(v?.week?.rest).toEqual({ count: 1, show: "1 more pickup that doesn't help you this week (show)", hide: "1 more pickup that doesn't help you this week (hide)", caption: "Pickups that don't help you in week 4" });
  });

  it("while a week is under way: “This week” for its games still to play and “Next week” name their weeks", () => {
    const EAR = new Date(TEST_NOW.getTime() - 3_600_000).toISOString();
    const LAT = new Date(TEST_NOW.getTime() + 86_400_000).toISOString();
    const mine = MINE.map((x) => ({ ...x, nflTeam: x.id === "t1" || x.id === "k1" ? "EAR" : "LAT" }));
    const u = view(setup({ mine, freeAgents: [p("fa1", "RB", 13, "Frankie Burst", { nflTeam: "LAT" }), p("fa5", "RB", 6.5, "Fred Depth", { nflTeam: "LAT" })], kickoffs: { 4: { EAR, LAT } } }));
    expect([u?.underWay?.label, u?.week?.label]).toEqual(["This week", "Next week"]);
    expect(u?.underWay?.rest).toEqual({ count: 1, show: "1 more pickup that doesn't help you this week (show)", hide: "1 more pickup that doesn't help you this week (hide)", caption: "Pickups that don't help you in week 4's games still to play" });
    expect(u?.week?.rest).toEqual({ count: 1, show: "1 more pickup that doesn't help you next week (show)", hide: "1 more pickup that doesn't help you next week (hide)", caption: "Pickups that don't help you in week 5" });
    // Every game of the week kicked off: "Next week" alone.
    const next = view(setup({ kickoffs: { 4: { AAA: EAR } } }));
    expect(next?.week?.label).toBe("Next week");
    expect(next?.week?.rest?.show).toBe("1 more pickup that doesn't help you next week (show)");
  });

  it("when no row helps: the line instead of them, then the fold without “more”", () => {
    const depth = [p("fa5", "RB", 6.5, "Fred Depth"), p("fa6", "RB", 6.2, "Dale Bench"), p("fa7", "RB", 6.8, "Dusty Pine")];
    const v = view(setup({ freeAgents: depth }));
    expect(v?.ros?.helping).toBe(0);
    expect(v?.ros?.noneHelps).toBe("No pickup helps you over the rest of the season.");
    expect(v?.ros?.rest?.show).toBe("3 pickups that don't help you (show)");
    expect(v?.ros?.rest?.hide).toBe("3 pickups that don't help you (hide)");
    expect(v?.week?.noneHelps).toBe("No pickup helps you this week.");
    expect(v?.week?.rest?.show).toBe("3 pickups that don't help you this week (show)");
  });

  it("every row helps: nothing folded, no line", () => {
    const EAR = new Date(TEST_NOW.getTime() - 3_600_000).toISOString();
    const LAT = new Date(TEST_NOW.getTime() + 86_400_000).toISOString();
    const mine = MINE.map((x) => ({ ...x, nflTeam: x.id === "t1" || x.id === "k1" ? "EAR" : "LAT" }));
    const u = view(setup({ mine, freeAgents: [p("fa1", "RB", 13, "Frankie Burst", { nflTeam: "LAT" }), p("ft", "TE", 9, "Tad Fill", { nflTeam: "LAT" })], kickoffs: { 4: { EAR, LAT } } }));
    for (const list of [u?.ros, u?.underWay, u?.week]) {
      expect(list?.rows.length).toBeGreaterThan(0);
      expect(list?.helping).toBe(list?.rows.length);
      expect(list?.rest).toBeNull();
      expect(list?.noneHelps).toBeNull();
    }
  });

  /** A list with Frankie Burst made a move only untouchables could make room for (`also`: another free agent made one too). */
  const withBlocked = (freeAgents: TestPlayer[] = FAS, also: string | null = null) => {
    const base = setup({ freeAgents });
    const ros = base.model.waiverUpgrades?.ros;
    if (!ros) throw new Error("no list");
    const blocked: WaiverBlocked = { why: "untouchable", atPosition: true, otherPosition: true, untouchable: ["r2"] };
    const rows = ros.rows.map((r) => (r.playerId === "fa1" || r.playerId === also ? { ...r, gain: null, drop: null, dropPoints: null, depthOnly: false, blocked } : r));
    const model: LeagueModel = { ...base.model, waiverUpgrades: { ...(base.model.waiverUpgrades as NonNullable<LeagueModel["waiverUpgrades"]>), ros: { ...ros, rows } } };
    return { engine: rows, view: buildWaiversView({ snapshot: base.snapshot, model, inputs: base.inputs, timeZone: NY, now: TEST_NOW.toISOString() })?.ros };
  };

  it("a move that can't be made shows above the fold, after the rows that help, and the fold holds only the “No gain” rows (review of Checkpoint 7f, WAIVERS-1)", () => {
    // The engine lists Frankie Burst first; he can't be added now, and Fred Depth reads "No gain".
    const { engine, view: v } = withBlocked();
    expect(engine[0]?.playerId).toBe("fa1");
    expect(v?.rows.map((r) => [r.name, r.main.text])).toEqual([
      ["Frankie Burst", CANT_ADD_TEXT],
      ["Fred Depth", NO_GAIN_TEXT],
    ]);
    expect([v?.helping, v?.blocked]).toEqual([0, 1]);
    // None helps, a move that can't be made shown: the line says no pickup you can make helps (his sentence says how to make his).
    expect(v?.noneHelps).toBe("No pickup you can make helps you over the rest of the season.");
    expect(v?.rows[0]?.blocked?.hint).toBe(SAME_POSITION_HINT);
    // The fold counts the "No gain" row alone, without "more" (no row helps).
    expect(v?.rest).toEqual({ count: 1, show: "1 pickup that doesn't help you (show)", hide: "1 pickup that doesn't help you (hide)", caption: "Pickups that don't help you over the rest of the season" });
    expect(WAIVERS_NONE_YOU_CAN_MAKE).toEqual({
      ros: "No pickup you can make helps you over the rest of the season.",
      thisWeek: "No pickup you can make helps you this week.",
      nextWeek: "No pickup you can make helps you next week.",
    });
  });

  it("rows that help, then the moves that can't be made, each in the engine's order, then the “No gain” rows folded, “more” as a row helps", () => {
    // Rex Block and Ray Boot help too, then can't be added: they move behind Frankie Burst, the one that helps.
    const fas = [...FAS, p("fa8", "RB", 12, "Rex Block"), p("fa9", "RB", 11, "Ray Boot")];
    const { view: v } = withBlocked(fas, "fa8");
    // The engine's order: Frankie Burst, Rex Block, Ray Boot (by gain), then Fred Depth.
    expect(v?.rows.map((r) => r.name)).toEqual(["Ray Boot", "Frankie Burst", "Rex Block", "Fred Depth"]);
    expect(v?.helping).toBe(1);
    expect(v?.rows.slice(0, v.helping).every((r) => r.helps)).toBe(true);
    expect(v?.rows.slice(v.helping, v.helping + v.blocked).map((r) => r.main.text)).toEqual([CANT_ADD_TEXT, CANT_ADD_TEXT]);
    expect(v?.rows.slice((v?.helping ?? 0) + (v?.blocked ?? 0)).map((r) => r.main.text)).toEqual([NO_GAIN_TEXT]);
    expect(v?.blocked).toBe(2);
    expect(v?.noneHelps).toBeNull();
    expect(v?.rest?.show).toBe("1 more pickup that doesn't help you (show)");
    // Every move can't be made: no fold, the line, then the moves.
    const only = withBlocked([p("fa1", "RB", 13, "Frankie Burst")]).view;
    expect([only?.helping, only?.blocked, only?.rest]).toEqual([0, 1, null]);
    expect(only?.noneHelps).toBe(WAIVERS_NONE_YOU_CAN_MAKE.ros);
    // No move that can't be made: the line as before (WAIVERS_NONE_HELPS).
    expect(view(setup({ freeAgents: [p("fa5", "RB", 6.5, "Fred Depth")] }))?.ros?.noneHelps).toBe(WAIVERS_NONE_HELPS.ros);
  });
});
