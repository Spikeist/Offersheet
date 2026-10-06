/**
 * A per-instance cap on League page model builds running at once (Checkpoint 7b load test, risk 3; the numbers:
 * src/server/limits.ts modelBuildLimits). In a cold burst every build waited on the same single-flight fetches and then
 * worked through the data in step, holding about 25–34 MB of heap each at once, so 50 cold builds on one instance kept
 * more than 1.27 GB live; Fluid compute can put that many concurrent requests on one instance.
 *
 * - At most `capacity` builds hold a slot at once (the model routes' handlers take one around buildInputs: src/app/api/
 *   model/{espn,sleeper}/handler.ts; a signed import already built on the instance, src/app/api/model/memo.ts, needs none).
 * - The others wait, served in the order their requests reached Offer Sheet (the HTTP client's queue rule, src/server/
 *   http.ts acquire: an API request by when it started, then its arrival number; an earlier request has less of its
 *   deadline left), each while more than `minTimeLeftMs` of its request's deadline is left (src/server/deadline.ts); then
 *   it gets null and its route answers BUSY (src/app/api/_lib/respond.ts buildsBusyResponse). A free slot is given at once,
 *   however little time is left (the build would have run before the cap too).
 * - Outside a request (scripts, tests) a waiter waits without a bound.
 * - Per instance, in memory: a slot is released when its build ends, whatever the answer (the handlers' finally).
 */
import { nextArrival, requestScope, timeLeftMs } from "./deadline";
import { modelBuildLimits } from "./limits";

export interface BuildSlots {
  /** A slot (its release: call it once, when the build is done), or null when none came free in time (see the header). */
  acquire(): Promise<(() => void) | null>;
  /** Builds holding a slot now (tests, measurements). */
  running(): number;
  /** Builds waiting for one now (tests, measurements). */
  waiting(): number;
}

/** One build waiting for a slot: its place (its request's start, then its arrival number) and how it's given one. */
interface Waiter {
  time: number;
  order: number;
  grant: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** Whether `a` is served before `b`: the request that reached Offer Sheet first (src/server/http.ts's rule). */
function before(a: Waiter, b: Waiter): boolean {
  return a.time < b.time || (a.time === b.time && a.order < b.order);
}

/** Slots for `capacity` builds at once (see the header). */
export function createBuildSlots(capacity: number = modelBuildLimits.concurrent, minTimeLeftMs: number = modelBuildLimits.minTimeLeftMs): BuildSlots {
  let busy = 0;
  const queue: Waiter[] = [];

  /** Gives free slots to the first waiters. */
  const dispatch = (): void => {
    while (busy < capacity && queue.length) {
      const next = queue.shift() as Waiter;
      if (next.timer) clearTimeout(next.timer);
      busy++;
      next.grant();
    }
  };

  /** A slot's release: the first call frees it (for the next waiter); later calls do nothing. */
  const releaseOf = (): (() => void) => {
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      busy--;
      dispatch();
    };
  };

  return {
    running: () => busy,
    waiting: () => queue.length,
    acquire() {
      if (busy < capacity && !queue.length) {
        busy++;
        return Promise.resolve(releaseOf());
      }
      const waitMs = timeLeftMs() - minTimeLeftMs;
      if (!(waitMs > 0)) return Promise.resolve(null);
      const scope = requestScope();
      return new Promise<(() => void) | null>((resolve) => {
        const me: Waiter = { time: scope?.startedAt ?? Date.now(), order: scope?.order ?? nextArrival(), grant: () => resolve(releaseOf()) };
        const at = queue.findIndex((w) => before(me, w));
        queue.splice(at < 0 ? queue.length : at, 0, me);
        if (waitMs !== Number.POSITIVE_INFINITY) {
          me.timer = setTimeout(() => {
            const i = queue.indexOf(me);
            if (i >= 0) queue.splice(i, 1);
            resolve(null);
          }, waitMs);
        }
        dispatch();
      });
    },
  };
}

let processSlots: BuildSlots | undefined;

/** The process's slots (one per server instance; both model routes share them). */
export function modelBuildSlots(): BuildSlots {
  processSlots ??= createBuildSlots();
  return processSlots;
}
