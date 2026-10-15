"use client";
/**
 * The League page's own settings edits (Checkpoint 7e; planner reply to Checkpoint 7d, items 3.2, 3.3 and 3.5): the lock
 * icon on my roster card and in "Waiver upgrades" (untouchables: "users can do it from the roster card and the waiver view,
 * with a lock icon, not only from the Trade Finder"), Waiver upgrades' "Drop from the same position" switch, and my injured
 * players' return weeks.
 *
 * The League page (LeaguePage.tsx) provides the league's key and its settings as the browser holds them now
 * (LeagueSettingsEditContext); a section edits them through useLeagueSettingsEdit(), which saves to the league store the
 * way the Settings page does (useLeagueSettings.ts changeSavedSettings: the page's copy at once, then the stored copy; the
 * promise says whether the browser kept it). Every one of these settings is one the League model reads
 * (settingsStore.ts LEAGUE_MODEL_SETTINGS), so the page computes again after a change, the last numbers dimmed meanwhile.
 * None of them ever goes to the server or into a feedback copy (the planner: "New settings stay in the browser").
 *
 * A lock is the Settings page's own untouchable edit (settingsView.ts applySettingsEdit): locking a must-include player
 * takes him off that list, as there.
 */
import { createContext, use, useMemo } from "react";
import type { TradeSettings } from "@/engine/settings";
import type { SaveResult } from "@/lib/importStore";
import { applySettingsEdit } from "../settings/settingsView";
import { changeSavedSettings } from "../settings/useLeagueSettings";

/** What the League page provides: the league's key in the league store and its settings as the browser holds them now. */
export interface LeagueSettingsEditValue {
  leagueKey: string;
  settings: TradeSettings;
}

/** Provided by the League page once the league's settings are read; null elsewhere (a section then shows no controls). */
export const LeagueSettingsEditContext = createContext<LeagueSettingsEditValue | null>(null);

/** The edits a League page section can make (useLeagueSettingsEdit). */
export interface LeagueSettingsEdit {
  /** The league's settings as the browser holds them now (a change shows here at once, before the model computes again). */
  settings: TradeSettings;
  /** Whether my player `id` is untouchable (TradeSettings.untouchables). */
  isUntouchable: (id: string) => boolean;
  /** Locks (`on`) or unlocks my player `id` (the Settings page's untouchable edit). */
  setUntouchable: (id: string, on: boolean) => Promise<SaveResult>;
  /** Waiver upgrades' "Drop from the same position" (TradeSettings.waiverSamePosition). */
  setWaiverSamePosition: (on: boolean) => Promise<SaveResult>;
  /**
   * My injured player's return week (TradeSettings.returnWeeks): an NFL week (1 to settings.RETURN_WEEK_MAX; "out for the
   * season" is the NFL's last week + 1, as LeagueSnapshot's injuryReturnWeek), or null to go back to the platform's or our
   * own week (the entry goes).
   */
  setReturnWeek: (id: string, week: number | null) => Promise<SaveResult>;
}

/** A league's settings with `id`'s return week set (`week`) or gone (null). */
export function withReturnWeek(settings: TradeSettings, id: string, week: number | null): TradeSettings {
  const next: Record<string, number> = { ...settings.returnWeeks };
  if (week === null) delete next[id];
  else next[id] = week;
  return { ...settings, returnWeeks: next };
}

/** The League page's settings edits, or null when no League page provides them (LeagueSettingsEditContext). */
export function useLeagueSettingsEdit(): LeagueSettingsEdit | null {
  const value = use(LeagueSettingsEditContext);
  return useMemo(() => {
    if (!value) return null;
    const { leagueKey, settings } = value;
    return {
      settings,
      isUntouchable: (id) => settings.untouchables.includes(id),
      setUntouchable: (id, on) => changeSavedSettings(leagueKey, (s) => applySettingsEdit(s, { kind: "untouchable", id, on }).settings),
      setWaiverSamePosition: (on) => changeSavedSettings(leagueKey, (s) => ({ ...s, waiverSamePosition: on })),
      setReturnWeek: (id, week) => changeSavedSettings(leagueKey, (s) => withReturnWeek(s, id, week)),
    };
  }, [value]);
}
