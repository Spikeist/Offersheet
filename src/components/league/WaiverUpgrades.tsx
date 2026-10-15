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
 * alone); 44 px toggle, switch, lock and "Show all" targets (the toggle's three buttons wrap rather than overflow on a
 * narrow phone). The first config.waivers.rowsShown rows show, then "Show all".
 */
import Link from "next/link";
import { createContext, use, useEffect, useId, useRef, useState, type RefObject } from "react";
import { EngineError, waiverRatingFor, waiverRatingKnown } from "@/lib/engineClient";
import {
  DEPTH_ONLY_TAG,
  RATING_FAILED_TEXT,
  RATING_PENDING_TEXT,
  RATING_PENDING_WEEK_TEXT,
  SAME_POSITION_HELP,
  SAME_POSITION_LABEL,
  UNTOUCHABLES_LABEL,
  WAIVERS_SECTION_ID,
  WAIVERS_TITLE,
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
 * heading (SettingsForm.tsx useRemoveFocus is the Settings page's own pattern). Any other press or key ends the watch, so
 * focus is never taken back later.
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

/** The section for a given view (tests render it directly); `rating`: the season list's rating under way, or failed (RatedWaivers). */
export function WaiverUpgradesCard({ view, rating = null }: { view: WaiversView; rating?: WaiverRatingStatus }) {
  const [mode, setMode] = useState<WaiverListMode>(view.first);
  const [all, setAll] = useState(false);
  // The heading takes focus from script (tabIndex −1) when the section is revealed (the file header).
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Arrived through the header's link (the file header): bring the section into view once it's there, its heading focused.
  useEffect(() => {
    if (window.location.hash === `#${WAIVERS_SECTION_ID}`) revealSection(browserSectionPage(), WAIVERS_SECTION_ID);
  }, []);
  useLockFocus(view, headingRef);
  const lists = waiverLists(view);
  const list = lists.find((l) => l.mode === mode) ?? lists[0] ?? null;
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
              }}
              className={cx("min-h-11 rounded-lg px-3 text-sm font-bold", list?.mode === l.mode ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground")}
            >
              {l.label}
            </button>
          ))}
        </div>
      ) : null}
      {list ? <WaiverListBody list={list} all={all} onShowAll={() => setAll((a) => !a)} rating={rating} /> : null}
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

function WaiverListBody({ list, all, onShowAll, rating }: { list: WaiverListView; all: boolean; onShowAll: () => void; rating: WaiverRatingStatus }) {
  const rows = all ? list.rows : list.rows.slice(0, list.shown);
  return (
    <div>
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
      <p className="mb-3 text-xs leading-relaxed text-muted">{list.note}</p>
      {list.rows.length ? (
        <>
          <ul aria-label={list.caption} className="space-y-2">
            {rows.map((r) => (
              <WaiverRowCard key={r.id} row={r} weekLabel={list.weekLabel} depthOnlyTitle={list.depthOnlyTitle} />
            ))}
          </ul>
          {list.rows.length > list.shown ? (
            <button type="button" aria-expanded={all} onClick={onShowAll} className={cx(buttonClass("secondary"), "mt-3")}>
              {all ? "Show fewer" : `Show all ${list.rows.length}`}
            </button>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted">{list.empty}</p>
      )}
    </div>
  );
}

function WaiverRowCard({ row: r, weekLabel, depthOnlyTitle }: { row: WaiverRowView; weekLabel: string; depthOnlyTitle: string }) {
  return (
    <li className="rounded-xl border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="font-extrabold wrap-anywhere">
            <span className="text-xs font-semibold text-muted">Add </span>
            {r.name}{" "}
            <span className="text-xs font-semibold whitespace-nowrap text-muted">
              {r.pos} · {r.nflTeam} · {r.bye}
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
        <div className="shrink-0 sm:text-right" title={r.main.title}>
          <p className={cx("font-black tabular-nums", r.main.positive ? "text-ok-fg" : "text-muted")}>
            <span className="text-xs font-semibold text-muted">{r.main.label}: </span>
            {r.main.text}
          </p>
          {r.outscores ? <p className="text-xs text-muted">{r.outscores}</p> : null}
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
      <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-sm">
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
        {r.why ? (
          <>
            <dt className="text-muted">Why no gain</dt>
            <dd>{r.why}</dd>
          </>
        ) : null}
      </dl>
    </li>
  );
}
