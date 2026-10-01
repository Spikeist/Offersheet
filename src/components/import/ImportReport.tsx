"use client";
/**
 * Import Report container (CLAUDE.md §14 item 2): reads the import the Connect page left in
 * sessionStorage, plus the stored "Your team" pick for this league (the user's own, or one taken
 * from a pasted ESPN team link) and, when the League page has loaded them, this league's model
 * inputs (for the projection-source note), and renders the pure view model from
 * src/lib/importReport.ts. It owns the page's requests: Refresh, and "Forget my ESPN cookies". An
 * import saved by an earlier version of Offer Sheet isn't read: the page says Offer Sheet was updated
 * and asks for the league again (NoImportCard).
 */
import { useMemo, useState } from "react";
import { callApi, isApiError, type EspnImportBody, type EspnSessionStatus, type ImportResponse, type SleeperImportBody } from "@/lib/api";
import { buildImportReport, refreshOutcomeText } from "@/lib/importReport";
import { IMPORT_STORAGE_KEY, myTeamKey, parseMyTeamPick, readStoredImport, saveMyTeam, type StoredImport } from "@/lib/importStore";
import { MODEL_STORAGE_KEY, parseStoredModel, storedModelForLeague } from "@/lib/modelStore";
import { browserSessionStorage, notifySessionChange, useSessionValue } from "@/lib/useSessionValue";
import { NoImportCard } from "../NoImportCard";
import { finishImport } from "../connect/finishImport";
import { Spinner } from "../ui";
import { ReportView, type ForgetControl, type RefreshControl } from "./ReportView";

const COOKIES_FORGOTTEN =
  "Done. Your ESPN cookies are gone from this browser session. This report stays until you close the tab; if your league is private, Refresh won't work until you connect with cookies again.";

export function ImportReport() {
  const raw = useSessionValue(IMPORT_STORAGE_KEY);
  const read = useMemo(() => (raw === undefined ? undefined : readStoredImport(raw)), [raw]);

  if (read === undefined) {
    return (
      <div className="flex items-center gap-3 py-16 text-muted" role="status">
        <Spinner /> Loading your league…
      </div>
    );
  }
  if (read.kind !== "ok") {
    return (
      <NoImportCard
        outdated={read.kind === "outdated"}
        text="Connect your ESPN or Sleeper league and we'll show you everything we understood about it. Imports stay in this browser tab only."
      />
    );
  }
  return <LoadedReport stored={read.stored} />;
}

function LoadedReport({ stored }: { stored: StoredImport }) {
  const snapshot = stored.response.snapshot;
  const pickRaw = useSessionValue(myTeamKey(snapshot));
  const pick = useMemo(() => parseMyTeamPick(pickRaw), [pickRaw]);
  const modelRaw = useSessionValue(MODEL_STORAGE_KEY);
  const model = useMemo(() => storedModelForLeague(parseStoredModel(modelRaw), snapshot)?.model ?? null, [modelRaw, snapshot]);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const view = useMemo(
    () => buildImportReport(stored.response, { timeZone, myTeamId: pick?.teamId ?? null, ...(pick ? { myTeamSource: pick.source } : {}), model }),
    [stored.response, timeZone, pick, model],
  );

  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [forgotten, setForgotten] = useState(false);
  const [forgetNote, setForgetNote] = useState<string | null>(null);

  function pickTeam(teamId: string) {
    const storage = browserSessionStorage();
    if (!storage) return;
    saveMyTeam(storage, snapshot, teamId || null, "you");
    notifySessionChange();
  }

  /** Refresh (§2.10): the same league again, skipping server copies older than a minute. The stored team pick stays. */
  async function refresh() {
    const { platform, leagueId, season, fetchedAt: before } = snapshot;
    let body: EspnImportBody | SleeperImportBody;
    if (platform === "espn") body = { leagueId, season, refresh: true };
    else if (platform === "sleeper") body = { season, leagueId, ...(stored.request.username ? { username: stored.request.username } : {}), refresh: true };
    else return;
    setRefreshing(true);
    setRefreshError(null);
    setRefreshStatus(null);
    const res = await callApi<ImportResponse>(`/api/import/${platform}`, { method: "POST", body });
    setRefreshing(false);
    if (isApiError(res)) {
      setRefreshError(res.error.message);
      return;
    }
    if (!("snapshot" in res)) {
      setRefreshError("That didn't work. Import the league again from the Connect page.");
      return;
    }
    const saved = finishImport(stored.request, res);
    if (!saved.ok) {
      setRefreshError(saved.message);
      return;
    }
    setRefreshStatus(refreshOutcomeText({ before, after: res.snapshot.fetchedAt, now: new Date(), platform, timeZone }));
  }

  /** "Forget my ESPN cookies": the sealed session cookie is deleted; this report (sessionStorage) stays. */
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
  return <ReportView view={view} onPickTeam={pickTeam} refresh={refreshControl} forget={forgetControl} />;
}
