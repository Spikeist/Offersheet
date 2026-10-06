"use client";
/**
 * "Waiver upgrades" on the League page (planner reply to Checkpoint 7a, §6.2; CLAUDE.md §14 item 3): the free agents who
 * project for more points than one of my players at their position, each with what picking him up adds to my starting
 * lineup and whom he'd replace, for the rest of the season or for one week (a toggle; while a week is under way, "This
 * week" for its games still to play and "Next week"). Every word and number comes from buildWaiversView()
 * (src/lib/waiversView.ts); this file only lays it out.
 *
 * Where its view comes from: the League page (LeaguePage.tsx) builds it from the League model it computed and provides it
 * through WaiversViewContext; LeagueView.tsx places <WaiverUpgrades /> among its sections. Without a provider (or with no
 * list: no team picked, no week left) the section renders nothing.
 *
 * The site header's "Waivers" link goes to /league#waivers (WAIVERS_HREF). The League page computes for a few seconds
 * first, so when the section appears with that hash in the address it brings itself into view and moves keyboard focus to
 * its heading (NavLink.revealSection: Next leaves focus where it was), once, when it mounts; a tap on the link while the
 * section is on the page reveals it the same way (NavLink.revealSectionLink).
 *
 * At 375 px: one card per player (no table: seven columns don't fit a phone), the name wrapping, the gain and the drop on
 * the card's right from sm up and under the name on a phone; tags in words (never color alone); 44 px toggle and "Show all"
 * buttons (the toggle's three buttons wrap rather than overflow on a narrow phone). The first config.waivers.rowsShown rows
 * show, then "Show all".
 */
import { createContext, use, useEffect, useRef, useState } from "react";
import { DEPTH_ONLY_TAG, DEPTH_ONLY_TITLE, WAIVERS_SECTION_ID, WAIVERS_TITLE, type WaiverListMode, type WaiverListView, type WaiverRowView, type WaiversView } from "@/lib/waiversView";
import { browserSectionPage, revealSection } from "../NavLink";
import { Badge, Card, CardTitle, buttonClass, cx } from "../ui";

/** The section's view (buildWaiversView), provided by the League page; null: nothing to show. */
export const WaiversViewContext = createContext<WaiversView | null>(null);

/** The section, from the League page's context (the file header). */
export function WaiverUpgrades() {
  const view = use(WaiversViewContext);
  return view ? <WaiverUpgradesCard view={view} /> : null;
}

/** The lists in toggle order: rest of season, the week under way ("This week"), then "This week" or "Next week". */
function waiverLists(view: WaiversView): WaiverListView[] {
  return [view.ros, view.underWay, view.week].filter((l): l is WaiverListView => l !== null);
}

/** The section for a given view (tests render it directly). */
export function WaiverUpgradesCard({ view }: { view: WaiversView }) {
  const [mode, setMode] = useState<WaiverListMode>(view.first);
  const [all, setAll] = useState(false);
  // The heading takes focus from script (tabIndex −1) when the section is revealed (the file header).
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Arrived through the header's link (the file header): bring the section into view once it's there, its heading focused.
  useEffect(() => {
    if (window.location.hash === `#${WAIVERS_SECTION_ID}`) revealSection(browserSectionPage(), WAIVERS_SECTION_ID);
  }, []);
  const lists = waiverLists(view);
  const list = lists.find((l) => l.mode === mode) ?? lists[0] ?? null;
  return (
    <Card id={WAIVERS_SECTION_ID} className="scroll-mt-4">
      <CardTitle eyebrow="Free agents" headingRef={headingRef}>
        {WAIVERS_TITLE}
      </CardTitle>
      <p className="-mt-1 mb-3 text-sm text-muted">{view.intro}</p>
      {view.empty ? <p className="text-sm">{view.empty}</p> : null}
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
      {list ? <WaiverListBody list={list} all={all} onShowAll={() => setAll((a) => !a)} /> : null}
    </Card>
  );
}

function WaiverListBody({ list, all, onShowAll }: { list: WaiverListView; all: boolean; onShowAll: () => void }) {
  const rows = all ? list.rows : list.rows.slice(0, list.shown);
  return (
    <div>
      {list.underWay ? <p className="mb-1 text-sm font-semibold">{list.underWay}</p> : null}
      <p className="mb-3 text-xs leading-relaxed text-muted">{list.note}</p>
      {list.rows.length ? (
        <>
          <ul aria-label={list.caption} className="space-y-2">
            {rows.map((r) => (
              <WaiverRowCard key={r.id} row={r} weekLabel={list.weekLabel} />
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

function WaiverRowCard({ row: r, weekLabel }: { row: WaiverRowView; weekLabel: string }) {
  return (
    <li className="rounded-xl border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="font-extrabold wrap-anywhere">
            {r.name}{" "}
            <span className="text-xs font-semibold whitespace-nowrap text-muted">
              {r.pos} · {r.nflTeam} · {r.bye}
            </span>
          </p>
          {r.injury || r.status || r.depthOnly ? (
            <p className="mt-1 flex flex-wrap gap-1.5">
              {r.injury ? <Badge tone={r.injury.tone}>{r.injury.long}</Badge> : null}
              {r.status ? (
                <span title={r.status.title}>
                  <Badge tone="brand">{r.status.text}</Badge>
                </span>
              ) : null}
              {r.depthOnly ? (
                <span title={DEPTH_ONLY_TITLE}>
                  <Badge>{DEPTH_ONLY_TAG}</Badge>
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 sm:text-right" title={r.gain.title}>
          <p className={cx("font-black tabular-nums", r.gain.positive ? "text-ok-fg" : "text-muted")}>
            <span className="sr-only">Lineup gain: </span>
            {r.gain.text}
          </p>
          {r.drop ? <p className="text-xs text-muted">{r.drop}</p> : null}
        </div>
      </div>
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
      </dl>
    </li>
  );
}
