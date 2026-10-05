/**
 * Server-side loader for the player ID crosswalk (CLAUDE.md §2.9, §2.10). Fetches through the
 * injected HttpClient, which paces each host and caches each checked response for 24 h:
 *
 *   Sleeper players DB   /v1/players/nfl?position=<P>&active=true for QB RB WR TE K P DEF DL LB DB
 *   DynastyProcess       db_playerids.csv
 *
 * FantasyCalc's /players, the third source until Checkpoint 7b, isn't asked any more: FantasyCalc's conditions for free
 * use (their reply of 2026-10-05, reports/fantasycalc-permission.md) allow only /values/current. It was the second source
 * for ESPN, MFL and Fleaflicker ids (src/data/crosswalk.ts ID_SOURCE_PRIORITY), so the crosswalk is now DynastyProcess's and
 * the Sleeper DB's, with the name match as the last resort as before (⚠️ measured offline on the 2026-10-05 cached bodies:
 * ESPN ids mapped 7,421 → 7,393, the 28 lost all players DynastyProcess doesn't list, 9 of them on an NFL team: deep
 * backups and rookies; MFL 6,445 → 6,415; Fleaflicker 930 → 520; the "same player" override of Sam Hartman's ESPN and MFL
 * ids is lost, so his ESPN id maps to DynastyProcess's wrong Sleeper id again, read as an inactive player; Parker's league
 * keeps 420 of its 421 players' ids, the one other a free agent the name match finds). The crosswalk then lists two
 * sources (CrosswalkData.fantasyCalcPlayers left out: not a source, never "unavailable").
 *
 * Built to degrade, never to block (review DATA-2):
 * - Every body is checked (shape and row floors) before it is cached. When a live fetch fails, a saved
 *   copy up to 7 days old stands in and status() says so. Requests retry once; Sleeper's lists stop
 *   at the first one Sleeper doesn't serve.
 * - A source that still fails is left out and reported through status() / warnings(); only when both
 *   fail does a build throw (SOURCE_DOWN).
 * - A crosswalk is served from memory for RESOLVER_MEMO_MS. After that the same crosswalk keeps being
 *   served while a new one builds in the background, and the new one takes over once it's built,
 *   unless it's worse (a source lost, or problems where there were none).
 * - A degraded build is retried after DEGRADED_MEMO_MS, doubling while it stays degraded (at most
 *   RESOLVER_MEMO_MS), so an outage costs a few requests an hour instead of a burst per import.
 * - Only the first build (nothing to serve yet) makes imports wait for it.
 *
 * The two hosts are fetched in parallel, one request at a time per host.
 */
import { LeagueImportError, type HttpClient } from "@/adapters/types";
import { HOUR, MINUTE } from "@/server/cache";
import { LATE, noteCut, withinDeadline } from "@/server/deadline";
import { resolverFromData, type CrosswalkSourceKey, type PlayerIdCrosswalk } from "./crosswalk";
import { fetchDynastyProcessIds } from "./dynastyProcess";
import { fetchSleeperPlayers, SLEEPER_PLAYER_POSITIONS, type SleeperPlayersLoad } from "./sleeperPlayers";
import { utcStamp } from "./source";

/**
 * A built crosswalk is reused in-process for this long before a rebuild starts, keyed by HttpClient
 * instance (reuse one client per server process). The HTTP cache keeps the network at one fetch a
 * day; this only saves re-parsing the cached bodies on every import.
 */
export const RESOLVER_MEMO_MS = HOUR;

/**
 * A degraded build (a source down, partly loaded or served from a saved copy) is rebuilt after this
 * long, doubling while it stays degraded (up to RESOLVER_MEMO_MS).
 */
export const DEGRADED_MEMO_MS = 10 * MINUTE;

/** How long a build is served before the next rebuild starts, after `degradedBuilds` degraded (or failed) builds in a row. */
export function rebuildDelayMs(degradedBuilds: number): number {
  if (degradedBuilds <= 0) return RESOLVER_MEMO_MS;
  return Math.min(RESOLVER_MEMO_MS, DEGRADED_MEMO_MS * 2 ** (degradedBuilds - 1));
}

interface MemoEntry {
  /** The crosswalk being served; undefined until the first build succeeds. */
  current?: PlayerIdCrosswalk;
  /** When the next rebuild is due (epoch ms). */
  refreshAt: number;
  /** The build in flight, shared by every caller. */
  building?: Promise<PlayerIdCrosswalk>;
  /** Degraded or failed builds in a row. */
  degradedBuilds: number;
}

const memo = new WeakMap<HttpClient, MemoEntry>();

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A source down, partly loaded, or standing in with a saved copy. */
function isDegraded(r: PlayerIdCrosswalk): boolean {
  return r.status().some((s) => !s.available || s.note !== undefined);
}

function availableSources(r: PlayerIdCrosswalk): number {
  return r.status().filter((s) => s.available).length;
}

/** Whether a new build takes over from the one being served: not when it lost a source, or has problems the current one hasn't. */
function takesOver(next: PlayerIdCrosswalk, current: PlayerIdCrosswalk): boolean {
  if (availableSources(next) < availableSources(current)) return false;
  return !isDegraded(next) || isDegraded(current);
}

function listNames(positions: readonly string[]): string {
  if (positions.length === SLEEPER_PLAYER_POSITIONS.length && SLEEPER_PLAYER_POSITIONS.every((p) => positions.includes(p))) return `all ${positions.length} lists`;
  return `the ${positions.join(", ")} list${positions.length > 1 ? "s" : ""}`;
}

function oldestOf(times: ReadonlyArray<number | undefined>): number | undefined {
  const known = times.filter((t): t is number => t !== undefined);
  return known.length ? Math.min(...known) : undefined;
}

/** "couldn't be refreshed, so our saved copy from 2026-09-28 01:11 UTC is used" (status note of a source served stale). */
function savedCopyNote(fetchedAt: number | undefined, what = "our saved copy", verb = "is"): string {
  return `couldn't be refreshed, so ${what}${fetchedAt !== undefined ? ` from ${utcStamp(fetchedAt)}` : ""} ${verb} used`;
}

/** Status note for the Sleeper players DB: lists served from saved copies, and lists that failed. */
function sleeperNote(load: SleeperPlayersLoad): string | undefined {
  const parts: string[] = [];
  const stale = load.staleLists;
  if (stale.length) {
    parts.push(savedCopyNote(oldestOf(stale.map((s) => s.fetchedAt)), `our saved cop${stale.length > 1 ? "ies" : "y"} of ${listNames(stale.map((s) => s.position))}`, stale.length > 1 ? "are" : "is"));
  }
  if (load.failed.length) parts.push(`${listNames(load.failed.map((f) => f.position))} could not be loaded (${load.failed[0]?.reason ?? "unknown error"})`);
  return parts.length ? parts.join("; ") : undefined;
}

async function buildFromSources(http: HttpClient, now: Date): Promise<PlayerIdCrosswalk> {
  const iso = now.toISOString();
  const [sleeper, dynasty] = await Promise.allSettled([fetchSleeperPlayers(http), fetchDynastyProcessIds(http)]);
  if (sleeper.status === "rejected" && dynasty.status === "rejected") {
    throw new LeagueImportError("SOURCE_DOWN", `Player ID sources are unavailable (${[sleeper.reason, dynasty.reason].map(reason).join("; ")}). Try again in a few minutes.`);
  }
  const notes: Partial<Record<CrosswalkSourceKey, string>> = {};
  const fromCache: Partial<Record<CrosswalkSourceKey, boolean>> = {};
  const fetchedAt: Partial<Record<CrosswalkSourceKey, string | null>> = {};
  const settle = (key: CrosswalkSourceKey, r: PromiseSettledResult<{ fromCache: boolean; fetchedAt?: number; stale?: boolean }>) => {
    if (r.status === "rejected") {
      notes[key] = reason(r.reason);
      return;
    }
    fromCache[key] = r.value.fromCache;
    // The client reports when a (possibly cached) body was fetched; unknown for other clients' cache entries.
    fetchedAt[key] = r.value.fetchedAt !== undefined ? new Date(r.value.fetchedAt).toISOString() : r.value.fromCache ? null : iso;
    if (r.value.stale) notes[key] = savedCopyNote(r.value.fetchedAt);
  };
  settle("sleeper", sleeper);
  settle("dynastyProcess", dynasty);
  const sleeperLoad = sleeper.status === "fulfilled" ? sleeper.value : undefined;
  const sleeperProblems = sleeperLoad ? sleeperNote(sleeperLoad) : undefined;
  if (sleeperProblems) notes.sleeper = sleeperProblems;
  // No FantasyCalc rows (see the header): left out, so the crosswalk doesn't name FantasyCalc as a source at all.
  return resolverFromData({
    sleeperPlayers: sleeperLoad ? sleeperLoad.players : null,
    sleeperCompletePositions: sleeperLoad ? sleeperLoad.complete : [],
    dynastyRows: dynasty.status === "fulfilled" ? dynasty.value.rows : null,
    fetchedAt,
    notes,
    fromCache,
  });
}

function startBuild(http: HttpClient, entry: MemoEntry, now: Date): Promise<PlayerIdCrosswalk> {
  const started = now.getTime();
  const build: Promise<PlayerIdCrosswalk> = buildFromSources(http, now)
    .then(
      (next) => {
        if (!entry.current || takesOver(next, entry.current)) entry.current = next;
        entry.degradedBuilds = isDegraded(next) ? entry.degradedBuilds + 1 : 0;
        entry.refreshAt = started + rebuildDelayMs(entry.degradedBuilds);
        return entry.current;
      },
      (err: unknown) => {
        // Nothing to serve yet: this import fails, and the next one tries again.
        if (!entry.current) throw err;
        entry.degradedBuilds += 1;
        entry.refreshAt = started + rebuildDelayMs(entry.degradedBuilds);
        return entry.current;
      },
    )
    .finally(() => {
      if (entry.building === build) entry.building = undefined;
    });
  entry.building = build;
  return build;
}

/**
 * The player ID resolver every adapter receives through ImportDeps. Signature relied on by the app
 * (src/adapters/types.ts): loadPlayerIdResolver(deps: { http; now? }): Promise<PlayerIdResolver>.
 * Waits only for the first build; after that it answers from memory and rebuilds in the background.
 */
export async function loadPlayerIdResolver(deps: { http: HttpClient; now?: Date }): Promise<PlayerIdCrosswalk> {
  const now = deps.now ?? new Date();
  let entry = memo.get(deps.http);
  if (!entry) {
    entry = { refreshAt: 0, degradedBuilds: 0 };
    memo.set(deps.http, entry);
  }
  if (entry.current) {
    // A background rebuild never rejects while there is a crosswalk to serve; the catch is belt and braces.
    if (now.getTime() >= entry.refreshAt && !entry.building) startBuild(deps.http, entry, now).catch(() => {});
    return entry.current;
  }
  if (!entry.building) return startBuild(deps.http, entry, now);
  // Another request's first build is in flight (Checkpoint 7a, review RL-1): wait for it no longer than this request's own
  // deadline (outside a request, as long as it takes), then answer that the player ID lists are still loading.
  const built = await withinDeadline(entry.building);
  if (built !== LATE) return built;
  noteCut("slow", "other");
  throw new LeagueImportError("SOURCE_DOWN", "the player ID lists are still loading");
}

/** The build in flight for this client (tests and scripts that want to wait for a background rebuild). */
export function resolverBuildInFlight(http: HttpClient): Promise<PlayerIdCrosswalk> | undefined {
  return memo.get(http)?.building;
}
