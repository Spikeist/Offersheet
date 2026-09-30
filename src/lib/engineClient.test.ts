/**
 * The engine client (CLAUDE.md §3: the engine runs in a Web Worker): replies are matched by request
 * id, errors reject, and the main thread takes over when there's no worker or it fails. A fake
 * worker stands in for the real one (Vitest runs in Node).
 */
import { describe, expect, it } from "vitest";
import type { LeagueModel } from "@/engine/leagueModel";
import type { EngineRequest, EngineResponse } from "@/workers/engine.worker";
import { ENGINE_STOPPED, EngineError, createEngineClient, type LeagueJob, type WorkerLike } from "./engineClient";

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: EngineRequest[] = [];
  terminated = false;
  postMessage(message: EngineRequest): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(response: unknown): void {
    this.onmessage?.({ data: response } as MessageEvent);
  }
  crash(): void {
    let prevented = false;
    this.onerror?.({ preventDefault: () => (prevented = true) } as unknown as ErrorEvent);
    if (!prevented) throw new Error("the client should handle the worker's error event");
  }
}

const result = (label: string) => ({ weeks: [4], label }) as unknown as LeagueModel;
const job = (myTeamId: string | null = "1"): LeagueJob => ({ snapshot: { leagueId: "4242" } as never, model: { version: 1 } as never, myTeamId, nowIso: "2026-09-30T02:00:00.000Z" });
const flush = () => new Promise((r) => setTimeout(r, 0));

function mainThreadRecorder() {
  const calls: EngineRequest[] = [];
  const run = async (request: EngineRequest): Promise<EngineResponse> => {
    calls.push(request);
    return { type: "league", id: request.id, result: result(`main ${request.id}`) };
  };
  return { calls, run };
}

describe("createEngineClient", () => {
  it("starts one worker on the first request and matches replies to requests by id", async () => {
    const worker = new FakeWorker();
    let made = 0;
    const client = createEngineClient({
      createWorker: () => {
        made++;
        return worker;
      },
    });
    expect(made).toBe(0);
    const a = client.buildLeague(job("1"));
    const b = client.buildLeague(job("2"));
    expect(made).toBe(1);
    expect(worker.posted.map((p) => [p.type, p.id, p.myTeamId])).toEqual([
      ["league", 1, "1"],
      ["league", 2, "2"],
    ]);
    // Replies arrive out of order; each settles its own request.
    worker.reply({ type: "league", id: 2, result: result("b") });
    worker.reply({ type: "league", id: 1, result: result("a") });
    await expect(a).resolves.toMatchObject({ label: "a" });
    await expect(b).resolves.toMatchObject({ label: "b" });
  });

  it("rejects with the engine's message, keeping the detail for the console", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const p = client.buildLeague(job());
    worker.reply({ type: "error", id: 1, message: "Something went wrong while crunching the numbers.", detail: "TypeError: boom" });
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect(err).toMatchObject({ message: "Something went wrong while crunching the numbers.", detail: "TypeError: boom" });
  });

  it("ignores replies nobody waits for, and anything that isn't a reply", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const p = client.buildLeague(job());
    worker.reply({ type: "league", id: 99, result: result("stray") });
    worker.reply("hello");
    worker.reply({ id: 1, type: "progress" });
    worker.reply({ type: "league", id: 1, result: result("mine") });
    await expect(p).resolves.toMatchObject({ label: "mine" });
  });

  it("runs on the main thread when the browser has no Worker", async () => {
    const main = mainThreadRecorder();
    const client = createEngineClient({ createWorker: () => null, runOnMainThread: main.run });
    await expect(client.buildLeague(job())).resolves.toMatchObject({ label: "main 1" });
    expect(main.calls.map((c) => c.id)).toEqual([1]);
  });

  it("runs on the main thread when the worker can't be created", async () => {
    const main = mainThreadRecorder();
    const client = createEngineClient({
      createWorker: () => {
        throw new Error("SecurityError");
      },
      runOnMainThread: main.run,
    });
    await expect(client.buildLeague(job())).resolves.toMatchObject({ label: "main 1" });
  });

  it("finishes pending requests on the main thread when the worker fails, and stays there", async () => {
    const worker = new FakeWorker();
    const main = mainThreadRecorder();
    let made = 0;
    const client = createEngineClient({
      createWorker: () => {
        made++;
        return worker;
      },
      runOnMainThread: main.run,
    });
    const a = client.buildLeague(job());
    worker.crash();
    await expect(a).resolves.toMatchObject({ label: "main 1" });
    expect(worker.terminated).toBe(true);
    await expect(client.buildLeague(job())).resolves.toMatchObject({ label: "main 2" });
    expect(made).toBe(1);
    expect(worker.posted).toHaveLength(1);
  });

  it("runs a request the worker can't take (not cloneable) on the main thread", async () => {
    const worker = new FakeWorker();
    worker.postMessage = () => {
      throw new Error("DataCloneError");
    };
    const main = mainThreadRecorder();
    const client = createEngineClient({ createWorker: () => worker, runOnMainThread: main.run });
    await expect(client.buildLeague(job())).resolves.toMatchObject({ label: "main 1" });
    expect(worker.terminated).toBe(false);
  });

  it("says so when the main-thread fallback itself fails", async () => {
    const client = createEngineClient({ createWorker: () => null, runOnMainThread: () => Promise.reject(new Error("ChunkLoadError")) });
    const err = await client.buildLeague(job()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).message).toMatch(/couldn't start the number cruncher/);
    expect((err as EngineError).detail).toContain("ChunkLoadError");
  });

  it("stops the worker on dispose: pending requests reject, late replies and new requests don't run", async () => {
    const worker = new FakeWorker();
    const client = createEngineClient({ createWorker: () => worker });
    const p = client.buildLeague(job());
    client.dispose();
    expect(worker.terminated).toBe(true);
    await expect(p).rejects.toMatchObject({ message: ENGINE_STOPPED });
    worker.reply({ type: "league", id: 1, result: result("late") });
    await expect(client.buildLeague(job())).rejects.toMatchObject({ message: ENGINE_STOPPED });
    expect(worker.posted).toHaveLength(1);
  });

  it("drops a main-thread result that finishes after dispose", async () => {
    let finish: (r: EngineResponse) => void = () => {};
    const client = createEngineClient({ createWorker: () => null, runOnMainThread: () => new Promise<EngineResponse>((r) => (finish = r)) });
    const p = client.buildLeague(job());
    const outcome = expect(p).rejects.toMatchObject({ message: ENGINE_STOPPED });
    client.dispose();
    finish({ type: "league", id: 1, result: result("late") });
    await flush();
    await outcome;
  });
});
