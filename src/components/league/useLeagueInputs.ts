"use client";
/**
 * The imported league and its model inputs, as the League page, the Trade Finder and the Trade Analyzer load
 * them (CLAUDE.md §14 items 3–5; Phase 4 wave 2 decision M13: the trade pages share the League page's loading
 * rather than copy it). It reads the import from this tab's sessionStorage, gets the league's model inputs
 * (projections and values, §6 and §9) from this page view's latest answer, else this tab's stored copy (reused
 * only while under 6 hours old: modelStore.ts MODEL_REUSE_MAX_AGE_MS), else the server, and resolves "my team"
 * the way every page does (the user's pick, else the platform's: src/lib/myTeam.ts).
 *
 * One request at a time: the model request is shared by key (sharedRequest.ts), so React StrictMode's mount →
 * unmount → mount in development sends one, and it's aborted once the page is gone. A model response is kept
 * in this tab (keepModelResponse: a newer snapshot replaces the stored import, keeping the team pick), then one
 * change notification; whatever the browser refuses to store, the page still has in memory. React state is only
 * set in async callbacks (the react-hooks lint rules).
 */
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import type { ModelInputs } from "@/engine/inputs";
import type { LeagueSnapshot } from "@/engine/model";
import { callApi, isApiError, isModelResponse, type ModelResponse } from "@/lib/api";
import { IMPORT_STORAGE_KEY, myTeamKey, parseMyTeamPick, readStoredImport, type StoredImport, type StoredImportRead } from "@/lib/importStore";
import { MODEL_STORAGE_KEY, keepModelResponse, modelForSnapshot, modelKey, modelRequest, parseStoredModel, withImportedTeam } from "@/lib/modelStore";
import { resolveMyTeam, type ResolvedMyTeam } from "@/lib/myTeam";
import { browserSessionStorage, notifySessionChange, useSessionValue } from "@/lib/useSessionValue";
import { createRequestSharer, type JoinedRequest } from "./sharedRequest";

/** This tab's stored import as the pages read it; undefined while storage hasn't been read (server render, hydration). */
export function useStoredImport(): StoredImportRead | undefined {
  const raw = useSessionValue(IMPORT_STORAGE_KEY);
  return useMemo(() => (raw === undefined ? undefined : readStoredImport(raw)), [raw]);
}

export type InputsOutcome = { ok: true; response: ModelResponse } | { ok: false; message: string };

/** A league's data as one tag: which league, and which fetch of it. */
export const leagueTag = (s: Pick<LeagueSnapshot, "platform" | "leagueId" | "season" | "fetchedAt">) => `${modelKey(s)}|${s.fetchedAt}`;

/** The pages' model requests in flight, shared by URL and body (see the header). */
const inputRequests = createRequestSharer<InputsOutcome>();

const UNREACHABLE = "We couldn't reach Offer Sheet. Check your connection and try again.";

/**
 * The model request for the stored import that is already in flight, or a new one (a page load's,
 * never Refresh's): React StrictMode's second mount joins the first's, and it's aborted once every
 * page that joined it has left.
 */
export function joinInputsRequest(stored: StoredImport): JoinedRequest<InputsOutcome> {
  const req = modelRequest(stored, false);
  const key = req ? `${req.url} ${JSON.stringify(req.body)}` : leagueTag(stored.response.snapshot);
  return inputRequests.join(key, (signal) => requestInputs(stored, false, signal));
}

/**
 * The stored import's model inputs from the server (with the Sleeper username it was imported with,
 * so the re-import finds the user's team). `signal` aborts the request.
 */
export async function requestInputs(stored: StoredImport, refresh: boolean, signal?: AbortSignal): Promise<InputsOutcome> {
  const snapshot = stored.response.snapshot;
  const req = modelRequest(stored, refresh);
  if (!req) return { ok: false, message: "Offer Sheet works with ESPN and Sleeper leagues for now." };
  const res = await callApi<ModelResponse>(req.url, { method: "POST", body: req.body }, signal ? (input, init) => fetch(input, { ...init, signal }) : undefined);
  if (isApiError(res)) return { ok: false, message: res.error.message };
  if (!isModelResponse(res) || modelKey(res.import.snapshot) !== modelKey(snapshot)) return { ok: false, message: "We couldn't read the projections for this league. Try again in a moment." };
  return { ok: true, response: res };
}

/** Model inputs fetched in this page view (kept in memory too, in case the browser won't store them). */
interface Fetched {
  /** The stored-import tags this answers: the one it was asked for, and its own snapshot's. */
  tags: string[];
  snapshot: LeagueSnapshot;
  inputs: ModelInputs;
}

/**
 * Keeps a model response in this tab (keepModelResponse: a newer snapshot replaces the stored
 * import, keeping the team pick, and the inputs are stored with it), then one change notification.
 * Whatever the browser refuses to store, the page still has in memory; it fetches again next time.
 */
function keepResponse(stored: StoredImport, response: ModelResponse, requestTag: string): Fetched {
  const res = withImportedTeam(response, stored);
  const snap = res.import.snapshot;
  const storage = browserSessionStorage();
  if (storage) {
    const kept = keepModelResponse(storage, { stored, response: res, savedAt: new Date().toISOString() });
    if (kept.importSaved || kept.modelSaved) notifySessionChange();
  }
  return { tags: [requestTag, leagueTag(snap)], snapshot: snap, inputs: res.model };
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
  /** The Refresh button: the inputs again with refresh (the server fetches data over a minute old); kept on success. */
  refreshInputs(): Promise<InputsOutcome>;
}

/** The league's model inputs and "my team" for a stored import (see the header). */
export function useLeagueInputs(stored: StoredImport): LeagueInputs {
  const snapshot = stored.response.snapshot;
  const requestTag = leagueTag(snapshot);
  const pickRaw = useSessionValue(myTeamKey(snapshot));
  const pick = useMemo(() => parseMyTeamPick(pickRaw), [pickRaw]);
  const modelRaw = useSessionValue(MODEL_STORAGE_KEY);
  // When the page opened: stored inputs built over MODEL_REUSE_MAX_AGE_MS before it are fetched again.
  const [openedAt] = useState(() => Date.now());
  // undefined while storage hasn't been read; null when nothing stored (and fresh) matches this snapshot.
  const storedInputs = useMemo(
    () => (modelRaw === undefined ? undefined : (modelForSnapshot(parseStoredModel(modelRaw), snapshot, { now: openedAt }) ?? null)),
    [modelRaw, snapshot, openedAt],
  );

  // This page view's latest answer, else this tab's stored copy, else fetch.
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [fetchError, setFetchError] = useState<{ tag: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const fetchTag = `${requestTag}|${attempt}`;
  const pair = useMemo(() => {
    if (fetched && fetched.tags.includes(requestTag)) return { snapshot: fetched.snapshot, inputs: fetched.inputs };
    if (storedInputs) return { snapshot, inputs: storedInputs };
    return null;
  }, [fetched, requestTag, storedInputs, snapshot]);
  const fetchFailed = fetchError !== null && fetchError.tag === fetchTag;
  const needFetch = storedInputs !== undefined && !pair && !fetchFailed;

  const startFetch = useEffectEvent((tag: string) => {
    const joined = joinInputsRequest(stored);
    let live = true;
    joined.promise.then(
      (outcome) => {
        if (!live) return;
        if (outcome.ok) setFetched(keepResponse(stored, outcome.response, requestTag));
        else setFetchError({ tag, message: outcome.message });
      },
      () => {
        if (live) setFetchError({ tag, message: UNREACHABLE });
      },
    );
    return () => {
      live = false;
      joined.leave();
    };
  });
  useEffect(() => {
    if (!needFetch) return;
    return startFetch(fetchTag);
  }, [needFetch, fetchTag]);

  const myTeam = useMemo(() => (pair ? resolveMyTeam(pair.snapshot, pick) : null), [pair, pick]);

  return {
    pair,
    myTeam,
    error: !pair && fetchFailed ? fetchError.message : null,
    retry: () => setAttempt((a) => a + 1),
    async refreshInputs() {
      const outcome = await requestInputs(stored, true);
      if (outcome.ok) setFetched(keepResponse(stored, outcome.response, requestTag));
      return outcome;
    },
  };
}
