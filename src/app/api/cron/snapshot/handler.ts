/**
 * GET /api/cron/snapshot: the daily pre-game snapshots (planner reply to Checkpoint 7a, §6.3; what a run does and where it
 * goes: src/server/snapshots.ts). vercel.json schedules it ("0 20 * * *", UTC: on the Hobby plan it runs once a day,
 * sometime within that hour, and on production deployments only); route.ts wraps it in withRoute (another site's request
 * refused, the per-IP "cron" rate limit, the 110 s deadline, the log; never charged to the daily work budget).
 *
 * - The secret: Vercel sends "Authorization: Bearer <CRON_SECRET>" when the project has a CRON_SECRET variable
 *   (`npm run vercel:secret -- --live --name CRON_SECRET` gives production a random one, never shown). The header is
 *   compared with the expected one in constant time (their SHA-256 digests, so not even the length shows). Without a
 *   CRON_SECRET of 32+ characters, or with any other header, the answer is a bare 401: no body, nothing done, nothing
 *   revealed (not even whether a secret is set). A missing secret is logged once per process ("cron_secret_missing"); a
 *   wrong header isn't logged (someone guessing; the rate limit stops them).
 * - Then the store (snapshotStoreFor: Upstash on Vercel, the local archives in data-local/ elsewhere; none: 503
 *   { status: "no_store", reason }), and the run: 200 with what it did (statuses, weeks, days and format keys: public
 *   facts only), or { status: "locked" } when another run holds the lock (a duplicate delivery: 200, nothing done). A store
 *   that fails before the run starts (the lock) answers 503 { status: "failed", errorName }.
 * - One log line a run ("snapshot_run", its status as the code, and its time), so `npm run beta:log -- --live --env
 *   production` shows the cron ran.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { HttpClient } from "@/adapters/types";
import { errorNameOf, logEvent } from "@/server/log";
import { MIN_SECRET_CHARS } from "@/server/redis";
import { runSnapshots, snapshotStoreFor, type SnapshotRunDeps, type SnapshotRun, type SnapshotStore, type SnapshotStoreReason } from "@/server/snapshots";
import { getHttp } from "../../_lib/deps";
import { jsonResponse } from "../../_lib/respond";

type Env = Readonly<Record<string, string | undefined>>;

/** The variable Vercel reads to sign its cron requests (its own name). */
export const CRON_SECRET_ENV = "CRON_SECRET";

let secretMissingSaid = false;

const digest = (text: string): Buffer => createHash("sha256").update(text, "utf8").digest();

/** Whether the request carries "Authorization: Bearer <CRON_SECRET>" (see the header), in constant time. */
export function cronAuthorized(request: Request, env: Env = process.env): boolean {
  const secret = env[CRON_SECRET_ENV] ?? "";
  if (secret.length < MIN_SECRET_CHARS) {
    if (!secretMissingSaid) {
      secretMissingSaid = true;
      logEvent({ event: "cron_secret_missing" });
    }
    return false;
  }
  return timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`));
}

/** Test hook: say a missing secret again. */
export function resetCronSecretSaidForTests(): void {
  secretMissingSaid = false;
}

/** The bare refusal (see the header). */
function unauthorized(): Response {
  return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
}

export interface SnapshotCronOptions {
  /** Test hooks: the environment, the store, the HTTP client, the clock, the run and the timer. */
  env?: Env;
  store?: () => { store: SnapshotStore } | { reason: SnapshotStoreReason };
  http?: () => HttpClient;
  now?: () => Date;
  run?: (deps: SnapshotRunDeps) => Promise<SnapshotRun>;
  timer?: () => number;
}

export function createSnapshotCronHandler(opts: SnapshotCronOptions = {}): (request: Request) => Promise<Response> {
  return async function snapshotCron(request: Request): Promise<Response> {
    const env = opts.env ?? process.env;
    if (!cronAuthorized(request, env)) return unauthorized();
    const timer = opts.timer ?? (() => performance.now());
    const started = timer();
    const elapsed = () => Math.max(0, Math.round(timer() - started));
    const chosen = (opts.store ?? (() => snapshotStoreFor(env)))();
    if ("reason" in chosen) {
      logEvent({ event: "snapshot_no_store", code: chosen.reason.toUpperCase() });
      return jsonResponse({ status: "no_store", reason: chosen.reason }, { status: 503 });
    }
    let run: SnapshotRun;
    try {
      run = await (opts.run ?? runSnapshots)({ http: (opts.http ?? getHttp)(), store: chosen.store, now: (opts.now ?? (() => new Date()))() });
    } catch (err) {
      const errorName = errorNameOf(err);
      logEvent({ event: "snapshot_failed", errorName, ms: elapsed() });
      return jsonResponse({ status: "failed", errorName }, { status: 503 });
    }
    const ms = elapsed();
    logEvent({ event: "snapshot_run", code: run.status.toUpperCase(), ms });
    return jsonResponse({ ...run, ms });
  };
}
