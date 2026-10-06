"use client";
/**
 * The imported league and its model inputs, as the League page, the Trade Finder and the Trade Analyzer load
 * them (CLAUDE.md §14 items 3–5; Phase 4 wave 2 decision M13: the trade pages share the League page's loading
 * rather than copy it). It gets the league's model inputs (projections and values, §6 and §9) from this page view's
 * latest answer, else the stored copy (reused only while under 6 hours old: modelStore.ts MODEL_REUSE_MAX_AGE_MS),
 * else the server, and resolves "my team" the way every page does (the user's pick, else the platform's:
 * src/lib/myTeam.ts).
 *
 * Phase 4c (planner reply to Checkpoint 4b, change 11): saved leagues live in the league store (IndexedDB,
 * src/lib/leagueStore.ts). The pages read the league this tab shows with useCurrentLeague (undefined while the store
 * loads: never a flash of "No league imported yet"), the switcher's list with useSavedLeagues, where leagues are kept
 * with useLeagueStorage, and the league's inputs with useSavedLeagueInputs (the stored copy is the league's own, so
 * another league's never stands in).
 *
 * One request at a time: the model request is shared by key (sharedRequest.ts), so React StrictMode's mount →
 * unmount → mount in development sends one, and it's aborted once the page is gone. A model response is kept for its
 * saved league (leagueStore.ts keepModelResponse: a newer snapshot replaces the stored import, keeping the team pick);
 * whatever the browser refuses to store, the page still has in memory. React state is only set in async callbacks (the
 * react-hooks lint rules).
 */
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueSnapshot } from "@/engine/model";
import type { ImportResponse, ModelResponse } from "@/lib/api";
import type { MyTeamPick, StoredImport } from "@/lib/importStore";
import { loadModelInputs } from "@/lib/leagueFetch";
import {
  currentLeagueFrom,
  currentLeaguePartsOf,
  leagueStore,
  useLeagueStoreState,
  type CurrentLeagueRead,
  type SavedLeaguesRead,
  type StorageStatus,
} from "@/lib/leagueStore";
import { importWithImportedTeam, modelForSnapshot, modelKey, withImportedTeam, type StoredModel } from "@/lib/modelStore";
import { resolveMyTeam, type ResolvedMyTeam } from "@/lib/myTeam";
import { createRequestSharer, type JoinedRequest } from "./sharedRequest";

// ---------------------------------------------------------------------------------------------
// Phase 4c: the league store

/**
 * The league this tab shows (leagueStore.ts CurrentLeagueRead): "ok" with its import and "my team" pick, "outdated"
 * (saved by an earlier version: the page asks for it again, naming it when it can), or "none"; undefined while the store
 * (or that league's import) loads.
 */
export function useCurrentLeague(): CurrentLeagueRead | undefined {
  const parts = currentLeaguePartsOf(useLeagueStoreState());
  const { ready, league, loaded, pick, outdatedTabImport } = parts;
  return useMemo(() => currentLeagueFrom({ ready, league, loaded, pick, outdatedTabImport }), [ready, league, loaded, pick, outdatedTabImport]);
}

/** The saved leagues in the switcher's order and the one this tab shows; undefined while the store loads. */
export function useSavedLeagues(): SavedLeaguesRead | undefined {
  const { status, leagues, currentId } = useLeagueStoreState();
  return useMemo(() => (status === "ready" ? { leagues, currentId } : undefined), [status, leagues, currentId]);
}

/**
 * Where saved leagues are kept for this page (leagueStore.ts StorageStatus): IndexedDB; this page's memory (a banner
 * should say they last only until the page closes: its `message`); or gone while the page was open (reload: its
 * `message`). Undefined while the store loads.
 */
export function useLeagueStorage(): StorageStatus | undefined {
  const { status, storage } = useLeagueStoreState();
  return status === "ready" ? storage : undefined;
}

/** A saved league's stored model inputs (whatever league data they were built for): null when none, undefined while loading. */
export function useSavedModel(id: string): StoredModel | null | undefined {
  const { status, models } = useLeagueStoreState();
  return status === "ready" ? models.get(id) : undefined;
}

/** The league's model inputs and "my team" for the league this tab shows (useCurrentLeague's "ok"; see the header). */
export function useSavedLeagueInputs(current: Extract<CurrentLeagueRead, { kind: "ok" }>): LeagueInputs {
  const id = current.league.id;
  const storedModel = useSavedModel(id);
  return useInputsCore(current.stored, storedModel, current.pick, {
    keep: (response) => {
      void leagueStore()?.keepModelResponse(id, { response, savedAt: new Date().toISOString() });
    },
    keepImport: (imported) => {
      void leagueStore()?.keepImport(id, { response: imported, savedAt: new Date().toISOString() });
    },
  });
}

// ---------------------------------------------------------------------------------------------
// The inputs: shared by the pages

/**
 * A model request's outcome (src/lib/leagueFetch.ts ModelOutcome): the import and its inputs, or why not; a failure after the
 * league was read again carries that fresh import (`import`), which the page keeps (useInputsCore; review of Phase 7b).
 */
export type InputsOutcome = { ok: true; response: ModelResponse } | { ok: false; message: string; import?: ImportResponse };

/** A league's data as one tag: which league, and which fetch of it. */
export const leagueTag = (s: Pick<LeagueSnapshot, "platform" | "leagueId" | "season" | "fetchedAt">) => `${modelKey(s)}|${s.fetchedAt}`;

/** A page's model request for a league's data (leagueTag) on its `attempt`-th try: what a failure is filed under. */
const fetchTagOf = (requestTag: string, attempt: number) => `${requestTag}|${attempt}`;

/** The pages' model requests in flight, shared by league and league data (see the header). */
const inputRequests = createRequestSharer<InputsOutcome>();

/** What the pages say when a model request ended without an answer (no connection, or something unexpected). */
export const INPUTS_UNREACHABLE = "We couldn't reach Offer Sheet. Check your connection and try again.";

/**
 * A model request's outcome, never a rejection (review E2E-1): a request that throws reads as INPUTS_UNREACHABLE, so the
 * League page's Refresh always ends (its button never stays "Refreshing…"). Not for a request with a signal: a page that
 * left must not be told it couldn't reach Offer Sheet.
 */
export async function settledInputs(request: Promise<InputsOutcome>): Promise<InputsOutcome> {
  try {
    return await request;
  } catch {
    return { ok: false, message: INPUTS_UNREACHABLE };
  }
}

/**
 * The model request for the stored import that is already in flight, or a new one (a page load's,
 * never Refresh's): React StrictMode's second mount joins the first's, and it's aborted once every
 * page that joined it has left.
 */
export function joinInputsRequest(stored: StoredImport): JoinedRequest<InputsOutcome> {
  return inputRequests.join(`model ${leagueTag(stored.response.snapshot)}`, (signal) => requestInputs(stored, false, signal));
}

/**
 * The stored import's model inputs (src/lib/leagueFetch.ts loadModelInputs; Part B, track BF): the import sent back
 * signed while its data is fresh, else read again first (by this browser where it can), or today's request where the
 * server reads it (with the Sleeper username it was imported with, so the re-import finds the user's team). `signal`
 * aborts it.
 */
export async function requestInputs(stored: StoredImport, refresh: boolean, signal?: AbortSignal): Promise<InputsOutcome> {
  return loadModelInputs(stored, { refresh, ...(signal ? { signal } : {}) });
}

/** Model inputs fetched in this page view (kept in memory too, in case the browser won't store them). */
interface Fetched {
  /** The stored-import tags this answers: the one it was asked for, and its own snapshot's. */
  tags: string[];
  snapshot: LeagueSnapshot;
  inputs: ModelInputs;
}

export interface LeagueInputs {
  /** The league data and its model inputs, once there are any (the newest snapshot: a fetch may bring a newer one). */
  pair: { snapshot: LeagueSnapshot; inputs: ModelInputs } | null;
  /** "My team" in that snapshot (null until there's a pair). */
  myTeam: ResolvedMyTeam | null;
  /** Why the inputs couldn't be loaded (no pair, the last fetch failed); null otherwise. */
  error: string | null;
  /** Fetch the inputs again after a failure (Try again). */
  retry(): void;
  /** The Refresh button: the inputs again with refresh (the server fetches data over a minute old); kept on success. Never rejects. */
  refreshInputs(): Promise<InputsOutcome>;
}

/** A page load's failed model request (inputsFailure): the error and the fetch tags it answers, and the import to keep. */
export interface InputsFailure {
  error: { tags: string[]; message: string };
  kept: ImportResponse | null;
}

/**
 * A page load's failed model request (useInputsCore; pure): the error, under this fetch's tag (`tag`, `attempt`); with an
 * import read again (InputsOutcome.import), that import to keep (after importWithImportedTeam: the stored import's team
 * carries over, as an answer's does) and its tag with the same attempt too, the tag the page asks under once the store shows
 * it, so the error stays and nothing is asked until Try again (review of Phase 7b).
 */
export function inputsFailure(x: { tag: string; attempt: number; message: string; imported: ImportResponse | undefined; stored: StoredImport }): InputsFailure {
  if (!x.imported) return { error: { tags: [x.tag], message: x.message }, kept: null };
  const kept = importWithImportedTeam(x.imported, x.stored);
  return { error: { tags: [x.tag, fetchTagOf(leagueTag(kept.snapshot), x.attempt)], message: x.message }, kept };
}

/** How a page keeps what its model requests bring (useInputsCore): an answer, and an import read again whose numbers failed. */
interface InputsKeepers {
  keep: (response: ModelResponse) => void;
  keepImport: (imported: ImportResponse) => void;
}

/**
 * The inputs for a stored import, from this page view's latest answer, else `storedModel` (when it was built for this
 * very snapshot and is still fresh), else the server; `keep` stores an answer (after withImportedTeam: the team the
 * platform found at import carries over). `storedModel` is undefined while it hasn't been read (nothing is fetched yet).
 * A page load's request that read the league again and then failed (the model route BUSY under load, say) brings that
 * fresh import (InputsOutcome.import): `keepImport` stores it (the same team rule), so Try again sends it back signed, one
 * build, instead of reading the league again (review of Phase 7b). The error is filed under the kept import's tag too, so
 * the newer import the store then shows waits for Try again rather than asking at once (under the load that refused it).
 * Refresh keeps no such import: its numbers stay on screen, and its next press reads the league again anyway.
 */
function useInputsCore(stored: StoredImport, storedModel: StoredModel | null | undefined, pick: MyTeamPick | undefined, keepers: InputsKeepers): LeagueInputs {
  const { keep, keepImport } = keepers;
  const snapshot = stored.response.snapshot;
  const requestTag = leagueTag(snapshot);
  // When the page opened: stored inputs built over MODEL_REUSE_MAX_AGE_MS before it are fetched again.
  const [openedAt] = useState(() => Date.now());
  // undefined while storage hasn't been read; null when nothing stored (and fresh) matches this snapshot.
  const storedInputs = useMemo(
    () => (storedModel === undefined ? undefined : (modelForSnapshot(storedModel ?? undefined, snapshot, { now: openedAt }) ?? null)),
    [storedModel, snapshot, openedAt],
  );

  // This page view's latest answer, else the stored copy, else fetch.
  const [fetched, setFetched] = useState<Fetched | null>(null);
  // The fetch tags a failure answers: its own, and the kept import's (see above).
  const [fetchError, setFetchError] = useState<{ tags: string[]; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // fetchTagOf's format, written out: the React Compiler can't tell the tag (a string) from an object a call might change.
  const fetchTag = `${requestTag}|${attempt}`;
  const pair = useMemo(() => {
    if (fetched && fetched.tags.includes(requestTag)) return { snapshot: fetched.snapshot, inputs: fetched.inputs };
    if (storedInputs) return { snapshot, inputs: storedInputs };
    return null;
  }, [fetched, requestTag, storedInputs, snapshot]);
  const fetchFailed = fetchError !== null && fetchError.tags.includes(fetchTag);
  const needFetch = storedInputs !== undefined && !pair && !fetchFailed;

  /** Keeps an answer (in memory for this page view, and stored) and says which stored-import tags it answers. */
  const remember = (response: ModelResponse): Fetched => {
    const res = withImportedTeam(response, stored);
    keep(res);
    return { tags: [requestTag, leagueTag(res.import.snapshot)], snapshot: res.import.snapshot, inputs: res.model };
  };

  /** A failure (inputsFailure), its import kept when it brought one. */
  const failed = (tag: string, n: number, message: string, imported: ImportResponse | undefined): InputsFailure["error"] => {
    const f = inputsFailure({ tag, attempt: n, message, imported, stored });
    if (f.kept) keepImport(f.kept);
    return f.error;
  };

  const startFetch = useEffectEvent((tag: string, n: number) => {
    const joined = joinInputsRequest(stored);
    let live = true;
    joined.promise.then(
      (outcome) => {
        if (!live) return;
        if (outcome.ok) setFetched(remember(outcome.response));
        else setFetchError(failed(tag, n, outcome.message, outcome.import));
      },
      () => {
        if (live) setFetchError({ tags: [tag], message: INPUTS_UNREACHABLE });
      },
    );
    return () => {
      live = false;
      joined.leave();
    };
  });
  useEffect(() => {
    if (!needFetch) return;
    return startFetch(fetchTag, attempt);
  }, [needFetch, fetchTag, attempt]);

  const myTeam = useMemo(() => (pair ? resolveMyTeam(pair.snapshot, pick) : null), [pair, pick]);

  return {
    pair,
    myTeam,
    error: !pair && fetchFailed ? fetchError.message : null,
    retry: () => setAttempt((a) => a + 1),
    async refreshInputs() {
      const outcome = await settledInputs(requestInputs(stored, true));
      if (outcome.ok) setFetched(remember(outcome.response));
      return outcome;
    },
  };
}
