/**
 * The engine worker's `whatif` request (Checkpoint 7h; planner reply to Checkpoint 7g, section 4: the Trade Analyzer's "What
 * if"; evaluate.ts analyzeWhatIf): a request that crossed the message boundary is checked, answered on the Analyzer's own
 * evaluation context (the cached one when it holds: a what-if after an evaluation builds nothing new) with my odds before any
 * change, and its answer survives a worker's structured clone. A hand league (trade.testing.ts handLeague; made-up players).
 */
import { describe, expect, it } from "vitest";
import { analyzeWhatIf, buildTradeContext, type TradeContext, type WhatIfAnalysis } from "@/engine/evaluate";
import { defaultTradeSettings } from "@/engine/settings";
import { TEST_NOW } from "@/engine/testLeague";
import { handLeague } from "@/engine/trade.testing";
import { ENGINE_ERROR_MESSAGE, createEngineHandler, isWhatIfProposal, type AnalyzeRequest, type EngineResponse, type WhatIfRequest } from "./engine.worker";

const { snapshot, inputs } = handLeague();
const NOW = TEST_NOW.toISOString();
const whatIfReq = (id: number, proposal: WhatIfRequest["proposal"]): WhatIfRequest => ({ type: "whatif", id, snapshot, model: inputs, myTeamId: "1", nowIso: NOW, settings: defaultTradeSettings(), proposal });

describe("the worker's what-if request", () => {
  it("checks what crossed the message boundary: two lists of player ids", () => {
    expect(isWhatIfProposal({ remove: ["a"], add: [] })).toBe(true);
    expect(isWhatIfProposal({ remove: [], add: ["b", "c"] })).toBe(true);
    expect(isWhatIfProposal({ remove: [""], add: [] })).toBe(false);
    expect(isWhatIfProposal({ remove: ["a"] })).toBe(false);
    expect(isWhatIfProposal({ remove: [1], add: [] })).toBe(false);
    expect(isWhatIfProposal(null)).toBe(false);
    const posted: EngineResponse[] = [];
    const handle = createEngineHandler((r) => posted.push(r), {
      buildContext: () => {
        throw new Error("never built for a bad request");
      },
    });
    handle({ ...whatIfReq(3, { remove: [], add: [] }), proposal: { remove: "q1" } });
    expect(posted).toEqual([{ type: "error", id: 3, message: ENGINE_ERROR_MESSAGE, detail: "Not an engine request." }]);
  });

  it("answers with the engine's what-if and my odds before any change, on the context an evaluation built (fakes)", () => {
    const posted: EngineResponse[] = [];
    let built = 0;
    const ctx = { fake: true } as unknown as TradeContext;
    const answer: WhatIfAnalysis = { evaluation: null, illegal: "Testy McTest q9 isn't on your active roster or IR.", notes: [] };
    const calls: unknown[] = [];
    const handle = createEngineHandler((r) => posted.push(r), {
      buildContext: () => {
        built++;
        return ctx;
      },
      analyze: () => ({ evaluation: null, illegal: null, notes: [] }),
      whatIf: (c, p, o) => {
        calls.push([c, p, o?.settings?.goal]);
        return answer;
      },
      baseline: () => ({ pPlayoffs: 0.5, pTitle: 0.1, expWins: 4, prizes: { first: 0.1, second: 0.1, third: 0.1, weeklyHigh: 0, pointsLeader: 0 } }),
    });
    const analyze: AnalyzeRequest = { type: "analyze", id: 1, snapshot, model: inputs, myTeamId: "1", nowIso: NOW, settings: defaultTradeSettings(), proposal: { partnerId: "2", give: [], get: [{ kind: "player", id: "fw" }] } };
    handle(analyze);
    handle(whatIfReq(2, { remove: ["q9"], add: [] }));
    expect(built).toBe(1);
    expect(calls).toEqual([[ctx, { remove: ["q9"], add: [] }, "title"]]);
    expect(posted[1]).toEqual({ type: "whatif", id: 2, result: { ...answer, baseline: { pPlayoffs: 0.5, pTitle: 0.1, expWins: 4, prizes: { first: 0.1, second: 0.1, third: 0.1, weeklyHigh: 0, pointsLeader: 0 } } } });
  });

  it("with the real engine: the same answer analyzeWhatIf gives on a context of its own, surviving a structured clone", () => {
    const posted: EngineResponse[] = [];
    const handle = createEngineHandler((r) => posted.push(r));
    handle(whatIfReq(5, { remove: ["q1"], add: ["fw"] }));
    const reply = posted[0];
    expect(reply?.type).toBe("whatif");
    if (reply?.type !== "whatif") return;
    const own = analyzeWhatIf(buildTradeContext({ ...snapshot, myTeamId: "1" }, inputs, { now: TEST_NOW, settings: defaultTradeSettings() }), { remove: ["q1"], add: ["fw"] }, { settings: defaultTradeSettings() });
    const { baseline, ...rest } = structuredClone(reply.result);
    expect(rest).toEqual(own);
    expect(baseline?.pPlayoffs).toBeGreaterThan(0);
    expect(reply.result.evaluation?.dCH).toBeLessThan(0);
  });
});
