/**
 * GET /api/cron/snapshot (planner reply to Checkpoint 7a, §6.3): the CRON_SECRET check (a bare 401 that reveals nothing),
 * the store's choice, the run's answer and its log line, and the schedule in vercel.json. The run itself: src/server/
 * snapshots.test.ts. No network.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpClient } from "@/adapters/types";
import { deadlineMsOf } from "@/server/deadline";
import { FakeRedis } from "@/server/redis";
import { sharedSnapshotStore, type SnapshotRun, type SnapshotRunDeps } from "@/server/snapshots";
import { createMemoryLimiter } from "@/server/rateLimit";
import { withRoute } from "../../_lib/route";
import { createSnapshotCronHandler, cronAuthorized, resetCronSecretSaidForTests } from "./handler";

vi.mock("server-only", () => ({}));

const SECRET = "c".repeat(43);
const ENV = { CRON_SECRET: SECRET };
const url = "https://offersheet.test/api/cron/snapshot";
const get = (headers: Record<string, string> = {}) => new Request(url, { headers });
const bearer = (s: string) => ({ authorization: `Bearer ${s}` });
const NO_HTTP: () => HttpClient = () => ({ get: () => Promise.reject(new Error("no network in tests")) });

const DONE: SnapshotRun = {
  status: "done",
  store: "shared",
  projections: { season: 2026, seasonType: "regular", currentWeek: 5, weeks: [{ week: 5, firstKickoff: "2026-10-09T00:15:00.000Z", status: "saved", replaced: ["QB"] }], warnings: [] },
  fantasyCalc: { day: "2026-10-07", inUse: 1, savedBefore: 0, lists: [{ format: "redraft-1qb-10team-ppr0.5", status: "saved" }], overCap: 0 },
};

let logs: string[];
beforeEach(() => {
  resetCronSecretSaidForTests();
  logs = [];
  vi.spyOn(console, "error").mockImplementation((line: unknown) => void logs.push(String(line)));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the CRON_SECRET check", () => {
  it("only the exact 'Bearer <CRON_SECRET>' passes", () => {
    expect(cronAuthorized(get(bearer(SECRET)), ENV)).toBe(true);
    for (const h of [{}, bearer(`${SECRET}x`), bearer(SECRET.slice(1)), { authorization: SECRET }, { authorization: `bearer ${SECRET}` }, bearer("")]) expect(cronAuthorized(get(h), ENV)).toBe(false);
  });

  it("without a CRON_SECRET of 32+ characters nothing passes, not even a matching header; said once in the log, by name", () => {
    const short = "s".repeat(31);
    expect(cronAuthorized(get(bearer(short)), { CRON_SECRET: short })).toBe(false);
    expect(cronAuthorized(get(bearer("")), {})).toBe(false);
    expect(cronAuthorized(get({ authorization: "Bearer undefined" }), {})).toBe(false);
    expect(logs.filter((l) => l.includes('"event":"cron_secret_missing"'))).toHaveLength(1);
    expect(logs.join("\n")).not.toContain(short);
  });

  it("refused: a bare 401, no body, the same whether the secret is wrong or missing; nothing runs and no store is chosen", async () => {
    const run = vi.fn();
    const store = vi.fn();
    for (const [env, headers] of [
      [ENV, {}],
      [ENV, bearer("wrong")],
      [{}, bearer(SECRET)],
    ] as const) {
      const res = await createSnapshotCronHandler({ env, run, store, http: NO_HTTP })(get(headers));
      expect(res.status).toBe(401);
      expect(await res.text()).toBe("");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(run).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
  });
});

describe("the run's answer", () => {
  it("authorized: the run on the chosen store and the injected client, its result with the time taken, and one log line", async () => {
    const redis = new FakeRedis();
    const seen: SnapshotRunDeps[] = [];
    const now = new Date("2026-10-07T20:05:00.000Z");
    let t = 0;
    const handler = createSnapshotCronHandler({
      env: ENV,
      store: () => ({ store: sharedSnapshotStore(redis, { env: { VERCEL_ENV: "production" } }) }),
      http: NO_HTTP,
      now: () => now,
      timer: () => (t += 250),
      run: async (deps) => {
        seen.push(deps);
        return DONE;
      },
    });
    const res = await handler(get(bearer(SECRET)));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ ...DONE, ms: 250 });
    expect(seen[0]?.store.kind).toBe("shared");
    expect(seen[0]?.now).toBe(now);
    expect(logs.filter((l) => l.includes('"event":"snapshot_run"'))).toEqual([JSON.stringify({ route: "server", event: "snapshot_run", code: "DONE", ms: 250 })]);
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("another run holds the lock: 200 { status: locked } (a duplicate delivery isn't a failure)", async () => {
    const res = await createSnapshotCronHandler({ env: ENV, store: () => ({ store: sharedSnapshotStore(new FakeRedis()) }), http: NO_HTTP, run: async () => ({ status: "locked", store: "shared" }) })(get(bearer(SECRET)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "locked", store: "shared" });
  });

  it("no store: 503 with the reason by name; a store that fails before the run: 503 with the error's name only", async () => {
    const none = await createSnapshotCronHandler({ env: ENV, store: () => ({ reason: "store_variables_missing" }), http: NO_HTTP })(get(bearer(SECRET)));
    expect(none.status).toBe(503);
    expect(await none.json()).toEqual({ status: "no_store", reason: "store_variables_missing" });
    const failing = await createSnapshotCronHandler({
      env: ENV,
      store: () => ({ store: sharedSnapshotStore(new FakeRedis()) }),
      http: NO_HTTP,
      run: async () => {
        throw Object.assign(new Error("https://user:secret@db.upstash.invalid"), { name: "UpstashError" });
      },
    })(get(bearer(SECRET)));
    expect(failing.status).toBe(503);
    const text = await failing.text();
    expect(JSON.parse(text)).toEqual({ status: "failed", errorName: "UpstashError" });
    expect(`${text}\n${logs.join("\n")}`).not.toContain("secret@");
  });

  it("through withRoute: a 'cron' route of its own (its rate limit and deadline), never charged to the work budget", async () => {
    const seen: number[] = [];
    const route = withRoute(
      "cron",
      createSnapshotCronHandler({ env: ENV, store: () => ({ store: sharedSnapshotStore(new FakeRedis()) }), http: NO_HTTP, run: async () => DONE }),
      { limiter: createMemoryLimiter(), work: { refusedAlready: () => null, charge: (units: number) => (seen.push(units), "ok") } as never, env: {} },
    );
    expect((await route(get(bearer(SECRET)))).status).toBe(200);
    expect((await route(get())).status).toBe(401);
    expect(seen).toEqual([]);
    expect(deadlineMsOf("cron")).toBe(110_000);
  });
});

describe("the schedule (vercel.json)", () => {
  it("one cron, daily at 20:00 UTC (Hobby runs crons at most once a day), on this route", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
    const config = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8")) as { crons?: Array<{ path: string; schedule: string }> };
    expect(config.crons).toEqual([{ path: "/api/cron/snapshot", schedule: "0 20 * * *" }]);
    // A daily expression: fixed minute and hour, every day.
    expect(config.crons?.[0]?.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
    expect(readFileSync(path.join(root, "src", "app", "api", "cron", "snapshot", "route.ts"), "utf8")).toMatch(/export const GET = withRoute\("cron"/);
  });
});
