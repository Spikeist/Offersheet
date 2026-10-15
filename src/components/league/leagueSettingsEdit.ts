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
 * takes him off that list, as there, and the lock says so as the Settings page does (EditResult.note; review of wave C,
 * UI-C-9).
 *
 * A return week is set for the snapshot's season (LeagueSettingsEditValue.season, TradeSettings.returnWeeksSeason; review of
 * wave C, UI-C-3: a league's settings carry over to its next season). It stops counting once its player has left my roster
 * and IR, is active again, his week has passed, or the season it was set for has (src/engine/returnWeeks.ts; the planner:
 * "It clears when the player is active again or the week passes"): the League page
 * builds its model without such entries (withoutStaleReturnWeeks: the engine ignores them anyway, so the numbers are the
 * same) and drops them from the saved settings in one save, once per new snapshot or team (clearStaleReturnWeeks).
 */
import { createContext, use, useMemo } from "react";
import { staleReturnWeeks, type ReturnWeekSnapshot } from "@/engine/returnWeeks";
import type { TradeSettings } from "@/engine/settings";
import type { SaveResult } from "@/lib/importStore";
import { applySettingsEdit } from "../settings/settingsView";
import { changeSavedSettings } from "../settings/useLeagueSettings";

/**
 * What the League page provides: the league's key in the league store, its settings as the browser holds them now, and the
 * NFL season of the snapshot it shows (the season a return week is set for: review of wave C, UI-C-3).
 */
export interface LeagueSettingsEditValue {
  leagueKey: string;
  settings: TradeSettings;
  season: number;
}

/**
 * A save's result (the store's), with what else the edit changed when it says so: locking a must-include player takes him
 * off that list, "Romeo Doubs is no longer a must-include player." (the Settings page's own note: settingsView.ts
 * applySettingsEdit; review of wave C, UI-C-9: the lock changed the Trade Finder's list without a word).
 */
export type EditResult = SaveResult & { note?: string };

/** Provided by the League page once the league's settings are read; null elsewhere (a section then shows no controls). */
export const LeagueSettingsEditContext = createContext<LeagueSettingsEditValue | null>(null);

/** The edits a League page section can make (useLeagueSettingsEdit). */
export interface LeagueSettingsEdit {
  /** The league's settings as the browser holds them now (a change shows here at once, before the model computes again). */
  settings: TradeSettings;
  /** Whether my player `id` is untouchable (TradeSettings.untouchables). */
  isUntouchable: (id: string) => boolean;
  /** Locks (`on`) or unlocks my player `id`, named `name` in its note (the Settings page's untouchable edit; EditResult). */
  setUntouchable: (id: string, on: boolean, name?: string) => Promise<EditResult>;
  /** Waiver upgrades' "Drop from the same position" (TradeSettings.waiverSamePosition). */
  setWaiverSamePosition: (on: boolean) => Promise<SaveResult>;
  /** My injured player `id`'s return week as the browser holds it now, when it's set for this season (else undefined). */
  returnWeekOf: (id: string) => number | undefined;
  /**
   * My injured player's return week (TradeSettings.returnWeeks): an NFL week (1 to settings.RETURN_WEEK_MAX; "out for the
   * season" is the NFL's last week + 1, as LeagueSnapshot's injuryReturnWeek), or null to go back to the platform's or our
   * own week (the entry goes); set for the snapshot's season (withReturnWeek).
   */
  setReturnWeek: (id: string, week: number | null) => Promise<SaveResult>;
}

/**
 * A league's settings with `id`'s return week set (`week`) or gone (null), for `season` (TradeSettings.returnWeeksSeason;
 * review of wave C, UI-C-3): weeks set for another season don't carry over, so they go.
 */
export function withReturnWeek(settings: TradeSettings, id: string, week: number | null, season: number): TradeSettings {
  const next: Record<string, number> = settings.returnWeeksSeason === season ? { ...settings.returnWeeks } : {};
  if (week === null) delete next[id];
  else next[id] = week;
  return { ...settings, returnWeeks: next, returnWeeksSeason: season };
}

/**
 * A league's settings without the return weeks that no longer count for `snapshot` (its myTeamId the page's team;
 * returnWeeks.ts staleReturnWeeks), the very same object when none is stale (so the page's memos and compute tag hold).
 */
export function withoutStaleReturnWeeks(settings: TradeSettings, snapshot: ReturnWeekSnapshot): TradeSettings {
  const stale = staleReturnWeeks(snapshot, settings);
  if (!stale.length) return settings;
  const next: Record<string, number> = { ...settings.returnWeeks };
  for (const id of stale) delete next[id];
  return { ...settings, returnWeeks: next };
}

/**
 * Drops the return weeks that no longer count for `snapshot` from the league's saved settings, in one save (the League
 * page, once per new snapshot or team: the file header). Run on the copy stored right now too, so a week set meanwhile
 * stays. Resolves as changeSavedSettings does.
 */
export function clearStaleReturnWeeks(leagueKey: string, snapshot: ReturnWeekSnapshot): Promise<SaveResult> {
  return changeSavedSettings(leagueKey, (s) => withoutStaleReturnWeeks(s, snapshot));
}

/** The League page's settings edits, or null when no League page provides them (LeagueSettingsEditContext). */
export function useLeagueSettingsEdit(): LeagueSettingsEdit | null {
  const value = use(LeagueSettingsEditContext);
  return useMemo(() => {
    if (!value) return null;
    const { leagueKey, settings, season } = value;
    return {
      settings,
      isUntouchable: (id) => settings.untouchables.includes(id),
      setUntouchable: (id, on, name) => {
        // The store runs the change on the page's copy, then on the stored one (changeSavedSettings): the note is the edit's.
        let note: string | null = null;
        return changeSavedSettings(leagueKey, (s) => {
          const edit = applySettingsEdit(s, { kind: "untouchable", id, on }, () => name ?? "That player");
          note = edit.note ?? note;
          return edit.settings;
        }).then((r): EditResult => (r.ok && note ? { ...r, note } : r));
      },
      setWaiverSamePosition: (on) => changeSavedSettings(leagueKey, (s) => ({ ...s, waiverSamePosition: on })),
      returnWeekOf: (id) => (settings.returnWeeksSeason === season ? settings.returnWeeks[id] : undefined),
      setReturnWeek: (id, week) => changeSavedSettings(leagueKey, (s) => withReturnWeek(s, id, week, season)),
    };
  }, [value]);
}
