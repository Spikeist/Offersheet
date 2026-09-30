/**
 * Shares an in-flight request between the effects that want it, so the League page asks the server
 * once (CLAUDE.md §0.9 and §2.10: every model request fetches from Sleeper and FantasyCalc on a cold
 * cache). React StrictMode mounts, unmounts and mounts again in development, and an effect can re-run
 * while its request is still out: the second effect joins the request already under way instead of
 * sending another.
 *
 * When the last one waiting leaves (the page unmounted), the request is aborted, a tick later: a
 * remount in the same tick (StrictMode's) joins it again first. A settled request is forgotten at
 * once, so the next join (a Try again) asks again. Client-safe, no React.
 */

export interface JoinedRequest<T> {
  readonly promise: Promise<T>;
  /** Stop waiting (once; later calls do nothing). The request is aborted when nobody waits for it any more. */
  leave(): void;
}

export interface RequestSharer<T> {
  /** The request in flight under `key`, or a new one: `start` is called with the signal that aborts it. */
  join(key: string, start: (signal: AbortSignal) => Promise<T>): JoinedRequest<T>;
  /** Requests in flight (for tests). */
  readonly size: number;
}

interface Entry<T> {
  promise: Promise<T>;
  controller: AbortController;
  waiting: number;
}

/** `later` runs a check after the current tick (a timer by default; tests pass their own). */
export function createRequestSharer<T>(later: (check: () => void) => void = (check) => void setTimeout(check, 0)): RequestSharer<T> {
  const inFlight = new Map<string, Entry<T>>();

  function begin(key: string, start: (signal: AbortSignal) => Promise<T>): Entry<T> {
    const controller = new AbortController();
    let promise: Promise<T>;
    try {
      promise = start(controller.signal);
    } catch (err) {
      promise = Promise.reject(err);
    }
    const entry: Entry<T> = { promise, controller, waiting: 0 };
    const forget = () => {
      if (inFlight.get(key) === entry) inFlight.delete(key);
    };
    promise.then(forget, forget);
    inFlight.set(key, entry);
    return entry;
  }

  return {
    join(key, start) {
      const entry = inFlight.get(key) ?? begin(key, start);
      entry.waiting++;
      let left = false;
      return {
        promise: entry.promise,
        leave() {
          if (left) return;
          left = true;
          entry.waiting--;
          later(() => {
            if (entry.waiting > 0 || inFlight.get(key) !== entry) return;
            inFlight.delete(key);
            entry.controller.abort();
          });
        },
      };
    },
    get size() {
      return inFlight.size;
    },
  };
}
