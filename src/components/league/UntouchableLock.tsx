"use client";
/**
 * The lock icon (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.3: "users can do it from the roster card and the
 * waiver view, with a lock icon, not only from the Trade Finder"): marks one of my players untouchable, or not, through the
 * League page's settings edits (leagueSettingsEdit.ts: the Settings page's own untouchable edit). An untouchable player is
 * never offered in a trade idea and never suggested as a drop (Waiver upgrades, a trade's roster moves, the release when a
 * player comes back from IR).
 *
 * The icon is an inline SVG (no icon library): a closed lock when he's untouchable, an open one when not. Never color
 * alone: a toggle button (aria-pressed) whose accessible name stays the same whichever way it's set, "Untouchable: Romeo
 * Doubs" (review of wave C, UI-C-10: a name that also changed with the state was read as "Romeo Doubs is untouchable.
 * Unlock him, toggle button, pressed"), with what pressing it does on hover (its title: "Lock Romeo Doubs as untouchable" /
 * "Romeo Doubs is untouchable. Unlock him"). 44 px square on every screen (a tap target). A change the browser refuses shows
 * its reason next to the button (role alert); a lock that also takes him off the must-include players says so (role status:
 * "Romeo Doubs is no longer a must-include player.", the Settings page's own note; review of wave C, UI-C-9). The button
 * carries his id (data-untouchable-lock), so a list that redraws after a change can put focus back on his lock (Waiver
 * upgrades). Without a League page around it (LeagueSettingsEditContext), or for a player who isn't mine, render nothing:
 * the caller decides.
 */
import { useState } from "react";
import { cx } from "../ui";
import { useLeagueSettingsEdit } from "./leagueSettingsEdit";

/** The button's accessible name: the same whichever way it's set (aria-pressed says which). */
export function untouchableLockName(name: string): string {
  return `Untouchable: ${name}`;
}

/** The button's title (hover): what pressing it does, and the state it's in. */
export function untouchableLockLabel(name: string, locked: boolean): string {
  return locked ? `${name} is untouchable. Unlock him` : `Lock ${name} as untouchable`;
}

/** The attribute a lock's button carries its player's id in (Waiver upgrades finds it again after a redraw). */
export const LOCK_PLAYER_ATTRIBUTE = "data-untouchable-lock";

/**
 * What the lock does, said where the locks are (the final review of Checkpoint 7e, UI-F-3: it was only in the button's
 * accessible name and its hover, which a phone doesn't have): once over my roster (LeagueView.tsx Rosters) and once in Waiver
 * upgrades (WaiverUpgrades.tsx), the Settings page's untouchables help in short (settingsView.ts UNTOUCHABLES_HELP).
 */
export const LOCK_HELP = "The lock next to one of your players makes him untouchable: trade ideas never offer him, and he's never suggested as a drop.";

/** LOCK_HELP as a line, only where the locks are: with the League page's settings edits (none without them, as the lock). */
export function LockHelp({ className }: { className?: string }) {
  const edit = useLeagueSettingsEdit();
  return edit ? <p className={className}>{LOCK_HELP}</p> : null;
}

/** The CSS selector of my player `id`'s lock buttons (LOCK_PLAYER_ATTRIBUTE). */
export function lockSelector(id: string): string {
  return `button[${LOCK_PLAYER_ATTRIBUTE}="${id.replace(/["\\]/g, "\\$&")}"]`;
}

/** The lock button for my player `playerId` (named `name` in its label). */
export function UntouchableLock({ playerId, name, className }: { playerId: string; name: string; className?: string }) {
  const edit = useLeagueSettingsEdit();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (!edit) return null;
  const locked = edit.isUntouchable(playerId);
  const title = untouchableLockLabel(name, locked);
  const toggle = () => {
    setError(null);
    setNote(null);
    void edit.setUntouchable(playerId, !locked, name).then((r) => {
      if (!r.ok) setError(r.message);
      else if (r.note) setNote(r.note);
    });
  };
  return (
    <span className={cx("inline-flex items-center gap-1", className)}>
      <button
        type="button"
        aria-pressed={locked}
        aria-label={untouchableLockName(name)}
        title={title}
        data-untouchable-lock={playerId}
        onClick={toggle}
        className={cx(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-xl border transition-colors",
          locked ? "border-brand bg-brand-soft text-brand-strong dark:text-brand" : "border-transparent text-muted hover:border-line hover:bg-surface-muted",
        )}
      >
        <LockIcon closed={locked} />
      </button>
      {/* Always there (out of the layout while empty), so a note put in it is announced. */}
      <span role="status" className={note && !error ? "text-xs text-muted" : "sr-only"}>
        {note && !error ? note : ""}
      </span>
      {error ? (
        <span role="alert" className="text-xs font-semibold text-danger-fg">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** A padlock, closed or open (decorative: the button's name and state say it). */
function LockIcon({ closed }: { closed: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="9" width="12" height="8.5" rx="1.8" fill={closed ? "currentColor" : "none"} />
      {closed ? <path d="M6.8 9V6.6a3.2 3.2 0 0 1 6.4 0V9" /> : <path d="M6.8 9V6.6a3.2 3.2 0 0 1 6.2-1.1" />}
    </svg>
  );
}
