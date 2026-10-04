"use client";
/**
 * The league switcher at the top of every page (CLAUDE.md §14; planner reply to Checkpoint 4b, change 11: several
 * leagues saved in this browser, src/lib/leagueStore.ts), in the site header next to the logo:
 * - The button names the league this tab shows: its name, platform and season ("ESPN · 2026"). The store opens a tab on
 *   the league used last.
 * - It opens a panel (a disclosure, not a menu: Tab moves through it in order) listing every saved league, the one
 *   shown marked (aria-current and a check mark, not color alone), each with Remove; then "Add league" (the Connect
 *   page). Escape or a tap outside closes it, and so does going to another page.
 * - Switching shows the other league at once (selectLeague). ⚠️ A trade page's address names teams and players of the
 *   league it was for (`?partner=&give=&get=`), so it's dropped first (history.replaceState): the other league's page
 *   starts on its own. (The trade pages also read only an address of the league they show, which covers the render
 *   before Next applies the drop, and a switch another tab causes: src/components/trades/finderMemory.ts.)
 * - Remove asks first, in the panel, saying what goes (the import, the team pick, the projections, and the settings and
 *   feedback unless another season of the league is saved: removeLeague), with "Export its feedback first" when it has
 *   feedback that would go. The tab then shows the league used last, or none; when it showed the league removed, its
 *   address is dropped as for a switch, and the status line names the league it shows now (review of track ML).
 * - Nothing shows while the store loads or when no league is saved (the nav's Connect is the way in), so the header's
 *   rows don't move: the button shares the logo's row, which is 44 px tall either way.
 *
 * Accessibility: 44 px targets; the panel's buttons are native; a status line (role="status", always mounted, the same
 * element with or without a league) says what a switch or a removal did. Focus moves to what replaces a control that
 * goes away: a switch or a removal → the button (or, with no league left, the page's main region); Remove → the
 * confirmation's question; Keep it → that league's Remove; Escape → the button. ⚠️ The panel is a light card inside the
 * navy header, whose rule gives focus rings the bright gold that only reads on navy (globals.css): the panel sets
 * --accent to the focus color, so its rings read on the card (4.7 : 1 on white).
 *
 * StorageNotice is the banner under the header when leagues can't be kept (leagueStore.ts StorageStatus): this page's
 * memory only (site data blocked), or the storage went away while the page was open (Reload).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useEffectEvent, useId, useRef, useState, type CSSProperties, type Ref } from "react";
import type { FeedbackRecord } from "@/lib/feedbackStore";
import { plural } from "@/lib/format";
import { PLATFORM_LABEL } from "@/lib/labels";
import { chooseCurrentLeague, removeLeague, selectLeague, type SavedLeague } from "@/lib/leagueStore";
import { useLeagueStorage, useSavedLeagues } from "./league/useLeagueInputs";
import { revealResult } from "./reveal";
import { downloadFeedback, useSavedFeedback } from "./settings/useFeedback";
import { FOCUS_TARGET, buttonClass, cx } from "./ui";

type LeagueParts = Pick<SavedLeague, "name" | "platform" | "season">;

/** A saved league's name: the platform's, else "<platform> league" (pure). */
export function leagueName(league: LeagueParts): string {
  return league.name.trim() || `${PLATFORM_LABEL[league.platform]} league`;
}

/** Its platform and season, as the button's second line says them: "ESPN · 2026" (pure). */
export function leagueMeta(league: LeagueParts): string {
  return `${PLATFORM_LABEL[league.platform]} · ${league.season}`;
}

/** The league in words: "Moonbeam League (ESPN 2026)" (pure). */
export function savedLeagueLabel(league: LeagueParts): string {
  return `${leagueName(league)} (${PLATFORM_LABEL[league.platform]} ${league.season})`;
}

/**
 * What removing a league deletes, in words (pure; removeLeague's rule): its import, the team pick and the projections
 * always; its settings and feedback too unless another saved season of it (`sharedSeason`) keeps them.
 */
export function removalText(feedbackCount: number, sharedSeason: number | null): string {
  if (sharedSeason !== null) {
    return `Its import, your team pick and its projections go. Its settings${feedbackCount ? " and feedback stay" : " stay"}, since its ${sharedSeason} season is saved too.`;
  }
  const feedback = feedbackCount ? ` and your feedback on ${plural(feedbackCount, "trade idea")}` : "";
  return `Its import, your team pick and its projections go, and so do its settings${feedback}. You can import it again from the Connect page.`;
}

/** What the status line says once a league is removed, and, when the tab showed it, which league shows now (pure). */
export function removedText(removed: LeagueParts, next: LeagueParts | null): string {
  return `Removed ${savedLeagueLabel(removed)} from this browser.${next ? ` Now showing ${savedLeagueLabel(next)}.` : ""}`;
}

/** Drops the address's query (a trade page's teams and players of the league that was shown: the header). */
function dropAddressQuery(): void {
  try {
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  } catch {
    // the address keeps its query; the trade pages read only an address of the league they show (finderMemory.ts)
  }
}

/** The panel's custom properties: focus rings in the focus color, not the navy header's bright gold (the header). */
const ON_CARD = { "--accent": "var(--focus)" } as CSSProperties;

type FocusTo = { to: "button" } | { to: "question" } | { to: "remove"; id: string } | { to: "main" };

export function LeagueSwitcher() {
  const saved = useSavedLeagues();
  const pathname = usePathname();
  const allFeedback = useSavedFeedback();
  // The page the panel was opened on (null: closed): going to another page closes it, without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [focus, setFocus] = useState<{ n: number } & FocusTo>();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const removeRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const panelId = useId();
  const open = openOn !== null && openOn === pathname;
  const leagues = saved?.leagues ?? [];
  const currentId = saved?.currentId ?? null;
  const current = leagues.find((l) => l.id === currentId) ?? null;

  const moveFocus = (to: FocusTo) => setFocus((f) => ({ n: (f?.n ?? 0) + 1, ...to }));
  useEffect(() => {
    if (!focus) return;
    if (focus.to === "button") buttonRef.current?.focus();
    else if (focus.to === "question") revealResult(questionRef.current);
    else if (focus.to === "remove") removeRefs.current[focus.id]?.focus();
    else {
      // No league left: the page's main region (the skip link's target), which now says there's none.
      const main = document.getElementById("main");
      if (main && !main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
      main?.focus();
    }
  }, [focus]);

  const close = (returnFocus: boolean) => {
    setOpenOn(null);
    setConfirmId(null);
    setError(null);
    if (returnFocus) moveFocus({ to: "button" });
  };
  // While open: Escape closes it (focus back on the button), and so does a tap outside it.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape") close(true);
  });
  const onPointer = useEffectEvent((e: PointerEvent) => {
    if (wrapRef.current && e.target instanceof Node && !wrapRef.current.contains(e.target)) close(false);
  });
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => onKey(e);
    const pointer = (e: PointerEvent) => onPointer(e);
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", pointer);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", pointer);
    };
  }, [open]);

  function switchTo(league: SavedLeague) {
    close(true);
    if (league.id === currentId) return;
    // The address's teams and players are the other league's (the header).
    dropAddressQuery();
    setNotice(`Now showing ${savedLeagueLabel(league)}.`);
    void selectLeague(league.id).then((done) => {
      if (!done.ok) setNotice(done.message);
    });
  }

  function askRemove(id: string) {
    setConfirmId(id);
    setError(null);
    moveFocus({ to: "question" });
  }

  function keep(id: string) {
    setConfirmId(null);
    setError(null);
    moveFocus({ to: "remove", id });
  }

  async function remove(league: SavedLeague, othersLeft: boolean) {
    // (Its button stays focusable while it works: a second press waits for the first.)
    if (removing) return;
    setRemoving(true);
    setError(null);
    const wasShown = league.id === currentId;
    // The league the tab moves to when it showed this one (the store's rule: the league used last).
    const nextId = wasShown ? chooseCurrentLeague(leagues.filter((l) => l.id !== league.id), null) : null;
    const next = leagues.find((l) => l.id === nextId) ?? null;
    const done = await removeLeague(league.id);
    setRemoving(false);
    if (!done.ok) {
      setError(done.message);
      return;
    }
    // Its address (a trade page's teams and players) isn't the next league's (the header; review of track ML).
    if (wasShown) dropAddressQuery();
    setOpenOn(null);
    setConfirmId(null);
    setNotice(removedText(league, next));
    moveFocus(othersLeft ? { to: "button" } : { to: "main" });
  }

  const switcher = leagues.length ? (
    <div ref={wrapRef} data-league-switcher="" className="min-w-0 flex-[1_1_12rem] sm:relative sm:max-w-sm lg:max-w-xs">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close(false) : setOpenOn(pathname))}
        className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-white/20 px-2.5 py-1 text-left hover:bg-white/10"
      >
        <span className="min-w-0 flex-1">
          <span className="sr-only">League: </span>
          <span className="block truncate text-sm leading-tight font-extrabold">{current ? leagueName(current) : "Pick a league"}</span>
          <span className="sr-only">, </span>
          <span className="block truncate text-xs leading-tight text-navy-contrast/75">{current ? leagueMeta(current) : `${plural(leagues.length, "league")} saved`}</span>
          <span className="sr-only"> (switch leagues)</span>
        </span>
        <svg viewBox="0 0 20 20" aria-hidden className={cx("size-4 shrink-0 transition-transform", open && "rotate-180")}>
          <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <LeaguePanel
          id={panelId}
          leagues={leagues}
          currentId={currentId}
          feedback={allFeedback ?? []}
          confirmId={confirmId}
          removing={removing}
          error={error}
          questionRef={questionRef}
          removeRef={(id, el) => {
            removeRefs.current[id] = el;
          }}
          onSwitch={switchTo}
          onAskRemove={askRemove}
          onKeep={keep}
          onRemove={(league) => void remove(league, leagues.length > 1)}
          onAdd={() => close(false)}
        />
      ) : null}
    </div>
  ) : null;

  return (
    <>
      {switcher}
      {/* The same element with or without a league, so removing the last one is announced too. */}
      <p role="status" className="sr-only">
        {notice}
      </p>
    </>
  );
}

export interface LeaguePanelProps {
  id: string;
  leagues: readonly SavedLeague[];
  currentId: string | null;
  /** Every league's saved feedback (a removal says how much of a league's goes, and offers to export it first). */
  feedback: readonly FeedbackRecord[];
  /** The league whose removal is being confirmed, or null. */
  confirmId: string | null;
  removing: boolean;
  /** Why the last removal didn't happen, or null. */
  error: string | null;
  questionRef?: Ref<HTMLParagraphElement> | undefined;
  removeRef?: ((leagueId: string, el: HTMLButtonElement | null) => void) | undefined;
  onSwitch: (league: SavedLeague) => void;
  onAskRemove: (leagueId: string) => void;
  onKeep: (leagueId: string) => void;
  onRemove: (league: SavedLeague) => void;
  onAdd: () => void;
}

/**
 * The switcher's panel (no state of its own, so tests render it): every saved league, the one shown marked, each with
 * Remove and, while it's being confirmed, the question, what goes, "Export its feedback first" when its feedback would
 * go, "Yes, remove it" and "Keep it"; then "Add league".
 */
export function LeaguePanel({ id, leagues, currentId, feedback, confirmId, removing, error, questionRef, removeRef, onSwitch, onAskRemove, onKeep, onRemove, onAdd }: LeaguePanelProps) {
  const listId = useId();
  const questionId = useId();
  return (
    <div
      id={id}
      style={ON_CARD}
      className="absolute inset-x-4 top-full z-40 mt-1 max-h-[min(75vh,36rem)] overflow-y-auto rounded-2xl border border-line bg-surface p-3 text-foreground shadow-xl sm:inset-x-auto sm:left-0 sm:w-96"
    >
      <p id={listId} className="px-1 text-xs font-bold tracking-wider text-brand-strong uppercase dark:text-brand">
        Your leagues
      </p>
      <ul aria-labelledby={listId} className="mt-1 space-y-1">
        {leagues.map((l) => {
          const isCurrent = l.id === currentId;
          const records = feedback.filter((r) => r.leagueKey === l.leagueKey);
          const sharedWith = leagues.find((o) => o.id !== l.id && o.leagueKey === l.leagueKey) ?? null;
          return (
            <li key={l.id}>
              <div className="flex items-stretch gap-1">
                <button
                  type="button"
                  data-league-id={l.id}
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => onSwitch(l)}
                  className={cx("flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-surface-muted", isCurrent && "bg-brand-soft")}
                >
                  <span aria-hidden className="w-4 shrink-0 text-center font-extrabold text-brand-strong dark:text-brand">
                    {isCurrent ? "✓" : ""}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-bold break-words">{leagueName(l)}</span>
                    <span className="block text-xs text-muted">
                      {leagueMeta(l)}
                      {isCurrent ? " · showing now" : ""}
                    </span>
                  </span>
                </button>
                <button
                  ref={removeRef ? (el) => removeRef(l.id, el) : undefined}
                  type="button"
                  data-remove-league={l.id}
                  onClick={() => onAskRemove(l.id)}
                  className="min-h-11 shrink-0 rounded-lg px-2.5 text-sm font-bold text-danger-fg hover:bg-danger-bg"
                >
                  Remove<span className="sr-only"> {savedLeagueLabel(l)}</span>
                </button>
              </div>
              {confirmId === l.id ? (
                <div role="group" aria-labelledby={questionId} className="mt-1 rounded-xl border border-danger-line p-3">
                  <p ref={questionRef} id={questionId} tabIndex={FOCUS_TARGET.tabIndex} className={cx("text-sm font-bold break-words", FOCUS_TARGET.className)}>
                    Remove {savedLeagueLabel(l)} from this browser?
                  </p>
                  <p className="mt-1 text-sm text-muted">{removalText(records.length, sharedWith?.season ?? null)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {records.length && !sharedWith ? (
                      <button type="button" onClick={() => downloadFeedback(records)} className={cx(buttonClass("secondary", "sm"), "min-h-11")}>
                        Export its feedback first
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onRemove(l)}
                      aria-disabled={removing || undefined}
                      className={cx(buttonClass("danger", "sm"), "min-h-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-60")}
                    >
                      {removing ? "Removing…" : "Yes, remove it"}
                    </button>
                    <button type="button" onClick={() => onKeep(l.id)} className={cx(buttonClass("secondary", "sm"), "min-h-11")}>
                      Keep it
                    </button>
                  </div>
                  {error ? (
                    <p role="alert" className="mt-2 text-sm font-semibold text-danger-fg">
                      {error}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Link
        href="/connect"
        onClick={onAdd}
        className="mt-2 flex min-h-11 items-center justify-center rounded-lg border border-dashed border-line px-3 text-sm font-bold text-brand-strong hover:bg-brand-soft dark:text-brand"
      >
        Add league
      </Link>
    </div>
  );
}

/** The banner under the header when leagues can't be kept: this page's memory only, or reload (the header). */
export function StorageNotice() {
  const storage = useLeagueStorage();
  if (!storage || storage.kind === "indexeddb") return null;
  const closed = storage.kind === "closed";
  return (
    <div role={closed ? "alert" : "status"} className="border-b border-warn-line bg-warn-bg text-warn-fg">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm font-semibold">
        <p className="min-w-0 flex-1">{storage.message}</p>
        {closed ? (
          <button type="button" onClick={() => window.location.reload()} className={cx(buttonClass("secondary", "sm"), "min-h-11")}>
            Reload
          </button>
        ) : null}
      </div>
    </div>
  );
}
