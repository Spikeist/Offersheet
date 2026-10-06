"use client";
/**
 * Import Report container (CLAUDE.md §14 item 2): reads the league this tab shows from the league store
 * (one of the leagues saved in this browser: src/lib/leagueStore.ts, Phase 4c; the Connect page saves each
 * import there and shows it), plus its "Your team" pick (the user's own, or one taken from a pasted ESPN
 * team link) and, when the League page has loaded them, its model inputs (for the projection-source note; the notices read
 * them only while they're fresh for this league data: modelStore.ts modelForSnapshot, the League page's reuse rule),
 * and renders the pure view model from src/lib/importReport.ts. It owns the page's requests: Refresh (the
 * same league again, saved over it, unless the league was removed while it ran), and "Forget my ESPN
 * cookies". A league saved by an earlier version of
 * Offer Sheet isn't read: the page says Offer Sheet was updated and offers to import it again (NoImportCard).
 * A team pick shows at once; one the browser refuses to keep is put back, and an alert under the choice says why.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { callApi, isApiError, type EspnImportBody, type EspnSessionStatus, type SleeperImportBody } from "@/lib/api";
import { buildImportReport, refreshOutcomeText, refreshTooSoon } from "@/lib/importReport";
import { importLeague } from "@/lib/leagueFetch";
import { saveMyTeamPick, type CurrentLeagueRead } from "@/lib/leagueStore";
import { importDataAgeMs, modelForSnapshot, storedModelForLeague } from "@/lib/modelStore";
import { NoImportCard } from "../NoImportCard";
import { finishImport } from "../connect/finishImport";
import { useCurrentLeague, useSavedModel } from "../league/useLeagueInputs";
import { Spinner } from "../ui";
import { ReportView, type ForgetControl, type RefreshControl } from "./ReportView";

export const COOKIES_FORGOTTEN =
  "Done. Your ESPN cookies are gone from this browser session. This league stays saved in this browser; if it's private, Refresh won't work until you connect with cookies again.";

export const NO_IMPORT_TEXT =
  "Connect your ESPN or Sleeper league and we'll show you everything we understood about it. Leagues you import stay saved in this browser until you remove them.";

export function ImportReport() {
  const read = useCurrentLeague();

  if (read === undefined) {
    return (
      <div className="flex items-center gap-3 py-16 text-muted" role="status">
        <Spinner /> Loading your league…
      </div>
    );
  }
  if (read.kind !== "ok") return <NoImportCard read={read} text={NO_IMPORT_TEXT} />;
  // One page state per saved league: another league's report starts fresh (its Refresh and Forget lines included).
  return <LoadedReport key={read.league.id} current={read} />;
}

function LoadedReport({ current }: { current: Extract<CurrentLeagueRead, { kind: "ok" }> }) {
  const { stored, pick } = current;
  const leagueId = current.league.id;
  const snapshot = stored.response.snapshot;
  const storedModel = useSavedModel(leagueId);
  // The stored inputs of any age name the projection source; only fresh ones (built for this very league data, under 6
  // hours old: the League page's own reuse rule) feed the notices, so an outage that's over never shows as current.
  const [openedAt] = useState(() => Date.now());
  const model = useMemo(() => storedModelForLeague(storedModel ?? undefined, snapshot)?.model ?? null, [storedModel, snapshot]);
  const freshModel = useMemo(() => modelForSnapshot(storedModel ?? undefined, snapshot, { now: openedAt }) ?? null, [storedModel, snapshot, openedAt]);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const view = useMemo(
    () => buildImportReport(stored.response, { timeZone, myTeamId: pick?.teamId ?? null, ...(pick ? { myTeamSource: pick.source } : {}), model, freshModel }),
    [stored.response, timeZone, pick, model, freshModel],
  );

  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [forgotten, setForgotten] = useState(false);
  const [forgetNote, setForgetNote] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  /** "Your team": shows at once (the league store applies it first); a pick the browser refuses is put back, and said. */
  function pickTeam(teamId: string) {
    setPickError(null);
    void saveMyTeamPick(leagueId, teamId || null, "you").then((saved) => {
      if (!saved.ok && live.current) setPickError(saved.message);
    });
  }

  /**
   * Refresh (§2.10): the same league again, skipping copies older than a minute: read by this browser where it can (Part
   * B, track BF: src/lib/leagueFetch.ts importLeague), else by the server. League data under a minute old is as new as
   * Refresh gets, so then nothing is asked (the line says so). The stored team pick stays.
   */
  async function refresh() {
    const { platform, leagueId, season, fetchedAt: before } = snapshot;
    let body: EspnImportBody | SleeperImportBody;
    if (platform === "espn") body = { leagueId, season, refresh: true };
    else if (platform === "sleeper") body = { season, leagueId, ...(stored.request.username ? { username: stored.request.username } : {}), refresh: true };
    else return;
    setRefreshError(null);
    setRefreshStatus(null);
    const now = new Date();
    // The data's age on one clock at a time (review BF-R4): a device clock set differently from the server's doesn't matter.
    const age = importDataAgeMs(stored, now.getTime());
    if (refreshTooSoon(age)) {
      setRefreshStatus(refreshOutcomeText({ before, after: before, now, platform, timeZone, ageMs: age }));
      return;
    }
    setRefreshing(true);
    const res = await importLeague({ platform, body, espnCookies: stored.response.usedEspnCookies ? "connected" : "unknown" });
    setRefreshing(false);
    if (isApiError(res)) {
      setRefreshError(res.error.message);
      return;
    }
    if (!("snapshot" in res)) {
      setRefreshError("That didn't work. Import the league again from the Connect page.");
      return;
    }
    // Saved over the league without making it the tab's league: one switched away from meanwhile stays switched away,
    // and one removed meanwhile (here or in another tab) stays removed (ifSaved; review of track ML).
    const saved = await finishImport(stored.request, res, undefined, { makeCurrent: false, ifSaved: true });
    if (!live.current) return;
    if (!saved.ok) {
      setRefreshError(saved.message);
      return;
    }
    // The answer's own age (just arrived: the server's time of answering against its data's, when it signed it).
    const answered = new Date();
    const ageMs = importDataAgeMs({ response: res, savedAt: answered.toISOString() }, answered.getTime());
    setRefreshStatus(refreshOutcomeText({ before, after: res.snapshot.fetchedAt, now: answered, platform, timeZone, ageMs }));
  }

  /** "Forget my ESPN cookies": the sealed session cookie is deleted; this league stays saved in the browser. */
  async function forgetCookies() {
    setForgetting(true);
    setForgetNote(null);
    const res = await callApi<EspnSessionStatus>("/api/session/espn", { method: "DELETE" });
    setForgetting(false);
    if (isApiError(res)) {
      setForgetNote(res.error.message);
      return;
    }
    setForgotten(true);
    setForgetNote(COOKIES_FORGOTTEN);
  }

  const refreshControl: RefreshControl | undefined =
    snapshot.platform === "espn" || snapshot.platform === "sleeper" ? { onRefresh: () => void refresh(), refreshing, error: refreshError, status: refreshStatus } : undefined;
  const forgetControl: ForgetControl | undefined = view.league.canForgetEspnCookies ? { onForget: () => void forgetCookies(), forgetting, done: forgotten, note: forgetNote } : undefined;
  return <ReportView view={view} onPickTeam={pickTeam} pickError={pickError} refresh={refreshControl} forget={forgetControl} />;
}
