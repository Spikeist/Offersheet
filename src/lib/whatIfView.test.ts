/**
 * The Trade Analyzer's "What if" in words (Checkpoint 7h; planner reply to Checkpoint 7g, section 4; src/lib/whatIfView.ts): the
 * mode and the address (player ids only), the picker (grouped by team and "Free agents", narrowed by where, a position and a
 * name, capped), and the result read from the real engine on a hand league (trade.testing.ts handLeague: made-up players,
 * placeholder teams): the planner's line about other teams, Helps you on the odds alone, the odds lines, the weekly line, the
 * ROS points and the roster moves in a change's words, and no trade value anywhere.
 */
import { describe, expect, it } from "vitest";
import { analyzeWhatIf, buildTradeContext, type WhatIfAnalysis } from "@/engine/evaluate";
import type { LeagueSnapshot } from "@/engine/model";
import { defaultTradeSettings, type TradeSettings } from "@/engine/settings";
import { TEST_NOW, type TestLeagueSpec } from "@/engine/testLeague";
import { flat, handLeague, type SeasonSpec } from "@/engine/trade.testing";
import { contextBaseline } from "@/workers/engine.worker";
import { HELPS_SCALE_TEXT, readAnalyzerDraft } from "./tradeView";
import {
  ANY_POSITION,
  ANY_SOURCE,
  DEFAULT_WHAT_IF_FILTER,
  EMPTY_WHAT_IF,
  FREE_AGENTS_SOURCE,
  WHAT_IF_MAX,
  WHAT_IF_ODDS_ONLY,
  WHAT_IF_OTHER_TEAMS,
  WHAT_IF_PROMPT,
  WHAT_IF_RESULTS_MAX,
  buildWhatIfView,
  modeQueryOf,
  readAnalyzerMode,
  readWhatIfDraft,
  searchText,
  whatIfChoices,
  whatIfDraftKey,
  whatIfHref,
  whatIfProposalOf,
  whatIfStatus,
  whatIfSummary,
  whatIfWords,
} from "./whatIfView";

/** A hand league (4 teams of 10, team "1" mine; one IR player and one taxi player on team 2). */
function league(edit: (spec: TestLeagueSpec) => void = () => undefined, season: SeasonSpec = {}) {
  return handLeague((spec) => {
    const two = spec.teams[1];
    if (two) {
      two.ir = [flat("ir2", "WR", 15, { injury: "IR", injuryReturnWeek: 7 })];
      two.taxi = [flat("tx2", "RB", 5)];
    }
    edit(spec);
  }, season);
}

/** The engine's answer with my odds before any change, as the worker sends it. */
function answer(proposal: { remove: string[]; add: string[] }, settings: TradeSettings = defaultTradeSettings(), built = league()): WhatIfAnalysis & { baseline: ReturnType<typeof contextBaseline> } {
  const ctx = buildTradeContext(built.snapshot, built.inputs, { now: TEST_NOW, scenarios: 0 });
  return { ...analyzeWhatIf(ctx, proposal, { settings }), baseline: contextBaseline(ctx) };
}

describe("the mode and the address (player ids only)", () => {
  const { snapshot } = league();

  it("reads the mode: ?mode=whatif, else a trade", () => {
    expect(readAnalyzerMode("mode=whatif&remove=q1")).toBe("whatif");
    expect(readAnalyzerMode("partner=2&give=q1")).toBe("trade");
    expect(readAnalyzerMode("")).toBe("trade");
    expect(readAnalyzerMode(null)).toBe("trade");
  });

  it("reads a what-if from the address: my players to take off, others' and free agents to put on, each once, at most WHAT_IF_MAX", () => {
    expect(readWhatIfDraft("mode=whatif&remove=q1&remove=wa2&add=fw&add=ra2&add=ir2&add=q1&add=fw&add=tx2&add=nobody", snapshot, "1")).toEqual({ remove: ["q1"], add: ["fw", "ra2", "ir2"] });
    // Not a what-if's address: none.
    expect(readWhatIfDraft("remove=q1&add=fw", snapshot, "1")).toEqual(EMPTY_WHAT_IF);
    const many = ["q1", "ra1", "rb1", "wa1", "wb1", "te1"].map((id) => `remove=${id}`).join("&");
    expect(readWhatIfDraft(`mode=whatif&${many}`, snapshot, "1").remove).toHaveLength(WHAT_IF_MAX);
  });

  it("writes it back the same way, with no team id", () => {
    const draft = { remove: ["q1", "wc1"], add: ["fw", "ra2"] };
    const href = whatIfHref(draft);
    expect(href).toBe("/analyzer?mode=whatif&remove=q1&remove=wc1&add=fw&add=ra2");
    expect(href).not.toMatch(/partner=/);
    expect(readWhatIfDraft(href.split("?")[1], snapshot, "1")).toEqual(draft);
  });

  it("keys a draft whatever the order picked; no proposal until a player is picked; says it in a sentence", () => {
    expect(whatIfDraftKey({ remove: ["b", "a"], add: ["d", "c"] })).toBe(whatIfDraftKey({ remove: ["a", "b"], add: ["c", "d"] }));
    expect(whatIfProposalOf(EMPTY_WHAT_IF)).toBeNull();
    expect(whatIfProposalOf({ remove: ["q1"], add: [] })).toEqual({ remove: ["q1"], add: [] });
    expect(whatIfSummary(EMPTY_WHAT_IF, snapshot)).toBeNull();
    expect(whatIfSummary({ remove: ["q1"], add: [] }, snapshot)).toBe("You take off Testy McTest q1; you put on nobody.");
    expect(whatIfSummary({ remove: [], add: ["fw", "ra2"] }, snapshot)).toBe("You take off nobody; you put on Testy McTest fw and Testy McTest ra2.");
    const jr: Pick<LeagueSnapshot, "players"> = { players: { ...snapshot.players, fw: { ...(snapshot.players.fw as NonNullable<LeagueSnapshot["players"][string]>), name: "Marvin Harrison Jr." } } };
    expect(whatIfSummary({ remove: [], add: ["fw"] }, jr)).toBe("You take off nobody; you put on Marvin Harrison Jr.");
  });
});

describe("each mode reads the address it last had (the review of Checkpoint 7h; WhatIfPanel.tsx useModeQuery)", () => {
  const { snapshot } = league();
  const trade = { partnerId: "2", give: ["q1"], get: ["ra2"] };
  const tradeAddress = "partner=2&give=q1&get=ra2";
  const whatIf = { remove: ["q1"], add: ["fw"] };
  const whatIfAddress = whatIfHref(whatIf).split("?")[1] as string;

  it("a card's Open in Analyzer, then a what-if evaluated, then back: the trade is still the card's, and the what-if its own", () => {
    let t = modeQueryOf("", tradeAddress, "trade");
    let w = modeQueryOf("", tradeAddress, "whatif");
    expect(readAnalyzerDraft(t, snapshot, "1")).toEqual(trade);
    expect(readWhatIfDraft(w, snapshot, "1")).toEqual(EMPTY_WHAT_IF);
    // The what-if's Evaluate writes its own address (history.replaceState): the trade keeps reading the one it had.
    t = modeQueryOf(t, whatIfAddress, "trade");
    w = modeQueryOf(w, whatIfAddress, "whatif");
    expect(readAnalyzerDraft(t, snapshot, "1")).toEqual(trade);
    expect(readWhatIfDraft(w, snapshot, "1")).toEqual(whatIf);
    // The trade evaluated again writes its address: the what-if keeps its own.
    t = modeQueryOf(t, tradeAddress, "trade");
    w = modeQueryOf(w, tradeAddress, "whatif");
    expect(readAnalyzerDraft(t, snapshot, "1")).toEqual(trade);
    expect(readWhatIfDraft(w, snapshot, "1")).toEqual(whatIf);
  });

  it("the mirror: a what-if opened from its address, then a trade evaluated, then back", () => {
    let w = modeQueryOf("", whatIfAddress, "whatif");
    let t = modeQueryOf("", whatIfAddress, "trade");
    expect(readWhatIfDraft(w, snapshot, "1")).toEqual(whatIf);
    expect(readAnalyzerDraft(t, snapshot, "1")).toEqual({ partnerId: null, give: [], get: [] });
    t = modeQueryOf(t, tradeAddress, "trade");
    w = modeQueryOf(w, tradeAddress, "whatif");
    expect(readWhatIfDraft(w, snapshot, "1")).toEqual(whatIf);
    expect(readAnalyzerDraft(t, snapshot, "1")).toEqual(trade);
  });

  it("a new address of a mode's own (another card's link, a reload) is read at once", () => {
    const other = "partner=3&give=wa1&get=wa3";
    expect(modeQueryOf(tradeAddress, other, "trade")).toBe(other);
    expect(modeQueryOf(whatIfAddress, "mode=whatif&remove=ra1", "whatif")).toBe("mode=whatif&remove=ra1");
    expect(modeQueryOf(tradeAddress, other, "whatif")).toBe(tradeAddress);
  });
});

describe("the picker", () => {
  const { snapshot } = league();

  it("offers my active roster and IR to take off, every other team and the free agents to put on; nothing listed until narrowed", () => {
    const c = whatIfChoices(snapshot, "1", EMPTY_WHAT_IF);
    expect(c.mine.map((p) => p.id)).toEqual(["q1", "ra1", "rb1", "rc1", "wa1", "wb1", "wc1", "te1", "k1", "d1"]);
    expect(c.sources).toEqual([
      { value: ANY_SOURCE, label: "Every team and free agents" },
      { value: "2", label: "Team 2" },
      { value: "3", label: "Team 3" },
      { value: "4", label: "Team 4" },
      { value: FREE_AGENTS_SOURCE, label: "Free agents" },
    ]);
    expect(c.positions.map((p) => p.value)).toEqual([ANY_POSITION, "QB", "RB", "WR", "TE", "K", "DEF"]);
    expect(c.groups).toEqual([]);
    expect(c.prompt).toBe(WHAT_IF_PROMPT);
    expect(c.limitText).toBe(`Up to ${WHAT_IF_MAX} players to take off and ${WHAT_IF_MAX} to put on, from the active rosters and IR or the free agents (players on a taxi squad can't be moved here).`);
  });

  it("lists one team's active roster and IR (an IR player saying so), never its taxi squad", () => {
    const c = whatIfChoices(snapshot, "1", EMPTY_WHAT_IF, { ...DEFAULT_WHAT_IF_FILTER, from: "2" });
    expect(c.groups.map((g) => g.name)).toEqual(["Team 2"]);
    const ids = c.groups[0]?.players.map((p) => p.id) ?? [];
    expect(ids).toContain("ir2");
    expect(ids).not.toContain("tx2");
    expect(c.groups[0]?.players.find((p) => p.id === "ir2")?.detail).toBe("WR · AAA · IR slot");
    expect(c.prompt).toBeNull();
  });

  it("narrows by position and by a name, accents, case and punctuation aside; groups by team then free agents", () => {
    const rbs = whatIfChoices(snapshot, "1", EMPTY_WHAT_IF, { ...DEFAULT_WHAT_IF_FILTER, pos: "RB" });
    expect(rbs.groups.map((g) => g.name)).toEqual(["Team 2", "Team 3", "Team 4", "Free agents"]);
    expect(rbs.groups.flatMap((g) => g.players.map((p) => snapshot.players[p.id]?.pos))).toEqual(Array(10).fill("RB"));
    const accented = league((spec) => {
      const fw = spec.freeAgents?.find((p) => p.id === "fw");
      if (fw) fw.name = "José Núñez-Ríos";
    }).snapshot;
    const found = whatIfChoices(accented, "1", EMPTY_WHAT_IF, { ...DEFAULT_WHAT_IF_FILTER, query: "  NUNEZ rios " });
    expect(found.groups).toEqual([{ id: FREE_AGENTS_SOURCE, name: "Free agents", players: [expect.objectContaining({ id: "fw", name: "José Núñez-Ríos" })] }]);
    expect(searchText("Ja'Marr  Chase")).toBe("ja marr chase");
    expect(whatIfChoices(snapshot, "1", EMPTY_WHAT_IF, { ...DEFAULT_WHAT_IF_FILTER, query: "zzz" }).none).toBe("No player matches.");
  });

  it("shows at most WHAT_IF_RESULTS_MAX at once, saying how many matched", () => {
    const big = league((spec) => {
      spec.freeAgents = [...(spec.freeAgents ?? []), ...Array.from({ length: 40 }, (_, i) => flat(`x${i}`, "WR", 1))];
    }).snapshot;
    const c = whatIfChoices(big, "1", EMPTY_WHAT_IF, { ...DEFAULT_WHAT_IF_FILTER, from: FREE_AGENTS_SOURCE });
    expect(c.groups.flatMap((g) => g.players)).toHaveLength(WHAT_IF_RESULTS_MAX);
    expect(c.more).toBe(`Showing ${WHAT_IF_RESULTS_MAX} of 46. Choose a team or a position, or type more of a name, to narrow it.`);
  });

  it("checks the players picked, names where each one put on is from, and disables the rest of a full side", () => {
    const draft = { remove: ["q1"], add: ["fw", "ra2", "ir2"] };
    const c = whatIfChoices(snapshot, "1", draft, { ...DEFAULT_WHAT_IF_FILTER, from: "2" });
    expect(c.mine.find((p) => p.id === "q1")?.checked).toBe(true);
    expect(c.picked.map((p) => [p.id, p.detail])).toEqual([
      ["fw", "WR · AAA · free agent"],
      ["ra2", "RB · AAA · from Team 2"],
      ["ir2", "WR · AAA · from Team 2's IR"],
    ]);
    expect(c.groups[0]?.players.find((p) => p.id === "ra2")?.checked).toBe(true);
    const full = whatIfChoices(snapshot, "1", { remove: [], add: ["fw", "ra2", "ir2", "fq"].slice(0, WHAT_IF_MAX) }, { ...DEFAULT_WHAT_IF_FILTER, from: "2" });
    if (WHAT_IF_MAX <= 4) expect(full.groups[0]?.players.filter((p) => !p.checked).every((p) => p.disabled)).toBe(true);
  });
});

describe("the result in words", () => {
  const { snapshot } = league();

  it("taking off a starter: the planner's line, Helps you on my odds alone, the odds before → after, the weekly line, the moves", () => {
    const view = buildWhatIfView(answer({ remove: ["q1"], add: [] }), snapshot);
    expect(view.otherTeams).toBe("Other teams don't change. To see a real trade, use the Analyzer with a partner.");
    expect(view.otherTeams).toBe(WHAT_IF_OTHER_TEAMS);
    expect(view.baseline).toMatch(/^Your odds before this change: \d+% to make the playoffs, \d+\.\d% to win the title\.$/);
    expect(view.baselineNote).toBe("As on the League page, they count the free-agent pickups that would help each team, and this change's odds start from them.");
    expect(view.helpsInfo).toBe(`Helps you (0–100) sums up how much your title and playoff odds rise. ${HELPS_SCALE_TEXT}`);
    const card = view.card;
    expect(card?.helps).toEqual({ value: "0", srText: null, title: HELPS_SCALE_TEXT });
    expect(card?.helpsNote).toBe(WHAT_IF_ODDS_ONLY);
    expect(card?.odds.map((o) => o.label)).toEqual(["Title odds", "Playoff odds"]);
    expect(card?.odds[0]?.value).toMatch(/^\d+\.\d% → \d+\.\d%$/);
    expect(card?.weekly?.label).toBe("Win chance by week");
    expect(card?.remove.map((a) => a.name)).toEqual(["Testy McTest q1"]);
    expect(card?.ros).toMatch(/^You put on 0 ROS pts, take off \d+$/);
    expect(card?.lineup).toMatch(/^−1\d\.\d pts a week in the regular season, −1\d(\.\d)? in the playoffs$/);
    expect(card?.moves).toEqual(["Open roster spot: add Testy McTest fq, the best available QB."]);
    expect(whatIfStatus(view)).toBe("Evaluated: Helps you 0.");
  });

  it("putting on a player: where he's from, his injury tag, the roster moves in a change's words (never “trade”)", () => {
    const view = buildWhatIfView(answer({ remove: [], add: ["ir2"] }), snapshot, { lastNflWeek: 18 });
    const card = view.card;
    expect(card?.add).toEqual([expect.objectContaining({ id: "ir2", detail: "WR · AAA · from Team 2's IR", status: { text: "On IR — expected back week 7", tone: "danger" } })]);
    expect(card?.injuryNote).toBe("Testy McTest ir2: his projection assumes he returns at full strength, blended with the trade market.");
    expect(card?.moves).toEqual(["Testy McTest ir2 goes to your IR slot (no roster spot until he's back).", "Week 7, when Testy McTest ir2 returns from IR: release Testy McTest wc1 (WR)."]);
    for (const line of [...(card?.moves ?? []), ...view.notes]) expect(line).not.toMatch(/trade\b/i);
  });

  it("says a trade's words of a change: “this trade” in any case reads “this change”", () => {
    expect(whatIfWords("Assumed with or without this trade: add Jake Ferguson, drop Romeo Doubs.")).toBe("Assumed with or without this change: add Jake Ferguson, drop Romeo Doubs.");
    expect(whatIfWords("This trade makes a waiver move worthwhile: add X (TE), drop Y (WR), whom this trade brings in.")).toBe(
      "This change makes a waiver move worthwhile: add X (TE), drop Y (WR), whom this change brings in.",
    );
    expect(whatIfWords("Make room on your roster: drop Stefon Diggs (WR, from this trade).")).toBe("Make room on your roster: drop Stefon Diggs (WR, from this change).");
  });

  it("under “Several prizes” paying 3rd place: the top-3 odds line and the before's top-3 chance", () => {
    const settings: TradeSettings = { ...defaultTradeSettings(), goal: "prizes" };
    const view = buildWhatIfView(answer({ remove: ["q1"], add: [] }, settings), snapshot);
    expect(view.card?.odds.map((o) => o.label)).toEqual(["Title odds", "Top 3 odds", "Playoff odds"]);
    expect(view.baseline).toMatch(/to finish in the top 3, /);
    expect(view.helpsInfo).toMatch(/^Helps you \(0–100\) sums up how much your chances at your league's prizes and your playoff odds rise\./);
  });

  it("a change that can't be made: why, and no card", () => {
    const view = buildWhatIfView(answer({ remove: ["ra2"], add: [] }), snapshot);
    expect(view.card).toBeNull();
    expect(view.illegal).toBe("Testy McTest ra2 isn't on your active roster or IR.");
    expect(view.otherTeams).toBeNull();
    expect(whatIfStatus(view)).toBe("This change can't be made: Testy McTest ra2 isn't on your active roster or IR.");
  });

  it("no trade value anywhere: distinctive FantasyCalc values never print", () => {
    const built = league();
    const market = built.inputs.market;
    if (!market) throw new Error("no market");
    const values = { ...market.values, q1: 7777, fw: 8888, ra2: 7777, fq: 8888 };
    const priced = { ...built, inputs: { ...built.inputs, market: { ...market, values, topValue: 9999 } } };
    const view = buildWhatIfView(answer({ remove: ["q1"], add: ["ra2"] }, defaultTradeSettings(), priced), priced.snapshot);
    const text = JSON.stringify(view);
    for (const v of ["7777", "7,777", "8888", "8,888", "9999", "9,999", "16665", "16,665"]) expect(text).not.toContain(v);
  });
});
