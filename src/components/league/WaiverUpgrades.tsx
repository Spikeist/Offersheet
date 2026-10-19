"use client";
/**
 * "Waiver upgrades" on the League page (planner reply to Checkpoint 7a, §6.2; CLAUDE.md §14 item 3): the free agents who
 * project for more points than one of my players at their position, each as one move, add him and drop the player named
 * (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.1), with two numbers: on "Rest of season" Helps you for that exact
 * swap and how many more rest-of-season points he scores than the drop (item 3.4; the lineup gain in the row's details),
 * on the one-week lists the lineup gain that week and the week's points against the drop; for the rest of the season or
 * for one week (a toggle; while a week is under way, "This week" for its games still to play and "Next week"). Every word
 * and number comes from buildWaiversView() (src/lib/waiversView.ts); this file only lays it out.
 *
 * Checkpoint 7e's controls (planner reply to Checkpoint 7d, items 3.2 and 3.3), through the League page's settings edits
 * (leagueSettingsEdit.ts; none without them, as in the tests): the "Drop from the same position" switch (on by default; a
 * native checkbox with role switch, its help linked by aria-describedby, a refusal shown in words next to it), the lock icon
 * next to each row's drop (UntouchableLock.tsx: "Untouchable: Romeo Doubs", saved to the league's settings, so the lists come
 * back with another drop), and my untouchables above the lists, each with its lock to unlock him (a move only they could
 * make room for names them, its locks being there: review of wave C, UI-C-7). Every change is a setting the League model
 * reads, so the page computes again (the last numbers dimmed meanwhile), and focus stays with the lock pressed (useLockFocus;
 * UI-C-1).
 *
 * The season list's Helps you (item 3.4) comes on its own request (about a second on Parker's league, over the lead's rule
 * for the League model build): when the view says so (WaiversView.pendingRating), the section asks the engine client that
 * built its model (engineClient.waiverRatingFor) when it first shows, showing the list in points with "Rating these against
 * your odds…" (a status line, so the change is announced) until the answer comes, then the rated view (RatedWaivers). The
 * one-week lists, whose drops are the season list's, say meanwhile that one can change (the final review of Checkpoint 7e,
 * UI-F-7: RATING_PENDING_WEEK_TEXT).
 *
 * Where its view comes from: the League page (LeaguePage.tsx) builds it from the League model it computed and provides it
 * through WaiversViewContext; LeagueView.tsx places <WaiverUpgrades /> among its sections. Without a provider the section
 * renders nothing; without lists (no team picked, my redraft season over, no week left) it shows its heading and one line
 * instead (WaiversView.empty), with a "Pick your team" link to the Import Report when no team is picked (review of Phase 7b:
 * the header's "Waivers" link led nowhere then).
 *
 * The site header's "Waivers" link goes to /league#waivers (WAIVERS_HREF). The League page computes for a few seconds
 * first, so when the section appears with that hash in the address it brings itself into view and moves keyboard focus to
 * its heading (NavLink.revealSection: Next leaves focus where it was), once, when it mounts; a tap on the link while the
 * section is on the page reveals it the same way (NavLink.revealSectionLink).
 *
 * At 375 px: one card per move (no table: seven columns don't fit a phone), the add line and the drop line (with its lock)
 * wrapping, the two numbers on the card's right from sm up and under the names on a phone; tags in words (never color
 * alone); 44 px toggle, switch, lock, "Show all" and fold targets (the toggle's three buttons wrap rather than overflow on a
 * narrow phone, the fold's words wrap inside its button).
 *
 * Checkpoint 7f (planner reply to Checkpoint 7e, item 3: "Show the rows that rate above 0, followed by a collapsed “N more
 * pickups that don't help you (show).”"): each list shows above the fold the rows that help and then (review of Checkpoint
 * 7f, WAIVERS-1) the moves that can't be made, the first config.waivers.rowsShown of them, then "Show all N" (N the rows
 * above the fold), with a line when none helps; then one button, a disclosure (aria-expanded), "42 more pickups that don't
 * help you (show)", which shows the "No gain" rows in their own list right after it ("(hide)" folds them again). The button
 * stays where it is, the list opening below it, so keyboard focus stays on it either way; aria-controls names the list only
 * while it's there. The toggle folds both again; a recompute (a lock, the switch, the rating's answer) keeps them as they
 * are, but "Show all" closes for good once the rows above the fold are no more than it shows at first, and when a recompute
 * takes away "Show all" or the fold's button while it has keyboard focus, focus moves to the fold's button, else the
 * section's heading (useFocusFallback; review of Checkpoint 7f, WAIVERS-2: focus fell to the page). Which rows help, and the
 * words: waiversView.ts (WaiverListView.helping, .blocked, .rest, .noneHelps).
 *
 * Checkpoint 7h (planner reply to Checkpoint 7g, sections 1 and 5; the lead's rulings for the waivers track): each row compact,
 * the move, its main number and "Outscores" line, why a move can't be made and the status pills, with its own 44 px "Details"
 * (WaiverRowCard: a button, aria-expanded and aria-controls naming its panel, which is always in the page, hidden until it's
 * opened, so the button never moves and keeps keyboard focus) holding Points, Better than, Lineup gain, the odds lines a rated
 * row carries ("Your odds: without a pickup → with this one", then "Title odds 8.9% → 9.2%" …: waiversView.ts
 * waiverOddsLines) and Why no gain; each list's long note as one line with a 44 px "Why?" at its end over the rest (WhyNote,
 * the same kind of disclosure), which the toggle closes again. A redraw that takes away a row's Details button while it has
 * keyboard focus (the rating's answer moves a row into the fold) gives focus to that row's button wherever it now is, else
 * the fold's button, else the heading (useFocusFallback).
 */
import Link from "next/link";
import { Fragment, createContext, use, useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { EngineError, waiverRatingFor, waiverRatingKnown } from "@/lib/engineClient";
import {
  DEPTH_ONLY_TAG,
  DETAILS_TEXT,
  ODDS_LABEL,
  RATING_FAILED_TEXT,
  RATING_PENDING_TEXT,
  RATING_PENDING_WEEK_TEXT,
  SAME_POSITION_HELP,
  SAME_POSITION_LABEL,
  UNTOUCHABLES_LABEL,
  WAIVERS_SECTION_ID,
  WAIVERS_TITLE,
  WHY_TEXT,
  buildWaiversView,
  type WaiverListMode,
  type WaiverListView,
  type WaiverRatingStatus,
  type WaiverRowView,
  type WaiversInput,
  type WaiversView,
} from "@/lib/waiversView";
import { browserSectionPage, revealSection } from "../NavLink";
import { Badge, Card, CardTitle, Spinner, buttonClass, cx } from "../ui";
import { useLeagueSettingsEdit } from "./leagueSettingsEdit";
import { LOCK_HELP, LOCK_PLAYER_ATTRIBUTE, UntouchableLock, lockSelector } from "./UntouchableLock";

/** The section's view (buildWaiversView), provided by the League page; null: nothing to show. */
export const WaiversViewContext = createContext<WaiversView | null>(null);

/** The section, from the League page's context (the file header). */
export function WaiverUpgrades() {
  const view = use(WaiversViewContext);
  return view ? <RatedWaivers view={view} /> : null;
}

/**
 * The section with its season list rated (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.4): when the view says the
 * list waits for its rating (WaiversView.pendingRating: the League page's model is built without it), it asks the engine
 * client that built the model, once per model (engineClient.waiverRatingFor), and shows the view built again from the answer;
 * meanwhile the list in points with "Rating these against your odds…", and if the rating fails, the list in points with a
 * line that says so. A stopped engine (the page gone) says nothing. Another model (a recompute) asks again.
 */
function RatedWaivers({ view }: { view: WaiversView }) {
  const pending = view.pendingRating ?? null;
  const [answer, setAnswer] = useState<{ for: WaiversInput; view: WaiversView | null } | null>(null);
  useEffect(() => {
    if (!pending) return undefined;
    const asked = waiverRatingFor(pending.model);
    if (!asked) return undefined;
    let live = true;
    asked.then(
      (rated) => {
        if (live) setAnswer({ for: pending, view: rated ? buildWaiversView({ ...pending, model: { ...pending.model, waiverUpgrades: rated } }) : null });
      },
      (err: unknown) => {
        if (live && !(err instanceof EngineError && err.cancelled)) setAnswer({ for: pending, view: null });
      },
    );
    return () => {
      live = false;
    };
  }, [pending]);
  const done = answer && answer.for === pending ? answer : null;
  const rating: WaiverRatingStatus = !pending ? null : done ? (done.view ? null : "failed") : waiverRatingKnown(pending.model) ? "pending" : null;
  return <WaiverUpgradesCard view={done?.view ?? view} rating={rating} />;
}

/** The lists in toggle order: rest of season, the week under way ("This week"), then "This week" or "Next week". */
function waiverLists(view: WaiversView): WaiverListView[] {
  return [view.ros, view.underWay, view.week].filter((l): l is WaiverListView => l !== null);
}

/**
 * Keeps keyboard focus with a lock pressed in the section while the lists redraw (review of wave C, UI-C-1): a lock press
 * computes the page again, and the row that held the lock may then drop someone else, move, or go (focus fell to the page,
 * or stayed on a reused button that now locked another player). Each lock carries its player's id (UntouchableLock
 * LOCK_PLAYER_ATTRIBUTE, the row's drop lock keyed by him); when the lists redraw with focus lost, it goes to that player's
 * lock wherever it now is (the untouchables line after locking him, a row's drop after unlocking him), else to the section's
 * heading (SettingsForm.tsx useRemoveFocus is the Settings page's own pattern; since Checkpoint 7f also when his row now sits
 * in the fold while it's closed). Any other press or key ends the watch, so focus is never taken back later.
 */
function useLockFocus(view: WaiversView, heading: RefObject<HTMLHeadingElement | null>) {
  const pressed = useRef<string | null>(null);
  useEffect(() => {
    const lockOf = (e: Event): Element | null => (e.target instanceof Element ? e.target.closest(`button[${LOCK_PLAYER_ATTRIBUTE}]`) : null);
    const onClick = (e: MouseEvent) => {
      const lock = lockOf(e);
      pressed.current = lock && document.getElementById(WAIVERS_SECTION_ID)?.contains(lock) ? lock.getAttribute(LOCK_PLAYER_ATTRIBUTE) : null;
    };
    const onOther = (e: Event) => {
      if (!lockOf(e)) pressed.current = null;
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerdown", onOther, true);
    document.addEventListener("keydown", onOther, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointerdown", onOther, true);
      document.removeEventListener("keydown", onOther, true);
    };
  }, []);
  useEffect(() => {
    const id = pressed.current;
    if (!id) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const lock = document.getElementById(WAIVERS_SECTION_ID)?.querySelector<HTMLButtonElement>(lockSelector(id));
    (lock ?? heading.current)?.focus();
  }, [view, heading]);
}

/** A button's ref callback that can say, as the button goes, whether it had keyboard focus (useFocusFallback). */
type TrackedRef = (el: HTMLButtonElement | null) => (() => void) | undefined;

/** The attribute a row's "Details" button carries its player's id in (Checkpoint 7h: focus follows him across a redraw). */
export const DETAILS_PLAYER_ATTRIBUTE = "data-waiver-details";

/** The CSS selector of the "Details" button of the row adding player `id` (DETAILS_PLAYER_ATTRIBUTE). */
function detailsSelector(id: string): string {
  return `button[${DETAILS_PLAYER_ATTRIBUTE}="${id.replace(/["\\]/g, "\\$&")}"]`;
}

/**
 * Keeps keyboard focus in the section when a redraw takes away the button that had it (review of Checkpoint 7f, WAIVERS-2 and
 * INTEGRATION-2): "Show all N" (or "Show fewer") counts the rows above the fold, so the rating's answer, a lock or the switch
 * can leave too few for it (on Parker's second league, 11 rows help by the lineup gain while the rating is pending, 1 once
 * it's rated), and a list without "No gain" rows has no fold; focus fell to the page. Each of the two buttons notes as it goes
 * whether it had focus (its ref's cleanup runs while it's still in the page), and once the redraw is done focus moves to the
 * next control left, the fold's button, else the section's heading (useLockFocus's fallback), only while focus is still lost,
 * so a press or a key since is never undone. Checkpoint 7h: a row's "Details" button too (the rating's answer can move its row
 * into the fold, or out of it, remounting it): focus goes to the same row's button wherever it now is (DETAILS_PLAYER_ATTRIBUTE),
 * else as above.
 */
function useFocusFallback(heading: RefObject<HTMLHeadingElement | null>): { trackShowAll: TrackedRef; trackFold: TrackedRef; trackDetails: TrackedRef } {
  const fold = useRef<HTMLButtonElement | null>(null);
  // false: nothing lost; true: a button that's gone for good; a string: the player whose row's "Details" button went.
  const lost = useRef<boolean | string>(false);
  const trackShowAll = useCallback<TrackedRef>((el) => {
    if (!el) return undefined;
    return () => {
      if (document.activeElement === el) lost.current = true;
    };
  }, []);
  const trackFold = useCallback<TrackedRef>((el) => {
    if (!el) return undefined;
    fold.current = el;
    return () => {
      if (document.activeElement === el) lost.current = true;
      if (fold.current === el) fold.current = null;
    };
  }, []);
  const trackDetails = useCallback<TrackedRef>((el) => {
    if (!el) return undefined;
    return () => {
      if (document.activeElement === el) lost.current = el.getAttribute(DETAILS_PLAYER_ATTRIBUTE) ?? true;
    };
  }, []);
  useEffect(() => {
    const was = lost.current;
    if (!was) return;
    lost.current = false;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const same = typeof was === "string" ? document.getElementById(WAIVERS_SECTION_ID)?.querySelector<HTMLButtonElement>(detailsSelector(was)) : null;
    (same ?? fold.current ?? heading.current)?.focus();
  });
  return { trackShowAll, trackFold, trackDetails };
}

/**
 * The section for a given view (tests render it directly); `rating`: the season list's rating under way, or failed
 * (RatedWaivers); `open`: whether "Show all", the fold and (Checkpoint 7h) the list's "Why?" start open (the page starts
 * them closed; static-render tests open them to read every row). Each row's "Details" starts closed; its panel is in the
 * markup either way (hidden).
 */
export function WaiverUpgradesCard({ view, rating = null, open }: { view: WaiversView; rating?: WaiverRatingStatus; open?: { all?: boolean; more?: boolean; why?: boolean } }) {
  const [mode, setMode] = useState<WaiverListMode>(view.first);
  const [all, setAll] = useState(open?.all ?? false);
  const [more, setMore] = useState(open?.more ?? false);
  const [why, setWhy] = useState(open?.why ?? false);
  // The heading takes focus from script (tabIndex −1) when the section is revealed (the file header).
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Arrived through the header's link (the file header): bring the section into view once it's there, its heading focused.
  useEffect(() => {
    if (window.location.hash === `#${WAIVERS_SECTION_ID}`) revealSection(browserSectionPage(), WAIVERS_SECTION_ID);
  }, []);
  useLockFocus(view, headingRef);
  const { trackShowAll, trackFold, trackDetails } = useFocusFallback(headingRef);
  const lists = waiverLists(view);
  const list = lists.find((l) => l.mode === mode) ?? lists[0] ?? null;
  // "Show all" opened closes for good once the rows above the fold are no more than it shows at first (review of Checkpoint
  // 7f, WAIVERS-2: it stayed open unseen, so a later list with more opened expanded), set during render as React documents for
  // state that follows the props, guarded so it runs once.
  if (all && (!list || list.helping + list.blocked <= list.shown)) setAll(false);
  return (
    <Card id={WAIVERS_SECTION_ID} className="scroll-mt-4">
      <CardTitle eyebrow="Free agents" headingRef={headingRef}>
        {WAIVERS_TITLE}
      </CardTitle>
      <p className="-mt-1 mb-3 text-sm text-muted">{view.intro}</p>
      {view.empty ? <p className="text-sm">{view.empty}</p> : null}
      {view.emptyLink ? (
        <Link href={view.emptyLink.href} className="mt-1 inline-flex min-h-11 items-center font-bold underline underline-offset-2">
          {view.emptyLink.text}
        </Link>
      ) : null}
      {lists.length ? <WaiverControls view={view} /> : null}
      {lists.length > 1 ? (
        <div role="group" aria-label="Which weeks" className="mb-3 inline-flex max-w-full flex-wrap rounded-xl border border-line bg-surface-muted p-1">
          {lists.map((l) => (
            <button
              key={l.mode}
              type="button"
              aria-pressed={list?.mode === l.mode}
              onClick={() => {
                setMode(l.mode);
                setAll(false);
                setMore(false);
                setWhy(false);
              }}
              className={cx("min-h-11 rounded-lg px-3 text-sm font-bold", list?.mode === l.mode ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground")}
            >
              {l.label}
            </button>
          ))}
        </div>
      ) : null}
      {list ? (
        <WaiverListBody
          list={list}
          all={all}
          onShowAll={() => setAll((a) => !a)}
          more={more}
          onMore={() => setMore((m) => !m)}
          why={why}
          onWhy={() => setWhy((w) => !w)}
          rating={rating}
          showAllRef={trackShowAll}
          foldRef={trackFold}
          detailsRef={trackDetails}
        />
      ) : null}
    </Card>
  );
}

/**
 * "Drop from the same position" and my untouchables (the file header): the switch shows the setting as the browser holds it
 * now (a change shows at once; the lists follow when the page has computed again), else as the lists were built.
 */
function WaiverControls({ view }: { view: WaiversView }) {
  const edit = useLeagueSettingsEdit();
  const helpId = useId();
  const [error, setError] = useState<string | null>(null);
  const untouchables = view.untouchables ?? [];
  if (!edit && !untouchables.length) return null;
  const on = edit ? edit.settings.waiverSamePosition : (view.samePosition ?? true);
  return (
    <div className="mb-3 space-y-2">
      {edit ? (
        <div>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-bold">
            <input
              type="checkbox"
              role="switch"
              aria-describedby={helpId}
              checked={on}
              onChange={(e) => {
                setError(null);
                void edit.setWaiverSamePosition(e.target.checked).then((r) => {
                  if (!r.ok) setError(r.message);
                });
              }}
              className="size-5 shrink-0 accent-brand"
            />
            {SAME_POSITION_LABEL}
          </label>
          <p id={helpId} className="text-xs text-muted">
            {SAME_POSITION_HELP}
          </p>
          {/* What the lock next to each drop does, in words (the final review of Checkpoint 7e, UI-F-3: hover only before). */}
          <p className="mt-1 text-xs text-muted">{LOCK_HELP}</p>
          {error ? (
            <p role="alert" className="text-xs font-semibold text-danger-fg">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      {untouchables.length ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="text-muted">{UNTOUCHABLES_LABEL}</span>
          {untouchables.map((u) => (
            <span key={u.id} className="inline-flex items-center gap-1 wrap-anywhere">
              {u.name}
              <UntouchableLock playerId={u.id} name={u.fullName} />
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One list (the file header): the line saying none helps when none does, the rows above the fold (those that help, then the
 * moves that can't be made: the first `shown`, then "Show all"), then the fold's button and, while it's open, the "No gain"
 * rows in their own list right after it. Each part keeps its place among its siblings whatever the others show, so the fold's
 * button is never remounted (focus stays on it). The wrapper says which list it is, whether it's rated and how many rows it
 * has, for check:browser (data-waiver-list, data-rated, data-waiver-total: review of Checkpoint 7f, WAIVERS-3, so a fold that
 * goes missing fails rather than reading as a list whose every row shows).
 */
function WaiverListBody({
  list,
  all,
  onShowAll,
  more,
  onMore,
  why,
  onWhy,
  rating,
  showAllRef,
  foldRef,
  detailsRef,
}: {
  list: WaiverListView;
  all: boolean;
  onShowAll: () => void;
  more: boolean;
  onMore: () => void;
  why: boolean;
  onWhy: () => void;
  rating: WaiverRatingStatus;
  showAllRef: TrackedRef;
  foldRef: TrackedRef;
  detailsRef: TrackedRef;
}) {
  const restId = useId();
  const above = list.rows.slice(0, list.helping + list.blocked);
  const rows = all ? above : above.slice(0, list.shown);
  const rest = list.rest;
  return (
    <div data-waiver-list={list.mode} data-rated={list.rated ? "true" : "false"} data-waiver-total={list.rows.length}>
      {list.underWay ? <p className="mb-1 text-sm font-semibold">{list.underWay}</p> : null}
      {/* The season list's rating (the file header): its line stays mounted, so each change is announced. A one-week list's
          drops are the season list's, so it says meanwhile that one can change (the final review of Checkpoint 7e, UI-F-7). */}
      {list.mode === "ros" ? (
        <p role="status" className={cx("text-sm font-semibold text-muted", rating && "mb-2 flex items-center gap-2")}>
          {rating === "pending" ? <Spinner /> : null}
          {rating === "pending" ? RATING_PENDING_TEXT : rating === "failed" ? RATING_FAILED_TEXT : ""}
        </p>
      ) : (
        <p role="status" className={cx("text-sm font-semibold text-muted", rating === "pending" && "mb-2 flex items-center gap-2")}>
          {rating === "pending" ? <Spinner /> : null}
          {rating === "pending" ? RATING_PENDING_WEEK_TEXT : ""}
        </p>
      )}
      <WhyNote list={list} open={why} onToggle={onWhy} />
      {list.rows.length ? (
        <>
          {/* No row helps: the line says so, before any move that can't be made (review of Checkpoint 7f, WAIVERS-1). */}
          {list.noneHelps ? (
            <p data-waiver-none="" className="text-sm">
              {list.noneHelps}
            </p>
          ) : null}
          {above.length ? (
            <ul data-waiver-rows="shown" aria-label={list.caption} className={cx("space-y-2", list.noneHelps && "mt-3")}>
              {rows.map((r) => (
                <WaiverRowCard key={r.id} row={r} weekLabel={list.weekLabel} depthOnlyTitle={list.depthOnlyTitle} detailsRef={detailsRef} />
              ))}
            </ul>
          ) : null}
          {above.length > list.shown ? (
            <button ref={showAllRef} type="button" aria-expanded={all} onClick={onShowAll} className={cx(buttonClass("secondary"), "mt-3")}>
              {all ? "Show fewer" : `Show all ${above.length}`}
            </button>
          ) : null}
          {/* The rows that don't help, folded (Checkpoint 7f, item 3): a block of its own, so it never sits beside "Show all";
              its words wrap inside the button on a phone. The list opens after it, so the button doesn't move. */}
          {rest ? (
            <div className="mt-3">
              <button
                ref={foldRef}
                type="button"
                aria-expanded={more}
                aria-controls={more ? restId : undefined}
                data-waiver-more=""
                onClick={onMore}
                className={cx(buttonClass("secondary"), "max-w-full py-2 text-left")}
              >
                {more ? rest.hide : rest.show}
              </button>
            </div>
          ) : null}
          {rest && more ? (
            <ul id={restId} data-waiver-rows="rest" aria-label={rest.caption} className="mt-3 space-y-2">
              {list.rows.slice(list.helping + list.blocked).map((r) => (
                <WaiverRowCard key={r.id} row={r} weekLabel={list.weekLabel} depthOnlyTitle={list.depthOnlyTitle} detailsRef={detailsRef} />
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted">{list.empty}</p>
      )}
    </div>
  );
}

/**
 * A list's one line and its "Why?" (Checkpoint 7h; planner reply to Checkpoint 7g, section 1: "cut each long explanation
 * paragraph to one line. The rest goes behind a "Why?" control"): the line (WaiverListView.lead) with a 44 px button at its end
 * (aria-expanded, aria-controls naming the rest), then the rest (WaiverListView.note), hidden until it's opened and always in
 * the page, so the button keeps keyboard focus and check:browser's text scans read it. Its words name the list for screen
 * readers ("Why? (more on Rest of season's numbers)").
 */
function WhyNote({ list, open, onToggle }: { list: WaiverListView; open: boolean; onToggle: () => void }) {
  const id = useId();
  return (
    <div className="mb-3 text-xs leading-relaxed text-muted">
      <p>
        {list.lead}{" "}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className="inline-flex min-h-11 items-center px-1 align-middle font-bold text-foreground underline underline-offset-2"
        >
          {WHY_TEXT}
          <span className="sr-only"> (more on {list.label}&apos;s numbers)</span>
        </button>
      </p>
      <p id={id} hidden={!open}>
        {list.note}
      </p>
    </div>
  );
}

/**
 * One move (the file header), compact (Checkpoint 7h; planner reply to Checkpoint 7g, sections 1 and 5): "Add" him (position,
 * NFL team, and his bye, or on a one-week list the week's opponent: ⚠️ ours, what a streamer weighs), "Drop" the player named
 * with his lock (or an open roster spot), the main number and the "Outscores" line with the row's "Details" beside them (on a
 * phone under the names; from sm up on the right, the button under the numbers), why a move can't be made, the status pills;
 * then the details, hidden until "Details" opens them: Points, Better than, Lineup gain, the odds lines ("Your odds: without
 * a pickup → with this one", then each line before → after, as the cards print them) and Why no gain. The panel is always in
 * the page (aria-controls names it; check:browser's text scans read it), so the button never moves and keeps keyboard focus;
 * the button carries the row's player (DETAILS_PLAYER_ATTRIBUTE) so focus can follow him across a redraw (useFocusFallback).
 */
function WaiverRowCard({ row: r, weekLabel, depthOnlyTitle, detailsRef }: { row: WaiverRowView; weekLabel: string; depthOnlyTitle: string; detailsRef: TrackedRef }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <li className="rounded-xl border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="font-extrabold wrap-anywhere">
            <span className="text-xs font-semibold text-muted">Add </span>
            {r.name}{" "}
            <span className="text-xs font-semibold whitespace-nowrap text-muted">
              {r.pos} · {r.nflTeam} ·{" "}
              {r.opponent ? (
                <>
                  <span aria-hidden>{r.opponent.short}</span>
                  <span className="sr-only">{r.opponent.long}</span>
                </>
              ) : (
                r.bye
              )}
            </span>
          </p>
          {r.drop ? (
            <p className="flex flex-wrap items-center gap-x-1 text-sm wrap-anywhere">
              <span>
                <span className="text-xs font-semibold text-muted">Drop </span>
                {r.drop.name} <span className="text-xs text-muted">({r.drop.pos})</span>
              </span>
              {/* Keyed by the player: a redraw that names another drop gives his own lock, never this one re-aimed (UI-C-1). */}
              <UntouchableLock key={r.drop.id} playerId={r.drop.id} name={r.drop.fullName} />
            </p>
          ) : r.dropText ? (
            <p className="text-sm text-muted">{r.dropText}</p>
          ) : null}
        </div>
        <div className="flex w-full items-start justify-between gap-x-3 sm:w-auto sm:flex-col sm:items-end">
          <div className="min-w-0 sm:text-right" title={r.main.title}>
            <p className={cx("font-black tabular-nums", r.main.positive ? "text-ok-fg" : "text-muted")}>
              <span className="text-xs font-semibold text-muted">{r.main.label}: </span>
              {r.main.text}
            </p>
            {r.outscores ? <p className="text-xs text-muted">{r.outscores}</p> : null}
          </div>
          <button
            ref={detailsRef}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            data-waiver-details={r.id}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-bold text-muted hover:text-foreground"
          >
            {DETAILS_TEXT}
            <span className="sr-only"> ({r.name})</span>
            <span aria-hidden className={cx("inline-block text-xs transition-transform", open && "rotate-180")}>
              ▾
            </span>
          </button>
        </div>
      </div>
      {/* Why he can't be added, the untouchables named (their locks are on the untouchables line above: review of wave C, UI-C-7). */}
      {r.blocked ? (
        <p className="mt-1 text-sm wrap-anywhere">
          {r.blocked.text}
          {r.blocked.hint ? ` ${r.blocked.hint}` : ""}
        </p>
      ) : null}
      {r.injury || r.status || r.depthOnly ? (
        <p className="mt-1 flex flex-wrap gap-1.5">
          {r.injury ? <Badge tone={r.injury.tone}>{r.injury.long}</Badge> : null}
          {r.status ? (
            <span title={r.status.title}>
              <Badge tone="brand">{r.status.text}</Badge>
            </span>
          ) : null}
          {r.depthOnly ? (
            <span title={depthOnlyTitle}>
              <Badge>{DEPTH_ONLY_TAG}</Badge>
            </span>
          ) : null}
        </p>
      ) : null}
      <div id={panelId} hidden={!open} className="mt-1.5">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-sm">
          <dt className="text-muted">Points</dt>
          <dd className="tabular-nums">
            {r.rosText} rest of season · {weekLabel}: {r.weekText}
            {r.opponent ? (
              <>
                {" "}
                <span aria-hidden>{r.opponent.short}</span>
                <span className="sr-only">{r.opponent.long}</span>
              </>
            ) : null}
          </dd>
          <dt className="text-muted">Better than</dt>
          <dd className="wrap-anywhere">{r.betterThan}</dd>
          {r.lineupGain ? (
            <>
              <dt className="text-muted">Lineup gain</dt>
              <dd className="tabular-nums" title={r.gain.title}>
                {r.lineupGain}
              </dd>
            </>
          ) : null}
          {/* My odds before → after from the runs behind its Helps you (Checkpoint 7h, section 5), the cards' forms. */}
          {r.odds ? (
            <>
              <dt className="text-muted">{ODDS_LABEL}</dt>
              <dd className="text-muted">
                <span aria-hidden>{r.odds.frame}</span>
                <span className="sr-only">{r.odds.srFrame}</span>
              </dd>
              {r.odds.lines.map((o) => (
                <Fragment key={o.label}>
                  <dt className="text-muted">{o.label}</dt>
                  <dd className="tabular-nums">
                    {o.srValue === o.value ? (
                      o.value
                    ) : (
                      <>
                        <span aria-hidden>{o.value}</span>
                        <span className="sr-only">{o.srValue}</span>
                      </>
                    )}
                  </dd>
                </Fragment>
              ))}
            </>
          ) : null}
          {r.why ? (
            <>
              <dt className="text-muted">Why no gain</dt>
              <dd>{r.why}</dd>
            </>
          ) : null}
        </dl>
      </div>
    </li>
  );
}
