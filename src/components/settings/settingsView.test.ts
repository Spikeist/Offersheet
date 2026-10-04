/**
 * The Settings page's view logic (CLAUDE.md §14 item 6, §12 "User settings", §7 "Streaming positions"; lead
 * decision L12): which choices a league gets (streamable positions it starts, Win now ↔ Future and draft
 * picks only in dynasty and keeper leagues, the K/D/ST/IDP toggle named after what the league starts), the
 * player pickers (my roster for untouchables, every roster for must-include, stale players listed), the
 * warnings, and the edits (a player never on both lists, a position never both targeted and avoided).
 * A small made-up league; every name is invented.
 */
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import type { LeagueSnapshot, Pos, SlotDef } from "@/engine/model";
import { defaultTradeSettings, type TradeSettings } from "@/engine/settings";
import {
  GOAL_LABEL,
  LAMBDA_ESTIMATED_NOTE,
  PROTECT_VALUE_ESTIMATED_NOTE,
  applySettingsEdit,
  buildSettingsView,
  goalHelp,
  lambdaStart,
  lambdaText,
  startablePositions,
  type SettingsView,
} from "./settingsView";
import { LINEUP, PLAYERS, snapshot } from "./testFixtures";

const view = (settings: Partial<TradeSettings> = {}, opts: { myTeamId?: string | null; snap?: LeagueSnapshot; stored?: boolean; valuesEstimated?: boolean } = {}): SettingsView =>
  buildSettingsView({
    snapshot: opts.snap ?? snapshot(),
    myTeamId: opts.myTeamId === undefined ? "1" : opts.myTeamId,
    settings: { ...defaultTradeSettings(), ...settings },
    stored: opts.stored ?? false,
    ...(opts.valuesEstimated !== undefined ? { valuesEstimated: opts.valuesEstimated } : {}),
  });

const checked = <T>(choices: { value: T; checked: boolean }[]) => choices.filter((c) => c.checked).map((c) => c.value);
const okPlayers = (v: SettingsView) => {
  if (v.players.kind !== "ok") throw new Error("expected the player pickers");
  return v.players;
};

describe("the Trade Finder's minimum chance on this page (final review of Phase 4c, finding PAGES-5)", () => {
  it("is named in the league's card when saved settings hold one other than the default, with what Reset does to it; else nothing", () => {
    expect(config.ranking.minChanceDefault).toBe(0.1);
    expect(view({ minChance: 0.3 }, { stored: true }).finderMinimum).toBe("The Trade Finder's “Chance they accept: at least” is 30%, set on the Trade Finder. Reset to defaults sets it back to 10% too.");
    expect(view({ minChance: 0 }, { stored: true }).finderMinimum).toBe("The Trade Finder's “Chance they accept: at least” is Any, set on the Trade Finder. Reset to defaults sets it back to 10% too.");
    // The default, or no saved settings at all: nothing to say.
    expect(view({ minChance: 0.1 }, { stored: true }).finderMinimum).toBeNull();
    expect(view({ minChance: 0.3 }, { stored: false }).finderMinimum).toBeNull();
  });
});

describe("the league's choices", () => {
  it("offers the streamable positions the league starts, K and D/ST on by default (ESPN calls defenses D/ST)", () => {
    const v = view();
    expect(v.stream?.choices.map((c) => [c.value, c.label, c.checked])).toEqual([
      ["K", "Kicker (K)", true],
      ["DEF", "D/ST", true],
      ["QB", "Quarterback (QB)", false],
      ["TE", "Tight end (TE)", false],
    ]);
    expect(v.stream?.help).toContain(`the ${config.streaming.streamRank === 3 ? "3rd" : config.streaming.streamRank}-best free agent that week`);
    expect(v.stream?.help).toContain(`${config.streaming.detectAdds} or more players there this season`);
    expect(view({}, { snap: snapshot({ platform: "sleeper" }) }).stream?.choices.find((c) => c.value === "DEF")?.label).toBe("Team defense (DEF)");
  });

  it("leaves out positions the league doesn't start (no kicker here), and the whole group when none is left", () => {
    const noK = LINEUP.filter((s) => s.slot !== "K");
    expect(view({}, { snap: snapshot({ lineup: noK }) }).stream?.choices.map((c) => c.value)).toEqual(["DEF", "QB", "TE"]);
    const bare: SlotDef[] = [
      { slot: "RB", count: 2, eligible: ["RB"] },
      { slot: "WR", count: 2, eligible: ["WR"] },
    ];
    expect(view({}, { snap: snapshot({ lineup: bare }) }).stream).toBeNull();
    expect(startablePositions(snapshot())).toEqual(["QB", "RB", "WR", "TE", "K", "DEF"]);
  });

  it("offers playoff weights in quarter steps from 1× to 2×, the default marked, and a saved value off those steps", () => {
    const v = view();
    expect(v.playoffWeight.choices.map((c) => c.label)).toEqual(["1×", "1.25×", "1.5×", "1.75×", "2×"]);
    expect(checked(v.playoffWeight.choices)).toEqual([config.lineups.playoffWeight]);
    expect(v.playoffWeight.choices.find((c) => c.value === config.lineups.playoffWeight)?.detail).toBe("default");
    const odd = view({ playoffWeight: 1.1 });
    expect(odd.playoffWeight.choices.map((c) => c.label)).toEqual(["1×", "1.1×", "1.25×", "1.5×", "1.75×", "2×"]);
    expect(checked(odd.playoffWeight.choices)).toEqual([1.1]);
  });

  it("offers 1 to the allowed maximum players per side, the default marked", () => {
    const v = view({ maxPerSide: 3 });
    expect(v.maxPerSide.choices.map((c) => c.value)).toEqual(Array.from({ length: config.search.maxPerSideAllowed }, (_, i) => i + 1));
    expect(checked(v.maxPerSide.choices)).toEqual([3]);
    expect(v.maxPerSide.choices.find((c) => c.value === config.search.maxPerSide)?.detail).toBe("default");
  });

  it("shows Win now ↔ Future and draft picks only in dynasty and keeper leagues; keeper leagues say keeper costs aren't modeled", () => {
    const redraft = view();
    expect(redraft.lambda).toBeNull();
    expect(redraft.picks).toBeNull();
    const dynasty = view({}, { snap: snapshot({ leagueType: "dynasty" }) });
    expect(dynasty.lambda).toMatchObject({ automatic: true, value: config.benefit.lambda.bubble, keeperNote: null });
    expect(dynasty.lambda?.automaticText).toBe("Set from your playoff odds: later seasons count 35% when you're 50% or better to make the playoffs, 50% from 20% to 50%, and 75% below 20%.");
    expect(dynasty.picks).toMatchObject({ checked: false });
    const keeper = view({ lambda: 0.35, includePicks: true }, { snap: snapshot({ leagueType: "keeper" }) });
    expect(keeper.lambda).toMatchObject({ automatic: false, value: 0.35, valueText: "Mostly this season: later seasons count 35%" });
    expect(keeper.lambda?.keeperNote).toMatch(/isn't part of the score/);
    expect(keeper.lambda?.automaticText).toBe(`Later seasons count ${Math.round(config.benefit.lambda.keeper * 100)}% in a keeper league.`);
    expect(keeper.picks?.checked).toBe(true);
    expect(lambdaStart("keeper")).toBe(config.benefit.lambda.keeper);
  });

  it("offers 'Protect my trade value' (Low / Medium / High, Medium the default) in redraft leagues only (planner addendum to Checkpoint 3, §3)", () => {
    const redraft = view();
    expect(redraft.protectValue?.choices).toEqual([
      { value: "low", label: "Low", checked: false },
      { value: "medium", label: "Medium", detail: "default", checked: true },
      { value: "high", label: "High", checked: false },
    ]);
    expect(config.benefit.protectValueDefault).toBe("medium");
    expect(redraft.protectValue?.help).toBe(
      "How much Helps you counts trade value, so you keep some for later deals before your trade deadline: giving up more value than you get lowers it, getting more raises it. High protects your value the most; Low goes for the biggest lineup gain now. Your bench's worth as cover for injuries and byes counts either way.",
    );
    expect(checked(view({ protectValue: "high" }).protectValue?.choices ?? [])).toEqual(["high"]);
    // Dynasty and keeper leagues have no market term in Helps you (long-term value counts instead): no choice there.
    expect(view({}, { snap: snapshot({ leagueType: "dynasty" }) }).protectValue).toBeNull();
    expect(view({}, { snap: snapshot({ leagueType: "keeper" }) }).protectValue).toBeNull();
    // Plain words: no Greek letters or model terms.
    expect(JSON.stringify(redraft.protectValue)).not.toMatch(/κ|kappa|g_mkt|market term/i);
  });

  it("offers 'What matters most' (Win the title, the default / Balanced / Make the playoffs) in every league type, each with its weights from config (planner reply to Checkpoint 4b, change 8)", () => {
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const g = config.benefit.goals;
    const redraft = view();
    expect(redraft.goal.choices).toEqual([
      { value: "title", label: "Win the title", detail: "default", help: `Weighs your title odds most (${pct(g.title.title)}), playoff odds ${pct(g.title.playoffs)}.`, checked: true },
      { value: "balanced", label: "Balanced", help: `Weighs your title odds ${pct(g.balanced.title)} and your playoff odds ${pct(g.balanced.playoffs)}.`, checked: false },
      { value: "playoffs", label: "Make the playoffs", help: `Weighs your playoff odds most (${pct(g.playoffs.playoffs)}), title odds ${pct(g.playoffs.title)}.`, checked: false },
    ]);
    // The planner's words for the default, with today's config.
    expect(goalHelp("title")).toBe("Weighs your title odds most (85%), playoff odds 15%.");
    expect(config.benefit.goalDefault).toBe("title");
    expect(GOAL_LABEL).toEqual({ title: "Win the title", balanced: "Balanced", playoffs: "Make the playoffs" });
    // The numbers follow the weights given, never fixed ones.
    expect(goalHelp("playoffs", { playoffs: 0.6, title: 0.4 })).toBe("Weighs your playoff odds most (60%), title odds 40%.");
    expect(redraft.goal.help).toBe("Helps you scores a trade by how much it raises your title and playoff odds. This sets which of the two counts more.");
    expect(checked(view({ goal: "playoffs" }).goal.choices)).toEqual(["playoffs"]);
    // Dynasty and keeper leagues too: it weighs this season's part, and the help says where later seasons are set.
    for (const leagueType of ["dynasty", "keeper"] as const) {
      const v = view({ goal: "balanced" }, { snap: snapshot({ leagueType }) });
      expect(checked(v.goal.choices)).toEqual(["balanced"]);
      expect(v.goal.help).toBe(
        "For this season, Helps you scores a trade by how much it raises your title and playoff odds (how much later seasons count is set under Win now or build for the future). This sets which of the two counts more.",
      );
    }
    // Plain words: no Greek letters or model terms.
    expect(JSON.stringify(redraft.goal)).not.toMatch(/ΔPO|ΔCH|B_win|weight/i);
  });

  it("says Protect my trade value (redraft) and Win now ↔ Future (dynasty, keeper) change nothing while the league's values are our own estimates (FantasyCalc's curve fallback)", () => {
    expect(view().protectValue?.note).toBeNull();
    expect(view({}, { valuesEstimated: true }).protectValue?.note).toBe(PROTECT_VALUE_ESTIMATED_NOTE);
    expect(PROTECT_VALUE_ESTIMATED_NOTE).toBe(
      "For now this setting changes nothing: FantasyCalc isn't available, so this league's trade values are our own estimates, and Helps you leaves trade value out until FantasyCalc is back.",
    );
    expect(view({}, { snap: snapshot({ leagueType: "dynasty" }) }).lambda?.estimatedNote).toBeNull();
    for (const leagueType of ["dynasty", "keeper"] as const) expect(view({}, { snap: snapshot({ leagueType }), valuesEstimated: true }).lambda?.estimatedNote).toBe(LAMBDA_ESTIMATED_NOTE);
    // What matters most still counts then (the odds don't depend on trade values): no note.
    expect(JSON.stringify(view({}, { valuesEstimated: true }).goal)).not.toContain("FantasyCalc");
  });

  it("puts λ in words", () => {
    expect([0, 0.2, 0.5, 0.75, 1].map(lambdaText)).toEqual([
      "This season: later seasons count 0%",
      "Mostly this season: later seasons count 20%",
      "Balanced: later seasons count 50%",
      "Mostly the future: later seasons count 75%",
      "The future: later seasons count 100%",
    ]);
  });

  it("names the K/D/ST/IDP toggle after what the league starts, and hides it when it starts none", () => {
    expect(view().kDefIdp?.label).toBe("Include kickers and D/STs in trade ideas");
    const idp = [...LINEUP, { slot: "LB", count: 1, eligible: ["LB"] as Pos[] }, { slot: "DB", count: 1, eligible: ["DB"] as Pos[] }];
    expect(view({}, { snap: snapshot({ lineup: idp, platform: "sleeper" }) }).kDefIdp?.label).toBe("Include kickers, team defenses and IDP players in trade ideas");
    const offenseOnly = LINEUP.filter((s) => s.slot !== "K" && s.slot !== "D/ST");
    expect(view({}, { snap: snapshot({ lineup: offenseOnly }) }).kDefIdp).toBeNull();
  });

  it("offers target and avoid positions the search can use: K and D/ST only when they're included", () => {
    expect(view().positions.target.map((c) => c.value)).toEqual(["QB", "RB", "WR", "TE"]);
    const v = view({ includeKDefIdp: true, targetPositions: ["RB", "K"], avoidPositions: ["TE"] });
    expect(v.positions.target.map((c) => c.label)).toEqual(["QB", "RB", "WR", "TE", "K", "D/ST"]);
    expect(checked(v.positions.target)).toEqual(["RB", "K"]);
    expect(checked(v.positions.avoid)).toEqual(["TE"]);
    expect(v.positions.note).toBeNull();
  });

  it("warns when every saved target is a position trade ideas leave out (they'd find nothing)", () => {
    expect(view({ targetPositions: ["K"] }).positions.note).toMatch(/Your saved target positions \(K\) aren't in trade ideas here/);
    expect(view({ targetPositions: ["K", "RB"] }).positions.note).toBeNull();
  });

  it("names the league and says whether it has saved settings", () => {
    const v = view({}, { stored: true });
    expect(v.league).toEqual({ name: "The Made-Up League", platformLabel: "ESPN", season: 2026, typeLabel: "Redraft", dynastyOrKeeper: false });
    expect(v.stored).toBe(true);
  });
});

describe("the player pickers", () => {
  it("need my team: without it the page points to the Import Report", () => {
    expect(view({}, { myTeamId: null }).players).toEqual({ kind: "noTeam", text: expect.stringContaining("Pick your team on the Import Report") });
    expect(view({}, { myTeamId: "99" }).players.kind).toBe("noTeam");
  });

  it("list my players (roster and IR) by position then name for untouchables, with saved ones checked", () => {
    const p = okPlayers(view({ untouchables: ["103"] }));
    expect(p.untouchables.choices.map((c) => [c.label, c.detail, c.checked])).toEqual([
      ["Zed Quarterback", "QB · BUF", false],
      ["Abe Runner", "RB · DAL", false],
      ["Ira Injured", "RB · NYJ · IR", false],
      ["Cal Catcher", "WR · SEA", true],
      ["Wes Wideout", "WR · MIA", false],
      ["Bo Blocker", "TE · KC", false],
      ["Kip Kicker", "K · LV", false],
    ]);
    expect(p.untouchables.stale).toEqual([]);
  });

  it("list saved untouchables who left my team, so they can be removed", () => {
    const p = okPlayers(view({ untouchables: ["202", "555"] }));
    expect(p.untouchables.stale).toEqual([
      { id: "202", name: "Rex Rusher", detail: "RB · DET" },
      { id: "555", name: "A player who's no longer in this league's data", detail: "" },
    ]);
  });

  it("offer every rostered player for must-include, my team first, without the ones already chosen", () => {
    const p = okPlayers(view({ mustInclude: ["202"], untouchables: ["101"] }));
    expect(p.mustInclude.groups.map((g) => [g.label, g.options.map((o) => o.id)])).toEqual([
      ["Your team", ["101", "102", "107", "103", "106", "104", "105"]],
      ["Team Two", ["201", "203"]],
      ["Team Three", ["301", "302"]],
    ]);
    expect(p.mustInclude.groups[0]?.options[0]?.label).toBe("Zed Quarterback (QB · BUF · untouchable)");
    expect(p.mustInclude.groups[2]?.options[1]?.label).toBe("Ned Newbie (WR · no NFL team · taxi)");
    expect(p.mustInclude.chosen).toEqual([{ id: "202", name: "Rex Rusher", detail: "RB · DET", team: "Team Two" }]);
    expect(p.mustInclude.warnings).toEqual([]);
  });

  it("warn about must-include players from two other teams (a trade is with one team)", () => {
    const p = okPlayers(view({ mustInclude: ["202", "301", "102"] }));
    expect(p.mustInclude.warnings).toEqual([expect.stringContaining("players from Team Two and Team Three can't all be in one trade")]);
  });

  it("warn about more must-include players on a side than a trade allows", () => {
    const mine = okPlayers(view({ mustInclude: ["101", "102", "103"], maxPerSide: 2 }));
    expect(mine.mustInclude.warnings).toEqual(["You chose 3 of your players, but a trade idea has at most 2 per side."]);
    const theirs = okPlayers(view({ mustInclude: ["201", "202", "203"], maxPerSide: 2 }));
    expect(theirs.mustInclude.warnings).toEqual(["You chose 3 of their players, but a trade idea has at most 2 per side."]);
    expect(okPlayers(view({ mustInclude: ["201", "202", "203"], maxPerSide: 3 })).mustInclude.warnings).toEqual([]);
  });

  it("warn about a must-include player who isn't on a team any more, or one who's also untouchable", () => {
    const p = okPlayers(view({ mustInclude: ["901", "101"], untouchables: ["101"] }));
    expect(p.mustInclude.chosen.map((c) => [c.name, c.team])).toEqual([
      ["Fred Freeagent", "Not on a team"],
      ["Zed Quarterback", "Your team"],
    ]);
    expect(p.mustInclude.warnings).toEqual([
      "Fred Freeagent isn't on a team in this league any more, so no trade can include him. Remove him.",
      "Zed Quarterback is both untouchable and a must-include player. Remove him from one list.",
    ]);
  });
});

describe("applySettingsEdit", () => {
  const base = defaultTradeSettings();
  const name = (id: string) => PLAYERS.find((p) => p.id === id)?.name ?? id;

  it("toggles streamed positions, and sets the weight, λ (null = Automatic), players per side and the include flags", () => {
    expect(applySettingsEdit(base, { kind: "stream", pos: "QB", on: true }).settings.streamPositions).toEqual(["K", "DEF", "QB"]);
    expect(applySettingsEdit(base, { kind: "stream", pos: "K", on: false }).settings.streamPositions).toEqual(["DEF"]);
    expect(applySettingsEdit(base, { kind: "playoffWeight", value: 1.75 }).settings.playoffWeight).toBe(1.75);
    expect(applySettingsEdit(base, { kind: "lambda", value: 0.6 }).settings.lambda).toBe(0.6);
    expect(applySettingsEdit({ ...base, lambda: 0.6 }, { kind: "lambda", value: null }).settings.lambda).toBeNull();
    expect(applySettingsEdit(base, { kind: "maxPerSide", value: 3 }).settings.maxPerSide).toBe(3);
    expect(applySettingsEdit(base, { kind: "protectValue", value: "high" })).toEqual({ settings: { ...base, protectValue: "high" }, note: null });
    expect(applySettingsEdit(base, { kind: "goal", value: "playoffs" })).toEqual({ settings: { ...base, goal: "playoffs" }, note: null });
    expect(applySettingsEdit({ ...base, goal: "playoffs" }, { kind: "goal", value: "title" }).settings.goal).toBe("title");
    expect(applySettingsEdit({ ...base, protectValue: "high" }, { kind: "protectValue", value: "low" }).settings.protectValue).toBe("low");
    expect(applySettingsEdit(base, { kind: "includePicks", on: true }).settings.includePicks).toBe(true);
    expect(applySettingsEdit(base, { kind: "includeKDefIdp", on: true })).toEqual({ settings: { ...base, includeKDefIdp: true }, note: null });
  });

  it("normalizes: a value out of range falls back to the default, a position nobody can stream is ignored", () => {
    expect(applySettingsEdit(base, { kind: "playoffWeight", value: 4 }).settings.playoffWeight).toBe(config.lineups.playoffWeight);
    expect(applySettingsEdit(base, { kind: "maxPerSide", value: 7 }).settings.maxPerSide).toBe(config.search.maxPerSide);
    expect(applySettingsEdit(base, { kind: "stream", pos: "RB", on: true }).settings.streamPositions).toEqual(["K", "DEF"]);
    // A level that doesn't exist (an old page, a tampered store) falls back to the default.
    expect(applySettingsEdit(base, { kind: "protectValue", value: "extreme" as unknown as "high" }).settings.protectValue).toBe(config.benefit.protectValueDefault);
    expect(applySettingsEdit(base, { kind: "goal", value: "everything" as unknown as "title" }).settings.goal).toBe(config.benefit.goalDefault);
  });

  it("never leaves a player on both lists: marking one moves him, and says so", () => {
    const both = applySettingsEdit({ ...base, mustInclude: ["101"] }, { kind: "untouchable", id: "101", on: true }, name);
    expect(both.settings).toMatchObject({ untouchables: ["101"], mustInclude: [] });
    expect(both.note).toBe("Zed Quarterback is no longer a must-include player.");
    const back = applySettingsEdit(both.settings, { kind: "mustInclude", id: "101", on: true }, name);
    expect(back.settings).toMatchObject({ untouchables: [], mustInclude: ["101"] });
    expect(back.note).toBe("Zed Quarterback is no longer untouchable.");
    // Removing from one list leaves the other alone.
    expect(applySettingsEdit({ ...base, untouchables: ["102"], mustInclude: ["201"] }, { kind: "mustInclude", id: "201", on: false }).settings).toMatchObject({ untouchables: ["102"], mustInclude: [] });
  });

  it("never leaves a position both targeted and avoided", () => {
    const t = applySettingsEdit({ ...base, avoidPositions: ["TE"] }, { kind: "target", pos: "TE", on: true }, name, "espn");
    expect(t.settings).toMatchObject({ targetPositions: ["TE"], avoidPositions: [] });
    expect(t.note).toBe("TE is no longer avoided.");
    const a = applySettingsEdit(t.settings, { kind: "avoid", pos: "TE", on: true }, name, "espn");
    expect(a.settings).toMatchObject({ targetPositions: [], avoidPositions: ["TE"] });
    expect(a.note).toBe("TE is no longer a target.");
  });

  it("turning K, D/ST and IDP off clears them from target and avoid, so no hidden choice empties the search", () => {
    const on = { ...base, includeKDefIdp: true, targetPositions: ["K", "RB"] as Pos[], avoidPositions: ["DEF", "LB"] as Pos[] };
    const off = applySettingsEdit(on, { kind: "includeKDefIdp", on: false }, name, "espn");
    expect(off.settings).toMatchObject({ includeKDefIdp: false, targetPositions: ["RB"], avoidPositions: [] });
    expect(off.note).toBe("K, D/ST and LB are no longer targeted or avoided.");
    expect(applySettingsEdit({ ...base, includeKDefIdp: true }, { kind: "includeKDefIdp", on: false }).note).toBeNull();
  });

  it("returns new settings without changing the ones it was given", () => {
    const before = { ...base, untouchables: ["101"] };
    const copy = structuredClone(before);
    applySettingsEdit(before, { kind: "untouchable", id: "102", on: true });
    expect(before).toEqual(copy);
  });
});
