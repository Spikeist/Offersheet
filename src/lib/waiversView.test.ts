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
import { TEST_NOW, buildTestLeague, type TestPlayer } from "@/engine/testLeague";
import { CANT_FIT_TEXT, NO_GAIN_TEXT, WAIVERS_HREF, WAIVERS_SECTION_ID, WAIVERS_SEASON_OVER, buildWaiversView, waiverStatusText, type WaiverListView } from "./waiversView";

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

  it("nothing to show without a list; my redraft season over: one line instead", () => {
    expect(buildWaiversView({ snapshot: s.snapshot, model: { ...s.model, waiverUpgrades: null }, inputs: s.inputs, timeZone: NY, now: TEST_NOW.toISOString() })).toBeNull();
    const odds = { teams: [{ teamId: "1", eliminated: true }, { teamId: "2", eliminated: false }] } as unknown as SeasonOdds;
    const over = buildWaiversView({ snapshot: s.snapshot, model: { ...s.model, odds }, inputs: s.inputs, timeZone: NY, now: TEST_NOW.toISOString() });
    expect(over).toEqual({ ros: null, underWay: null, week: null, first: "ros", intro: expect.any(String), empty: WAIVERS_SEASON_OVER });
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
