/**
 * "Waiver upgrades" on the League page (planner reply to Checkpoint 7a, §6.2; ./waiversView.ts): the words and numbers of
 * the lists, from a made-up league run through the engine (CLAUDE.md §16): labels ("This week" for a week under way's games
 * still to play, "Next week" for the week after it), the notes naming the one-week lists the page actually has (review:
 * the note pointed to a "This week" the page didn't show), the gain and the drop in words ("No gain" when the gain prints
 * as 0), "No room", who and why when none of mine at his position plays ("No TE of yours plays in week 4 (T. Block:
 * bye)"), the waiver status ("On waivers until Wed", "Free agent now", none on Sleeper), opponents on the one-week lists,
 * the D/ST label, and nothing once my redraft season is over.
 */
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import { buildLeagueModel, type LeagueModelConfig } from "@/engine/league";
import type { LeagueModel, SeasonOdds } from "@/engine/leagueModel";
import type { LeagueSnapshot, Pos } from "@/engine/model";
import { TITLE_ONLY, type Reward } from "@/engine/reward";
import { TEST_NOW, buildTestLeague, type TestPlayer } from "@/engine/testLeague";
import { seasonOver } from "./leagueView";
import {
  CANT_FIT_TEXT,
  DEPTH_ONLY_TAG,
  DEPTH_ONLY_WORDS,
  NO_GAIN_TEXT,
  WAIVERS_HREF,
  WAIVERS_NO_TEAM,
  WAIVERS_NO_WEEKS,
  WAIVERS_PICK_TEAM,
  WAIVERS_SECTION_ID,
  WAIVERS_SEASON_OVER,
  buildWaiversView,
  waiverStatusText,
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
    expect(v?.ros?.note).toContain("weeks 4–17, each week counted once, with injuries and byes simulated");
    // The positions I stream (K and D/ST by default) wait for the one-week list.
    expect(v?.ros?.note).toContain("Positions you stream weekly (K, D/ST) are under “This week”.");
  });

  it("a row in words: the player, his points, whom he beats, the gain and the drop (an open roster spot)", () => {
    const r = row(v?.ros, "Frankie Burst");
    expect(r).toMatchObject({ pos: "RB", nflTeam: "BBB", bye: "bye unknown", rosText: "182", weekText: "13", betterThan: "R. Dash, R. Slow", drop: "Open roster spot", depthOnly: false, status: null, opponent: null });
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
    expect(u?.ros?.note).toContain("weeks 5–17");
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
      expect(u?.underWay?.note).toContain("in the rest of week 4");
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
