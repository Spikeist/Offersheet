"use client";
/**
 * One league's trade settings in the pages (CLAUDE.md §12 "User settings", §14 item 6; lead decision L12):
 * the Settings page edits them, and the League page (and Phase 4's Trade Finder and Analyzer) send them with
 * every engine request. They're read from localStorage through src/lib/settingsStore.ts, so every page sees
 * the same normalized copy, and a change saved anywhere (this tab or another) reaches every open page.
 */
import { useMemo } from "react";
import type { LeagueSnapshot } from "@/engine/model";
import type { TradeSettings } from "@/engine/settings";
import type { SaveResult } from "@/lib/importStore";
import { SETTINGS_SAVE_FAILED, SETTINGS_STORAGE_KEY, leagueKey, loadLeagueSettings, readLeagueSettings, resetLeagueSettings, saveLeagueSettings } from "@/lib/settingsStore";
import { browserLocalStorage, notifyLocalChange, useLocalValue } from "./useLocalValue";

export interface LeagueSettingsState {
  /** The league's key in this browser's storage (settingsStore.ts leagueKey). */
  key: string;
  /** The league's settings (its saved copy, else the defaults); undefined until the browser's storage has been read. */
  settings: TradeSettings | undefined;
  /** The league has a saved copy (false: the defaults). */
  stored: boolean;
}

/** This league's settings, kept current as they change. */
export function useLeagueSettings(league: Pick<LeagueSnapshot, "platform" | "leagueId">): LeagueSettingsState {
  const raw = useLocalValue(SETTINGS_STORAGE_KEY);
  const key = leagueKey(league);
  return useMemo(() => {
    if (raw === undefined) return { key, settings: undefined, stored: false };
    const read = readLeagueSettings(raw, key);
    return { key, settings: read.settings, stored: read.stored };
  }, [raw, key]);
}

/**
 * Changes a league's settings in this browser and tells the open pages. The change applies to the copy
 * stored right now (not to what a page last rendered), so quick changes in a row, a slider's drag among them,
 * never undo each other.
 */
export function updateSettings(key: string, change: (current: TradeSettings) => TradeSettings): SaveResult {
  const storage = browserLocalStorage();
  if (!storage) return { ok: false, message: SETTINGS_SAVE_FAILED };
  const saved = saveLeagueSettings(storage, key, change(loadLeagueSettings(storage, key).settings));
  if (saved.ok) notifyLocalChange();
  return saved;
}

/** Back to the defaults for a league (its saved copy is removed) and tells the open pages. */
export function resetSettings(key: string): SaveResult {
  const storage = browserLocalStorage();
  if (!storage) return { ok: false, message: SETTINGS_SAVE_FAILED };
  const reset = resetLeagueSettings(storage, key);
  if (reset.ok) notifyLocalChange();
  return reset;
}
