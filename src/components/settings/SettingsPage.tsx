"use client";
/**
 * The Settings page (CLAUDE.md §14 item 6; §12 "User settings"; §7 "Streaming positions"; lead decision
 * L12). Settings belong to a league, so the page edits the league this tab shows (one of the leagues saved in
 * this browser, src/lib/leagueStore.ts, Phase 4c: the switcher at the top of every page picks it), with "my
 * team" resolved the way the other pages resolve it (the user's pick, else the platform's). Each change shows at
 * once and is saved in the league store, per league (useLeagueSettings.ts changeSavedSettings), where the League
 * page and the trade pages read it; "Reset to defaults" removes the league's saved copy.
 *
 * Without a league it can read, the page says settings need a league and links to the Connect page (a
 * league saved by an earlier version of Offer Sheet asks for the league again, with "Import again" as on the
 * other pages). "Your trade feedback" (export and delete, every league's) needs no league and is always there.
 *
 * Saving is reported in one status line at the bottom of the screen ("Saved." once the browser kept the change,
 * for a few seconds, then cleared), and a failure as an alert in the league's card that stays until the next
 * change: a change the browser refuses is put back on the page (the store does it). The form moves focus as soon
 * as a change shows (a Remove button's row is gone at once), except when the store already refuses writes (its
 * storage went away while the page was open: the alert says to reload).
 *
 * Phase 4c (planner reply to Checkpoint 4b, change 12): when the league's latest model inputs (the saved copy the League
 * page reuses, only while it's fresh: modelStore.ts modelForSnapshot) say its trade values are our own estimates
 * (MarketInputs.fallback kind "curve"), Protect my trade value and Win now ↔ Future say they change nothing for now. The
 * page fetches nothing for it: without a fresh saved copy it says nothing.
 *
 * Planner reply to Checkpoint 7a, §6.1: "Playoff weeks count" is read-only, the League model's automatic weight, worked out
 * from the same fresh saved copy in an engine worker of this page's own (usePlayoffWeight.ts), again whenever a setting the
 * League model reads changes (the goal among them); without a fresh copy the page says it's set automatically when the
 * League page loads.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { OUTDATED_IMPORT_TITLE, type ImportRequestSummary, type SaveResult } from "@/lib/importStore";
import type { CurrentLeagueRead } from "@/lib/leagueStore";
import { modelForSnapshot } from "@/lib/modelStore";
import { resolveMyTeam } from "@/lib/myTeam";
import { ImportAgain, importAgainFor } from "../NoImportCard";
import { useCurrentLeague, useLeagueStorage, useSavedModel } from "../league/useLeagueInputs";
import { Card, Spinner, buttonClass } from "../ui";
import { FeedbackCard } from "./FeedbackCard";
import { SettingsForm, type SettingsStatus } from "./SettingsForm";
import { applySettingsEdit, buildSettingsView, type SettingsEdit } from "./settingsView";
import { changeSavedSettings, resetSavedSettings, useSavedLeagueSettings } from "./useLeagueSettings";
import { usePlayoffWeight } from "./usePlayoffWeight";

/** How long "Saved." stays on screen. */
const SAVED_SHOWN_MS = 3000;

export const NO_LEAGUE_TITLE = "Settings are saved for each league";
export const NO_LEAGUE_TEXT =
  "The positions you stream, what your league rewards and what trade ideas may include are saved for each league you import. Connect your league to choose them.";
export const OUTDATED_TEXT = "Import your league again to change its settings.";

function Waiting({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center gap-3 py-10 text-muted">
      <Spinner /> {text}
    </p>
  );
}

/**
 * No import this page can read: settings need a league. One saved by an earlier version offers "Import again" when its
 * id is known, as the other pages do (NoImportCard.tsx; review of track ML: Phase 4c's import format makes every Phase
 * 4b import one).
 */
export function NoLeagueCard({ outdated, request = null }: { outdated: boolean; request?: ImportRequestSummary | null }) {
  return (
    <Card>
      <h2 className="text-xl font-extrabold tracking-tight">{outdated ? OUTDATED_IMPORT_TITLE : NO_LEAGUE_TITLE}</h2>
      <p className="mt-2 text-sm text-muted">{outdated ? OUTDATED_TEXT : NO_LEAGUE_TEXT}</p>
      {outdated && request ? (
        <ImportAgain request={request} align="start" />
      ) : (
        <Link href="/connect" className={`${buttonClass("primary")} mt-4`}>
          Connect your league
        </Link>
      )}
    </Card>
  );
}

export function SettingsPage() {
  const read = useCurrentLeague();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Settings</h1>
        <p className="mt-2 max-w-2xl text-muted">How Offer Sheet values your lineup, how it scores trade ideas, and what they may include. Saved in this browser, for each league.</p>
      </header>
      {read === undefined ? (
        <Waiting text="Loading your league…" />
      ) : read.kind === "ok" ? (
        // One form state per saved league: another league's settings never show under this one's status line.
        <LeagueSettings key={read.league.id} current={read} />
      ) : (
        <NoLeagueCard outdated={read.kind === "outdated"} request={importAgainFor(read)} />
      )}
      <FeedbackCard />
    </div>
  );
}

function LeagueSettings({ current }: { current: Extract<CurrentLeagueRead, { kind: "ok" }> }) {
  const snapshot = current.stored.response.snapshot;
  const pick = current.pick;
  const myTeamId = useMemo(() => resolveMyTeam(snapshot, pick).myTeamId, [snapshot, pick]);
  const league = useSavedLeagueSettings(current.league.leagueKey);
  const storage = useLeagueStorage();
  // The league's saved model inputs, while fresh (the file header): whether its trade values are our own estimates for now,
  // and the automatic playoff-week weight worked out from them (usePlayoffWeight.ts).
  const savedModel = useSavedModel(current.league.id);
  const [openedAt] = useState(() => Date.now());
  const freshInputs = useMemo(() => modelForSnapshot(savedModel ?? undefined, snapshot, { now: openedAt }) ?? null, [savedModel, snapshot, openedAt]);
  const valuesEstimated = freshInputs?.market?.fallback?.kind === "curve";
  const playoffWeight = usePlayoffWeight({ snapshot, inputs: freshInputs, myTeamId, settings: league.settings });
  const view = useMemo(
    () => (league.settings ? buildSettingsView({ snapshot, myTeamId, settings: league.settings, stored: league.stored, valuesEstimated, playoffWeight }) : null),
    [snapshot, myTeamId, league.settings, league.stored, valuesEstimated, playoffWeight],
  );

  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  function report(next: SettingsStatus) {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = null;
    setStatus(next);
    if (next.tone === "ok") clearTimer.current = setTimeout(() => setStatus(null), SAVED_SHOWN_MS);
  }

  /**
   * A change or a reset: refused at once while the store refuses writes (its storage went away: false, the alert says
   * why); else it shows at once (true: the form moves focus) and is reported once the browser kept it, or didn't.
   */
  function save(write: () => Promise<SaveResult>, savedText: () => string): boolean {
    if (storage?.kind === "closed") {
      report({ tone: "error", text: storage.message });
      return false;
    }
    void write().then((saved) => {
      if (live.current) report(saved.ok ? { tone: "ok", text: savedText() } : { tone: "error", text: saved.message });
    });
    return true;
  }

  /** Saves one change (the store runs it on the page's copy, then on the stored one: the note is the stored one's). */
  function edit(change: SettingsEdit): boolean {
    const out = { note: null as string | null };
    return save(
      () =>
        changeSavedSettings(league.key, (settings) => {
          const applied = applySettingsEdit(settings, change, (id) => snapshot.players[id]?.name ?? "That player", snapshot.platform);
          out.note = applied.note;
          return applied.settings;
        }),
      () => (out.note ? `Saved. ${out.note}` : "Saved."),
    );
  }

  function reset(): boolean {
    return save(
      () => resetSavedSettings(league.key),
      () => "Back to the defaults for this league.",
    );
  }

  if (!view) return <Waiting text="Loading your settings…" />;
  return <SettingsForm view={view} onEdit={edit} onReset={reset} status={status} />;
}
