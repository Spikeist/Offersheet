/**
 * The engine client's "What if" (Checkpoint 7h; planner reply to Checkpoint 7g, section 4; engineClient.ts's header):
 * whatIf(job) sends a `whatif` request with the players taken off and put on, resolves with the worker's answer (replies
 * matched by id), and rejects with an EngineError on an error reply, another reply, or once the client is stopped. A fake
 * worker stands in (Vitest runs in Node).
 */
import { describe, expect, it } from "vitest";
import { defaultTradeSettings } from "@/engine/settings";
import type { EngineRequest, WhatIfResult } from "@/workers/engine.worker";
import { ENGINE_STOPPED, createEngineClient, type WhatIfJob, type WorkerLike } from "./engineClient";

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: EngineRequest[] = [];
  postMessage(message: EngineRequest): void {
    this.posted.push(message);
  }
  terminate(): void {}
  reply(response: unknown): void {
    this.onmessage?.({ data: response } as MessageEvent);
  }
}

const job: WhatIfJob = {
  snapshot: { leagueId: "4242" } as never,
  model: { version: 1 } as never,
  myTeamId: "1",
  nowIso: "2026-10-15T21:00:00.000Z",
  settings: defaultTradeSettings(),
  proposal: { remove: ["101"], add: ["202"] },
};
const answer = (illegal: string | null): WhatIfResult => ({ evaluation: null, illegal, notes: [], baseline: null });

describe("the client's what-if (Checkpoint 7h)", () => {
  it("sends the players taken off and put on, and resolves with the answer its own reply carries", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const pending = client.whatIf(job);
    expect(worker.posted[0]).toEqual({ type: "whatif", id: 1, ...job });
    worker.reply({ type: "whatif", id: 99, result: answer("not this one") });
    const want = answer("Testy McTest 101 isn't on your active roster or IR.");
    worker.reply({ type: "whatif", id: 1, result: want });
    await expect(pending).resolves.toEqual(want);
  });

  it("rejects with an EngineError on an error reply or another reply, and once the client is stopped", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const failing = client.whatIf(job);
    worker.reply({ type: "error", id: 1, message: "Something went wrong.", detail: "RangeError: nope" });
    await expect(failing).rejects.toMatchObject({ name: "EngineError", message: "Something went wrong.", detail: "RangeError: nope" });
    const odd = client.whatIf(job);
    worker.reply({ type: "analysis", id: 2, result: {} });
    await expect(odd).rejects.toMatchObject({ name: "EngineError" });
    const waiting = client.whatIf(job);
    client.dispose();
    await expect(waiting).rejects.toMatchObject({ name: "EngineError", message: ENGINE_STOPPED });
    await expect(client.whatIf(job)).rejects.toMatchObject({ name: "EngineError", message: ENGINE_STOPPED });
  });
});
