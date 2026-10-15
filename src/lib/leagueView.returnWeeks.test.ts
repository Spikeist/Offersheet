/**
 * My roster card's lock and return weeks on the League page (Checkpoint 7e; planner reply to Checkpoint 7d, items 3.3 and
 * 3.5; leagueView.ts PlayerRow.lockable, returnWeek, returnWeekOptions): who gets them, the words ("Expected back: week 8
 * (ESPN)", "our guess", "your week"), the select's choices, a week of the user's in the week-by-week notes, and the returner
 * week the schedule's bye rule reads. From the fictional league in src/components/league/testFixtures.ts.
 */
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import type { ExpectedReturn } from "@/engine/leagueModel";
import { leagueFixture, NOW, type LeagueFixture } from "@/components/league/testFixtures";
import { buildLeagueView, returnWeekHelp, returnWeekOptions, returnWeekText, scheduleByeRule, type PlayerRow, type ReturnWeekRow } from "./leagueView";

const TZ = "America/Chicago";
const of = (f: LeagueFixture) => buildLeagueView({ ...f, myTeamSource: f.model.myTeamId ? "platform" : "none", timeZone: TZ, now: NOW });
const row = (f: LeagueFixture, teamId: string, id: string) => of(f).rosters.find((r) => r.teamId === teamId)?.players.find((p) => p.id === id) as PlayerRow;

/** The fixture with `id`'s PlayerModel.expectedReturn set as the engine would (my IR receiver, Fiddlesticks, by default). */
function withReturn(expected: ExpectedReturn, id = "107", opts: Parameters<typeof leagueFixture>[0] = {}): LeagueFixture {
  const f = leagueFixture(opts);
  const pm = f.model.players[id];
  if (!pm) throw new Error(`fixture player ${id} missing`);
  f.model.players[id] = { ...pm, expectedReturn: expected };
  return f;
}

const ESPN_15: ExpectedReturn = { week: 15, source: "platform", fallback: { week: 15, source: "platform" } };

describe("the lock on my roster card (item 3.3)", () => {
  it("is on my active and IR players only: never another team's, a free agent, or without a team of mine", () => {
    const v = of(leagueFixture());
    const mine = v.rosters.find((r) => r.isMine);
    expect(mine?.players.map((p) => [p.id, p.lockable])).toEqual(mine?.players.map((p) => [p.id, p.group === "active" || p.group === "ir"]));
    expect(mine?.players.every((p) => p.lockable)).toBe(true);
    expect(v.rosters.filter((r) => !r.isMine).flatMap((r) => r.players).some((p) => p.lockable)).toBe(false);
    expect(v.freeAgents.flatMap((g) => g.players).some((p) => p.lockable)).toBe(false);
    expect(of(leagueFixture({ myTeamId: null })).rosters.flatMap((r) => r.players).some((p) => p.lockable)).toBe(false);
  });

  it("isn't on my taxi squad (no trade or drop reaches it)", () => {
    const f = leagueFixture({ myTeamId: "3" });
    const taxi = of(f).rosters.find((r) => r.teamId === "3")?.players.find((p) => p.group === "taxi");
    expect(taxi?.id).toBe("306");
    expect(taxi?.lockable).toBe(false);
    expect(row(f, "3", "301").lockable).toBe(true);
  });
});

describe("Expected back (item 3.5)", () => {
  it("says when my injured player is expected back and whose week it is: the platform's, our guess or the user's", () => {
    expect(returnWeekText(15, "platform", "espn")).toBe("week 15 (ESPN)");
    expect(returnWeekText(13, "model", "espn")).toBe("week 13 (our guess)");
    expect(returnWeekText(14, "user", "sleeper")).toBe("week 14 (your week)");
    expect(returnWeekText(null, "platform", "espn")).toBe("out for the season (ESPN)");
    expect(returnWeekText(null, "model", "sleeper")).toBe("out for the season (our guess)");
    const r = row(withReturn(ESPN_15), "1", "107").returnWeek;
    expect(r).toEqual({
      text: "Expected back: week 15 (ESPN)",
      userWeek: null,
      fallback: "week 15 (ESPN)",
      fallbackWeek: 15,
      // Next week through the league's last.
      weeks: [13, 14, 15, 16, 17],
      // The NFL's last week isn't in the fixture's schedule: the latest week a setting keeps, so it reads as out for the
      // season whatever that week turns out to be.
      outForSeason: 30,
      firstWeek: 12,
      help: returnWeekHelp(),
    });
    // The NFL's last week when known (ESPN's own marker is it + 1).
    const f = withReturn(ESPN_15);
    f.inputs = { ...f.inputs, nfl: { ...f.inputs.nfl, lastWeek: 18 } };
    expect(row(f, "1", "107").returnWeek?.outForSeason).toBe(19);
  });

  it("is on my players the model gives one only: never another team's, and nobody else of mine", () => {
    const f = withReturn(ESPN_15);
    const pm = f.model.players["206"];
    if (pm) f.model.players["206"] = { ...pm, expectedReturn: ESPN_15 };
    expect(row(f, "2", "206").returnWeek).toBeNull();
    expect(row(f, "1", "101").returnWeek).toBeNull();
    // No week left to set: the season is over.
    const over = withReturn(ESPN_15);
    over.model = { ...over.model, weeks: [] };
    expect(of(over).rosters.find((r) => r.isMine)?.players.find((p) => p.id === "107")?.returnWeek ?? null).toBeNull();
  });

  it("puts the line in his hover, and a week of the user's in the weeks he misses before it", () => {
    const platform = row(withReturn(ESPN_15), "1", "107");
    expect(platform.weeksText.split("\n")[0]).toBe("Expected back: week 15 (ESPN)");
    // The platform's date: the IR weeks keep their injury label, as before.
    expect(platform.weeks.map((w) => w.note)).toEqual(["Injured reserve", "Injured reserve", "Injured reserve", null, null, null]);
    const user = row(withReturn({ week: 14, source: "user", fallback: { week: 15, source: "platform" } }), "1", "107");
    expect(user.returnWeek?.text).toBe("Expected back: week 14 (your week)");
    expect(user.returnWeek?.userWeek).toBe(14);
    expect(user.returnWeek?.fallback).toBe("week 15 (ESPN)");
    expect(user.weeks.map((w) => w.note)).toEqual(["Out until wk 14 (your week)", "Out until wk 14 (your week)", "Out until wk 14 (your week)", null, null, null]);
    const season = row(withReturn({ week: null, source: "user", fallback: { week: 13, source: "model" } }), "1", "107");
    expect(season.returnWeek?.userWeek).toBe(30);
    expect(season.weeks[0]?.note).toBe("Out for the season (your week)");
  });

  it("says how a week of the user's counts, from the return-week rule's spread", () => {
    expect(config.projections.returnWeekSpread).toEqual([0.25, 0.5, 0.25]);
    expect(returnWeekHelp()).toBe(
      "Pick the week you expect him back if you know better. Offer Sheet then counts him out before that week, 75% likely to play that week and back the week after, in every number for your team, trade ideas included. It's kept in this browser only and clears once he's active again or the week has passed.",
    );
    expect(returnWeekHelp([0.1, 0.2, 0.4, 0.2, 0.1])).toContain("70% likely to play that week and back 2 weeks after");
    expect(returnWeekHelp([0, 1, 0])).toContain("counts him out before that week, back that week, in every number");
  });

  it("says in the Availability explainer that my injured players' weeks can be set, with a team of mine", () => {
    const text = (f: LeagueFixture) => of(f).explain.find((e) => e.title === "Availability")?.text ?? "";
    expect(text(leagueFixture())).toContain("On your roster, “Expected back” shows when each of your injured players should return, and you can set the week yourself if you know better.");
    expect(text(leagueFixture({ myTeamId: null }))).not.toContain("Expected back");
  });

  it("gives the schedule's bye rule the returner's week the engine used, a week of the user's included (returnWeekOf)", () => {
    // Fiddlesticks (IR, a returner the model lists with team 1) has a bye in week 14.
    const f = withReturn(ESPN_15);
    f.model.teams = f.model.teams.map((t) => (t.id === "1" ? { ...t, players: { ...t.players, "107": { mvLoseEv: 3, mvLoseScen: 3, autoAdd: null, surplusScore: 0 } } } : t));
    const pm = f.model.players["107"];
    if (!pm) throw new Error("fixture WR missing");
    const at = f.model.weeks.indexOf(14);
    f.model.players["107"] = { ...pm, weekly: pm.weekly.map((w, i) => (i === at ? { ...w, p: 0, a: 0, bye: true, sd: 0 } : w)) };
    const onBye = (expected: ExpectedReturn) => {
      const g: LeagueFixture = { ...f, model: { ...f.model, players: { ...f.model.players, "107": { ...(f.model.players["107"] as NonNullable<typeof pm>), expectedReturn: expected } } } };
      return scheduleByeRule(g.snapshot, g.model, "1", undefined).onBye("107", [14]);
    };
    // ESPN's week 15: he's on IR in week 14 anyway, so his bye then isn't my crunch.
    expect(onBye(ESPN_15)).toBe(false);
    // The user's week 13: he's back, so it is.
    expect(onBye({ week: 13, source: "user", fallback: { week: 15, source: "platform" } })).toBe(true);
    // Out for the season, or back only after the league's last week: never mine again.
    expect(onBye({ week: null, source: "user", fallback: { week: 15, source: "platform" } })).toBe(false);
    expect(onBye({ week: 18, source: "platform", fallback: { week: 18, source: "platform" } })).toBe(false);
  });
});

describe("returnWeekOptions: the select's choices", () => {
  const r: ReturnWeekRow = { text: "Expected back: week 15 (ESPN)", userWeek: null, fallback: "week 15 (ESPN)", fallbackWeek: 15, weeks: [13, 14, 15, 16, 17], outForSeason: 19, firstWeek: 12, help: "" };

  it("offers the platform's or our week first (clearing his), then next week through the league's last but that one, then out for the season", () => {
    const { options, selected } = returnWeekOptions(r, undefined);
    expect(selected).toBe("");
    // Review of wave C, UI-C-5: "week 15 (ESPN)" and "week 15" read alike, so ESPN's own week isn't offered twice.
    expect(options).toEqual([
      { value: "", text: "week 15 (ESPN)" },
      { value: "13", text: "week 13" },
      { value: "14", text: "week 14" },
      { value: "16", text: "week 16" },
      { value: "17", text: "week 17" },
      { value: "19", text: "out for the season" },
    ]);
    // Out for the season by the platform's word (or ours): "out for the season" isn't offered again either.
    const out = returnWeekOptions({ ...r, fallback: "out for the season (ESPN)", fallbackWeek: null }, undefined);
    expect(out.options.map((o) => o.value)).toEqual(["", "13", "14", "15", "16", "17"]);
    expect(returnWeekOptions({ ...r, fallbackWeek: null }, 19).options.at(-1)).toEqual({ value: "19", text: "out for the season (your week)" });
  });

  it("marks the user's week as his, and shows one it doesn't offer: this week now, past the league's last, or the platform's own", () => {
    expect(returnWeekOptions(r, 14)).toMatchObject({ selected: "14", options: expect.arrayContaining([{ value: "14", text: "week 14 (your week)" }]) });
    const now = returnWeekOptions(r, 12);
    expect(now.selected).toBe("12");
    expect(now.options[1]).toEqual({ value: "12", text: "week 12 (your week)" });
    const late = returnWeekOptions(r, 18);
    expect(late.selected).toBe("18");
    expect(late.options.map((o) => o.value)).toEqual(["", "13", "14", "16", "17", "18", "19"]);
    // A week of the user's that is ESPN's too (set when ESPN said another): shown as his.
    const same = returnWeekOptions(r, 15);
    expect(same.selected).toBe("15");
    expect(same.options.map((o) => o.text)).toEqual(["week 15 (ESPN)", "week 13", "week 14", "week 15 (your week)", "week 16", "week 17", "out for the season"]);
    for (const saved of [19, 25]) {
      const out = returnWeekOptions(r, saved);
      expect(out.selected).toBe("19");
      expect(out.options.at(-1)).toEqual({ value: "19", text: "out for the season (your week)" });
    }
  });

  it("reads a week that has passed, or one that isn't a whole week, as none", () => {
    expect(returnWeekOptions(r, 11).selected).toBe("");
    expect(returnWeekOptions(r, 13.5).selected).toBe("");
    expect(returnWeekOptions(r, 11).options).toEqual(returnWeekOptions(r, undefined).options);
  });

  it("never offers a week at or past the out-for-the-season one twice", () => {
    const short: ReturnWeekRow = { ...r, weeks: [13, 14, 15, 16, 17], outForSeason: 17 };
    expect(returnWeekOptions(short, undefined).options.map((o) => o.value)).toEqual(["", "13", "14", "16", "17"]);
  });
});
