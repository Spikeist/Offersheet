"use client";
/**
 * One league's trade settings in the pages (CLAUDE.md §12 "User settings", §14 item 6; lead decision L12):
 * the Settings page edits them, and the League page, the Trade Finder and the Analyzer send them with every
 * engine request. Every page sees the same normalized copy, and a change saved anywhere (this tab or another)
 * reaches every open page.
 *
 * Phase 4c (planner reply to Checkpoint 4b, change 11): settings live in the league store (IndexedDB,
 * src/lib/leagueStore.ts), per leagueKey: useSavedLeagueSettings reads them (undefined settings while the store
 * loads), changeSavedSettings and resetSavedSettings write them. A change applies to the page at once and then to
 * the copy stored right now (so quick changes in a row, a slider's drag among them, never undo each other); the
 * promise says whether the browser kept it (a refused change puts the page back and says why).
 */
import { useMemo } from "react";
import { defaultTradeSettings, type TradeSettings } from "@/engine/settings";
import type { SaveResult } from "@/lib/importStore";
import { leagueStore, useLeagueStoreState } from "@/lib/leagueStore";
import { SETTINGS_SAVE_FAILED } from "@/lib/settingsStore";

export interface LeagueSettingsState {
  /** The league's key in this browser's storage (settingsStore.ts leagueKey). */
  key: string;
  /** The league's settings (its saved copy, else the defaults); undefined until the browser's storage has been read. */
  settings: TradeSettings | undefined;
  /** The league has a saved copy (false: the defaults). */
  stored: boolean;
}

/** A league's settings from the league store (by its leagueKey: a saved league's `leagueKey`), kept current as they change. */
export function useSavedLeagueSettings(key: string): LeagueSettingsState {
  const { status, settings } = useLeagueStoreState();
  const own = status === "ready" ? settings.get(key) : undefined;
  return useMemo(() => {
    if (status !== "ready") return { key, settings: undefined, stored: false };
    return own ? { key, settings: own, stored: true } : { key, settings: defaultTradeSettings(), stored: false };
  }, [status, own, key]);
}

/**
 * Changes a league's settings in the league store: `change` runs on the page's copy at once, then on the stored copy
 * (keep it pure: it can run twice). Resolves once the browser kept it, or with the reason it didn't.
 */
export function changeSavedSettings(key: string, change: (current: TradeSettings) => TradeSettings): Promise<SaveResult> {
  return leagueStore()?.updateSettings(key, change) ?? Promise.resolve({ ok: false, message: SETTINGS_SAVE_FAILED });
}

/** Back to the defaults for a league in the league store (its saved copy goes). */
export function resetSavedSettings(key: string): Promise<SaveResult> {
  return leagueStore()?.resetSettings(key) ?? Promise.resolve({ ok: false, message: SETTINGS_SAVE_FAILED });
}
