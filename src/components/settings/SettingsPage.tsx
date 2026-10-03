"use client";
/**
 * The Settings page (CLAUDE.md §14 item 6; §12 "User settings"; §7 "Streaming positions"; lead decision
 * L12). Settings belong to a league, so the page edits the one imported in this tab (sessionStorage, as the
 * other pages read it), with "my team" resolved the way they resolve it (the user's pick, else the
 * platform's). Each change is saved at once in this browser's localStorage (src/lib/settingsStore.ts), where
 * the League page and the trade pages read it; "Reset to defaults" removes the league's saved copy.
 *
 * Without an import it can read, the page says settings need a league and links to the Connect page (an
 * import saved by an earlier version of Offer Sheet asks for the league again). "Your trade feedback"
 * (export and delete) needs no league and is always there.
 *
 * Saving is reported in one status line at the bottom of the screen ("Saved." for a few seconds, then
 * cleared), and a failure as an alert in the league's card that stays until the next change.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { IMPORT_STORAGE_KEY, OUTDATED_IMPORT_TITLE, myTeamKey, parseMyTeamPick, readStoredImport, type StoredImport } from "@/lib/importStore";
import { resolveMyTeam } from "@/lib/myTeam";
import { useSessionValue } from "@/lib/useSessionValue";
import { Card, Spinner, buttonClass } from "../ui";
import { FeedbackCard } from "./FeedbackCard";
import { SettingsForm, type SettingsStatus } from "./SettingsForm";
import { applySettingsEdit, buildSettingsView, type SettingsEdit } from "./settingsView";
import { resetSettings, updateSettings, useLeagueSettings } from "./useLeagueSettings";

/** How long "Saved." stays on screen. */
const SAVED_SHOWN_MS = 3000;

export const NO_LEAGUE_TITLE = "Settings are saved for each league";
export const NO_LEAGUE_TEXT =
  "The positions you stream, how much playoff weeks count and what trade ideas may include are saved for each league you import. Connect your league to choose them.";
export const OUTDATED_TEXT = "Import your league again to change its settings.";

function Waiting({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center gap-3 py-10 text-muted">
      <Spinner /> {text}
    </p>
  );
}

/** No import this page can read: settings need a league. */
export function NoLeagueCard({ outdated }: { outdated: boolean }) {
  return (
    <Card>
      <h2 className="text-xl font-extrabold tracking-tight">{outdated ? OUTDATED_IMPORT_TITLE : NO_LEAGUE_TITLE}</h2>
      <p className="mt-2 text-sm text-muted">{outdated ? OUTDATED_TEXT : NO_LEAGUE_TEXT}</p>
      <Link href="/connect" className={`${buttonClass("primary")} mt-4`}>
        Connect your league
      </Link>
    </Card>
  );
}

export function SettingsPage() {
  const raw = useSessionValue(IMPORT_STORAGE_KEY);
  const read = useMemo(() => (raw === undefined ? undefined : readStoredImport(raw)), [raw]);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Settings</h1>
        <p className="mt-2 max-w-2xl text-muted">How Offer Sheet values your lineup, and what its trade ideas may include. Saved in this browser, for each league.</p>
      </header>
      {read === undefined ? <Waiting text="Loading your league…" /> : read.kind === "ok" ? <LeagueSettings stored={read.stored} /> : <NoLeagueCard outdated={read.kind === "outdated"} />}
      <FeedbackCard />
    </div>
  );
}

function LeagueSettings({ stored }: { stored: StoredImport }) {
  const snapshot = stored.response.snapshot;
  const pickRaw = useSessionValue(myTeamKey(snapshot));
  const pick = useMemo(() => parseMyTeamPick(pickRaw), [pickRaw]);
  const myTeamId = useMemo(() => resolveMyTeam(snapshot, pick).myTeamId, [snapshot, pick]);
  const league = useLeagueSettings(snapshot);
  const view = useMemo(
    () => (league.settings ? buildSettingsView({ snapshot, myTeamId, settings: league.settings, stored: league.stored }) : null),
    [snapshot, myTeamId, league.settings, league.stored],
  );

  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );

  function report(next: SettingsStatus) {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = null;
    setStatus(next);
    if (next.tone === "ok") clearTimer.current = setTimeout(() => setStatus(null), SAVED_SHOWN_MS);
  }

  /** Saves one change; true when it was saved (the form moves focus only then). */
  function edit(change: SettingsEdit): boolean {
    const out = { note: null as string | null };
    const saved = updateSettings(league.key, (current) => {
      const applied = applySettingsEdit(current, change, (id) => snapshot.players[id]?.name ?? "That player", snapshot.platform);
      out.note = applied.note;
      return applied.settings;
    });
    report(saved.ok ? { tone: "ok", text: out.note ? `Saved. ${out.note}` : "Saved." } : { tone: "error", text: saved.message });
    return saved.ok;
  }

  function reset(): boolean {
    const done = resetSettings(league.key);
    report(done.ok ? { tone: "ok", text: "Back to the defaults for this league." } : { tone: "error", text: done.message });
    return done.ok;
  }

  if (!view) return <Waiting text="Loading your settings…" />;
  return <SettingsForm view={view} onEdit={edit} onReset={reset} status={status} />;
}
